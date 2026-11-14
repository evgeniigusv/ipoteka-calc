"""Субсидированные программы двух банковских справочников в формате карточек."""
import hashlib
import json
import os
from pathlib import Path
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
        source = sources(int(monotonic() // 180))
    old = {(r['project'], identity(r['params'])): r for r in data['records'] if managed(r)}
    records, warnings, checked = [], {}, {}
    for key, labels in PROJECTS.items():
        projects = [PROJECT[label] for label in labels]
        backup = [r for r in previous['records'] if r['project'] in projects and managed(r)]
        reason = source.get('errors', {}).get(key)
        if not reason:
            cards = project_cards(source['programs'], labels, old)
            for project in projects:
                count = sum(r['project'] == project for r in cards)
                old_count = sum(r['project'] == project for r in backup)
                catalog_count = sum(p == project for p, _ in old)
                if not count or count < max(old_count, catalog_count) / 2:
                    reason = 'Резко уменьшилось число субсидированных программ.'
                    break
        if reason:
            for project in projects:
                if not any(r['project'] == project for r in backup):
                    raise ValueError(f'Нет проверенной копии ставок для {project}')
                # У прежнего формата checked_at — время последней общей успешной сверки.
                dates = previous.get('mortgageCheckedAt')
                checked[project] = previous['checked_at'] if dates is None else dates[project]
                warnings[project] = reason
            records.extend(backup)
        else:
            records.extend(cards)
            checked.update(dict.fromkeys(projects, source['checked_at']))
    records.extend(r for r in data['records'] if not managed(r))
    return dict(data, records=records, mortgageWarnings=warnings, mortgageCheckedAt=checked)
