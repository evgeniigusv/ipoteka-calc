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
        with patch.object(ai, 'generate') as generate, self.assertRaisesRegex(ValueError,'справочнике субсидий'):
            tools_editor.prepare(dict(DATA,revision='test'), [same[0]])
        generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
