#!/usr/bin/env python3
"""Сверяет текстовые условия ДА; неизвестную механику не публикует автоматически."""
import argparse
import base64
import csv
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from sync_mortgage import download, gh, REPO

ROOT = Path(__file__).resolve().parents[1]
FILE = 'assets/installments.json'
CONFIG = Path.home() / '.config/ipoteka-calc/installments.json'
NUM = r'\d+(?:[.,]\d+)?'
DATE = r'\d{2}\.\d{2}\.\d{4}'
PROJECTS = ['ДА — 1 очередь', 'ДА — 2 очередь']


def norm(text):
    return re.sub(r'\s+', ' ', (text or '').strip().lower())


def signature(text):
    # Меняться без ревью могут лишь числа в поддержанных полях. Например,
    # «2 раза в год», «100% оплату» и названия комнат остаются частью механики.
    text = norm(text)
    patterns = [DATE, rf'(?<=пв ){NUM}', rf'(?<=пв от ){NUM}',
                rf'(?<=до ){NUM}(?=%)', rf'(?<=через ){NUM}(?= года)',
                rf'{NUM}(?=% - в дату сделки)', rf'(?<=срок - ){NUM}(?= мес)',
                rf'(?<=срок - до ){NUM}(?= мес)', rf'{NUM}/{NUM}(?= от скидки)',
                rf'(?<=ежемесячно от ){NUM}', rf'{NUM}(?= тыс\. руб)',
                rf'(?<=с ){NUM}(?= по)', rf'(?<=по ){NUM}(?= число месяца)',
                r'(?<=ст/1к -)\d[\d ]*(?=2к)', r'(?<=2к-)\d[\d ]*(?=3к)',
                r'(?<=3к-)\d[\d ]*', rf'^{NUM}(?=% скидка да1)']
    for pattern in patterns:
        text = re.sub(pattern, '#', text)
    return hashlib.sha256(norm(text).encode()).hexdigest()


def match(pattern, text):
    found = re.search(pattern, text, re.I | re.S)
    if not found:
        raise ValueError('Не найдено обязательное поле условий рассрочки')
    return found


def value(text, minimum=0, maximum=1):
    n = float(text.replace(' ', '').replace(',', '.'))
    if not minimum <= n <= maximum:
        raise ValueError('Число вне допустимого диапазона')
    return n


def percent(text):
    return value(text, 0, 90) / 100


def date(text):
    return datetime.strptime(text.strip(), '%d.%m.%Y').date().isoformat()


def pv(text):
    return percent(match(rf'ПВ (?:от )?({NUM})%', text)[1])


def source_rows(config, area):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', config['spreadsheet_id']) or not str(config['gid']).isdigit():
        raise ValueError('Некорректная настройка источника')
    url = 'https://docs.google.com/spreadsheets/d/' + config['spreadsheet_id'] + '/export?'
    rows = list(csv.reader(io.StringIO(download(url + urlencode({'format':'csv', 'gid':config['gid'], 'range':area})))))
    if not rows or len(rows) >= int(re.search(r'\d+$', area)[0]):
        raise ValueError('Источник пуст или достиг границы диапазона')
    return rows


def select_rows(rows):
    rows = [(r + [''] * 7)[:7] for r in rows]
    starts = [i for i, r in enumerate(rows) if norm(r[0]) == 'рассрочка']
    ends = [i for i, r in enumerate(rows) if norm(r[0]) == 'скидки']
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        raise ValueError('Изменились разделы таблицы инструментов')
    if [norm(x) for x in rows[starts[0]+1][2:4]] != ['да1', 'да2']:
        raise ValueError('Изменились колонки очередей')
    selected = {}
    for row in rows[starts[0]+2:ends[0]]:
        title = norm(row[0])
        if not title:
            continue
        if re.fullmatch(r'рассрочка от '+NUM+'%', title): key = 'equal'
        elif title == 'рассрочка с ежемесячным платежом': key = 'monthly'
        elif title == 'рассрочка "для беременных"': key = 'parents'
        elif title == 'рассрочка 50 / 50': key = 'half'
        elif any(word in title for word in ['коммер', 'паркинг', 'кладов', 'нежил']): continue
        else: raise ValueError('Новая программа рассрочки: требуется проверка механики')
        if key in selected: raise ValueError('Повтор программы рассрочки')
        selected[key] = row
    cash = [r for r in rows[ends[0]+1:] if norm(r[0]) == 'скидка за 100% оплату и ипотеку без субсидии']
    if len(cash) != 1 or set(selected) != {'equal','monthly','parents','half'}:
        raise ValueError('Не хватает обязательной программы или скидки')
    selected['cash'] = cash[0]
    return selected


