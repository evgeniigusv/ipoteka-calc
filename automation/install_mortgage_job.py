#!/usr/bin/env python3
"""Запуск синхронизации ипотечных справочников каждые три часа на этом Mac."""
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
config = Path.home() / '.config/ipoteka-calc/sheets.json'
if not config.exists():
    raise SystemExit('Сначала создайте локальный sheets.json по инструкции README')
label = 'ru.svobodamysli.ipoteka-mortgage'
agent = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
log = Path.home() / 'Library/Logs/ipoteka-mortgage.log'
if agent.exists():
    raise SystemExit('Задание уже установлено; используйте launchctl kickstart для ручного запуска')
job = {'Label': label, 'ProgramArguments': [sys.executable, str(root / 'automation/sync_mortgage.py')],
       'WorkingDirectory': str(root), 'RunAtLoad': True, 'StartInterval': 10800,
       'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/bin:/bin'},
       'StandardOutPath': str(log), 'StandardErrorPath': str(log)}
agent.parent.mkdir(parents=True, exist_ok=True)
agent.write_bytes(plistlib.dumps(job))
agent.chmod(0o600)
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(agent)], check=True)
print('Синхронизация ДА/ДНК запущена каждые три часа; журнал:', log)
