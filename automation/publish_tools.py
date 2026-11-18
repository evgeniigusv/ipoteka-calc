#!/usr/bin/env python3
"""Публикация только публичного снимка; SQLite и закрытые карточки не покидают Mac."""
import base64
import json
import os
import subprocess

from tools_source import ROOT, config, public_snapshot


def gh(args, body=None):
    result = subprocess.run(['gh', 'api', *args], input=json.dumps(body) if body else None,
                            text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('GitHub не принял запрос: проверьте доступ или параллельное обновление. Сохранённые данные не потеряны.')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def remote_snapshot(repo):
    result = gh(['repos/' + repo + '/contents/assets/tools.json?ref=main'])
    data = json.loads(base64.b64decode(result['content']))
    return result['sha'], public_snapshot(data)


def publish_snapshot(data, repo, expected_sha):
    clean = public_snapshot(data)
    payload = json.dumps(clean, ensure_ascii=False, indent=2) + '\n'
    endpoint = 'repos/' + repo
    result = gh(['--method', 'PUT', endpoint + '/contents/assets/tools.json', '--input', '-'], {
        'message': 'Обновить публичный снимок инструментов', 'branch': 'main',
        'sha': expected_sha, 'content': base64.b64encode(payload.encode()).decode()})
    result = {'snapshotSaved': True, 'commit': result['commit']['sha'], 'published': False, 'error': None}
    try:
        gh([endpoint + '/pages'])
        gh(['--method', 'POST', endpoint + '/pages/builds'])
        # Подтверждена постановка сборки, не её завершение.
        result.update(published=True, publicationStatus='queued')
    except RuntimeError:
        result['error'] = 'Публичный снимок сохранён в GitHub, но сайт Pages недоступен или сборка не запущена.'
        result['publicationStatus'] = 'unavailable'
    return result


def publish_local(data):
    import owner_catalog as store
    repo = config().get('repo', 'evgeniigusv/ipoteka-calc')
    # Даже при отсутствии сети есть безопасный снимок для повторной публикации.
    path = store.catalog_path()
    store.atomic_json(path.parent / 'public-tools.json', public_snapshot(store.read(True)))
    sha, remote = remote_snapshot(repo)
    store.import_bank_snapshot(remote)
    with store.connect(path) as db:
        # Сохранение и импорт не могут обогнать публикацию и раскрыть прежнюю видимость.
        db.execute('BEGIN IMMEDIATE')
        current = store.snapshot(db, path)
        clean = public_snapshot(current)
        store.atomic_json(path.parent / 'public-tools.json', clean)
        result = publish_snapshot(clean, repo, sha)
        store.atomic_json(path.parent / 'publication.json', dict(result, revision=current['revision']))
        db.execute('COMMIT')
    result['data'] = current
    return result


def main():
    # CI начинает с публичного checkout. Его Git blob SHA защищает от записи поверх ручной публикации.
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD:assets/tools.json'], cwd=ROOT, text=True).strip()
    data = json.loads((ROOT / 'assets/tools.json').read_text())
    result = publish_snapshot(data, os.environ['GITHUB_REPOSITORY'], sha)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
