import io
import json
import wave
import sys
import threading
import unittest
from copy import deepcopy
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import tools_ai as ai
import tools_editor as editor
import tools_proposals as proposals
import tools_source as source

TEXT = ('Протокол встречи. Решили: для ДА, первая очередь, ввести рассрочку «Пробный график». '
        'Первоначальный взнос 40% от стоимости, остаток одним платежом через четыре месяца от сделки. '
        'Скидка не применяется, с акциями не суммируется. '
        'Предложение снизить ставку до 1% обсуждалось, решения нет.')
DATA = json.loads((source.ROOT/'tests/fixtures/tools-initial.json').read_text())
DATA['revision'] = source.revision(DATA['records'])
ITEM = dict(target='', name='Пробный график', project='da1', kind='installment', category='installment',
            terms='Первоначальный взнос 40%. Остаток через 4 месяца. Скидка 0%.',
            combination='С акциями не суммируется.', source_ids=[2, 3, 4])
EDITS = [dict(field=k, value_json=json.dumps(v), quote=q) for k,v,q in [
    ('minPv', .4, 'взнос 40%'), ('months', 4, 'через 4 месяца'), ('scheme', 'deferred', 'Остаток через 4 месяца'),
    ('disc', 0, 'Скидка 0%')]]


class PlanTest(unittest.TestCase):
    def test_original_evidence_and_calculation(self):
        with patch.object(proposals, 'structured', return_value={'items':[dict(ITEM,name='Рассрочка')], 'questions':[]}) as plan, \
             patch.object(ai, 'generate', return_value={'question':'','edits':EDITS}):
            result = proposals.proposals(DATA, TEXT)
        fragments = plan.call_args.args[1]['document']
        self.assertEqual(fragments[-1]['id'], 5)
        self.assertFalse(result['questions'])
        card, = result['items']
        self.assertEqual(card['quotes'], [s['text'] for s in fragments[1:4]])
        self.assertTrue(all(q in TEXT for q in card['quotes']))
        self.assertEqual(card['record']['name'], 'Пробный график')
        self.assertEqual(card['record']['params'], dict(minPv=.4, months=4, scheme='deferred', disc=0))
        self.assertEqual(card['record']['mode'], 'none')

    def test_bad_reference_never_becomes_a_card(self):
        for ids in ([], [0], [-1], [6], [True], ['2']):
            with self.subTest(ids=ids), patch.object(proposals, 'structured', return_value={
                    'items':[dict(ITEM,source_ids=ids)],'questions':[]}), patch.object(ai, 'generate') as generate:
                result = proposals.proposals(DATA, TEXT)
                self.assertFalse(result['items'])
                self.assertTrue(result['questions'])
                generate.assert_not_called()

    def test_audio_request_carries_original_file_and_glossary(self):
        with io.BytesIO() as buf:
            with wave.open(buf, 'wb') as wav:
                wav.setparams((1, 2, 16000, 0, 'NONE', ''))
                wav.writeframes(bytes(3200))
            raw = buf.getvalue()

        def receive(args, **kwargs):
            self.assertEqual(Path(args[-1].removeprefix('file=@')).read_bytes(), raw)
            prompt = next(a for a in args if a.startswith('prompt='))
            for term in ('«ДА»', 'ДНК-2', 'рассрочка', 'отсрочка', 'ПВ'):
                self.assertIn(term, prompt)
            return proposals.subprocess.CompletedProcess(args, 0, '{"text":"Проверено"}')

        with patch.object(proposals, 'api_key', return_value='test'), patch.object(
                proposals.subprocess, 'run', side_effect=receive):
            self.assertEqual(proposals.transcribe(raw, 'audio/wav'), 'Проверено')


class BatchTest(unittest.TestCase):
    def setUp(self):
        self.data = deepcopy(DATA)
        self.server = editor.ThreadingHTTPServer(('127.0.0.1', 0), editor.Handler)
        port = self.server.server_port
        self.origin = f'http://127.0.0.1:{port}'
        self.connection = HTTPConnection('127.0.0.1', port, timeout=10)
        for obj, name, value in [
                (editor, 'PORT', port), (editor, 'ORIGIN', self.origin),
                (source, 'config', lambda:{'sheet_name':'test'}),
                (source, 'read', lambda auth:deepcopy(self.data)),
                (editor, 'read', lambda auth:deepcopy(self.data)),
                (editor, 'read_catalog', lambda:deepcopy(self.data)),
                (editor, 'with_subsidies', lambda data:data)]:
            self.enter_patch(obj, name, new=value)
        self.google = self.enter_patch(source, 'google', side_effect=self.apply_in_memory)
        self.publish = self.enter_patch(editor, 'publish', return_value='local')
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.connection.close)

    def enter_patch(self, obj, name, **kwargs):
        mock = patch.object(obj, name, **kwargs)
        self.addCleanup(mock.stop)
        return mock.start()

    def apply_in_memory(self, method, path, body, **kwargs):
        self.assertIsNone(kwargs.get('source'))
        self.assertEqual((method, path), ('POST', '/values:batchUpdate'))
        rows = [source.row(r) for r in self.data['records']]
        for update in body['data']:
            n = int(update['range'].split('!A')[1].split(':')[0]) - 2
            rows[n:n+1] = update['values']
        self.data = source.parse([source.COLUMNS, *rows])

    def post(self, path, **payload):
        self.connection.request('POST', '/api/ai/'+path, json.dumps(payload), headers={
            'Origin':self.origin, 'Cookie':'sm_owner='+editor.SESSION, 'X-CSRF-Token':editor.CSRF})
        res = self.connection.getresponse()
        return res.status, json.loads(res.read())

    def test_review_then_one_batch_and_retry(self):
        rev = self.data['revision']
        first = dict(id='test-a', group='test', project='da1', kind='installment', category='installment',
                     mode='none', combination='Не суммируется', description=ITEM['terms'],
                     params=dict(minPv=.4, months=4, scheme='deferred', disc=0), name='Пробный график', enabled=True)
        second = dict(first, id='test-b', project='da2')
        def signed(r):
            return dict(record=r, ticket=editor.ticket(rev,r))
        before = signed(first)
        edited = dict(first, description=ITEM['terms'].replace('40%', '45%'))
        answer = {'question':'','edits':[dict(field='minPv', value_json='0.45', quote='взнос 45%')]}
        with patch.object(ai,'generate',return_value=answer):
            status, after = self.post('revise', previous=first, record=edited, ticket=before['ticket'], revision=rev)
        self.assertEqual(status, 200)
        edited['params'] = dict(first['params'], minPv=.45)
        self.assertEqual(after['record'], edited)
        self.assertNotEqual(after['ticket'], before['ticket'])
        for items in ([after,dict(signed(second),record=dict(second, enabled=False))], [after,after], []):
            self.assertEqual(self.post('accept', revision=rev, items=items)[0], 400)
        self.google.assert_not_called()
        self.publish.assert_not_called()
        batch = [after, signed(second)]
        self.publish.side_effect = RuntimeError('Публикация недоступна')
        status, result = self.post('accept', revision=rev, items=batch)
        self.assertEqual(status, 200)
        self.assertTrue(result['saved'])
        self.assertFalse(result['published'])
        self.assertEqual(self.data['records'][-2:], [edited,second])
        self.publish.side_effect = None
        self.assertTrue(self.post('accept', revision=rev, items=batch)[1]['published'])
        self.assertEqual(self.post('accept', revision=rev, items=[before])[0], 409)
        self.google.assert_called_once()


if __name__ == '__main__':
    unittest.main()
