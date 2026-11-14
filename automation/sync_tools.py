#!/usr/bin/env python3
"""Проверить справочник и обновить безопасный публичный снимок."""
import argparse, json
from subsidy_catalog import with_subsidies
from tools_source import ROOT, read, public_snapshot
p=argparse.ArgumentParser(); p.add_argument('--mortgage-only',action='store_true'); p.add_argument('--dry-run',action='store_true'); args=p.parse_args()
data=with_subsidies(read())
previous=json.loads((ROOT/'assets/tools.json').read_text())
for project in ['da1','da2','dnk2']:
    for category in ['mortgage','installment']:
        old=sum(r['project']==project and r['category']==category for r in previous['records'])
        new=sum(r['project']==project and r['category']==category for r in data['records'])
        if new < old/2: raise SystemExit('Резкое уменьшение справочника: снимок не обновлён. Проверьте Google.')
if args.mortgage_only:
    data['records']=[r for r in data['records'] if r['category']=='mortgage']+[r for r in previous['records'] if r['category']!='mortgage']
    data['full_checked_at']=previous.get('full_checked_at',previous['checked_at'])
else: data['full_checked_at']=data['checked_at']
data=public_snapshot(data)
if not args.dry_run:
    (ROOT/'assets/tools.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('Справочник проверен:',len(data['records']),'записей.')
