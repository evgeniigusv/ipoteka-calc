import json
import re
import sys
import tempfile
import threading
import unittest
from copy import deepcopy
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import owner_catalog
import subsidy_catalog as bank
import tools_ai
import tools_editor as editor
import tools_proposals
import tools_source as store


class ManualSubsidiesTest(unittest.TestCase):
    """Настоящие HTTP, разбор условий, модель Node, запись строк и слияние снимков."""

    def mock(self, obj, name, **kwargs):
        binding = patch.object(obj, name, **kwargs)
        self.addCleanup(binding.stop)
        return binding.start()

    def setUp(self):
        fixture = json.loads((store.ROOT / 'tests/fixtures/tools-initial.json').read_text())
        self.source = json.loads((store.ROOT / 'assets/mortgage.json').read_text())
        self.program = next(p for p in self.source['programs'] if p.get('kids') and len(p['projects']) == 2)
        # У двух строк одного банка совпадают все признаки, кроме ставки.
        self.sibling = dict(self.program, rate=.09871)
        self.source['programs'].append(self.sibling)
        # Зарезервируем пример импортированного ID, которого в общем листе ещё нет.
        imported_only = dict(self.program, bank='Новый тестовый банк')
        self.source['programs'].append(imported_only)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.snapshot = Path(self.temporary.name) / 'tools.json'
        self.snapshot.write_text(json.dumps(fixture))
        self.mock(bank, 'PUBLISHED', new=self.snapshot)
        self.bank = self.mock(bank, 'sources', return_value=self.source)
        self.books = {'test-public': [store.COLUMNS, *map(store.row, fixture['records'])],
                      'test-private': [store.COLUMNS]}
        self.mock(store, 'config', return_value=dict(spreadsheet_id='test-public', sheet_name='Общий',
                  gid=1, owner_sheet=dict(spreadsheet_id='test-private', sheet_name='Личный', gid=2)))
        self.google = self.mock(store, 'google', side_effect=self.google_request)
        self.ai = self.mock(tools_ai, 'generate', return_value={'question':'', 'edits':[]})
        self.publish = self.mock(editor, 'publish', side_effect=self.write_snapshot)
        self.mock(owner_catalog, '_retries', new={})
        self.mock(editor, 'PREPARED', new=set())
        server = editor.ThreadingHTTPServer(('127.0.0.1', 0), editor.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.connection = HTTPConnection(*server.server_address, timeout=15)
        self.addCleanup(self.connection.close)
        self.catalog = self.request('/api/tools')
        self.write_snapshot(self.catalog)
        self.row = self.find_bank(self.program)
        self.virtual = self.find_bank(imported_only)
        self.assertTrue(self.virtual['id'].startswith('sub-'))

    def find_bank(self, program, project='da1'):
        return next(r for r in self.catalog['records'] if r.get('source') == 'subsidies'
                    and r['project'] == project and bank.identity(r['params']) == bank.identity(program))

    def google_request(self, method, path, body=None, *, source):
        rows = self.books[source['spreadsheet_id']]
        if method == 'GET':
            self.assertTrue(path.startswith('/values/'))
            return {'values':deepcopy(rows)}
        self.assertEqual((method, path), ('POST', '/values:batchUpdate'))
        for update in body['data']:
            index = int(re.search(r'!A(\d+):', update['range'])[1]) - 1
            rows[index:index+1] = update['values']
        return {}

    def write_snapshot(self, data):
        self.snapshot.write_text(json.dumps(store.public_snapshot(data)))
        return 'mock'

    def request(self, route, body=None, status=200):
        self.connection.request('POST' if body is not None else 'GET', route, json.dumps(body), headers={
            'Origin':editor.ORIGIN, 'Host':'127.0.0.1:8795', 'Cookie':'sm_owner='+editor.SESSION,
            'X-CSRF-Token':editor.CSRF})
        response = self.connection.getresponse()
        data = json.loads(response.read())
        self.assertEqual(response.status, status, data.get('error'))
        return data

    def edit(self, *rows, preview=False, status=200):
        return self.request(editor.EVENT, dict(changes=rows, revision=self.catalog['revision'],
                                               preview=preview), status)

    @staticmethod
    def adopt(row, **params):
        draft = deepcopy(row)
        draft.pop('source')
        draft['params'].update(appManaged=True, **params)
        return draft

    def test_preview_save_reimport_archive_and_fallback(self):
        draft = self.adopt(self.row, rate=.011, bank='Банк владельца')
        other = self.adopt(self.virtual, subsidy=.12)
        old_size = len(self.books['test-public'])
        prepared = self.edit(draft, other, preview=True)['changes']
        self.assertEqual(len(self.books['test-public']), old_size)
        for row, original in zip(prepared, (self.row, self.virtual)):
            self.assertEqual(row['params']['subsidyOrigin']['rate'], original['params']['rate'])
            self.assertNotIn('source', row)
        self.ai.assert_not_called()
        self.catalog = self.edit(*prepared)['data']
        self.assertEqual(len(self.books['test-public']), old_size + 1)
        self.assertEqual(len(self.books['test-private']), 1)
        self.assertEqual(self.request('/api/tools')['records'], self.catalog['records'])
        saved = store.parse(self.books['test-public'])
        for row in prepared:
            self.assertIn(row, saved['records'])
        self.program['rate'] = .06981
        def available(project):
            return [r['params']['rate'] for r in self.catalog['records'] if r['project'] == project
                    and r.get('source') and bank.bank_key(r) == bank.bank_key(dict(self.row, project=project))]
        self.catalog = self.request('/api/tools')
        self.assertEqual(available('da1'), [self.sibling['rate']])
        self.assertCountEqual(available('da2'), [self.sibling['rate'], self.program['rate']])
        archived = dict(prepared[0], enabled=False)
        self.catalog = self.edit(archived)['data']
        for fallback in (True, False):
            if fallback:
                self.bank.side_effect = FileNotFoundError()
            else:
                self.bank.side_effect = None
            self.catalog = self.request('/api/tools')
            self.assertIn(archived, self.catalog['records'])
            self.assertEqual(available('da1'), [self.sibling['rate']])
            self.assertEqual(bool(self.catalog['mortgageWarnings']), fallback)
            self.assertEqual(len(self.catalog['records']), len({r['id'] for r in self.catalog['records']}))

    def test_takeover_checks_and_ambiguous_reimport(self):
        draft = self.adopt(self.virtual)
        wrong_flag = deepcopy(draft)
        del wrong_flag['params']['appManaged']
        forged = self.adopt(self.virtual, subsidyOrigin={'key':'x'})
        for invalid in (wrong_flag, forged, self.adopt(self.virtual, ownerOnly=True),
                        dict(draft, id='sub-unknown'), dict(draft, project='da2')):
            self.edit(invalid, status=400)
        self.assertFalse(any(c.args[0]=='POST' for c in self.google.call_args_list))
        # Резерв ещё в старом формате, без служебных полей. При принятии во время сбоя
        # и после возвращения банка архив скрывает только свою исходную программу.
        self.source['errors'] = {'da':'Сбой'}
        archived = dict(self.adopt(self.row), enabled=False)
        self.catalog = self.edit(archived)['data']
        self.source['errors'].clear()
        self.program['rate'], self.sibling['rate'] = .09123, .08123
        self.catalog = self.request('/api/tools')
        self.assertIn('da1', self.catalog['mortgageWarnings'])
        self.assertNotIn('da2', self.catalog['mortgageWarnings'])
        rates = [r['params']['rate'] for r in self.catalog['records'] if r.get('source')
                 and bank.bank_key(r) == bank.bank_key(self.row)]
        self.assertEqual(rates, [.09871])
        self.assertFalse(next(r for r in self.catalog['records'] if r['id']==archived['id'])['enabled'])

    def test_new_public_private_and_ai_review(self):
        new = deepcopy(self.row)
        new.pop('source')
        new.update(id='tool-new', group='group-new')
        personal = dict(new, id='tool-private', params=dict(new['params'], ownerOnly=True))
        adopted = self.adopt(self.virtual)
        self.catalog = self.edit(new, personal, adopted)['data']
        for r in (new, personal):
            row = next(x for x in self.catalog['records'] if x['id']==r['id'])
            self.assertTrue(row['params']['appManaged'])
            self.assertNotIn('subsidyOrigin', row['params'])
        self.assertEqual(self.books['test-private'][1][0], personal['id'])
        published = json.loads(self.snapshot.read_text())
        self.assertNotIn(personal['id'], [r['id'] for r in published['records']])
        self.assertIn(self.row, published['records'])
        item = dict(target=adopted['id'], name='Ручная ставка', project='da1', kind='mortgage',
                    category='mortgage', terms='Уточнённое название', combination='', source_ids=[1])
        imported = dict(item, target=self.row['id'])
        with patch.object(tools_proposals, 'structured', return_value={'items':[item, imported], 'questions':[]}):
            result = self.request('/api/ai/propose', {'text':'Согласованы изменения условий.'})
        proposal, = result['items']
        self.assertTrue(result['questions'])
        self.assertEqual(proposal['record']['id'], adopted['id'])
        self.assertEqual(proposal['record']['params']['subsidyOrigin']['key'], bank.bank_key(self.virtual))
        revised = self.request('/api/ai/revise', dict(previous=proposal['record'], ticket=proposal['ticket'],
                               revision=result['revision'], record=dict(proposal['record'], enabled=False)))
        self.catalog = self.request('/api/ai/accept', dict(items=[revised], revision=result['revision']))['data']
        self.assertIn(revised['record'], self.catalog['records'])


if __name__ == '__main__':
    unittest.main()
