#!/usr/bin/env python3
"""Личный редактор: только loopback, Google OAuth вне репозитория, CSRF и проверка версии."""
import json, secrets, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit
from tools_source import ROOT, config, read, write_changes, publish, revision, validate
from subsidy_catalog import managed, with_subsidies
from tools_ai import interpret
PORT=8795; ORIGIN=f'http://127.0.0.1:{PORT}'; SESSION=secrets.token_urlsafe(32); CSRF=secrets.token_urlsafe(32); LOCK=threading.Lock()
# Подготовленные формы живут только до изменения версии источника или перезапуска.
PREPARED = set()
EVENT = '/api/events/tools-changed'


def prepare(current, changes):
    if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
        raise ValueError('От 1 до 100 изменений за сохранение.')
    records = {r['id']: r for r in current['records']}
    proposed = dict(records)
    seen = set()
    for draft in changes:
        if draft['id'] in seen:
            raise ValueError('Повтор ID в изменениях.')
        seen.add(draft['id'])
        previous = records.get(draft['id'])
        if managed(draft) or (previous and managed(previous)) or draft.get('source') or draft['id'].startswith('sub-'):
            raise ValueError('Субсидированную ипотеку редактируют в справочнике субсидий проекта.')
        if previous and (previous['kind'], previous['project']) != (draft['kind'], draft['project']):
            raise ValueError('Проект и механика существующего инструмента должны совпадать.')
        proposed[draft['id']] = draft
    prepared = {}
    # Сначала основная скидка, чтобы зависимые условия получили новое значение в том же сохранении.
    for draft in sorted(changes, key=lambda r: r['kind'] != 'discount'):
        context = [r for r in proposed.values() if r['kind']=='discount' and r['enabled'] and r['project']==draft['project']]
        key = (current['revision'], revision(draft), revision(context))
        result = draft if key in PREPARED else interpret(records.get(draft['id']), draft, context)
        proposed[draft['id']] = prepared[draft['id']] = result
    validate({'version': 1, 'records': list(proposed.values())})
    if len(PREPARED) > 500:
        PREPARED.clear()
    for result in prepared.values():
        context = [r for r in proposed.values() if r['kind']=='discount' and r['enabled'] and r['project']==result['project']]
        PREPARED.add((current['revision'], revision(result), revision(context)))
    return [prepared[r['id']] for r in changes]


def read_catalog():
    try:
        return read(True)
    except (RuntimeError, FileNotFoundError):
        data = read()
        data['writeNotice'] = 'Для сохранения в Google переподключите аккаунт владельца. Доступен предварительный разбор условий.'
        return data


class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,fmt,*args): pass
    def end_headers(self):
        self.send_header('X-Frame-Options','DENY'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Referrer-Policy','no-referrer')
        super().end_headers()
    def host_ok(self): return self.headers.get('Host')==f'127.0.0.1:{PORT}'
    def same_site(self): return self.headers.get('Sec-Fetch-Site','none') in ['same-origin','none']
    def authorized(self): return self.host_ok() and self.same_site() and ('sm_owner='+SESSION) in self.headers.get('Cookie','').split('; ')
    def respond(self,status,obj,cookie=False):
        raw=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(raw)))
        if cookie: self.send_header('Set-Cookie','sm_owner='+SESSION+'; HttpOnly; SameSite=Strict; Path=/')
        self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        path=urlsplit(self.path).path
        if not self.host_ok() or not self.same_site(): return self.respond(403,{'error':'Редактор доступен только на этом Mac.'})
        if path=='/api/session':
            c=config(); return self.respond(200,{'csrf':CSRF,'source':'https://docs.google.com/spreadsheets/d/'+c['spreadsheet_id']+'/edit#gid='+str(c['gid'])},True)
        if path=='/api/tools':
            if not self.authorized(): return self.respond(401,{'error':'Откройте личный редактор заново.'})
            try: return self.respond(200,with_subsidies(read_catalog()))
            except Exception as e: return self.respond(503,{'error':str(e)})
        # Служебные файлы и .git не раздаются даже локально.
        if path not in ['/','/index.html','/tools.html','/rassrochka.html','/chpv.html','/transh.html'] and not path.startswith('/assets/'):
            return self.respond(404,{'error':'Не найдено'})
        if '..' in path or '%2e' in path.lower(): return self.respond(404,{'error':'Не найдено'})
        return super().do_GET()
    def do_POST(self):
        if not self.authorized() or self.headers.get('Origin')!=ORIGIN or self.headers.get('X-CSRF-Token')!=CSRF:
            return self.respond(403,{'error':'Не подтверждена сессия редактора.'})
        if self.path not in ['/api/tools','/api/publish',EVENT]: return self.respond(404,{'error':'Не найдено'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=1000000: raise ValueError('Неверный размер запроса.')
            req=json.loads(self.rfile.read(size))
            with LOCK:
                preview = self.path == EVENT and req.get('preview') is True
                current = read_catalog() if preview else read(True)
                if self.path in ('/api/tools', EVENT):
                    if req.get('revision')!=current['revision']: return self.respond(409,{'error':'Справочник изменён в Google. Перечитайте его перед сохранением.'})
                    changes = prepare(current, req.get('changes'))
                    if preview:
                        return self.respond(200, {'changes': changes})
                    if read(True)['revision'] != current['revision']:
                        return self.respond(409, {'error':'Во время разбора условия в Google изменились. Перечитайте справочник.'})
                    current=write_changes(current,changes)
                current=with_subsidies(current)
                try: sha=publish(current)
                except Exception as e: return self.respond(200,{'saved':True,'published':False,'data':current,'error':str(e)})
                return self.respond(200,{'saved':True,'published':True,'data':current,'commit':sha})
        except FileNotFoundError: return self.respond(503,{'error':'Переподключите Google для сохранения. Черновик остался в редакторе.'})
        except ValueError as e: return self.respond(400,{'error':str(e)})
        except Exception as e: return self.respond(503,{'error':str(e)})
if __name__=='__main__':
    ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
