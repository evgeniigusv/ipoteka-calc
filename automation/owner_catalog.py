"""Локальный каталог. Google читается только явной одноразовой миграцией.

SQLite, исходный импорт и резервные копии всегда находятся вне репозитория.
Восстановление: остановить редактор, restore_backup(backup, catalog_path()), запустить.
"""
import copy
import json
import math
import os
import re
import shutil
import sqlite3
import tempfile
from contextlib import contextmanager, closing
from datetime import datetime, timezone
from pathlib import Path

import tools_source as source

DEFAULT_SETTINGS = {'subsidyCompensation': dict.fromkeys(('da1', 'da2', 'dnk2'), .1), 'specialFlats': []}


class Conflict(ValueError):
    pass


def private(record):
    return record['params'].get('ownerOnly') is True


def check_scope(previous, draft):
    promotion_move = previous and previous['category'] == draft['category'] == 'discount'
    if previous and private(previous) != private(draft) and not promotion_move:
        raise ValueError('Перенос между общим и закрытым справочниками через редактор запрещён.')


def now():
    return datetime.now(timezone.utc).isoformat()


def outside_repo(path):
    path = Path(path).expanduser().resolve()
    if path == source.ROOT or source.ROOT in path.parents:
        raise ValueError('База и резервные копии должны храниться вне Git.')
    return path


def catalog_path():
    return outside_repo(os.environ.get('IPOTEKA_CATALOG_PATH') or source.config().get('catalog_path')
                        or Path.home() / '.local/share/ipoteka-calc/catalog.sqlite')


def validate_settings(settings):
    if not isinstance(settings, dict) or set(settings) != {'subsidyCompensation', 'specialFlats'}:
        raise ValueError('Нужны subsidyCompensation и specialFlats.')
    caps = settings['subsidyCompensation']
    if not isinstance(caps, dict) or set(caps) != {'da1', 'da2', 'dnk2'} or any(
            type(v) not in (float, int) or not math.isfinite(v) or not 0 <= v <= .99 for v in caps.values()):
        raise ValueError('Компенсация каждого проекта: доля от 0 до 0.99.')
    flats = settings['specialFlats']
    if not isinstance(flats, list) or len(flats) > 10000 or any(
            not isinstance(v, str) or not re.fullmatch(r'[0-9]{1,20}:[0-9A-Za-zА-Яа-яЁё/-]{1,30}', v)
            for v in flats) or len(set(flats)) != len(flats):
        raise ValueError('Квартиры: уникальные идентификаторы house_id:num.')
    return settings


def check_inventory(settings, previous):
    added = set(settings['specialFlats']) - set(previous['specialFlats'])
    if added:
        inventory = json.loads((source.ROOT / 'assets/macro-flats.json').read_text())
        allowed = {str(r['house_id']) + ':' + str(r['num']) for r in inventory['rows']}
        if not added <= allowed:
            raise ValueError('Выберите квартиры из публичного списка Macro.')


