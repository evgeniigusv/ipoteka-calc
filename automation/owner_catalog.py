"""Общий и закрытый справочники в одном представлении локального редактора."""
import re
from collections import OrderedDict

import tools_source as source


class Conflict(ValueError):
    pass


def private(record):
    return record['params'].get('ownerOnly') is True


def check_scope(previous, draft):
    if previous and private(previous) != private(draft):
        raise ValueError('Перенос между общим и закрытым справочниками через редактор запрещён.')


class Catalog(dict):
    """В JSON редактора попадают только данные. Конфигурация и исходные строки остаются на сервере."""

    def __init__(self, public, owner, conf, public_conf):
        if any(map(private, public['records'])) or not all(map(private, owner['records'])):
            raise ValueError('Проверьте размещение записей владельца в закрытом справочнике.')
        records = public['records'] + owner['records']
        super().__init__(public, records=records, revision=source.revision(records))
        source.validate(self)
        self.public = public
        self.owner = owner
        self.conf = conf
        self.public_conf = public_conf
        self.files = (public_conf['spreadsheet_id'], public_conf['sheet_name'], conf['spreadsheet_id'], conf['sheet_name'])


def read(authenticated=False):
    config = source.config()
    if 'owner_sheet' not in config:
        return source.read(authenticated)
    sheet = config['owner_sheet']
    if not isinstance(sheet, dict) or not all(isinstance(sheet.get(k), str) and sheet[k].strip()
                                              for k in ('spreadsheet_id', 'sheet_name')):
        raise ValueError('Укажите отдельный закрытый файл и лист в owner_sheet.')
    if (not re.fullmatch(r'[A-Za-z0-9_-]+', sheet['spreadsheet_id'])
            or sheet['spreadsheet_id'] == config['spreadsheet_id']
            or not re.fullmatch(r'[0-9]+', str(sheet.get('gid', '')))):
        raise ValueError('Для записей владельца нужен отдельный Google-файл с указанным gid.')
    if not authenticated:
        raise RuntimeError('Для чтения закрытого справочника переподключите аккаунт владельца.')
    conf = {k: sheet[k] for k in ('spreadsheet_id', 'gid', 'sheet_name')}
    return Catalog(source.read(True, source=config), source.read_private(conf), conf, config)


def updated(snapshot, changes):
    records = {r['id']: r for r in snapshot['records']}
    records.update((r['id'], r) for r in changes)
    return list(records.values())


class Save:
    """Допустимые состояния двух атомарных batchUpdate при повторе того же запроса."""

    def __init__(self, catalog, changes):
        if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
            raise ValueError('От 1 до 100 изменений за сохранение.')
        if len({r['id'] for r in changes}) != len(changes):
            raise ValueError('Повтор ID в изменениях.')
        existing = {r['id']: r for r in catalog['records']}
        self.public, self.owner = [], []
        for r in changes:
            old = existing.get(r['id'])
            check_scope(old, r)
            if old != r:
                (self.owner if private(r) else self.public).append(r)
        public = updated(catalog.public, self.public)
        owner = updated(catalog.owner, self.owner)
        source.validate(dict(catalog, records=public + owner))
        self.files = catalog.files
        self.completed = False
        self.before = catalog['revision']
        self.partial = source.revision(public + catalog.owner['records'])
        self.after = source.revision(public + owner)

    def apply(self, catalog):
        allowed = (self.after,) if self.completed else (self.before, self.partial, self.after)
        if catalog.files != self.files or catalog['revision'] not in allowed:
            raise Conflict('Справочник изменён в Google. Перечитайте его перед сохранением.')
        if catalog['revision'] == self.before and self.public:
            public = source.write_changes(catalog.public, self.public, source=catalog.public_conf)
            catalog = Catalog(public, source.read_private(catalog.conf), catalog.conf, catalog.public_conf)
            if catalog['revision'] != self.partial:
                raise Conflict('После записи общей таблицы справочник изменился. Перечитайте его.')
        if catalog['revision'] == self.partial and self.owner:
            owner = source.write_private(catalog.owner, self.owner, catalog.conf)
            public = source.read(True, source=catalog.public_conf)
            catalog = Catalog(public, owner, catalog.conf, catalog.public_conf)
        if catalog['revision'] != self.after:
            raise Conflict('Состояние после записи изменилось. Перечитайте справочник.')
        self.completed = True
        return catalog


# Пока жива сессия редактора, можно повторить исходный запрос даже после потери ответа Google.
# Храним подготовленные строки в памяти. Чужую версию или другой запрос не продолжаем.
_retries = OrderedDict()


def save(catalog, expected, changes, prepare, operation):
    key = (catalog.files, expected, operation, source.revision(changes))
    plan = _retries.get(key)
    if plan is None:
        if expected != catalog['revision']:
            raise Conflict('Справочник изменён в Google. Перечитайте его перед сохранением.')
        plan = Save(catalog, prepare(catalog, changes))
        # Подготовка может включать долгий разбор текста. Берём свежие строки и их позиции.
        catalog = read(True)
        if catalog.files != plan.files or catalog['revision'] != expected:
            raise Conflict('Во время разбора условия в Google изменились. Перечитайте справочник.')
        if len(_retries) >= 32:
            _retries.popitem(last=False)
        _retries[key] = plan
    try:
        return plan.apply(catalog)
    except (RuntimeError, OSError) as exc:
        raise RuntimeError('Не удалось подтвердить сохранение в Google. Повторите ту же правку: '
                           'редактор сверит обе таблицы и допишет оставшиеся изменения. ' + str(exc)) from exc