def parse(rows, discount_rows):
    selected = select_rows(rows)
    templates = json.loads((ROOT / 'automation/installment-templates.json').read_text())
    for key, row in selected.items():
        for col in (2,3,4):
            if signature(row[col]) != templates[key][str(col)]:
                raise ValueError('Изменилась механика: ' + key + '; сохранены прежние условия')
    discount_text = ' '.join(' '.join(r) for r in discount_rows)
    threshold = percent(match(rf'ДО ({NUM})% ПВ скидок нет', discount_text)[1])
    cash_rows = [r for r in discount_rows if len(r)>2 and norm(r[1]) == 'скидка 100%']
    if len(cash_rows) != 1: raise ValueError('Не найдена базовая скидка в таблице скидок')
    cap_cash = percent(cash_rows[0][2])
    programs = []
    for col, project in enumerate(PROJECTS, 2):
        cash = percent(match(rf'До ({NUM})%', selected['cash'][col])[1])
        if cash != cap_cash: raise ValueError('Базовые скидки двух источников не совпадают')
        eq, mo, pa = (selected[k] for k in ('equal','monthly','parents'))
        share = pv(eq[col])
        if share != threshold or share != percent(match(rf'от ({NUM})%', eq[0])[1]):
            raise ValueError('Минимальные взносы в источниках не совпадают')
        common = {'projects':[project], 'extraSequential':True}
        equal = dict(common, name=f'Рассрочка от {share*100:g}%', scheme='equal', minPv=share,
                     steps=[1,3] if col==2 else [1,3,6], discFromPv=cash,
                     pvFromBase=True, validUntil=date(eq[5]),
                     note='Взнос и скидка от него — по прайсу, как в таблице скидок. Остаток — равными платежами.')
        if col == 2: equal['end'] = date(match(rf'до ({DATE})', eq[col])[1])
        else:
            if percent(match(rf'({NUM})% - в дату сделки', eq[col])[1]) != share:
                raise ValueError('Не совпадает взнос в двух описаниях')
            equal['months'] = int(value(match(rf'через ({NUM}) года', eq[col])[1],1,5)*12)
        programs.append(equal)
        pay = {str(i):int(value(match(label+r'\s*-\s*(\d[\d ]*?)(?=\s*(?:2к|3к|$))', mo[col])[1],1,1000000))
               for i,label in [(1,'ст/1к'),(2,'2к'),(3,'3к')]}
        limits = match(rf'ежемесячно от ({NUM}) до ({NUM}) тыс', mo[col])
        if min(pay.values()) != value(limits[1],0,1000)*1000 or max(pay.values()) != value(limits[2],0,1000)*1000:
            raise ValueError('Диапазон платежей расходится с платежами по комнатности')
        days = match(r'с (\d+) по (\d+) число месяца', mo[col])
        if not 1 <= int(days[1]) <= int(days[2]) <= 28: raise ValueError('Неверные дни платежей')
        programs.append(dict(common, name='Рассрочка с ежемесячным платежом', scheme='monthly', minPv=pv(mo[col]),
            end=date(match(rf'Полное погашение - до ({DATE})',mo[col])[1]), pay=pay,
            disc=percent(match(rf'({NUM})% скидка ДА1',mo[4])[1]) if col==2 else 0,
            validUntil=date(mo[5]), note=f'Платежи с {days[1]} по {days[2]} число, начиная со следующего месяца. Остаток — к дате погашения.'))
        long_term = int(value(match(r'Срок - до (\d+) мес',pa[col])[1],1,36))
        short_term = int(value(match(r'Срок - (\d+) мес',pa[col])[1],1,36))
        fraction = match(r'(\d+)/(\d+) от скидки',pa[col])
        ratio = value(fraction[1],1,10) / value(fraction[2],1,10)
        if short_term >= long_term or ratio>1: raise ValueError('Противоречивые условия для родителей')
        for months, disc in [(short_term,cash*ratio),(long_term,0)]:
            programs.append(dict(common, name=f'Для будущих родителей · {months} мес.',scheme='deferred',
                minPv=pv(pa[col]), months=months,disc=disc,validUntil=date(pa[5]),
                note='Без промежуточных платежей, остаток за счёт семейной ипотеки. Применимость и одобрение банка уточняются.'))
    # Эту строку ранее исключили из-за противоречия дат. При исправлении — ревью,
    # чтобы не подключить новую программу без проверки базы взноса и скидки.
    half = selected['half'][2]
    if date(match(rf'Погашение - до ({DATE})',half)[1]) >= date(match(rf'Предложение До ({DATE})',half)[1]):
        raise ValueError('Исправлена рассрочка 50/50; требуется проверить и подключить программу')
    return programs


def snapshot(config):
    rows = source_rows(config['tools'], 'A1:G60')
    discounts = source_rows(config['discounts'], 'A1:C20')
    return {'version':1, 'checked_at':datetime.now(ZoneInfo('Asia/Yekaterinburg')).isoformat(timespec='seconds'),
            'programs':parse(rows, discounts)}


def publish(data, dry_run=False):
    remote = gh(f'repos/{REPO}/contents/{FILE}?ref=main')
    previous = json.loads(base64.b64decode(remote['content']))
    if previous['version'] != 1 or previous['checked_at'] > data['checked_at'] or len(data['programs']) != 8:
        raise ValueError('Нельзя заменить текущий снимок этими данными')
    print('Проверено программ:',len(data['programs']),'; условия изменились:',previous['programs']!=data['programs'])
    if dry_run: return
    content = json.dumps(data, ensure_ascii=False, indent=2)+'\n'
    gh('--method','PUT',f'repos/{REPO}/contents/{FILE}','--input','-',payload={
        'message':'Сверить рассрочки ДА с таблицей инструментов', 'branch':'main',
        'sha':remote['sha'],'content':base64.b64encode(content.encode()).decode()})
    print('Рассрочки отправлены на GitHub:',data['checked_at'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config',type=Path,default=CONFIG)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    try:
        config = json.loads(os.environ['INSTALLMENT_SOURCES'] if 'INSTALLMENT_SOURCES' in os.environ else args.config.read_text())
        data = snapshot(config)
        if args.output:
            args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
            print('Сохранено программ:',len(data['programs']))
        else: publish(data,args.dry_run)
    except Exception as exc:
        print('Обновление не выполнено:',str(exc) if isinstance(exc,(ValueError,RuntimeError)) else type(exc).__name__,file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
