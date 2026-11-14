#!/usr/bin/env python3
"""Проверяет оба справочника и атомарно публикует обезличенные ипотечные условия.

ID таблицы хранится только в ~/.config/ipoteka-calc/sheets.json, вне открытого Git.
Чтение Google — без изменения доступа и содержимого, публикация — только mortgage.json.
"""
import argparse
import base64
import io
import json
import math
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

REPO = 'evgeniigusv/ipoteka-calc'
FILE = 'assets/mortgage.json'
CONFIG = Path.home() / '.config/ipoteka-calc/sheets.json'
HEADERS = ['Банк', 'Программа кредитования', 'Условие', 'Срок', 'Ставка', 'Комиссия банку',
           'Срок, лет', 'КВ банку, % (расчёт)', 'Вариант', 'Ключ', 'Лимит кредита, руб.']
PROJECTS = {'da': ['ДА — 1 очередь', 'ДА — 2 очередь'], 'dnk': ['ДНК — 2 очередь']}
MIN_PV = {'da': .201, 'dnk': .2}
MAX_ROWS = 200


def download(url, *, binary=False):
    # curl использует системные сертификаты macOS; URL и ответы ошибок в журнал не выводятся.
    result = subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--show-error', '--location',
                             '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '3',
                             '--max-time', '35', '--max-filesize', '1000000', url],
                            capture_output=True, text=not binary, timeout=40)
    if result.returncode:
        raise RuntimeError('Справочник Google недоступен; сохранены прежние условия')
    return result.stdout


