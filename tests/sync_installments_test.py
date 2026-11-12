import base64
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'automation'))
import sync_installments as sync

FIXTURE=json.loads((Path(__file__).parent/'fixtures/installment-conditions.json').read_text())


class InstallmentsTest(unittest.TestCase):
    def setUp(self):
        self.f=copy.deepcopy(FIXTURE)

    def parse(self): return sync.parse(self.f['tools'],self.f['discounts'])

    def test_current_conditions(self):
        rows=self.parse()
        self.assertEqual(len(rows),8)
        self.assertEqual(rows[0]['end'],'2027-03-20')
        self.assertEqual(rows[0]['discFromPv'],.13)
        self.assertTrue(all('maxDisc' not in row for row in rows if row['scheme'] == 'equal'))
        self.assertEqual(rows[4]['months'],24)
        self.assertEqual(rows[1]['pay'],{'1':50000,'2':75000,'3':100000})
        self.assertEqual(rows[1]['disc'],.06)
        self.assertEqual(rows[5]['disc'],0)
        self.assertEqual(rows[2]['disc'],.065)
        self.assertEqual(rows[3]['months'],6)

    def test_changed_numbers_and_dates(self):
        self.f['tools'][3][2]=self.f['tools'][3][2].replace('20.03.2027','20.06.2027')
        self.f['tools'][3][3]=self.f['tools'][3][3].replace('через 2 года','через 3 года')
        self.f['tools'][4][2]=self.f['tools'][4][2].replace('2к-75 000','2к-80 000').replace('с 1 по 5','с 2 по 10')
        self.f['tools'][4][4]=self.f['tools'][4][4].replace('6%','8%')
        self.f['tools'][5][2]=self.f['tools'][5][2].replace('до 6 мес','до 9 мес')
        self.f['tools'][7][2]='До 12%'
        self.f['tools'][7][3]='До 12%'
        self.f['discounts'][0][2]='12'
        self.f['discounts'][2][2]=''
        rows=self.parse()
        self.assertEqual(rows[0]['end'],'2027-06-20')
        self.assertEqual(rows[4]['months'],36)
        self.assertNotIn('maxDisc', rows[0])
        self.assertEqual(rows[2]['disc'],.06)
        self.assertEqual(rows[3]['months'],9)
        self.assertEqual(rows[1]['pay']['2'],80000)
        self.assertEqual(rows[1]['disc'],.08)
        self.assertIn('с 2 по 10',rows[1]['note'])

    def test_unknown_mechanics_rejected(self):
        self.f['tools'][3][2]+=' С удорожанием 5% в год'
        with self.assertRaisesRegex(ValueError,'механика'): self.parse()

    def test_changed_frequency_rejected(self):
        self.f['tools'][3][3]=self.f['tools'][3][3].replace('2 раза в год','3 раза в год')
        with self.assertRaisesRegex(ValueError,'механика'): self.parse()

    def test_bad_date_rejected(self):
        self.f['tools'][3][2]=self.f['tools'][3][2].replace('20.03.2027','31.02.2027')
        with self.assertRaises(ValueError): self.parse()

    def test_missing_and_unknown_programs(self):
        self.f['tools'].insert(3,['Новая рассрочка','','ПВ 10%'])
        with self.assertRaises(ValueError): self.parse()
        with self.assertRaises(ValueError): sync.parse([],self.f['discounts'])

    def test_conflicting_sources(self):
        self.f['discounts'][0][2]='12'
        with self.assertRaisesRegex(ValueError,'не совпадают'): self.parse()

    def test_conflicting_payment_ranges(self):
        self.f['tools'][4][2]=self.f['tools'][4][2].replace('от 50 до','от 60 до')
        with self.assertRaisesRegex(ValueError,'Диапазон'): self.parse()

    def test_publish_dry_run_and_sha(self):
        data={'version':1,'checked_at':'2026-11-06T14:00:00+05:00','programs':self.parse()}
        remote={'sha':'current-sha','content':base64.b64encode(json.dumps(data).encode()).decode()}
        with patch.object(sync,'gh',return_value=remote) as gh:
            sync.publish(data,True)
            self.assertEqual(gh.call_count,1)
        with patch.object(sync,'gh',side_effect=[remote,{}]) as gh:
            sync.publish(data)
            payload=gh.call_args.kwargs['payload']
            self.assertEqual(payload['sha'],'current-sha')
            self.assertEqual(payload['branch'],'main')
        with patch.object(sync,'gh',side_effect=[remote,RuntimeError('SHA conflict')]):
            with self.assertRaises(RuntimeError): sync.publish(data)


if __name__=='__main__': unittest.main()
