import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import subsidy_source as lookup
import tools_editor as editor

FAMILY = {'id': 'mortgage-test', 'source': 'subsidies', 'kind': 'mortgage', 'project': 'da2',
          'params': {'bank': 'Банк', 'type': 'Семейная ипотека', 'kids': '1 ребёнок',
                     'term': 15, 'rate': .07001}}
ROW = ['Банк', 'Семейная ипотека ', '1 ребенок', '15 лет', .07001, .1, 15, .1, '', '', 6000000]
ERROR = {'errorValue': {'type': 'VALUE'}}


def sheet(*rows, gid=11):
    def cell(value):
        if isinstance(value, dict):
            return {'effectiveValue': value}
        key = 'stringValue' if isinstance(value, str) else 'numberValue'
        return {'effectiveValue': {key: value}}
    return {'properties': {'sheetId': gid}, 'data': [{'rowData': [
        {'values': [cell(v) for v in row]} for row in (lookup.HEADERS, *rows)]}]}


class SourceTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / 'sheets.json'
        path.write_text(json.dumps({'spreadsheet_id': 'test-book', 'sources': {
            'da': {'gid': 11, 'name': "Тест 'ДА'"}, 'dnk': {'gid': 22, 'name': 'Тест ДНК'}}}))
        self.enter_patch(lookup, 'CONFIG', path)
        self.enter_patch(lookup.tools_source, 'config', return_value={'credentials': 'test-oauth'})
        self.google = self.enter_patch(lookup.tools_source, 'google')

    def enter_patch(self, *args, **kwargs):
        p = patch.object(*args, **kwargs)
        self.addCleanup(p.stop)
        return p.start()

    def test_live_range_with_other_rows_and_blanks(self):
        unrelated = ROW.copy()
        unrelated[2], unrelated[6] = '2 ребенка', ERROR
        self.google.return_value = {'sheets': [sheet(unrelated, [], ROW)]}
        for project in ('da1', 'da2'):
            result = lookup.source_link(dict(FAMILY, project=project))
            self.assertEqual(result, {'url': 'https://docs.google.com/spreadsheets/d/test-book/edit#gid=11&range=A4:K4',
                                      'exact': True})
        method, path = self.google.call_args.args
        self.assertEqual(method, 'GET')
        self.assertEqual(parse_qs(urlsplit(path).query)['ranges'], ["'Тест ''ДА'''!A:K"])
        self.assertEqual(self.google.call_args.kwargs['source'],
                         {'credentials': 'test-oauth', 'spreadsheet_id': 'test-book'})

    def test_duplicate_possible_duplicate_and_moved_or_missing_program(self):
        other = ROW.copy()
        other[6] = ERROR
        for rows in ([ROW, ROW], [other, ROW], [ROW, other], [other], []):
            with self.subTest(rows=rows):
                self.google.return_value = {'sheets': [sheet(*rows)]}
                self.assertEqual(lookup.source_link(FAMILY),
                                 {'url': 'https://docs.google.com/spreadsheets/d/test-book/edit#gid=11',
                                  'exact': False})

    def test_identity_fields_and_base_variant(self):
        base = dict(FAMILY, project='dnk2', params=dict(
            bank='Банк', type='Базовая ипотека', variant='субсидированная ставка', term=15, rate=.07001))
        row = ROW.copy()
        row[1:3] = ['Базовая', 'Субсидированная ставка']
        row[7] = ERROR  # Комиссия не входит в идентификатор программы.
        near = []
        for changes in ({0: 'Другой банк'}, {1: 'Семейная ипотека', 2: '1 ребенок'},
                        {2: 'стандартная ставка'}, {3: '30 лет', 6: 30}, {4: .070011}):
            changed = row.copy()
            for index, value in changes.items():
                changed[index] = value
            near.append(changed)
        self.google.return_value = {'sheets': [sheet(*near, row, gid=22)]}
        self.assertEqual(lookup.source_link(base),
                         {'url': 'https://docs.google.com/spreadsheets/d/test-book/edit#gid=22&range=A7:K7',
                          'exact': True})

    def test_unverified_sheet_only_returns_tab(self):
        wrong_header = sheet(ROW)
        wrong_header['data'][0]['rowData'][0]['values'].reverse()
        for sheets in ([], [sheet(ROW, gid=22)], [wrong_header], [sheet(ROW), sheet(ROW)]):
            self.google.return_value = {'sheets': sheets}
            self.assertFalse(lookup.source_link(FAMILY)['exact'])
        self.google.side_effect = RuntimeError('текст ошибки внешнего сервиса')
        self.assertNotIn('&range=', lookup.source_link(FAMILY)['url'])

    def test_owner_http_route(self):
        published = self.enter_patch(editor, 'PUBLISHED')
        published.read_text.return_value = json.dumps({'records': [FAMILY, dict(FAMILY, id='ordinary', source=None)]})
        current = self.enter_patch(editor, 'read_catalog', return_value={})
        newer = dict(FAMILY, id='sub-new')
        self.enter_patch(editor, 'with_subsidies', return_value={'records': [newer]})
        self.google.return_value = {'sheets': [sheet(ROW)]}
        headers = {'Host': '127.0.0.1:' + str(editor.PORT), 'Sec-Fetch-Site': 'same-origin',
                   'Cookie': 'sm_owner=' + editor.SESSION}
        with editor.ThreadingHTTPServer(('127.0.0.1', 0), editor.Handler) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                def get(query, override=None):
                    conn = http.client.HTTPConnection('127.0.0.1', server.server_port)
                    try:
                        merged = dict(headers, **(override or {}))
                        conn.request('GET', '/api/subsidy-source?' + query,
                                     headers={k: v for k, v in merged.items() if v is not None})
                        resp = conn.getresponse()
                        self.assertEqual(resp.getheader('Cache-Control'), 'no-store')
                        return resp.status, json.load(resp)
                    finally:
                        conn.close()

                for override, expected in [
                    ({'Cookie': ''}, 401), ({'Host': 'example.invalid'}, 403),
                    ({'Sec-Fetch-Site': 'cross-site'}, 403), ({'Origin': 'null'}, 403),
                    ({'Origin': 'https://example.invalid'}, 403), ({'Sec-Fetch-Site': None}, 403)
                ]:
                    self.assertEqual(get('id=mortgage-test', override)[0], expected)
                for query in ('', 'id=', 'id=a&id=b', 'id=..'):
                    self.assertEqual(get(query)[0], 400)
                self.assertEqual(get('id=ordinary')[0], 404)
                self.google.assert_not_called()
                current.assert_not_called()
                for key in ('mortgage-test', 'sub-new'):
                    status, obj = get('id=' + key)
                    self.assertEqual(status, 200)
                    self.assertTrue(obj['exact'])
                self.assertEqual(get('id=unknown')[0], 404)
            finally:
                server.shutdown()


if __name__ == '__main__':
    unittest.main()
