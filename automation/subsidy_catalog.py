"""Субсидированные программы двух банковских справочников в формате карточек."""
import hashlib
import json
import os
from pathlib import Path
from collections import defaultdict
from functools import lru_cache
from time import monotonic

from sync_mortgage import CONFIG, PROJECTS, snapshot

PUBLISHED = Path(__file__).resolve().parents[1] / 'assets/tools.json'

PROJECT = {'ДА — 1 очередь':'da1', 'ДА — 2 очередь':'da2', 'ДНК — 2 очередь':'dnk2'}


def managed(record):
    p = record['params']
    return record['kind'] == 'mortgage' and (p.get('type') == 'Семейная ипотека' or p.get('variant') == 'субсидированная ставка')


def identity(p):
    return tuple(p.get(k) for k in ('bank', 'type', 'kids', 'variant', 'term', 'rate'))


def app_managed(record):
    return record['params'].get('appManaged') is True


def bank_row(record):
    return managed(record) and not app_managed(record) and not record['params'].get('ownerOnly')


def bank_key(record):
    # Очередь и исходные условия неизменны для привязки даже после правки карточки.
    parts = (record['project'], *identity(record['params'])[:-1])
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def manual_record(previous, draft, imported=()):
    """Служебные поля выводим из доверенных строк, в том числе при повторе предпросмотра."""
    params = dict(draft['params'])
    origin = None
    adopting = previous is not None and previous.get('source') == 'subsidies'
    already_manual = previous is not None and app_managed(previous)
    if adopting:
        if params.get('appManaged') is not True:
            raise ValueError('Для изменения ставки в справочнике субсидий примите карточку под управление приложения.')
        key = bank_key(previous)
        rate = previous['params']['rate']
        peers = sorted({r['params']['rate'] for r in imported
                        if r.get('source') == 'subsidies' and bank_key(r) == key and r['id'] != previous['id']})
        origin = dict(key=key, rate=rate, peers=peers)
    elif already_manual:
        origin = previous['params'].get('subsidyOrigin')
    elif draft.get('source') or draft['id'].startswith('sub-') or (previous and bank_row(previous)):
        raise ValueError('Исходная программа банка изменилась. Перечитайте справочник.')
    if draft.get('source') and not (adopting and draft['source'] == 'subsidies'):
        raise ValueError('Неверный источник карточки.')
    if 'subsidyOrigin' in params and (origin is None or params['subsidyOrigin'] != origin):
        raise ValueError('Привязку к банковской строке определяет сервер.')
    if 'appManaged' in params and params['appManaged'] is not True:
        raise ValueError('Для ручной карточки требуется appManaged=true.')
    if adopting or already_manual or managed(draft):
        if draft['kind'] != 'mortgage' or (origin and params.get('ownerOnly')):
            raise ValueError('Принятая банковская ипотека должна остаться в общем справочнике.')
        params['appManaged'] = True
    elif 'appManaged' in params:
        raise ValueError('Признак ручного ведения относится к семейной или субсидированной ипотеке.')
    if origin is not None:
        params['subsidyOrigin'] = origin
    result = dict(draft, params=params)
    result.pop('source', None)
    return result


def without_claimed(cards, claims, *, fallback=False):
    """Различаем варианты с одинаковыми условиями по исходным ставкам."""
    families = defaultdict(list)
    for card in cards:
        families[bank_key(card)].append(card)
    hidden = set()
    for key, origins in claims.items():
        rows = families[key]
        rates = {row['params']['rate'] for row in rows}
        claimed = {origin['rate'] for origin in origins}
        missing = claimed - rates
        hide_rates = set(claimed)
        if missing:
            peers = {rate for origin in origins for rate in origin['peers']} - claimed
            unknown = rates - claimed - peers
            if unknown and not fallback and (len(unknown) > len(missing) or peers - rates):
                raise ValueError('После изменения ставок невозможно различить варианты одной банковской программы.')
            hide_rates.update(unknown)
        hidden.update(row['id'] for row in rows if row['params']['rate'] in hide_rates)
    return [r for r in cards if r['id'] not in hidden]


