#!/usr/bin/env python3
"""Проверяет оба справочника и атомарно публикует обезличенные ипотечные условия.

ID таблицы хранится только в ~/.config/ipoteka-calc/sheets.json, вне открытого Git.
Чтение Google — без изменения доступа и содержимого, публикация — только mortgage.json.
"""
import argparse
import base64
import csv
import io
import json
import math
import re
import shutil
import subprocess
import sys
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


def download(url):
    # curl использует системные сертификаты macOS; URL и ответы ошибок в журнал не выводятся.
    result = subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--show-error', '--location',
                             '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '3',
                             '--max-time', '35', '--max-filesize', '1000000', url],
                            capture_output=True, text=True, timeout=40)
    if result.returncode:
        raise RuntimeError('Справочник Google недоступен; сохранены прежние условия')
    return result.stdout


def csv_rows(text):
    rows = list(csv.reader(io.StringIO(text.lstrip('\ufeff'))))
    if not rows or [v.strip() for v in rows[0]] != HEADERS:
        raise ValueError('Изменились колонки справочника или вместо таблицы получена ошибка')
    if len(rows) >= MAX_ROWS + 1:
        raise ValueError('Справочник достиг границы диапазона; нужно расширить чтение')
    return rows


def read_source(sheet_id, source):
    base = 'https://docs.google.com/spreadsheets/d/' + sheet_id
    area = 'A1:K' + str(MAX_ROWS + 1)
    # Сырой CSV сохраняет ошибки/текст в числовых ячейках; gviz может превратить их в null.
    rows = csv_rows(download(base + '/export?' + urlencode({'format': 'csv', 'gid': source['gid'], 'range': area})))
    # Проверяем привязку по имени: удаление/пересоздание листа не должно подставить другой проект.
    response = download(base + '/gviz/tq?' + urlencode({'sheet': source['name'], 'tqx': 'out:json', 'headers': 1, 'range': area}))
    match = re.search(r'google\.visualization\.Query\.setResponse\((.*)\);\s*$', response, re.S)
    if not match:
        raise ValueError('Некорректный ответ справочника по имени')
    result = json.loads(match[1])
    if result.get('status') != 'ok' or [c['label'] for c in result['table']['cols']] != HEADERS:
        raise ValueError('Справочник по имени недоступен или его колонки изменились')
    named = [[cell.get('v') if cell else None for cell in r['c']] for r in result['table']['rows']]
    raw = [r + [''] * max(0, 11 - len(r)) for r in rows[1:] if any(str(v).strip() for v in r[:6])]
    named = [r for r in named if any(v not in (None, '') for v in r[:6])]
    if len(raw) != len(named):
        raise ValueError('Количество строк по имени и по ID не совпадает')
    precise = [HEADERS]
    for display, values in zip(raw, named):
        if display[:4] != values[:4]:
            raise ValueError('Лист по имени не совпадает с листом по ID')
        row = display.copy()
        for col in (4, 5, 6, 7, 10):
            value = values[col] if col < len(values) else None
            if display[col].strip():
                shown = number(display[col], col in (4, 5, 7))
                if type(value) not in (int, float) or abs(shown-value) > (.000051 if col in (4, 5, 7) else .51):
                    raise ValueError('Ошибка ячейки или справочники изменились во время чтения')
                # Берём исходную точность ячейки, а не округлённое отображение процентов.
                row[col] = str(value)
            elif value not in (None, ''):
                raise ValueError('Пустая ячейка отличается в двух чтениях')
        precise.append(row)
    return precise


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


def parse_rows(rows, project):
    programs, seen = [], set()
    for rownum, raw in enumerate(rows[1:], 2):
        row = list(raw) + [''] * max(0, 11 - len(raw))
        if not any(str(v).strip() for v in row[:6]):
            continue
        try:
            bank, kind, condition = [str(v).strip() for v in row[:3]]
            if not bank or len(bank) > 60 or re.search(r'[<>\n\r]|https?://', bank):
                raise ValueError('Не указан банк или некорректное название')
            kind = {'Базовая': 'Базовая ипотека', 'Базовая ипотека': 'Базовая ипотека', 'Семейная ипотека': 'Семейная ипотека'}.get(kind)
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
                kids = condition.replace('ребенок', 'ребёнок').replace('ребенка', 'ребёнка')
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


def snapshot(config):
    sheet_id = config['spreadsheet_id']
    if not re.fullmatch(r'[A-Za-z0-9_-]+', sheet_id):
        raise ValueError('Некорректный ID источника')
    sources = config['sources']
    if set(sources) != set(PROJECTS):
        raise ValueError('Нужны оба источника: ДА и ДНК')
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {key: pool.submit(read_source, sheet_id, source) for key, source in sources.items()}
        programs = [item for key in PROJECTS for item in parse_rows(futures[key].result(), key)]
    return {'version': 1, 'checked_at': datetime.now(ZoneInfo('Asia/Yekaterinburg')).isoformat(timespec='seconds'), 'programs': programs}


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
