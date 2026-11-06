#!/usr/bin/env python3
"""Автозапуск личного редактора при входе пользователя macOS."""
import os, plistlib, subprocess, sys, shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1]; label='ru.svobodamysli.ipoteka-tools-editor'; domain='gui/'+str(os.getuid())
agent=Path.home()/'Library/LaunchAgents'/f'{label}.plist'; agent.parent.mkdir(parents=True,exist_ok=True)
log=Path.home()/'Library/Logs/ipoteka-tools-editor.log'
agent.write_bytes(plistlib.dumps({'Label':label,'ProgramArguments':[sys.executable,str(root/'automation/tools_editor.py')],'WorkingDirectory':str(root),'RunAtLoad':True,'KeepAlive':True,'EnvironmentVariables':{'PATH':':'.join(dict.fromkeys([str(Path(shutil.which(x)).parent) for x in ['node','gh','curl']]+['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin']))},'StandardOutPath':str(log),'StandardErrorPath':str(log)}))
subprocess.run(['launchctl','bootout',domain+'/'+label],capture_output=True)
subprocess.run(['launchctl','bootstrap',domain,str(agent)],check=True)
print('Редактор установлен: http://127.0.0.1:8795/tools.html')
