#!/usr/bin/env python3
"""Личный редактор: только loopback, SQLite вне репозитория, CSRF и транзакционная проверка версии."""
import json, secrets, threading, hmac, re
import owner_catalog
from owner_catalog import read
from zipfile import BadZipFile
from xml.etree.ElementTree import ParseError
from tools_proposals import document, proposals, transcribe
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit
from tools_source import ROOT, config, publish, revision, validate
from subsidy_catalog import PUBLISHED, bank_row, manual_record, with_subsidies
from subsidy_source import source_link
from tools_google_connect import start as connect_google
from tools_ai import TEXT_FIELDS, interpret
PORT=8795; ORIGIN=f'http://127.0.0.1:{PORT}'; SESSION=secrets.token_urlsafe(32); CSRF=secrets.token_urlsafe(32); LOCK=threading.Lock()
# Подготовленные формы живут только до изменения версии источника или перезапуска.
PREPARED = set()
EVENT = '/api/events/tools-changed'


def ticket(rev, record):
    message = json.dumps([rev, record], sort_keys=True, separators=(',', ':')).encode()
    return hmac.new(SESSION.encode(), message, 'sha256').hexdigest()


def prepare(current, changes):
    if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
        raise ValueError('От 1 до 100 изменений за сохранение.')
    records = {r['id']: r for r in current['records']}
    # В общем листе могут отсутствовать строки, созданные исключительно банковским импортом.
    # Для записи адрес строки берётся только из исходного общего листа.
    needs_import = any(r['kind'] == 'mortgage' or r.get('source') or r['id'].startswith('sub-')
                       or (r['id'] in records and bank_row(records[r['id']])) for r in changes)
    visible = current['records'] if needs_import else []
    imported = {r['id']: r for r in visible if r.get('source') == 'subsidies'}
    previous_rows = records | imported
    proposed = dict(records)
    seen = set()
    normalized = []
    for draft in changes:
        if draft['id'] in seen:
            raise ValueError('Повтор ID в изменениях.')
        seen.add(draft['id'])
        previous = previous_rows.get(draft['id'])
        owner_catalog.check_scope(previous, draft)
        promotion_move = previous and previous['category'] == draft['category'] == 'discount' and previous['kind'] == draft['kind']
        if previous and not promotion_move and (previous['kind'], previous['project']) != (draft['kind'], draft['project']):
            raise ValueError('Проект и механика существующего инструмента должны совпадать.')
        if previous and previous.get('source') == 'subsidies':
            stored = records.get(draft['id'])
            if stored and (not bank_row(stored) or stored['project'] != previous['project']):
                raise ValueError('ID банковской строки занят другой записью в каталоге.')
        draft = manual_record(previous, draft, imported.values())
        proposed[draft['id']] = draft
        normalized.append(draft)
    prepared = {}
    # Сначала основная скидка, чтобы зависимые условия получили новое значение в том же сохранении.
    for draft in sorted(normalized, key=lambda r: r['category'] != 'discount'):
        context = [r for r in proposed.values() if r['category']=='discount' and r['enabled'] and r['project']==draft['project'] and (owner_catalog.private(draft) or not owner_catalog.private(r))]
        key = (current['revision'], revision(draft), revision(context))
        previous = previous_rows.get(draft['id'])
        # При переносе в соседнюю колонку текст уже разобран у программы-образца.
        reference = previous
        if reference is None:
            reference = next((r for r in previous_rows.values()
                              if r['enabled'] and r['group'] == draft['group'] and r['kind'] == draft['kind']
                              and r['project'] != draft['project']
                              and all(r[k] == draft[k] for k in TEXT_FIELDS)), None)
        result = draft if key in PREPARED else interpret(reference, draft, context)
        result = manual_record(previous, result, imported.values())
        proposed[draft['id']] = prepared[draft['id']] = result
    candidate = owner_catalog.clean_references(dict(current, records=list(proposed.values())))
    validate(candidate)
    cleaned = {r['id']: r for r in candidate['records']}
    prepared = {key: cleaned[key] for key in prepared}
    if len(PREPARED) > 500:
        PREPARED.clear()
    for result in prepared.values():
        context = [r for r in proposed.values() if r['category']=='discount' and r['enabled'] and r['project']==result['project'] and (owner_catalog.private(result) or not owner_catalog.private(r))]
        PREPARED.add((current['revision'], revision(result), revision(context)))
    return [prepared[r['id']] for r in changes]


