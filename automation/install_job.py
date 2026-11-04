#!/usr/bin/env python3
"""Установить запуск обновления Macro каждые три часа в текущей учётной записи Mac."""
import os
import plistlib
import subprocess
from pathlib import Path

home = Path.home()
root = Path(__file__).resolve().parent.parent
label = 'ru.svobodamysli.ipoteka-macro'
agent = home / 'Library/LaunchAgents' / (label + '.plist')
log = home / 'Library/Logs/ipoteka-macro.log'
python = home / 'code/agent-sales-bi/.venv/bin/python'
if not python.exists():
    raise SystemExit('Не найден Python дашборда Macro BI')
agent.parent.mkdir(parents=True, exist_ok=True)
config = {'Label': label, 'ProgramArguments': [str(python), str(root / 'automation/sync_macro.py')],
          'WorkingDirectory': str(root), 'RunAtLoad': True, 'StartInterval': 10800,
          'StandardOutPath': str(log), 'StandardErrorPath': str(log)}
agent.write_bytes(plistlib.dumps(config))
os.chmod(agent, 0o600)
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(agent)], check=True)
print('Автообновление запущено каждые 3 часа; журнал:', log)
