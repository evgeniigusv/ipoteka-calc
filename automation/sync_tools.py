#!/usr/bin/env python3
"""Обновляет только ставки ЧПВ. Все остальные инструменты и настройки принадлежат SQLite."""
import argparse
import json
from datetime import datetime, timezone
from subsidy_catalog import with_subsidies
from tools_source import ROOT, config, public_snapshot, validate


def merge_snapshot(previous, bank_source=None):
    # Никаких all-tools Google reads: базой для GitHub служит опубликованный снимок.
    data = with_subsidies(previous, bank_source)
    data['checked_at'] = datetime.now(timezone.utc).isoformat()
    data['full_checked_at'] = previous.get('full_checked_at', previous['checked_at'])
    validate(data)
    return public_snapshot(data)


def sync_local(fetch_remote=False):
    import owner_catalog as store
    if fetch_remote:
        from publish_tools import remote_snapshot
        try:
            _, incoming = remote_snapshot(config().get('repo', 'evgeniigusv/ipoteka-calc'))
            store.import_bank_snapshot(incoming)
        except RuntimeError:
            pass  # Прямой источник ЧПВ по прежней конфигурации остаётся доступным.
    current = store.read(True)
    # Сначала учитываем свежий снимок, полученный checkout/pull, затем существующий источник ЧПВ.
    store.import_bank_snapshot(json.loads((ROOT / 'assets/tools.json').read_text()))
    current = store.read(True)
    incoming = with_subsidies(current)
    return store.import_bank_snapshot(incoming, report_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mortgage-only', action='store_true', help='Режим по умолчанию; полный Google sync удалён')
    parser.add_argument('--local', action='store_true', help='Обновить SQLite на Mac')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.local:
        if args.dry_run:
            parser.error('--dry-run используйте со снимком, без --local')
        data = sync_local(fetch_remote=True)
        import owner_catalog as store
        store.backups()
    else:
        previous = json.loads((ROOT / 'assets/tools.json').read_text())
        data = merge_snapshot(previous)
        if not args.dry_run:
            from owner_catalog import atomic_json
            atomic_json(ROOT / 'assets/tools.json', data)
    print('Проверен банковский импорт:', len(data['records']), 'записей; ручные условия сохранены.')


if __name__ == '__main__':
    main()
