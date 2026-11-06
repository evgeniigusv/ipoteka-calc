import copy, http.client, json, sys, threading, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'automation'))
import tools_source as source
import tools_editor as editor
DATA=json.loads((source.ROOT/'tests/fixtures/tools-initial.json').read_text()); DATA['revision']=source.revision(DATA['records'])
class SourceTests(unittest.TestCase):
 def test_roundtrip_and_broken_rows(self):
  rows=[source.COLUMNS]+[source.row(r) for r in DATA['records']]
  self.assertEqual(source.parse(rows)['records'],DATA['records'])
  with self.assertRaises(ValueError): source.parse([source.COLUMNS,rows[1],[],rows[2]])
  bad=copy.deepcopy(rows);bad[1][9]='{"rate":100}'
  with self.assertRaises(ValueError): source.parse(bad)
 def test_cyrillic_request_encoding(self):
  result=type('Result',(),{'returncode':0,'stdout':'{}\n200'})()
  with patch.object(source.subprocess,'run',return_value=result) as run:
   source.curl('https://sheets.googleapis.com/test','POST','{"range":"Инструменты!A2"}')
   self.assertIn('Инструменты',run.call_args.kwargs['input'])
 def test_scoped_write(self):
  change=copy.deepcopy(DATA['records'][0]);change['params']['rate']=.062
  with patch.object(source,'config',return_value={'sheet_name':'Тест'}),patch.object(source,'google') as api,patch.object(source,'read',return_value=DATA):
   source.write_changes(DATA,[change]); body=api.call_args.args[2];self.assertEqual(body['valueInputOption'],'RAW');self.assertEqual(len(body['data']),1);self.assertEqual(body['data'][0]['range'],"'Тест'!A2:K2")
 def test_duplicate_changes(self):
  with patch.object(source,'config',return_value={'sheet_name':'Тест'}),self.assertRaises(ValueError): source.write_changes(DATA,[DATA['records'][0]]*2)
class HttpTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.server=editor.ThreadingHTTPServer(('127.0.0.1',0),editor.Handler);cls.port=cls.server.server_port;cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
 @classmethod
 def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
 def request(self,path='/api/tools',body=None,headers=None):
  h={'Host':'127.0.0.1:8795','Cookie':'sm_owner='+editor.SESSION,'Origin':editor.ORIGIN,'X-CSRF-Token':editor.CSRF,'Content-Type':'application/json'};h.update(headers or {})
  conn=http.client.HTTPConnection('127.0.0.1',self.port);conn.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,h);r=conn.getresponse();result=(r.status,json.loads(r.read()));conn.close();return result
 def test_protections(self):
  for headers in [{'Host':'attacker.example'},{'Origin':'https://example.org'},{'X-CSRF-Token':'bad'},{'Cookie':'bad'},{'Sec-Fetch-Site':'cross-site'}]:self.assertEqual(self.request(body={},headers=headers)[0],403)
  self.assertEqual(self.request('/.git/config')[0],404)
  self.assertEqual(self.request('/automation/tools_source.py')[0],404)
 def test_conflict_no_write(self):
  with patch.object(editor,'read',return_value=DATA),patch.object(editor,'write_changes') as write:
   self.assertEqual(self.request(body={'revision':'old','changes':[]})[0],409);write.assert_not_called()
 def test_google_saved_publish_failed(self):
  with patch.object(editor,'read',return_value=DATA),patch.object(editor,'write_changes',return_value=DATA),patch.object(editor,'publish',side_effect=RuntimeError('Публикация недоступна')):
   code,result=self.request(body={'revision':DATA['revision'],'changes':[DATA['records'][0]]});self.assertEqual(code,200);self.assertTrue(result['saved']);self.assertFalse(result['published']);self.assertEqual(result['data']['revision'],DATA['revision'])
 def test_publish_retry_does_not_write_google(self):
  with patch.object(editor,'read',return_value=DATA),patch.object(editor,'write_changes') as write,patch.object(editor,'publish',return_value='sha'):
   code,result=self.request('/api/publish',{});self.assertEqual(code,200);self.assertTrue(result['published']);write.assert_not_called()
if __name__=='__main__':unittest.main()
