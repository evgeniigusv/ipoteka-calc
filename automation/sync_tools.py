#!/usr/bin/env python3
"""Проверить справочник и обновить безопасный публичный снимок."""
import argparse, json
from tools_source import ROOT, read, validate
p=argparse.ArgumentParser(); p.add_argument('--mortgage-only',action='store_true'); p.add_argument('--dry-run',action='store_true'); args=p.parse_args()
data=read()
if args.mortgage_only:
    previous=json.loads((ROOT/'assets/tools.json').read_text())
    data['records']=[r for r in data['records'] if r['category']=='mortgage']+[r for r in previous['records'] if r['category']!='mortgage']
    data['full_checked_at']=previous.get('full_checked_at',previous['checked_at'])
else: data['full_checked_at']=data['checked_at']
validate(data)
if not args.dry_run:
    data.pop('revision',None); (ROOT/'assets/tools.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('Справочник проверен:',len(data['records']),'записей.')