def read_catalog():
    return read(True)


def visible_catalog(data):
    # SQLite содержит уже согласованный банковский импорт. Чтение не меняет ревизию за спиной UI.
    return data


def publication_response(current):
    error = None
    try:
        owner_catalog.backups()
    except Exception:
        error = 'Каталог сохранён; резервная копия не подтверждена. Проверьте папку резервов.'
    try:
        result = publish(current)
    except Exception as exc:
        message = str(exc) + (' ' + error if error else '')
        try:
            # Публикация могла уже принять банковский импорт и изменить ревизию SQLite.
            current = read_catalog()
        except Exception:
            # Не выдаём старую ревизию за актуальную, если повторное чтение недоступно.
            return {'saved': True, 'published': False, 'data': None, 'refreshRequired': True,
                    'error': message + ' Не удалось перечитать каталог. Обновите данные перед следующей правкой.'}
        return {'saved': True, 'published': False, 'data': current, 'error': message}
    if isinstance(result, dict):
        result = dict(result, saved=True)
        result.setdefault('data', current)
        if error: result['error'] = (result.get('error') or '') + ' ' + error
        return result
    return {'saved': True, 'published': True, 'data': current, 'commit': result, 'error': error}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,fmt,*args): pass
    def end_headers(self):
        if urlsplit(self.path).path == '/tools.html' and self.host_ok():
            self.send_header('Content-Security-Policy', "frame-ancestors 'self' https://evgeniigusv.github.io")
        else:
            self.send_header('X-Frame-Options','DENY')
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Referrer-Policy','no-referrer')
        super().end_headers()
    def host_ok(self): return self.headers.get('Host')==f'127.0.0.1:{PORT}'
    def same_site(self): return self.headers.get('Sec-Fetch-Site','none') in ['same-origin','none']
    def authorized(self):
        if not self.host_ok() or not self.same_site():
            return False
        cookie = ('sm_owner='+SESSION) in self.headers.get('Cookie','').split('; ')
        # Встроенный редактор обращается к своему origin, даже если браузер отключил сторонние cookies.
        embedded = (self.headers.get('Sec-Fetch-Site') == 'same-origin'
                    and self.headers.get('X-Editor-Session') == CSRF)
        return cookie or embedded
    def respond(self,status,obj,cookie=False):
        raw=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(raw)))
        if cookie: self.send_header('Set-Cookie','sm_owner='+SESSION+'; HttpOnly; SameSite=Strict; Path=/')
        self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/google-connect' and self.host_ok():
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers()
            page = '''<!doctype html><html lang="ru"><meta charset="utf-8"><title>Подключение Google</title><main style="max-width:32rem;margin:12vh auto;font:18px/1.5 system-ui"><h1>Подключение Google</h1><p>Войдите в аккаунт, у которого есть право редактировать таблицу инструментов.</p><button style="padding:12px 20px" id="go">Продолжить в Google</button><p id="msg" role="status"></p><a href="/tools.html">Вернуться в редактор</a></main><script>
document.querySelector('#go').onclick=async function(){this.disabled=true;try{const s=await(await fetch('/api/session')).json();const r=await(await fetch('/api/google-connect',{method:'POST',headers:{'X-CSRF-Token':s.csrf,'Content-Type':'application/json'},body:'{}'})).json();if(r.url)location.assign(r.url);else document.querySelector('#msg').textContent=r.connected?'Аккаунт подключён. Можно вернуться в редактор.':r.error;}catch(e){document.querySelector('#msg').textContent='Не удалось подключиться.';}finally{this.disabled=false;}};
</script></html>'''
            self.wfile.write(page.encode());return
        # Только входная HTML-страница открывается из публичного каталога.
        entry = path == '/tools.html' and self.headers.get('Sec-Fetch-Mode') == 'navigate' and self.headers.get('Sec-Fetch-Dest') in ('document', 'iframe')
        if not self.host_ok() or not (self.same_site() or entry): return self.respond(403,{'error':'Редактор доступен только на этом Mac.'})
        if path=='/api/session':
            return self.respond(200,{'csrf':CSRF,'source':'local','storage':'sqlite','admin':True},True)
        if path == '/api/subsidy-source':
            origin = self.headers.get('Origin')
            if ((origin is not None and origin != ORIGIN)
                    or self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin')
                    or (origin is None and self.headers.get('Sec-Fetch-Site') != 'same-origin')):
                return self.respond(403, {'error': 'Откройте ссылку из личного редактора.'})
            if not self.authorized():
                return self.respond(401, {'error': 'Откройте личный редактор заново.'})
            ids = parse_qs(urlsplit(self.path).query, keep_blank_values=True).get('id', [])
            if len(ids) != 1 or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', ids[0]):
                return self.respond(400, {'error': 'Укажите один ID программы.'})
            try:
                records = json.loads(PUBLISHED.read_text())['records']
                matches = [r for r in records if r['id'] == ids[0]]
                if not matches:
                    # В редакторе уже могут быть программы, ещё не попавшие в снимок.
                    records = visible_catalog(read_catalog())['records']
                    matches = [r for r in records if r['id'] == ids[0]]
                result = source_link(matches[0]) if len(matches) == 1 else None
            except Exception:
                return self.respond(503, {'error': 'Не удалось прочитать справочник субсидий.'})
            if result is None:
                return self.respond(404, {'error': 'Программа справочника субсидий не найдена.'})
            return self.respond(200, result)
        if path in ('/api/tools', '/api/settings'):
            if not self.authorized(): return self.respond(401,{'error':'Откройте личный редактор заново.'})
            try:
                data = read_catalog()
                if path == '/api/settings': data = {k: data[k] for k in ('revision', 'settings')}
                return self.respond(200, data)
            except Exception as e: return self.respond(503,{'error':str(e)})
        # Служебные файлы и .git не раздаются даже локально.
        if path not in ['/','/index.html','/tools.html','/rassrochka.html','/chpv.html','/transh.html'] and not path.startswith('/assets/'):
            return self.respond(404,{'error':'Не найдено'})
        if '..' in path or '%2e' in path.lower(): return self.respond(404,{'error':'Не найдено'})
        return super().do_GET()
    def do_POST(self):
        if not self.authorized() or self.headers.get('Origin')!=ORIGIN or self.headers.get('X-CSRF-Token')!=CSRF:
            return self.respond(403,{'error':'Не подтверждена сессия редактора.'})
        if self.path=='/api/google-connect':
            try:
                with LOCK: result=connect_google()
                return self.respond(200,result)
            except Exception: return self.respond(503,{'error':'Не удалось начать вход в Google. Проверьте сеть и настройки редактора.'})
        if self.path not in ['/api/tools','/api/settings','/api/publish',EVENT,'/api/ai/document','/api/ai/audio','/api/ai/propose','/api/ai/revise','/api/ai/accept']: return self.respond(404,{'error':'Не найдено'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if self.path in ('/api/ai/document','/api/ai/audio'):
                if not 0 < size <= 12000000:
                    raise ValueError('Файл должен быть меньше 12 МБ.')
                raw = self.rfile.read(size)
                if self.path.endswith('audio'):
                    text = transcribe(raw, self.headers.get_content_type())
                else:
                    try:
                        text = document(raw, self.headers.get('X-File-Type', ''))
                    except (BadZipFile, KeyError, ParseError, UnicodeError):
                        raise ValueError('Не удалось прочитать документ. Проверьте формат файла.') from None
                return self.respond(200, {'text':text})
            if not 0<size<=1000000: raise ValueError('Неверный размер запроса.')
            req=json.loads(self.rfile.read(size))
            if not isinstance(req, dict): raise ValueError('Нужен объект запроса.')
            if self.path == '/api/ai/propose':
                catalog = visible_catalog(read_catalog())
                result = proposals(catalog, req.get('text'))
                for item in result['items']:
                    item['ticket'] = ticket(result['revision'], item['record'])
                return self.respond(200, result)
            if self.path == '/api/ai/revise':
                previous, draft = req['previous'], req['record']
                if not hmac.compare_digest(req['ticket'], ticket(req['revision'], previous)):
                    raise ValueError('Подготовьте предложение повторно.')
                catalog = read_catalog()
                if req['revision'] != catalog['revision']:
                    return self.respond(409, {'error':'Справочник изменился. Подготовьте предложения повторно.'})
                records = {r['id']: r for r in catalog['records']}
                if (draft['id'] != previous['id'] or draft['group'] != previous['group']
                        or draft.get('source')):
                    raise ValueError('Неверная строка предложения.')
                promotion_move = draft['category'] == previous['category'] == 'discount' and draft['kind'] == previous['kind']
                if draft['id'] in records and not promotion_move and (draft['project'], draft['kind']) != (previous['project'], previous['kind']):
                    raise ValueError('Проект и механика существующего инструмента должны совпадать.')
                owner_catalog.check_scope(records.get(draft['id']), draft)
                cash = [r for r in records.values() if r['category']=='discount' and r['enabled']
                        and r['project']==draft['project'] and (owner_catalog.private(draft) or not owner_catalog.private(r))]
                same_kind = previous['kind'] == draft['kind']
                revised = interpret(previous if same_kind else None, draft, cash)
                revised = manual_record(records.get(draft['id']), revised)
                records[revised['id']] = revised
                candidate = owner_catalog.clean_references({'version':1, 'records':list(records.values())})
                validate(candidate)
                revised = next(r for r in candidate['records'] if r['id'] == revised['id'])
                return self.respond(200, {'record':revised, 'ticket':ticket(req['revision'], revised)})
            with LOCK:
                preview = self.path == EVENT and req.get('preview') is True
                current = read_catalog() if preview else read(True)
                if self.path == '/api/ai/accept':
                    items = req.get('items')
                    if not isinstance(items,list) or not 1 <= len(items) <= 40:
                        raise ValueError('Выберите предложения для добавления.')
                    changes = []
                    for item in items:
                        record = item['record']
                        if not hmac.compare_digest(item['ticket'], ticket(req['revision'], record)):
                            raise ValueError('Подготовьте предложение повторно.')
                        changes.append(record)
                    existing = {r['id']:r for r in current['records']}
                    for record in changes:
                        previous = existing.get(record['id'])
                        owner_catalog.check_scope(previous, record)
                        if manual_record(previous, record) != record:
                            raise ValueError('Подготовьте предложение повторно.')
                    current = owner_catalog.save(current, req['revision'], changes, lambda _, rows: rows, 'accept')
                if self.path in ('/api/tools', EVENT):
                    if preview:
                        if req.get('revision') != current['revision']:
                            raise owner_catalog.Conflict('Каталог изменился. Перечитайте его.')
                        return self.respond(200, {'changes': prepare(current, req.get('changes'))})
                    current = owner_catalog.save(current, req.get('revision'), req.get('changes'), prepare, 'edit')
                if self.path == '/api/settings':
                    current = owner_catalog.save_settings(current, req.get('revision'), req.get('settings'))
                return self.respond(200, publication_response(current))
        except FileNotFoundError: return self.respond(503,{'error':'Локальный каталог недоступен. Проверьте миграцию или восстановите резерв.'})
        except owner_catalog.Conflict as e: return self.respond(409,{'error':str(e)})
        except ValueError as e: return self.respond(400,{'error':str(e)})
        except Exception as e: return self.respond(503,{'error':str(e)})
def refresh_banks():
    import time
    from sync_tools import sync_local
    while True:
        try:
            # Последний опубликованный импорт + текущие источники ЧПВ, без all-tools Google.
            sync_local(fetch_remote=True)
            owner_catalog.backups()
        except Exception as exc:
            print('Банковское обновление/резерв не подтверждены: ' + type(exc).__name__, flush=True)
        time.sleep(3 * 60 * 60)


if __name__=='__main__':
    threading.Thread(target=refresh_banks, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
