import copy
import json
import sys
import threading
import unittest
from collections import OrderedDict
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import owner_catalog
import tools_editor as editor
import tools_source as source


class OwnerCatalogTest(unittest.TestCase):
    def mock(self, obj, name, **kwargs):
        p = patch.object(obj, name, **kwargs)
        self.addCleanup(p.stop)
        return p.start()

    def setUp(self):
        self.config = dict(spreadsheet_id='public-book', sheet_name='Общий', gid=0,
                           credentials='test-only', owner_sheet=dict(
                               spreadsheet_id='owner-book', sheet_name='Личный', gid=0))
        self.mock(source, 'config', return_value=self.config)
        self.mock(editor, 'config', return_value=self.config)
        self.public = json.loads((source.ROOT/'tests/fixtures/tools-initial.json').read_text())['records']
        self.info = next(r for r in self.public if r['kind'] == 'info')
        self.owner = [dict(self.info, id='internal-' + str(i), params={'ownerOnly': True})
                      for i in (1, 2)]
        self.read_public = self.mock(source, 'read', side_effect=lambda *a, **kw: self.snapshot(self.public))
        self.read_owner = self.mock(source, 'read_private', side_effect=lambda conf: self.snapshot(self.owner))
        self.public_write = self.mock(source, 'write_changes', side_effect=self.write_public)
        self.owner_write = self.mock(source, 'write_private', side_effect=self.write_owner)
        self.publish = self.mock(editor, 'publish', return_value='test')
        self.mock(editor, 'with_subsidies', side_effect=lambda data: data)
        self.mock(editor, 'interpret', side_effect=lambda previous, draft, context: draft)
        self.mock(owner_catalog, '_retries', new=OrderedDict())
        self.server = editor.ThreadingHTTPServer(('127.0.0.1', 0), editor.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.archive = dict(self.owner[0], enabled=False)
        self.change = dict(self.info, name='Обновлено')

    @staticmethod
    def snapshot(rows):
        return dict(version=1, checked_at='2026-11-14', records=copy.deepcopy(rows), revision=source.revision(rows))

    def write_public(self, current, changes, *, source):
        self.assertEqual(source['spreadsheet_id'], 'public-book')
        self.assertEqual(current['records'], self.public)
        self.assertTrue(all(not owner_catalog.private(r) for r in changes))
        self.public = owner_catalog.updated(current, changes)
        return self.snapshot(self.public)

    def write_owner(self, current, changes, conf):
        self.assertEqual(conf, self.config['owner_sheet'])
        self.assertEqual(current['records'], self.owner)
        self.assertTrue(all(owner_catalog.private(r) for r in changes))
        self.owner = owner_catalog.updated(current, changes)
        return self.snapshot(self.owner)

    def api(self, path, body=None):
        conn = HTTPConnection(*self.server.server_address, timeout=10)
        try:
            conn.request('GET' if body is None else 'POST', path, json.dumps(body), headers={
                'Host': '127.0.0.1:8795', 'Cookie': 'sm_owner=' + editor.SESSION,
                'Origin': editor.ORIGIN, 'X-CSRF-Token': editor.CSRF})
            result = conn.getresponse()
            return result.status, json.loads(result.read())
        finally:
            conn.close()

    def batch(self):
        return dict(revision=self.api('/api/tools')[1]['revision'], changes=[self.change, self.archive])

    def test_read_session_preview_and_archive(self):
        status, data = self.api('/api/tools')
        self.assertEqual(status, 200)
        self.assertEqual(data['records'], self.public + self.owner)
        self.assertEqual(data['revision'], source.revision(self.public + self.owner))
        self.assertNotIn('owner-book', json.dumps(data))
        self.assertEqual(self.api('/api/session')[1]['source'],
                         'https://docs.google.com/spreadsheets/d/public-book/edit#gid=0')
        body = dict(revision=data['revision'], changes=[self.archive])
        self.assertEqual(self.api(editor.EVENT, dict(body, preview=True)), (200, {'changes':[self.archive]}))
        self.owner_write.assert_not_called()
        status, result = self.api(editor.EVENT, body)
        self.assertEqual(status, 200)
        self.assertNotEqual(result['data']['revision'], data['revision'])
        self.assertEqual(result['data']['records'][-2], self.archive)
        self.assertEqual(self.publish.call_args.args[0]['records'], self.public)
        self.public_write.assert_not_called()
        self.owner_write.assert_called_once()
        self.assertEqual(self.api(editor.EVENT, body)[0], 200)
        self.owner_write.assert_called_once()

    def test_partial_write_and_retry(self):
        body = self.batch()
        self.owner_write.side_effect = RuntimeError('Ошибка до записи')
        self.assertEqual(self.api(editor.EVENT, body)[0], 503)
        self.assertIn(self.change, self.public)
        self.assertNotIn(self.archive, self.owner)
        self.publish.assert_not_called()
        self.owner_write.side_effect = self.write_owner
        self.assertEqual(self.api(editor.EVENT, body)[0], 200)
        self.public_write.assert_called_once()
        self.assertEqual(self.owner_write.call_count, 2)
        self.assertIn(self.archive, self.owner)

    def test_lost_response_after_commit_and_signed_retry(self):
        body = self.batch()
        req = dict(revision=body['revision'], items=[
            dict(record=r, ticket=editor.ticket(body['revision'], r)) for r in body['changes']])

        def lose_response(*args):
            self.write_owner(*args)
            raise RuntimeError('Ответ потерян')
        self.owner_write.side_effect = lose_response
        self.assertEqual(self.api('/api/ai/accept', req)[0], 503)
        self.assertEqual(self.api('/api/ai/accept', req)[0], 200)
        self.public_write.assert_called_once()
        self.owner_write.assert_called_once()

    def test_partial_write_with_external_edit_is_conflict(self):
        body = self.batch()
        self.owner_write.side_effect = RuntimeError('Нет сети')
        self.assertEqual(self.api(editor.EVENT, body)[0], 503)
        self.owner[1] = dict(self.owner[1], name='Внешняя правка')
        self.assertEqual(self.api(editor.EVENT, body)[0], 409)
        self.public_write.assert_called_once()
        self.owner_write.assert_called_once()
        self.publish.assert_not_called()

    def test_move_in_either_direction_rejected_before_write(self):
        revision = self.batch()['revision']
        for old in [self.info, self.owner[0]]:
            moved = dict(old, params=dict(old['params'], ownerOnly=not owner_catalog.private(old)))
            body = dict(revision=revision, changes=[moved])
            self.assertEqual(self.api(editor.EVENT, body)[0], 400)
            self.assertEqual(self.api('/api/ai/accept', dict(revision=revision, items=[
                dict(record=moved, ticket=editor.ticket(revision, moved))]))[0], 400)
        self.public_write.assert_not_called()
        self.owner_write.assert_not_called()

    def test_invalid_owner_source_and_failed_private_read(self):
        self.read_owner.side_effect = RuntimeError('Закрытый файл недоступен')
        self.assertEqual(self.api('/api/tools')[0], 503)
        self.assertEqual(self.read_public.call_count, 1)
        self.assertEqual(self.read_public.call_args.args, (True,))
        self.read_owner.reset_mock()
        for invalid in [None, {}, dict(self.config['owner_sheet'], spreadsheet_id='public-book')]:
            self.config['owner_sheet'] = invalid
            self.assertEqual(self.api('/api/tools')[0], 503)
        self.read_owner.assert_not_called()

    def test_duplicate_id_or_wrong_book_rejected(self):
        original = self.owner[0]
        for invalid in [dict(original, id=self.info['id']), self.info]:
            self.owner[0] = invalid
            self.assertEqual(self.api('/api/tools')[0], 503)
        self.owner[0] = original
        self.public.append(dict(original, id='misplaced'))
        self.assertEqual(self.api('/api/tools')[0], 503)

    def test_legacy_single_source(self):
        del self.config['owner_sheet']
        status, data = self.api('/api/tools')
        self.assertEqual(status, 200)
        self.assertEqual(data['revision'], source.revision(self.public))
        self.read_public.assert_called_once_with(True)
        self.read_owner.assert_not_called()


if __name__ == '__main__':
    unittest.main()
