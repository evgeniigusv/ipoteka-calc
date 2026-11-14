import copy
import zipfile
import xml.etree.ElementTree as ET
import io
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('sync_mortgage',Path(__file__).parents[1]/'automation/sync_mortgage.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def family(**changes):
    r=['Тест Банк','Семейная ипотека','1 ребенок','15 лет','7,00%','15,16%','15','15,16%','15 лет, 7%','ключ','6\u00a0000\u00a0000']
    for index,value in changes.items(): r[int(index)]=value
    return r

def parse(row):return m.parse_rows([m.HEADERS,row],'dnk')

class SyncTest(unittest.TestCase):
    def export(self, names=('Справочник',), error=None, last_row=3):
        book = ET.Element('workbook')
        sheets = ET.SubElement(book, 'sheets')
        rel_ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        for name in names:
            ET.SubElement(sheets, 'sheet', {'name': name, '{'+rel_ns+'}id': 'rId5'})
        rels = ET.Element('Relationships')
        ET.SubElement(rels, 'Relationship', Id='rId5', Target='worksheets/test.xml', Type=rel_ns+'/worksheet')
        shared = ET.Element('sst')
        sheet = ET.Element('worksheet')
        data = ET.SubElement(sheet, 'sheetData')
        values = family()
        for col, value in {4: .07001, 5: .1516, 6: 15, 7: .1516, 10: 6000000}.items():
            values[col] = value
        for index, cells in [(1, m.HEADERS), (last_row, values)]:
            row = ET.SubElement(data, 'row', r=str(index), hidden=str(int(index > 1)))
            for col, value in enumerate(cells):
                ref = chr(65+col)+str(index)
                cell = ET.SubElement(row, 'c', r=ref)
                if error and ref == error[0]:
                    cell.set('t', error[1])
                    value = error[2]
                elif isinstance(value, str):
                    cell.set('t', 's')
                    ET.SubElement(ET.SubElement(shared, 'si'), 't').text = value
                    value = len(shared)-1
                ET.SubElement(cell, 'v').text = str(value)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for path, xml in [('workbook.xml', book), ('_rels/workbook.xml.rels', rels),
                              ('sharedStrings.xml', shared), ('worksheets/test.xml', sheet)]:
                archive.writestr('xl/'+path, ET.tostring(xml, encoding='utf-8'))
        return stream.getvalue()

    def test_hidden_rows_precision_and_source_binding(self):
        with patch.object(m, 'download', return_value=self.export()) as fetch:
            rows = m.read_source('test', {'gid': 1, 'name': 'Справочник'})
        fetch.assert_called_once_with('https://docs.google.com/spreadsheets/d/test/export?format=xlsx&gid=1', binary=True)
        self.assertEqual(rows[1], [])
        self.assertEqual(m.parse_rows(rows, 'da')[0]['rate'], .07001)

    def test_wrong_or_ambiguous_sheet_rejected(self):
        for names in [('Другой лист',), ('Справочник', 'Другой лист')]:
            with self.subTest(names=names), patch.object(m, 'download', return_value=self.export(names)):
                with self.assertRaisesRegex(ValueError, 'Имя вкладки'):
                    m.read_source('test', {'gid': 1, 'name': 'Справочник'})

    def test_errors_on_hidden_rows_rejected(self):
        for ref, kind, value in [('G3', 'str', '#VALUE!'), ('J3', 'e', '#REF!'), ('F3', 'str', '0.1516')]:
            with self.subTest(ref=ref), patch.object(m, 'download', return_value=self.export(error=(ref, kind, value))):
                with self.assertRaisesRegex(ValueError, ref):
                    m.read_source('test', {'gid': 1, 'name': 'Справочник'})

    def test_out_of_range_program_rejected(self):
        with patch.object(m, 'download', return_value=self.export(last_row=m.MAX_ROWS+1)):
            with self.assertRaisesRegex(ValueError, 'диапазон'):
                m.read_source('test', {'gid': 1, 'name': 'Справочник'})

    def test_rates_and_commissions_have_independent_units(self):
        p=parse(family())[0]
        self.assertEqual((p['rate'],p['subsidy'],p['term'],p['limit'],p['minPv']),(.07,.1516,15,6000000,.2))
        self.assertEqual(p['projects'],['ДНК — 2 очередь'])
    def test_missing_or_corrupt_values_reject_entire_snapshot(self):
        for col,value in [(4,''),(4,'#REF!'),(4,'7'),(5,''),(5,'текст'),(7,'0%'),(6,'30'),(10,''),(10,'0'),(2,'всем')]:
            with self.subTest(col=col,value=value),self.assertRaises(ValueError):parse(family(**{str(col):value}))
    def test_only_standard_base_can_have_empty_commission(self):
        row=family(**{'1':'Базовая','2':'Стандартная ставка','3':'30 лет','4':'19,4%','5':'','6':'30','7':'0','10':''})
        self.assertEqual(parse(row)[0]['subsidy'],0)
        row[2]='Субсидированная ставка'
        with self.assertRaises(ValueError):parse(row)
    def test_duplicate_empty_or_new_type_is_not_silently_ignored(self):
        with self.assertRaises(ValueError):m.parse_rows([m.HEADERS,family(),family()],'da')
        with self.assertRaises(ValueError):m.parse_rows([m.HEADERS],'da')
        with self.assertRaises(ValueError):parse(family(**{'1':'Ипотека нового типа'}))
    def test_partial_failure_never_yields_snapshot(self):
        config={'spreadsheet_id':'test','sources':{'da':{'gid':1,'name':'ДА'},'dnk':{'gid':2,'name':'ДНК'}}}
        def read(_,s):
            if s['gid']==2:raise RuntimeError('нет ДНК')
            return [m.HEADERS,family()]
        with patch.object(m,'read_source',side_effect=read), self.assertRaises(RuntimeError):m.snapshot(config)
    def test_guard_applies_to_each_project(self):
        data={'version':1,'checked_at':'2026-11-06T12:00:00+05:00','programs':m.parse_rows([m.HEADERS,family()],'da')*4+parse(family())*4}
        new=copy.deepcopy(data);new['programs']=new['programs'][:5]
        with self.assertRaises(ValueError):m.guard(data,new)
        new=copy.deepcopy(data);new['checked_at']='2026-11-05T12:00:00+05:00'
        with self.assertRaises(ValueError):m.guard(data,new)
    def test_sha_used_for_atomic_publication_and_dry_run_never_writes(self):
        import json,base64
        data={'version':1,'checked_at':'2026-11-06T12:00:00+05:00','programs':m.parse_rows([m.HEADERS,family()],'da')+parse(family())}
        remote={'sha':'concurrent-edit-guard','content':base64.b64encode(json.dumps(data).encode()).decode()}
        with patch.object(m,'gh',return_value=remote) as gh:
            m.publish(data,True);self.assertEqual(gh.call_count,1)
        with patch.object(m,'gh',return_value=remote) as gh:
            m.publish(data);payload=gh.call_args.kwargs['payload'];self.assertEqual(payload['sha'],remote['sha']);self.assertEqual(gh.call_count,2)

if __name__=='__main__':unittest.main()
