import copy
import csv
import io
import json
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
    def source_responses(self, raw=None, bank='Тест Банк'):
        row=raw or family()
        output=io.StringIO();writer=csv.writer(output);writer.writerows([m.HEADERS,row])
        values=family();values[0]=bank
        # 7.001% отображается как 7.00%, но для расчёта нужна исходная точность.
        for i,v in {4:.07001,5:.1516,6:15,7:.1516,10:6000000}.items():values[i]=v
        result={'status':'ok','table':{'cols':[{'label':h} for h in m.HEADERS],'rows':[{'c':[{'v':v} for v in values]}]}}
        return [output.getvalue(),'google.visualization.Query.setResponse('+json.dumps(result)+');']
    def test_source_uses_unrounded_value(self):
        with patch.object(m,'download',side_effect=self.source_responses()):
            rows=m.read_source('test',{'gid':1,'name':'Справочник'})
        self.assertEqual(m.parse_rows(rows,'da')[0]['rate'],.07001)
    def test_wrong_sheet_or_error_cell_cannot_replace_conditions(self):
        for responses in [self.source_responses(bank='Другой банк'),self.source_responses(raw=family(**{'5':'#REF!'}))]:
            with patch.object(m,'download',side_effect=responses),self.assertRaises(ValueError):
                m.read_source('test',{'gid':1,'name':'Справочник'})
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
