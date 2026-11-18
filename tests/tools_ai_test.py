import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import tools_ai as ai
import subsidy_catalog
import tools_editor
from tools_source import ROOT

DATA = json.loads((ROOT/'tests/fixtures/tools-initial.json').read_text())
ROW = next(r for r in DATA['records'] if r['kind']=='installment')


class ConditionsTest(unittest.TestCase):
    def test_cash_discount_reference_uses_existing_context(self):
        text = 'Скидка на сумму ПВ как при полной оплате.'
        draft = dict(copy.deepcopy(ROW),description=text)
        context = [{'id':'cash','kind':'discount','params':{'percent':.16}}]
        answer = {'question':'','edits':[dict(field='discFromPv',value_json='0.16',quote=text)]}
        with patch.object(ai,'generate',return_value=answer):
            self.assertEqual(ai.interpret(ROW,draft,context,source_text=text)['params']['discFromPv'],.16)

    def test_manual_numeric_form_and_explicit_compatibility_skip_ai(self):
        draft = copy.deepcopy(ROW)
        draft['combination'] = ''
        draft['mode'] = 'additive'
        draft['params']['compatiblePromotions'] = []
        draft['params']['minPv'] = .45
        for key in ai.LEGACY_INSTALLMENT_FIELDS:
            draft['params'].pop(key,None)
        with patch.object(ai, 'generate') as generate:
            self.assertEqual(ai.interpret(ROW,draft,[]),draft)
            new = dict(copy.deepcopy(draft),description='')
            self.assertEqual(ai.interpret(None,new,[]),new)
        generate.assert_not_called()

    def test_deprecated_installment_fields_cannot_be_restored(self):
        draft = dict(copy.deepcopy(ROW),description='Скидка 16%.')
        draft['params'].pop('maxDisc',None)
        answer = {'question':'','edits':[dict(field='maxDisc',value_json='.16',quote='Скидка 16%')]}
        with patch.object(ai,'generate',return_value=answer) as generate, self.assertRaises(ValueError):
            ai.interpret(ROW,draft,[])
        self.assertNotIn('maxDisc',[f['key'] if isinstance(f,dict) else f for f in generate.call_args.args[0]['fields']])

    def payment_record(self):
        row = copy.deepcopy(ROW)
        row['params'].update(scheme='monthly', pay={'1':50000, '2':75000, '3':100000})
        return row

    def test_numeric_units_and_spoken_sequences(self):
        for text, expected in [
                ('30–60–90 тысяч рублей', [30000,60000,90000]),
                ('30 / 60 / 90 тыс. руб.', [30000,60000,90000]),
                ('тридцать, шестьдесят и девяносто тысяч рублей', [30000,60000,90000]),
                ('1,5–2–2,5 млн рублей', [1500000,2000000,2500000]),
                ('30 тыс., 60 тысяч и 90 тыс. рублей', [30000,60000,90000]),
                ('30 000, 60\u00a0000 и 90\u202f000 рублей', [30000,60000,90000]),
                ('30 рублей, 60 тысяч рублей и 1 млн рублей', [30,60000,1000000])]:
            with self.subTest(text=text):
                self.assertEqual(ai.numeric_values(text, 'money'), expected)
        self.assertEqual(ai.numeric_values('30–60–90', 'money'), [])
        self.assertEqual(ai.numeric_values('30% и 60 месяцев', 'money'), [])
        self.assertEqual(ai.numeric_values('Этап 2027-03-01, квартира 3к', 'money'), [])
        self.assertEqual(ai.numeric_values('с 50 тысяч на 30 тысяч', 'money'), [30000])

    def test_payment_replacement_preserves_context_and_other_fields(self):
        old = self.payment_record()
        for command in ('Измени ежемесячные платежи с 50–75–100 тысяч рублей на 30–60–90 тысяч рублей',
                        'Измени платежи с 50–75–100 на 30–60–90',
                        'Измени платежи с 50–75–100 тысяч рублей на 30–60–90',
                        'Измени платежи с 50 тыс. /\n75 тыс. / 100 тыс.\nна 30 тыс. /\n60 тыс. / 90 тыс.',
                        'Измени платежи с 50–75–100 на 30–60–90 тыс. рублей'):
            draft = dict(copy.deepcopy(old), description=command)
            answer = {'question':'', 'edits':[dict(field='pay.'+str(i), value_json=str(n), quote=command)
                                            for i,n in enumerate((30000,60000,90000),1)]}
            with self.subTest(command=command), patch.object(ai, 'generate', return_value=answer) as generate:
                result = ai.interpret(old, draft, [])
                expected = dict(copy.deepcopy(draft), params=dict(old['params'], pay={'1':30000,'2':60000,'3':90000}))
                self.assertEqual(result, expected)
                self.assertEqual(old['params']['pay'], {'1':50000,'2':75000,'3':100000})
                self.assertEqual(generate.call_args.args[0]['paymentChanges'], {'pay.1':30000,'pay.2':60000,'pay.3':90000})

    def test_wrong_scale_order_or_partial_replacement_never_passes(self):
        old = self.payment_record()
        command = 'Измени ежемесячные платежи с 50–75–100 тысяч рублей на 30–60–90 тысяч рублей'
        draft = dict(copy.deepcopy(old), description=command)
        for numbers in ((30,60,90),(30000,60,90000),(90000,60000,30000),(30000,), (50000,75000,100000)):
            answer = {'question':'', 'edits':[dict(field='pay.'+str(i),value_json=str(n),quote=command)
                                            for i,n in enumerate(numbers,1)]}
            with self.subTest(numbers=numbers), patch.object(ai, 'generate', return_value=answer), self.assertRaises(ValueError):
                ai.interpret(old, draft, [])

    def test_mismatched_or_ambiguous_sequence_asks_before_api(self):
        old = self.payment_record()
        for command in ('Измени платежи с 50–70–100 тысяч на 30–60–90 тысяч',
                        'Измени платежи с 50000 рублей / 75 тысяч / 100 тысяч на 30–60–90',
                        'Измени платежи с 50–75–100 тысяч на 30–60 тысяч'):
            with self.subTest(command=command), patch.object(ai, 'generate') as generate, self.assertRaises(ValueError):
                ai.interpret(old, dict(copy.deepcopy(old),description=command), [])
            generate.assert_not_called()

    def test_scalar_money_cannot_use_unscaled_value(self):
        old = self.payment_record()
        draft = dict(copy.deepcopy(old), description='Платёж студии 30 тысяч рублей.')
        for value in ('30', 'true', 'NaN'):
            answer = {'question':'','edits':[dict(field='pay.1',value_json=value,quote=draft['description'])]}
            with self.subTest(value=value), patch.object(ai,'generate',return_value=answer), self.assertRaises(ValueError):
                ai.interpret(old,draft,[])

    def test_scheduled_amounts_use_money_units(self):
        old = self.payment_record()
        draft = dict(copy.deepcopy(old), description='Этап 2027-03-01: 30 тысяч рублей.')
        for amount in (30,30000):
            answer = {'question':'','edits':[dict(field='milestones', value_json=json.dumps([{'date':'2027-03-01','amount':amount}]),quote=draft['description'])]}
            with patch.object(ai,'generate',return_value=answer):
                if amount==30:
                    with self.assertRaises(ValueError): ai.interpret(old,draft,[])
                else:
                    self.assertEqual(ai.interpret(old,draft,[])['params']['milestones'][0]['amount'],30000)

    def test_add_existing_tranche_to_another_project(self):
        source = next(r for r in DATA['records'] if r['kind']=='tranche' and r['params'].get('first')==.1)
        draft = dict(copy.deepcopy(source), id='test-tranche-da1', project='da1', category='tranche')
        draft['params']['first'] = .12
        with patch.object(ai, 'generate', return_value={'question':'', 'edits':[]}) as generate:
            current = dict(DATA, revision='test-add-project')
            self.assertEqual(tools_editor.prepare(current, [draft]), [draft])
            generate.assert_not_called()
            draft['description'] += ' Новые условия для первой очереди.'
            tools_editor.prepare(current, [draft])
            generate.assert_called_once()
        self.assertEqual(source['params']['first'], .1)

    def test_text_discount_and_manual_conflict(self):
        draft = copy.deepcopy(ROW)
        draft['description'] += ' Скидка на сумму ПВ 16%.'
        edit = {'question':'', 'edits':[{'field':'discFromPv', 'value_json':'0.16', 'quote':'«Скидка на сумму ПВ 16%»'}]}
        with patch.object(ai, 'generate', return_value=edit):
            self.assertEqual(ai.interpret(ROW, draft, [])['params'], dict(ROW['params'], discFromPv=.16))
            draft['params']['discFromPv'] = .18
            with self.assertRaisesRegex(ValueError, 'расходятся'):
                ai.interpret(ROW, draft, [])
            draft['params']['discFromPv'] = .13
            edit['edits'][0]['value_json'] = '0.18'
            with self.assertRaisesRegex(ValueError, 'не подтверждено'):
                ai.interpret(ROW, draft, [])

    def test_subsidy_source_and_editor(self):
        source = json.loads((ROOT/'assets/mortgage.json').read_text())
        program = next(x for x in source['programs'] if x['type']=='Семейная ипотека')
        program['subsidy'] = .2345
        combined = subsidy_catalog.with_subsidies(DATA, source)
        same = [r for r in combined['records'] if r.get('source')=='subsidies'
                and subsidy_catalog.identity(r['params'])==subsidy_catalog.identity(program)
                and r['project'] in [subsidy_catalog.PROJECT[p] for p in program['projects']]]
        self.assertEqual(len(same),len(program['projects']))
        self.assertTrue(all(r['params']['subsidy']==.2345 for r in same))
        with patch.object(subsidy_catalog, 'sources', return_value=source), patch.object(ai, 'generate') as generate, \
                self.assertRaisesRegex(ValueError,'справочнике субсидий|программа банка изменилась'):
            tools_editor.prepare(dict(DATA,revision='test'), [same[0]])
        generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