def encode(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


class Catalog(dict):
    def __init__(self, data, path):
        super().__init__(data)
        self.path = Path(path)


@contextmanager
def connect(path=None):
    path = outside_repo(path or catalog_path())
    if not path.is_file():
        raise FileNotFoundError('Локальный каталог не перенесён. Сначала выполните проверенную миграцию.')
    db = sqlite3.connect(str(path), timeout=60, isolation_level=None)
    try:
        db.execute('PRAGMA busy_timeout=60000')
        db.execute('PRAGMA synchronous=FULL')
        yield db
    finally:
        db.close()


def snapshot(db, path):
    row = db.execute('SELECT data, revision FROM catalog WHERE id=1').fetchone()
    if not row:
        raise RuntimeError('В локальном каталоге нет проверенного импорта.')
    data = json.loads(row[0])
    data['revision'] = row[1]
    return Catalog(data, path)


def read(authenticated=False):
    if not authenticated:
        raise RuntimeError('Полный каталог доступен только в личном редакторе.')
    path = catalog_path()
    with connect(path) as db:
        return snapshot(db, path)


def updated(data, changes):
    records = {r['id']: r for r in data['records']}
    records.update((r['id'], r) for r in changes)
    return list(records.values())


def request_key(expected, operation, payload):
    return source.revision([expected, operation, payload])


def receipt(db, key, current):
    row = db.execute('SELECT revision FROM requests WHERE request_key=?', (key,)).fetchone()
    if row:
        if row[0] != current['revision']:
            raise Conflict('После сохранения каталог изменился. Перечитайте его.')
        return True
    return False


def commit(db, current, candidate, key):
    candidate = dict(candidate)
    candidate.pop('revision', None)
    validate_settings(candidate['settings'])
    source.validate(candidate)
    seq = db.execute('SELECT generation FROM catalog WHERE id=1').fetchone()[0] + 1
    rev = str(seq) + '-' + source.revision(candidate)
    candidate['checked_at'] = now()
    db.execute('UPDATE catalog SET data=?, revision=?, generation=? WHERE id=1 AND revision=?',
               (encode(candidate), rev, seq, current['revision']))
    if db.execute('SELECT changes()').fetchone()[0] != 1:
        raise Conflict('Каталог изменился. Перечитайте его.')
    db.execute('INSERT INTO requests VALUES (?, ?, ?)', (key, rev, now()))
    db.execute('COMMIT')
    return Catalog(dict(candidate, revision=rev), current.path)


def transact(current, expected, payload, operation, transform):
    key = request_key(expected, operation, payload)
    # Повтор подтверждённой операции переживает перезапуск процесса.
    with connect(current.path) as db:
        fresh = snapshot(db, current.path)
        if receipt(db, key, fresh):
            return fresh
        if expected != fresh['revision']:
            raise Conflict('Каталог изменился. Перечитайте его перед сохранением.')
    candidate = transform(fresh)  # Разбор условий и сеть не держат write-lock SQLite.
    with connect(current.path) as db:
        db.execute('BEGIN IMMEDIATE')
        fresh = snapshot(db, current.path)
        if receipt(db, key, fresh):
            db.execute('ROLLBACK')
            return fresh
        if expected != fresh['revision']:
            raise Conflict('Во время подготовки каталог изменился. Перечитайте его.')
        result = commit(db, fresh, candidate, key)
    return result


def clean_references(data):
    """Смена проекта/доступа акции атомарно убирает недопустимые связи у всех инструментов."""
    result = copy.deepcopy(dict(data))
    byid = {r['id']: r for r in result['records']}
    for record in result['records']:
        if 'compatiblePromotions' not in record['params']:
            continue
        allowed = []
        for ident in record['params']['compatiblePromotions']:
            promotion = byid.get(ident)
            if promotion and promotion['category'] == 'discount' and promotion['project'] == record['project'] and (
                    private(record) or not private(promotion)) and ident != record['id']:
                allowed.append(ident)
        record['params']['compatiblePromotions'] = allowed
    return result


def save(catalog, expected, changes, prepare, operation):
    if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
        raise ValueError('От 1 до 100 изменений за сохранение.')
    if len({r['id'] for r in changes}) != len(changes):
        raise ValueError('Повтор ID в изменениях.')
    def transform(current):
        normalized = prepare(current, changes)
        existing = {r['id']: r for r in current['records']}
        for record in normalized:
            check_scope(existing.get(record['id']), record)
        return clean_references(dict(current, records=retire_installment_fields(updated(current, normalized))))
    return transact(catalog, expected, changes, operation, transform)


def save_settings(catalog, expected, settings):
    validate_settings(settings)
    def transform(current):
        check_inventory(settings, current['settings'])
        return dict(current, settings=copy.deepcopy(settings))
    return transact(catalog, expected, settings, 'settings', transform)


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def backup_to(destination, path=None):
    path = outside_repo(path or catalog_path())
    destination = outside_repo(destination)
    if destination == path:
        raise ValueError('Резерв должен отличаться от рабочей базы.')
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(prefix='.catalog-', dir=destination.parent)
    os.close(fd)
    try:
        with connect(path) as src, closing(sqlite3.connect(tmp)) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Резерв SQLite не прошёл проверку.')
        os.replace(tmp, destination)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return destination


def restore_backup(backup, destination):
    destination = outside_repo(destination)
    if destination.exists():
        raise ValueError('Восстанавливайте в новый файл; действующую базу сначала сохраните отдельно.')
    backup_to(destination, backup)
    with connect(destination) as db:
        data = snapshot(db, destination)
    source.validate(data)
    validate_settings(data['settings'])
    return data


def backups():
    conf = source.config()
    path = catalog_path()
    with connect(path) as db:
        rev = snapshot(db, path)['revision']
    local = outside_repo(conf.get('backup_dir') or Path.home() / 'Backups/ipoteka-calc/catalog')
    name = 'catalog-' + rev + '.sqlite'
    backup_to(local / name, path)
    external = conf.get('external_backup_dir')
    if not external:
        raise RuntimeError('Локальный резерв готов; внешняя папка резервов не настроена.')
    backup_to(outside_repo(external) / name, path)


def import_bank_snapshot(incoming, report_errors=False):
    """Из опубликованного снимка принимаются только свежие банковские строки, никогда настройки."""
    from subsidy_catalog import bank_row, bank_key, without_claimed
    from collections import defaultdict
    source.validate(source.public_snapshot(incoming))
    for attempt in range(3):
        current = read(True)
        records = current['records']
        dates = dict(current.get('mortgageCheckedAt', {}))
        warnings = dict(current.get('mortgageWarnings', {}))
        changed = False
        for project in ('da1', 'da2', 'dnk2'):
            stamp = incoming.get('mortgageCheckedAt', {}).get(project)
            problem = incoming.get('mortgageWarnings', {}).get(project)
            if report_errors and problem and warnings.get(project) != problem:
                warnings[project] = problem
                changed = True
            if not stamp or (dates.get(project) and datetime.fromisoformat(stamp) <= datetime.fromisoformat(dates[project])):
                continue
            rows = [r for r in incoming['records'] if r['project'] == project and bank_row(r)]
            old = [r for r in records if r['project'] == project and bank_row(r)]
            if not rows or len(rows) < len(old) / 2:
                continue
            claims = defaultdict(list)
            for r in records:
                if r['project'] == project and r['params'].get('subsidyOrigin'):
                    o = r['params']['subsidyOrigin']; claims[o['key']].append(o)
            try:
                rows = without_claimed(rows, claims)
            except ValueError:
                continue
            # Условия сочетания и названия локального каталога не принадлежат банковскому импорту.
            byid = {r['id']: r for r in old}
            bykey = defaultdict(list)
            for r in old: bykey[bank_key(r)].append(r)
            newbykey = defaultdict(list)
            for r in rows: newbykey[bank_key(r)].append(r)
            incoming_ids = {r['id'] for r in rows}
            ambiguous = any((r['params'].get('compatiblePromotions') or r['mode'] != 'additive' or not r['enabled'])
                            and r['id'] not in incoming_ids and newbykey[bank_key(r)]
                            and (len(bykey[bank_key(r)]) != 1 or len(newbykey[bank_key(r)]) != 1) for r in old)
            if ambiguous:
                problem = 'Невозможно однозначно перенести локальные условия между вариантами ставки; сохранён прежний снимок.'
                if warnings.get(project) != problem:
                    warnings[project] = problem
                    changed = True
                continue
            merged = []
            for row in rows:
                previous = byid.get(row['id'])
                candidates = bykey[bank_key(row)]
                if previous is None and len(candidates) == 1 and len(newbykey[bank_key(row)]) == 1:
                    previous = candidates[0]
                    row = dict(row, id=previous['id'], group=previous['group'])
                params = dict(row['params'])
                if previous:
                    for k in ('compatiblePromotions', 'note', 'noExtra', 'extraSequential'):
                        if k in previous['params']: params[k] = previous['params'][k]
                    row = dict(row, **{k: previous[k] for k in ('name','description','combination','mode','enabled')})
                else:
                    row = dict(row, mode='additive')
                params.setdefault('compatiblePromotions', [])
                merged.append(dict(row, params=params, source='subsidies'))
            reserved = {r['id'] for r in records if not bank_row(r)}
            records = [r for r in records if not (r['project'] == project and bank_row(r))]
            records.extend(r for r in merged if r['id'] not in reserved)
            dates[project] = stamp
            warnings.pop(project, None)
            if incoming.get('mortgageWarnings', {}).get(project):
                warnings[project] = incoming['mortgageWarnings'][project]
            changed = True
        if not changed:
            return current
        candidate = dict(current, records=records, mortgageCheckedAt=dates, mortgageWarnings=warnings)
        try:
            return transact(current, current['revision'], incoming, 'banks', lambda _: candidate)
        except Conflict:
            if attempt == 2: raise


OBSOLETE_INSTALLMENT_FIELDS = ('maxDisc', 'launchDiscount', 'launchUntil', 'pvChoices', 'discAt70')
DNK_50_DESCRIPTION = 'ПВ от 50%; в октябре 2028 — 5%, остаток до 30.01.2029. При ПВ от 71% актуальная скидка полной оплаты. Точный день октября уточняется.'


def retire_installment_fields(records):
    result = copy.deepcopy(records)
    for record in result:
        if record['kind'] == 'installment':
            for key in OBSOLETE_INSTALLMENT_FIELDS:
                record['params'].pop(key, None)
    return result


def migration_records(records):
    result = retire_installment_fields(records)
    for r in result:
        if r['id'] == 'installment-117f2da64d7d2a' and r['project'] == 'dnk2' and r['kind'] == 'installment':
            r['description'] = DNK_50_DESCRIPTION
    changes = {'additive': 0, 'compatibilityMapped': 0, 'compatibilityReview': 0}
    for r in result:
        if r['mode'] != 'additive': changes['additive'] += 1
        r['mode'] = 'additive'
        if 'compatiblePromotions' in r['params']: continue
        names = {}
        for promo in records:
            if promo['category'] == 'discount' and promo['project'] == r['project'] and promo['id'] != r['id'] and not private(promo):
                names.setdefault(promo['name'].strip().casefold(), []).append(promo['id'])
        text = r['combination'].strip().casefold()
        ids = names.get(text, [])
        r['params']['compatiblePromotions'] = ids if len(ids) == 1 else []
        changes['compatibilityMapped' if len(ids) == 1 else 'compatibilityReview'] += bool(text)
    return result, changes


def migrate_google(backup_dir):
    """Редактор остановлен вызывающей стороной. Два полных OAuth-чтения до cutover."""
    path = catalog_path()
    if path.exists():
        raise ValueError('База уже существует; повторная миграция запрещена.')
    conf = source.config()
    owner_conf = conf.get('owner_sheet')
    if not isinstance(owner_conf, dict) or owner_conf.get('spreadsheet_id') == conf.get('spreadsheet_id'):
        raise ValueError('Нужна отдельная закрытая таблица владельца.')
    def fetch():
        public = source.read(True, source=conf)
        owner = source.read_private(owner_conf)
        if any(map(private, public['records'])) or not all(map(private, owner['records'])):
            raise ValueError('Нарушены границы общего и закрытого каталогов.')
        data = dict(public, records=public['records'] + owner['records'])
        source.validate(data)
        return data, len(public['records']), len(owner['records'])
    original, public_count, owner_count = fetch()
    backup_dir = outside_repo(backup_dir)
    atomic_json(backup_dir / 'original-google-catalog.json', original)
    again, _, _ = fetch()
    if source.revision(again['records']) != source.revision(original['records']):
        raise Conflict('Google изменился во время миграции. Перенос остановлен.')
    records, changes = migration_records(original['records'])
    data = dict(version=1, checked_at=now(), records=records, settings=copy.deepcopy(DEFAULT_SETTINGS))
    source.validate(data)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix='.migration-', dir=path.parent)
    os.close(fd)
    with closing(sqlite3.connect(temp)) as db:
        db.executescript('CREATE TABLE catalog(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision TEXT NOT NULL, generation INTEGER NOT NULL); CREATE TABLE requests(request_key TEXT PRIMARY KEY, revision TEXT NOT NULL, created_at TEXT NOT NULL);')
        rev = '1-' + source.revision(data)
        db.execute('INSERT INTO catalog VALUES(1,?,?,1)', (encode(data), rev))
        db.commit()
    with connect(temp) as db:
        stored = snapshot(db, temp)
    assert source.revision(stored['records']) == source.revision(records)
    backup = backup_to(backup_dir / 'catalog.sqlite', temp)
    restored = restore_backup(backup, backup_dir / 'restored-verified.sqlite')
    assert dict(restored) == dict(stored)
    # Не перезаписываем каталог, созданный другим процессом.
    os.link(temp, path)
    os.unlink(temp)
    report = dict(public=public_count, owner=owner_count, total=len(records),
                  originalHash=source.revision(original['records']), importedHash=source.revision(records),
                  restoredHash=source.revision(restored['records']), changes=changes, restoreVerified=True,
                  database=str(path), backup=str(backup))
    atomic_json(backup_dir / 'migration-report.json', report)
    return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--migrate-google', metavar='BACKUP_DIR')
    parser.add_argument('--backup', action='store_true')
    args = parser.parse_args()
    if args.migrate_google: print(json.dumps(migrate_google(args.migrate_google), ensure_ascii=False, indent=2))
    elif args.backup: backups()
    else: parser.error('Укажите --migrate-google или --backup')
