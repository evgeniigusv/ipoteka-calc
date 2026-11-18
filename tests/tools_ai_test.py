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
    def interpret_patch(self, text, edits, old=None, source=True):
        old = copy.deepcopy(old or self.payment_record())
        draft = dict(copy.deepcopy(old), description=text)
        answer = {'question':'','edits':[dict(field=k,value_json=json.dumps(v),quote=text) for k,v in edits]}
        with patch.object(ai,'generate',return_value=answer):
            return ai.interpret(old,draft,[],source_text=text if source else None)

    def test_pv_and_discount_numbers_are_bound_to_their_fields(self):
        old = self.payment_record()
        old['params'].update(minPv=.2,disc=.1)
        old['params'].pop('discFromPv',None)
        text = 'ПВ теперь 30%, скидка 5%.'
        result = self.interpret_patch(text,[('minPv',.3),('disc',.05)],old)
        self.assertEqual(result['params'],dict(old['params'],minPv=.3,disc=.05))
        for edits in ([('minPv',.05),('disc',.3)], [('disc',.3)], [('minPv',.3)], []):
            with self.subTest(edits=edits), self.assertRaises(ValueError):
                self.interpret_patch(text,edits,old)
        # A scalar from another clause cannot justify an unrelated percentage field.
        with self.assertRaises(ValueError):
            self.interpret_patch('ПВ теперь 30%.',[('minPv',.3),('disc',.3)],old)

    def test_do_not_change_discount_overrides_a_plausible_model_number(self):
        old = self.payment_record()
        old['params'].update(minPv=.2,disc=.1)
        for text in ('ПВ теперь 30%. Скидку не менять.', 'Не меняй скидку. ПВ теперь 30%.',
                     'ПВ теперь 30%. Не трогай скидку.', 'Скидку оставь без изменений, ПВ 30%.'):
            with self.subTest(text=text):
                result = self.interpret_patch(text,[('minPv',.3)],old)
                self.assertEqual(result['params'],dict(old['params'],minPv=.3))
                for key,value in [('disc',.3),('discFromPv',.3),('pvFromBase',False),('disc',None)]:
                    with self.subTest(key=key,value=value),self.assertRaises(ValueError):
                        self.interpret_patch(text,[('minPv',.3),(key,value)],old)
        with self.assertRaises(ValueError):
            self.interpret_patch('Скидка 5%, ПВ не менять.',[('disc',.05),('minPv',.05)],old)

    def test_existing_discount_basis_is_preserved_or_clarified(self):
        old=self.payment_record()
        self.assertNotIn('disc',old['params'])
        result=self.interpret_patch('Скидка теперь 5%.',[('discFromPv',.05)],old)
        self.assertEqual(result['params'],dict(old['params'],discFromPv=.05))
        with self.assertRaises(ValueError):self.interpret_patch('Скидка теперь 5%.',[('disc',.05)],old)
        old['params']['disc']=.1
        with self.assertRaisesRegex(ValueError,'Уточните скидку'):
            self.interpret_patch('Скидка теперь 5%.',[('disc',.05)],old)
        old['params'].pop('discFromPv');old['params']['pvFromBase']=False
        result=self.interpret_patch('Скидка от ПВ 16%.',[('discFromPv',.16),('pvFromBase',True)],old)
        self.assertEqual(result['params'],dict(old['params'],discFromPv=.16,pvFromBase=True))

    def test_room_labels_control_amount_order_and_partial_updates(self):
        old = self.payment_record()
        for text in ('Платёж для студии 30 тысяч, для 2к 60 тысяч, для 3к 90 тысяч рублей.',
                     'Для трёхкомнатной платёж 90 тысяч, для двухкомнатной 60 тысяч, для студии 30 тысяч.',
                     'Платежи: студия / 1к 30, 2к 60, 3к 90 тысяч рублей.'):
            edits = [('pay.1',30000),('pay.2',60000),('pay.3',90000)]
            with self.subTest(text=text):
                result = self.interpret_patch(text,edits,old)
                self.assertEqual(result['params'],dict(old['params'],pay={'1':30000,'2':60000,'3':90000}))
                for wrong in ([('pay.1',90000),('pay.2',30000),('pay.3',60000)], edits[:2], []):
                    with self.subTest(wrong=wrong),self.assertRaises(ValueError):
                        self.interpret_patch(text,wrong,old)
        result = self.interpret_patch('Измени только платёж для 2к на 60 тысяч рублей.',[('pay.2',60000)],old)
        self.assertEqual(result['params'],dict(old['params'],pay={'1':50000,'2':60000,'3':100000}))
        for extra in [('pay.1',60000),('end','2028-01-01'),('months',12),('steps',[1]),('pvFromBase',False)]:
            with self.subTest(extra=extra),self.assertRaises(ValueError):
                self.interpret_patch('Измени только платёж для 2к на 60 тысяч рублей.',[('pay.2',60000),extra],old)

    def test_short_replacement_still_checks_order(self):
        text = 'Замени платежи 50–75–100 тысяч рублей на 30–60–90 тысяч рублей.'
        self.assertEqual(self.interpret_patch(text,[('pay.1',30000),('pay.2',60000),('pay.3',90000)])['params']['pay'],
                         {'1':30000,'2':60000,'3':90000})
        with self.assertRaises(ValueError):
            self.interpret_patch(text,[('pay.1',90000),('pay.2',60000),('pay.3',30000)])

    def test_ambiguous_subject_or_units_never_guessed(self):
        for text in ('ПВ теперь 30.', 'Измени ПВ.', 'Скидка от 5% до 10%.',
                     'Платежи теперь 30–60–90 тысяч рублей.', 'Платёж для 2к теперь 60.',
                     'Платёж для студии 30 тысяч, для 1к 40 тысяч рублей.',
                     'Скидка 5%. Скидку не менять.'):
            with self.subTest(text=text),patch.object(ai,'generate') as generate,self.assertRaises(ValueError):
                old=self.payment_record()
                ai.interpret(old,dict(copy.deepcopy(old),description=text),[],source_text=text)
            generate.assert_not_called()

    def test_editor_text_uses_same_guards_and_leaves_previous_record_intact(self):
        old=self.payment_record();old['params'].update(minPv=.2,disc=.1)
        snapshot=copy.deepcopy(old)
        text='ПВ теперь 30%. Скидку не менять.'
        result=self.interpret_patch(text,[('minPv',.3)],old,source=False)
        self.assertEqual(result['params'],dict(old['params'],minPv=.3))
        with self.assertRaises(ValueError):self.interpret_patch(text,[('disc',.3)],old,source=False)
        self.assertEqual(old,snapshot)

    def test_unchanged_description_clause_does_not_authorize_another_patch(self):
        old=copy.deepcopy(next(r for r in DATA['records'] if r['kind']=='mortgage'))
        old['description']='Ставка 6%. ПВ 20%.'
        old['params'].update(rate=.06,minPv=.2)
        text='Ставка 6%. ПВ 30%.'
        result=self.interpret_patch(text,[('minPv',.3)],old,source=False)
        self.assertEqual(result['params'],dict(old['params'],minPv=.3))
        with self.assertRaisesRegex(ValueError,'не запрошено'):
            self.interpret_patch(text,[('minPv',.3),('rate',.3)],old,source=False)

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
