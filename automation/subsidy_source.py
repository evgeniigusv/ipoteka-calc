"""Ссылка владельца на актуальную строку банковского справочника."""
import json
import re
import subprocess
from urllib.parse import urlencode

import tools_source
from subsidy_catalog import PROJECT, managed
from sync_mortgage import CONFIG, HEADERS, PROJECTS, kids_condition, mortgage_type


def cell_value(cell):
    value = cell.get('effectiveValue', {})
    return value.get('numberValue', value.get('stringValue'))


def row_match(row, params):
    """True — совпало, False — другая программа, None — возможное совпадение."""
    bank, kind, condition, term_label, rate, _, term = (row + [None] * 7)[:7]
    family = params['type'] == 'Семейная ипотека'
    condition = str(condition or '').strip()
    label = re.fullmatch(r'(\d+)\s*(?:лет|год|года)', str(term_label or '').strip())
    fields = [
        (str(bank or '').strip() or None, params['bank']),
        (mortgage_type(str(kind or '').strip()), params['type']),
        ((kids_condition(condition) if family else condition.lower()) or None,
         params.get('kids' if family else 'variant')),
        (rate if type(rate) in (int, float) else None, params['rate']),
    ]
    if any(actual is not None and actual != expected for actual, expected in fields):
        return False
    # При расхождении D и G нельзя ни подтвердить срок, ни отбросить возможный дубль.
    if label and type(term) in (int, float) and int(label[1]) == term:
        if term != params['term']:
            return False
        if all(actual is not None for actual, _ in fields):
            return True
    return None


def exact_range(sheet, params):
    blocks = sheet.get('data', [])
    if len(blocks) != 1 or blocks[0].get('startRow', 0) or blocks[0].get('startColumn', 0):
        return None
    rows = [[cell_value(cell) for cell in row.get('values', [])]
            for row in blocks[0].get('rowData', [])]
    if not rows or rows[0] != HEADERS:
        return None
    found = None
    for number, row in enumerate(rows[1:], 2):
        if not any(value is not None and value != '' for value in row):
            continue
        match = row_match(row, params)
        if match is False:
            continue
        if match is None or found is not None:
            return None
        found = f'A{number}:K{number}'
    return found


def source_link(record):
    if record.get('source') != 'subsidies' or not managed(record):
        return None
    project = next(key for key, labels in PROJECTS.items()
                   if record['project'] in [PROJECT[label] for label in labels])
    conf = json.loads(CONFIG.read_text())
    book = conf['spreadsheet_id']
    tab = conf['sources'][project]
    gid = str(tab['gid'])
    if not re.fullmatch(r'[A-Za-z0-9_-]+', book) or not re.fullmatch(r'[0-9]+', gid):
        raise ValueError('Неверная настройка справочника.')
    url = f'https://docs.google.com/spreadsheets/d/{book}/edit#gid={gid}'
    tab_range = "'" + tab['name'].replace("'", "''") + "'!A:K"
    query = urlencode({'ranges': tab_range, 'fields':
        'sheets(properties(sheetId),data(startRow,startColumn,rowData(values(effectiveValue))))'})
    try:
        sheets = tools_source.google('GET', '?' + query, source=dict(
            tools_source.config(), spreadsheet_id=book)).get('sheets', [])
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError):
        sheets = []
    if len(sheets) == 1 and str(sheets[0].get('properties', {}).get('sheetId')) == gid:
        target = exact_range(sheets[0], record['params'])
        if target:
            return {'url': url + '&range=' + target, 'exact': True}
    return {'url': url, 'exact': False}
