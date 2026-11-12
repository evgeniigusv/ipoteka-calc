"""Возобновить существующий доступ Google Sheets владельца с тем же OAuth-клиентом."""
import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

from tools_source import config


def active_url(path):
    if not path.exists() or time.time()-path.stat().st_mtime>1740:
        return None
    url = path.read_text().strip()
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname != 'accounts.google.com':
        return None
    redirect = urlsplit(parse_qs(parsed.query).get('redirect_uri',[''])[0])
    if redirect.hostname != '127.0.0.1' or not redirect.port:
        return None
    try:
        with socket.create_connection(('127.0.0.1', redirect.port), timeout=1):
            return url
    except OSError:
        return None


def start():
    c = config()
    target = Path(c['credentials']).expanduser()
    directory = target.parent
    link = directory/'google-auth-url.txt'
    if target.exists():
        auth = json.loads(target.read_text())
        body = urlencode({k:auth[k] for k in ('client_id','client_secret','refresh_token')} | {'grant_type':'refresh_token'})
        result = subprocess.run(['curl','-sS','--max-time','20','--data-binary','@-','https://oauth2.googleapis.com/token'],
                                input=body,text=True,capture_output=True,timeout=25)
        if result.returncode:
            raise RuntimeError('Нет связи с Google.')
        response = json.loads(result.stdout)
        if response.get('access_token'):
            return {'connected':True}
        if response.get('error') != 'invalid_grant':
            raise RuntimeError('Google не подтвердил состояние подключения.')
        target.rename(directory/('google-oauth.expired-'+str(time.time_ns())+'.json'))
    url = active_url(link)
    if url:
        return {'url':url}
    script = Path(c['google_connect_script']).expanduser()
    old = link.stat().st_mtime_ns if link.exists() else None
    args = [sys.executable,str(script),str(directory/'google-desktop-client.json')]
    ca = c.get('google_ca_file')
    if ca:
        args += ['--ca-file',ca]
    proc = subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    for _ in range(50):
        if link.exists() and link.stat().st_mtime_ns!=old:
            url = active_url(link)
            if url:
                return {'url':url}
        if proc.poll() is not None:
            break
        time.sleep(.1)
    raise RuntimeError('Не удалось открыть вход в Google. Проверьте настройку клиента на Маке.')
