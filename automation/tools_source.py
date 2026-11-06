"""Единый справочник Google; секреты и адрес источника только во внешней конфигурации."""
import base64, csv, hashlib, io, json, os, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, quote
ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home()/'.config/ipoteka-calc/tools.json'
COLUMNS = ['ID', 'Группа', 'Раздел', 'Инструмент', 'Проект', 'Механика', 'Условия и примечания', 'Сочетание с акциями', 'Правило сочетания', 'Параметры расчёта', 'Активен']
KEYS = ['id','group','category','name','project','kind','description','combination','mode','params','enabled']

def config():
    return json.loads(os.environ['TOOLS_SOURCE']) if os.environ.get('TOOLS_SOURCE') else json.loads(CONFIG.read_text())

def curl(url, method='GET', body=None, headers=None):
    if not url.startswith('https://'): raise ValueError('Нужен HTTPS')
    lines = (['location', 'max-redirs = 3', 'proto-redir = "=https"'] if url.startswith('https://docs.google.com/') else []) + ['url = '+json.dumps(url), 'request = '+json.dumps(method), 'silent', 'show-error', 'max-time = 40', 'max-filesize = 5000000', 'proto = "=https"', 'write-out = "\\n%{http_code}"']
    for key,value in (headers or {}).items(): lines.append('header = '+json.dumps(key+': '+value))
    if body is not None: lines.append('data-binary = '+json.dumps(body,ensure_ascii=False))
    r=subprocess.run(['curl','--config','-'],input='\n'.join(lines),text=True,capture_output=True,timeout=50)
    if r.returncode: raise RuntimeError('Не удалось связаться с источником: проверьте сеть.')
    data,status=r.stdout.rsplit('\n',1)
    if not status.startswith('2'): raise RuntimeError('Источник вернул HTTP '+status+'. Проверьте подключение и права.')
    return data

def google(method,path,body=None):
    c=config(); auth=json.loads(Path(c['credentials']).expanduser().read_text())
    raw=curl('https://oauth2.googleapis.com/token','POST',urlencode({k:auth[k] for k in ['client_id','client_secret','refresh_token']} | {'grant_type':'refresh_token'}),{'Content-Type':'application/x-www-form-urlencoded'})
    token=json.loads(raw).get('access_token')
    if not token: raise RuntimeError('Переподключите Google на этом Mac.')
    return json.loads(curl('https://sheets.googleapis.com/v4/spreadsheets/'+c['spreadsheet_id']+path,method,json.dumps(body,ensure_ascii=False) if body is not None else None,{'Authorization':'Bearer '+token,'Content-Type':'application/json'}))

def row(r):
    return [json.dumps(r[k],ensure_ascii=False,separators=(',',':')) if k=='params' else ('TRUE' if r[k] else 'FALSE') if k=='enabled' else r[k] for k in KEYS]

def parse(rows):
    if not rows or rows[0]!=COLUMNS: raise ValueError('Изменена структура справочника. Снимок не опубликован.')
    records=[]
    for i,cells in enumerate(rows[1:]):
        if not any(cells):
            if any(any(r) for r in rows[i+2:]): raise ValueError('Уберите пустые строки между программами, затем повторите.')
            break
        if len(cells)!=len(KEYS): raise ValueError('В справочнике есть неполная строка.')
        r=dict(zip(KEYS,cells)); r['params']=json.loads(r['params'])
        if str(r['enabled']).upper() not in ['TRUE','FALSE']: raise ValueError('Активен: нужно TRUE или FALSE.')
        r['enabled']=str(r['enabled']).upper()=='TRUE'; records.append(r)
    data={'version':1,'checked_at':datetime.now(timezone.utc).isoformat(),'records':records}
    validate(data); data['revision']=revision(records); return data

def validate(data):
    p=subprocess.run(['node','-e',"const fs=require('fs');require('./assets/tools-model.js').validate(JSON.parse(fs.readFileSync(0,'utf8')));"],cwd=ROOT,input=json.dumps(data,ensure_ascii=False),text=True,capture_output=True)
    if p.returncode:
        # Не выводим исходные ячейки или секреты в журнал.
        msg=next((s for s in p.stderr.splitlines() if s.startswith('Error:')), 'Проверьте поля программ.')
        raise ValueError(msg)

def revision(records):
    return hashlib.sha256(json.dumps(records,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def read(authenticated=False):
    c=config()
    if authenticated:
        rg=quote("'"+c['sheet_name'].replace("'","''")+"'!A1:K601",safe='')
        rows=google('GET','/values/'+rg+'?valueRenderOption=UNFORMATTED_VALUE').get('values',[])
    else:
        raw=curl('https://docs.google.com/spreadsheets/d/'+c['spreadsheet_id']+'/export?'+urlencode({'format':'csv','gid':c['gid']}))
        rows=list(csv.reader(io.StringIO(raw)))
        while rows and not any(rows[-1]): rows.pop()
    return parse(rows)

def write_changes(current,changes):
    byid={r['id']:i+2 for i,r in enumerate(current['records'])}; records={r['id']:r for r in current['records']}
    if not isinstance(changes,list) or not changes or len(changes)>100: raise ValueError('От 1 до 100 изменений за сохранение.')
    seen=set(); nextrow=len(byid)+2; updates=[]; title="'"+config()['sheet_name'].replace("'","''")+"'"
    for r in changes:
        if r['id'] in seen: raise ValueError('Повтор ID в изменениях.')
        seen.add(r['id']); n=byid.get(r['id'])
        if n is None: n=nextrow; nextrow+=1
        records[r['id']]=r; updates.append({'range':f'{title}!A{n}:K{n}','values':[row(r)]})
    validate({'version':1,'records':list(records.values())})
    google('POST','/values:batchUpdate',{'valueInputOption':'RAW','data':updates})
    return read(True)

def publish(data):
    validate(data)
    clean={k:data[k] for k in ['version','checked_at','records']}; payload=json.dumps(clean,ensure_ascii=False,indent=2)+'\n'
    endpoint='repos/'+config().get('repo','evgeniigusv/ipoteka-calc')+'/contents/assets/tools.json'
    def gh(args,stdin=None):
        p=subprocess.run(['gh','api',*args],input=stdin,text=True,capture_output=True,timeout=60)
        if p.returncode: raise RuntimeError('Google сохранён; GitHub не принял обновление. Повторите публикацию.')
        return json.loads(p.stdout)
    old=gh([endpoint+'?ref=main'])
    sha=old.get('sha')
    req={'message':'Обновить инструменты из Google','branch':'main','content':base64.b64encode(payload.encode()).decode(),'sha':sha}
    result=gh(['--method','PUT',endpoint,'--input','-'],json.dumps(req))
    return result['commit']['sha']
