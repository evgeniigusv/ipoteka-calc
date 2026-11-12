"""Субсидированные программы двух банковских справочников в формате карточек."""
import hashlib
import json
import os
from collections import Counter
from functools import lru_cache
from time import monotonic

from sync_mortgage import CONFIG, snapshot

PROJECT = {'ДА — 1 очередь':'da1', 'ДА — 2 очередь':'da2', 'ДНК — 2 очередь':'dnk2'}


def managed(record):
    p = record['params']
    return record['kind'] == 'mortgage' and (p.get('type') == 'Семейная ипотека' or p.get('variant') == 'субсидированная ставка')


def identity(p):
    return tuple(p.get(k) for k in ('bank', 'type', 'kids', 'variant', 'term', 'rate'))


@lru_cache(maxsize=1)
def sources(period):
    conf = json.loads(os.environ['SUBSIDY_SOURCES']) if os.environ.get('SUBSIDY_SOURCES') else json.loads(CONFIG.read_text())
    return snapshot(conf)


def with_subsidies(data, source=None):
    source = source or sources(int(monotonic() // 180))
    old = {(r['project'], identity(r['params'])):r for r in data['records'] if managed(r)}
    records = []
    for item in source['programs']:
        p = {k:v for k,v in item.items() if k != 'projects'}
        if not managed({'kind':'mortgage','params':p}):
            continue
        group = hashlib.sha256(json.dumps(identity(p), ensure_ascii=False).encode()).hexdigest()[:16]
        for project in item['projects']:
            project = PROJECT[project]
            row = old.get((project, identity(p)))
            if row is None:
                name = ' · '.join([p['bank'], p.get('kids') or p['type'], str(p['term'])+' лет'])
                row = dict(id='sub-'+project+'-'+group, group='sub-'+group, name=name, project=project,
                           kind='mortgage', category='mortgage', enabled=True, description='',
                           combination='По условиям банка', mode='individual')
            records.append(dict(row, params=p, source='subsidies'))
    counts = Counter(r['project'] for r in records)
    for project in PROJECT.values():
        previous = sum(r['project']==project and managed(r) for r in data['records'])
        if not counts[project] or counts[project] < previous/2:
            raise ValueError('Резко изменилось количество субсидированных программ. Проверьте справочники.')
    return dict(data, records=records+[r for r in data['records'] if not managed(r)])