def read_source(sheet_id, source):
    # CSV округляет проценты, а gviz исключает отфильтрованные строки. Экспорт XLSX
    # по gid содержит одну именованную вкладку со всеми строками и результатами формул.
    gid = str(source['gid'])
    if not re.fullmatch(r'\d+', gid):
        raise ValueError('Некорректный ID вкладки')
    query = urlencode({'format': 'xlsx', 'gid': gid})
    url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?{query}'
    content = download(url, binary=True)
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as book:
            sheets = ET.fromstring(book.read('xl/workbook.xml')).findall('{*}sheets/{*}sheet')
            if len(sheets) != 1 or sheets[0].get('name') != source['name']:
                raise ValueError('Имя вкладки в экспорте по ID отличается от настроенного')
            rel_id = sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            rels = ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))
            targets = [r.get('Target') for r in rels if r.get('Id') == rel_id
                       and r.get('Type', '').endswith('/worksheet')]
            if len(targets) != 1 or not re.fullmatch(r'worksheets/[^/]+\.xml', targets[0] or ''):
                raise ValueError('Неоднозначная привязка вкладки в экспорте Google')
            sheet = ET.fromstring(book.read('xl/' + targets[0]))
            shared = ET.fromstring(book.read('xl/sharedStrings.xml'))
            strings = [''.join(t.text or '' for t in item.iterfind('.//{*}t')) for item in shared]
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError('Повреждён экспорт справочника Google') from exc

    rows = []
    for row in sheet.findall('{*}sheetData/{*}row'):
        rownum = int(row.attrib['r'])
        values = [''] * len(HEADERS)
        for cell in row.findall('{*}c'):
            ref = cell.attrib['r']
            if not re.fullmatch(r'[A-K]' + str(rownum), ref):
                continue
            col = ord(ref[0]) - ord('A')
            kind = cell.get('t', 'n')
            value = cell.findtext('{*}v', '')
            if kind not in ('n', 's', 'str', 'e'):
                raise ValueError(f"{source['name']}, {ref}: неизвестный тип ячейки")
            if cell.find('{*}f') is not None and cell.find('{*}v') is None:
                raise ValueError(f"{source['name']}, {ref}: нет результата формулы")
            if kind == 's':
                if not value.isdecimal() or int(value) >= len(strings):
                    raise ValueError(f"{source['name']}, {ref}: повреждён текст ячейки")
                value = strings[int(value)]
            if kind == 'e' or value.startswith('#'):
                code = value if value in ('#REF!', '#VALUE!', '#N/A', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!', '#ERROR!') else ''
                raise ValueError(f"{source['name']}, {ref}: ошибка в ячейке {code}".rstrip())
            if value and rownum > 1 and col in (4, 5, 6, 7, 10) and kind != 'n':
                raise ValueError(f"{source['name']}, {ref}: ожидается числовая ячейка")
            values[col] = value
        if any(values):
            if not len(rows) < rownum <= MAX_ROWS:
                raise ValueError('Нарушен порядок строк или превышен диапазон справочника')
            rows.extend([] for _ in range(rownum - len(rows) - 1))
            rows.append(values)
    if not rows or [v.strip() for v in rows[0]] != HEADERS:
        raise ValueError('Изменились колонки справочника')
    return rows


def number(value, percent=False):
    text = re.sub(r'\s+', '', str(value)).replace(',', '.')
    has_percent = text.endswith('%')
    if has_percent:
        text = text[:-1]
    if not re.fullmatch(r'\d+(?:\.\d+)?', text):
        raise ValueError('Некорректное число в справочнике')
    result = float(Decimal(text) / (100 if has_percent else 1))
    if (has_percent and not percent) or not math.isfinite(result):
        raise ValueError('Неверный формат числа в справочнике')
    return result


def mortgage_type(value):
    return {'базовая': 'Базовая ипотека', 'базовая ипотека': 'Базовая ипотека',
            'семейная ипотека': 'Семейная ипотека'}.get(value.casefold())


def kids_condition(value):
    return value.replace('ребенок', 'ребёнок').replace('ребенка', 'ребёнка')


def parse_rows(rows, project):
    programs, seen = [], set()
    for rownum, raw in enumerate(rows[1:], 2):
        row = list(raw) + [''] * max(0, 11 - len(raw))
        if not any(str(v).strip() for v in row):
            continue
        try:
            bank, kind, condition = [str(v).strip() for v in row[:3]]
            if not bank or len(bank) > 60 or re.search(r'[<>\n\r]|https?://', bank):
                raise ValueError('Не указан банк или некорректное название')
            kind = mortgage_type(kind)
            if not kind:
                raise ValueError('Неизвестный тип ипотеки; нужна настройка калькулятора')
            term, rate = number(row[6]), number(row[4], True)
            if term != int(term) or not 1 <= term <= 30 or not 0 < rate <= .5:
                raise ValueError('Срок или ставка вне допустимого диапазона')
            term_text = re.fullmatch(r'(\d+)\s*(?:лет|год|года)', str(row[3]).strip())
            if not term_text or int(term_text[1]) != term:
                raise ValueError('Срок в колонках D и G не совпадает')
            standard = condition.lower() == 'стандартная ставка'
            fee = 0 if standard and not str(row[5]).strip() else number(row[5], True)
            if not 0 <= fee <= .5 or abs(number(row[7], True) - fee) > 1e-8:
                raise ValueError('Комиссия некорректна или не совпадает с расчётной колонкой')
            item = dict(projects=PROJECTS[project], type=kind, bank=bank, term=int(term), rate=rate, subsidy=fee, minPv=MIN_PV[project])
            if kind == 'Семейная ипотека':
                kids = kids_condition(condition)
                if kids not in ['1 ребёнок', '2 ребёнка', '3 ребёнка', '4 ребёнка', '5 и более детей']:
                    raise ValueError('Неизвестное условие по детям')
                limit = number(row[10])
                if not 100000 <= limit <= 100000000:
                    raise ValueError('Не указан корректный лимит семейной ипотеки')
                item.update(kids=kids, limit=int(limit))
            else:
                if condition.lower() not in ['стандартная ставка', 'субсидированная ставка']:
                    raise ValueError('Неизвестное условие базовой ипотеки')
                item['variant'] = condition.lower()
                if str(row[10]).strip():
                    limit = number(row[10])
                    if not 100000 <= limit <= 100000000:
                        raise ValueError('Некорректный лимит базовой ипотеки')
                    item['limit'] = int(limit)
            key = (bank, kind, condition, term, rate)
            if key in seen:
                raise ValueError('Дублирующаяся программа')
            seen.add(key)
            programs.append(item)
        except ValueError as exc:
            raise ValueError(f'{project.upper()}, строка {rownum}: {exc}') from None
    if not programs:
        raise ValueError('Справочник пуст; сохранены прежние условия')
    return programs


def snapshot(config, *, allow_partial=False):
    sheet_id = config['spreadsheet_id']
    if not re.fullmatch(r'[A-Za-z0-9_-]+', sheet_id):
        raise ValueError('Некорректный ID источника')
    sources = config['sources']
    if set(sources) != set(PROJECTS):
        raise ValueError('Нужны оба источника: ДА и ДНК')
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {key: pool.submit(read_source, sheet_id, source) for key, source in sources.items()}
        programs, errors = [], {}
        for key in PROJECTS:
            try:
                programs.extend(parse_rows(futures[key].result(), key))
            except (ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
                if not allow_partial:
                    raise
                errors[key] = ('Истекло время ожидания Google.' if isinstance(exc, subprocess.TimeoutExpired)
                               else str(exc))
    result = {'version': 1, 'checked_at': datetime.now(ZoneInfo('Asia/Yekaterinburg')).isoformat(timespec='seconds'), 'programs': programs}
    if allow_partial:
        result['errors'] = errors
    return result


def gh(*args, payload=None):
    result = subprocess.run([shutil.which('gh') or '/opt/homebrew/bin/gh', 'api', *args],
                            input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError('GitHub отклонил обновление; прежний снимок сохранён')
    return json.loads(result.stdout)


def guard(previous, data):
    if previous.get('version') != 1 or data.get('version') != 1:
        raise ValueError('Неизвестная версия данных')
    if data['checked_at'] < previous['checked_at']:
        raise ValueError('Нельзя публиковать проверку старее текущей')
    for projects in PROJECTS.values():
        old = sum(p['projects'] == projects for p in previous['programs'])
        new = sum(p['projects'] == projects for p in data['programs'])
        if not new or new < old * .5:
            raise ValueError('Число программ проекта снизилось более чем вдвое; нужна проверка')


def publish(data, dry_run=False):
    remote = gh(f'repos/{REPO}/contents/{FILE}?ref=main')
    previous = json.loads(base64.b64decode(remote['content']))
    guard(previous, data)
    print('Проверено программ:', len(data['programs']), 'время:', data['checked_at'])
    if dry_run:
        print('Без публикации; изменения условий:', previous['programs'] != data['programs'])
        return
    # Обновляем время успешной проверки тоже, чтобы на странице было видно остановку синхронизации.
    content = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    gh('--method', 'PUT', f'repos/{REPO}/contents/{FILE}', '--input', '-', payload={
        'message': 'Сверить ставки и комиссии ДА и ДНК со справочниками', 'branch': 'main',
        'sha': remote['sha'], 'content': base64.b64encode(content.encode()).decode()})
    print('Ставки и комиссии отправлены в GitHub Pages')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=CONFIG)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--output', type=Path, help='Сохранить проверенный снимок локально вместо публикации')
    args = parser.parse_args()
    try:
        data = snapshot(json.loads(args.config.read_text()))
        if args.output:
            args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
            print('Снимок сохранён; программ:', len(data['programs']))
        else:
            publish(data, args.dry_run)
    except Exception as exc:
        print('Обновление не выполнено:', str(exc) if isinstance(exc, (ValueError, RuntimeError)) else type(exc).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
