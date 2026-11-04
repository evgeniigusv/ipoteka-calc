#!/usr/bin/env python3
"""Публикует обезличенный остаток квартир из Macro BI; без изменения CRM."""
import argparse
import base64
import json
import os
import subprocess
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pymysql
from dotenv import dotenv_values

REPO = 'evgeniigusv/ipoteka-calc'
FILE = 'assets/macro-flats.json'
HOUSES = (6736582, 6871059, 10899161, 11013930)
SQL = '''SELECT house_id, geo_flatnum AS num, estate_floor AS floor,
 estate_rooms AS rooms, estate_studia AS studio, estate_area AS area,
 estate_price AS price, estate_price_action AS action
 FROM estate_sells WHERE estate_sell_category='flat' AND estate_sell_status=20
 AND estate_price>0 AND house_id IN (%s,%s,%s,%s)
 ORDER BY house_id, estate_floor, geo_flatnum, estate_sell_id'''


def snapshot():
    cfg = {**dotenv_values(Path.home() / 'code/agent-sales-bi/.env'), **os.environ}
    kw = dict(user=cfg['BI_USER'], password=cfg['BI_PASS'], database=cfg['BI_DB'],
              charset='utf8mb4', connect_timeout=20, read_timeout=120,
              cursorclass=pymysql.cursors.DictCursor, autocommit=False)
    conn = pymysql.connect(host=cfg.get('BI_FORWARD_HOST') or '127.0.0.1',
                           port=int(cfg.get('BI_FORWARD_PORT') or '3307'), **kw)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT param_value, TIMESTAMPDIFF(SECOND, STR_TO_DATE(param_value, '%Y-%m-%d %H:%i:%s'), NOW()) AS age FROM stat WHERE param_name='last_date_updated'")
            stat = cur.fetchone()
            if not stat or stat['age'] is None or stat['age'] < -3600 or stat['age'] > 48 * 3600:
                raise ValueError('Выгрузка Macro устарела или её дата не определена; обновление остановлено')
            source_time = datetime.strptime(str(stat['param_value']), '%Y-%m-%d %H:%M:%S')
            cur.execute(SQL, HOUSES)
            data = cur.fetchall()
        rows = [{k: float(v) if isinstance(v, Decimal) else v for k, v in row.items()} for row in data]
        validate(rows)
        return {'updated': source_time.strftime('%d.%m.%Y, %H:%M'), 'source_ts': source_time.isoformat(), 'rows': rows}
    finally:
        conn.rollback()
        conn.close()


def validate(rows):
    if not rows or len(rows) > 5000:
        raise ValueError('Некорректное количество квартир; обновление остановлено')
    for row in rows:
        if row.get('house_id') not in HOUSES or not str(row.get('num') or '').strip():
            raise ValueError('Некорректный номер квартиры или дом; обновление остановлено')
        if not isinstance(row.get('price'), (int, float)) or row['price'] <= 0:
            raise ValueError('Некорректная цена; обновление остановлено')
        if row.get('area') is None or float(row['area']) <= 0:
            raise ValueError('Некорректная площадь; обновление остановлено')


def gh(*args, payload=None):
    result = subprocess.run(['/opt/homebrew/bin/gh', 'api', *args],
        input=json.dumps(payload, ensure_ascii=True) if payload is not None else None,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if result.returncode:
        raise RuntimeError('GitHub недоступен или отклонил обновление; данные не изменены')
    return json.loads(result.stdout)


def publish(data, dry_run=False):
    remote = gh(f'repos/{REPO}/contents/{FILE}?ref=main')
    previous = json.loads(base64.b64decode(remote['content']).decode('utf-8'))
    if len(data['rows']) < len(previous.get('rows', [])) * 0.5:
        raise ValueError('Число квартир снизилось более чем вдвое; требуется проверка')
    # Сравниваем только метки с известной основой. Старые снимки не содержали source_ts.
    if previous.get('source_ts') and data['source_ts'] < previous['source_ts']:
        raise ValueError('Выгрузка Macro старее опубликованной; обновление остановлено')
    if previous == data:
        print('Данные Macro не изменились')
        return
    print('Подготовлено квартир:', len(data['rows']), 'дата Macro:', data['updated'])
    if dry_run:
        print('Проверка без публикации')
        return
    body = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    gh('--method', 'PUT', f'repos/{REPO}/contents/{FILE}', '--input', '-', payload={
        'message': 'Обновить остатки квартир из Macro', 'branch': 'main', 'sha': remote['sha'],
        'content': base64.b64encode(body).decode('ascii')})
    print('Обновление отправлено в GitHub Pages')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        publish(snapshot(), args.dry_run)
    except (Exception, KeyboardInterrupt) as exc:
        # Не печатать исключения сторонних библиотек: они могут содержать параметры соединения.
        print('Обновление не выполнено:', str(exc) if isinstance(exc, (ValueError, RuntimeError)) else type(exc).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
