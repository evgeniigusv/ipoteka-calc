#!/usr/bin/env python3
"""Публикация проверенного снимка Actions с защитой от параллельной правки."""
import base64, json, os, subprocess
from tools_source import ROOT
endpoint='repos/'+os.environ['GITHUB_REPOSITORY']+'/contents/assets/tools.json'
# SHA исходного checkout, а не последнего main: чужие изменения не затираются.
sha=subprocess.check_output(['git','rev-parse','HEAD:assets/tools.json'],cwd=ROOT,text=True).strip()
body={'message':'Обновить инструменты из Google','branch':'main','sha':sha,'content':base64.b64encode((ROOT/'assets/tools.json').read_bytes()).decode()}
r=subprocess.run(['gh','api','--method','PUT',endpoint,'--input','-'],input=json.dumps(body),text=True,capture_output=True)
if r.returncode: raise SystemExit('Публикация не выполнена: проверьте права или параллельное обновление. Повторите workflow.')
print('Обновлён снимок инструментов:',json.loads(r.stdout)['commit']['sha'][:12])