@lru_cache(maxsize=1)
def sources(period):
    conf = json.loads(os.environ['SUBSIDY_SOURCES']) if os.environ.get('SUBSIDY_SOURCES') else json.loads(CONFIG.read_text())
    return snapshot(conf, allow_partial=True)


def project_cards(programs, labels, old):
    cards = []
    for item in programs:
        if item['projects'] != labels:
            continue
        p = {k:v for k,v in item.items() if k != 'projects'}
        if not managed({'kind':'mortgage','params':p}):
            continue
        group = hashlib.sha256(json.dumps(identity(p), ensure_ascii=False).encode()).hexdigest()[:16]
        for label in labels:
            project = PROJECT[label]
            row = old.get((project, identity(p)))
            if row is None:
                name = ' · '.join([p['bank'], p.get('kids') or p['type'], str(p['term'])+' лет'])
                row = dict(id='sub-'+project+'-'+group, group='sub-'+group, name=name, project=project,
                           kind='mortgage', category='mortgage', enabled=True, description='',
                           combination='По условиям банка', mode='individual')
            cards.append(dict(row, params=p, source='subsidies'))
    return cards


def with_subsidies(data, source=None):
    previous = json.loads(PUBLISHED.read_text())
    if source is None:
        try:
            source = sources(int(monotonic() // 180))
        except (OSError, KeyError, RuntimeError, ValueError):
            source = {'errors': dict.fromkeys(PROJECTS, 'Источник банковских ставок недоступен.')}
    old = {(r['project'], identity(r['params'])): r for r in data['records'] if bank_row(r)}
    independent = [r for r in data['records'] if not bank_row(r)]
    reserved = {r['id'] for r in independent}
    bound = [r for r in independent if r['params'].get('subsidyOrigin')]
    records, warnings, checked = [], {}, {}
    for key, labels in PROJECTS.items():
        projects = [PROJECT[label] for label in labels]
        reason = source.get('errors', {}).get(key)
        fresh = [] if reason else project_cards(source['programs'], labels, old)
        for project in projects:
            previous_rows = [r for r in previous['records'] if r['project'] == project]
            backup = [r for r in previous_rows if bank_row(r)]
            claims = defaultdict(list)
            for r in bound:
                if r['project'] == project:
                    origin = r['params']['subsidyOrigin']
                    claims[origin['key']].append(origin)
            cards = [r for r in fresh if r['project'] == project]
            problem = reason
            if not problem:
                previous_count = len(backup) + sum(bool(r['params'].get('subsidyOrigin')) for r in previous_rows)
                catalog_count = sum(p == project for p, _ in old)
                if not cards or len(cards) < max(previous_count, catalog_count) / 2:
                    problem = 'Резко уменьшилось число субсидированных программ.'
                else:
                    try:
                        cards = without_claimed(cards, claims)
                    except ValueError as exc:
                        problem = str(exc)
            if problem:
                # Опубликованные ручные карточки уже исключили свои строки из этого снимка.
                applied = {(o['key'], o['rate']) for r in previous_rows
                           if (o := r['params'].get('subsidyOrigin'))}
                if not backup and not applied:
                    raise ValueError(f'Нет проверенной копии ставок для {project}')
                pending = {k: [o for o in origins if (k, o['rate']) not in applied]
                           for k, origins in claims.items()}
                cards = without_claimed(backup, pending, fallback=True)
                # Старые резервные снимки предшествуют появлению поля source.
                cards = [dict(r, source='subsidies') for r in cards]
                dates = previous.get('mortgageCheckedAt')
                checked[project] = previous['checked_at'] if dates is None else dates[project]
                warnings[project] = problem
            else:
                checked[project] = source['checked_at']
            records.extend(r for r in cards if r['id'] not in reserved)
    records.extend(independent)
    return dict(data, records=records, mortgageWarnings=warnings, mortgageCheckedAt=checked)
