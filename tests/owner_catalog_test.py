import copy
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import owner_catalog as store
import tools_editor as editor
import tools_source as source


class LocalCatalogTest(unittest.TestCase):
    def mock(self, obj, name, **kw):
        binding = patch.object(obj, name, **kw)
        self.addCleanup(binding.stop)
        return binding.start()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.conf = dict(catalog_path=str(self.root / 'catalog.sqlite'), backup_dir=str(self.root / 'backups'),
                         external_backup_dir=str(self.root / 'external'), spreadsheet_id='public-test',
                         owner_sheet={'spreadsheet_id':'private-test'})
        self.mock(source, 'config', return_value=self.conf)
        fixture = json.loads((source.ROOT / 'tests/fixtures/tools-initial.json').read_text())
        info = next(r for r in fixture['records'] if r['kind'] == 'info')
        self.owner = dict(info, id='internal-test', name='Закрытая запись', params={'ownerOnly':True})
        self.mock(source, 'read', return_value=fixture)
        self.mock(source, 'read_private', return_value={'records':[self.owner]})
        self.report = store.migrate_google(self.root / 'migration')
        self.catalog = store.read(True)
        self.info = next(r for r in self.catalog['records'] if r['id'] == info['id'])

    def edit(self, current=None, **fields):
        current = current or self.catalog
        draft = dict(self.info, **fields)
        return store.save(current, current['revision'], [draft], lambda _, r:r, 'edit')

    def test_migration_hashes_restore_and_preserved_original(self):
        self.assertEqual(self.report['owner'], 1)
        self.assertEqual(self.report['importedHash'], self.report['restoredHash'])
        self.assertTrue(self.report['restoreVerified'])
        self.assertEqual(self.catalog['settings'], store.DEFAULT_SETTINGS)
        self.assertTrue(all(r['mode'] == 'additive' for r in self.catalog['records']))
        original = json.loads((self.root/'migration/original-google-catalog.json').read_text())
        self.assertEqual(source.revision(original['records']), self.report['originalHash'])
        store.backups()
        copies = list((self.root/'external').glob('*.sqlite'))
        restored = store.restore_backup(copies[0], self.root/'restored.sqlite')
        self.assertEqual(restored, self.catalog)
        with self.assertRaises(ValueError): store.migrate_google(self.root/'again')

    def test_batch_atomicity_and_retry_after_reopen(self):
        hidden = dict(next(r for r in self.catalog['records'] if store.private(r)), enabled=False)
        changed = dict(self.info, name='Новое имя')
        result = store.save(self.catalog, self.catalog['revision'], [changed,hidden], lambda _,r:r, 'edit')
        self.assertIn(changed, result['records']); self.assertIn(hidden, result['records'])
        retry = store.save(store.read(True), self.catalog['revision'], [changed,hidden], lambda *_:self.fail('Повторный разбор'), 'edit')
        self.assertEqual(result, retry)
        self.assertNotIn(hidden, source.public_snapshot(result)['records'])
        self.edit(result, name='Ещё одна версия')
        with self.assertRaises(store.Conflict):
            store.save(store.read(True), self.catalog['revision'], [changed,hidden], lambda _,r:r, 'edit')

    def test_invalid_batch_rolls_back_public_and_private(self):
        hidden = dict(self.owner, name='')
        with self.assertRaises(ValueError):
            store.save(self.catalog, self.catalog['revision'], [dict(self.info,name='Не сохранять'),hidden], lambda _,r:r,'edit')
        self.assertEqual(store.read(True), self.catalog)
        with self.assertRaises(ValueError):
            self.edit(params={'ownerOnly':True})
        self.assertEqual(store.read(True), self.catalog)

    def test_concurrent_compare_and_swap_only_one_winner(self):
        barrier = threading.Barrier(2)
        def run(name):
            def prepare(_, rows): barrier.wait(timeout=5); return rows
            try:
                store.save(self.catalog, self.catalog['revision'], [dict(self.info,name=name)], prepare, 'edit')
                return 'ok'
            except store.Conflict:
                return 'conflict'
        with ThreadPoolExecutor(2) as pool:
            self.assertCountEqual(list(pool.map(run, ('Первый','Второй'))), ['ok','conflict'])

    def test_settings_cas_strict_validation_and_inventory(self):
        settings = copy.deepcopy(store.DEFAULT_SETTINGS)
        settings['subsidyCompensation']['da1'] = .12
        first = store.save_settings(self.catalog, self.catalog['revision'], settings)
        self.assertEqual(first['settings'], settings)
        self.assertEqual(store.save_settings(store.read(True), self.catalog['revision'], settings),first)
        with self.assertRaises(store.Conflict): self.edit(name='Устаревшая правка')
        for invalid in (dict(settings, personal='secret'), dict(settings,specialFlats=['123:John']),
                        dict(settings,specialFlats=['1:1','1:1']), dict(settings,subsidyCompensation={'da1':True,'da2':.1,'dnk2':.1})):
            with self.assertRaises(ValueError): store.save_settings(first,first['revision'],invalid)
        self.assertEqual(store.read(True), first)

    def test_persistent_retry_receipts_restore(self):
        saved = self.edit(name='Изменено')
        backup = store.backup_to(self.root/'backup.sqlite')
        path = self.root/'recovered.sqlite'
        store.restore_backup(backup,path)
        self.conf['catalog_path'] = str(path)
        retry = store.save(store.read(True), self.catalog['revision'], [dict(self.info,name='Изменено')],lambda *_:self.fail(),'edit')
        self.assertEqual(retry, saved)


class ApiTest(LocalCatalogTest):
    def setUp(self):
        super().setUp()
        self.pub = self.mock(editor,'publish',return_value={'published':True,'snapshotSaved':True,'error':None})
        self.interpreter = self.mock(editor,'interpret',side_effect=lambda previous,draft,context:draft)
        self.server = editor.ThreadingHTTPServer(('127.0.0.1',0),editor.Handler)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.addCleanup(self.server.server_close); self.addCleanup(self.server.shutdown)

    def api(self,path,body=None,headers=None):
        conn=HTTPConnection(*self.server.server_address,timeout=10)
        try:
            h={'Host':'127.0.0.1:8795','Origin':editor.ORIGIN,'Cookie':'sm_owner='+editor.SESSION,'X-CSRF-Token':editor.CSRF}
            h.update(headers or {})
            conn.request('GET' if body is None else 'POST',path,json.dumps(body),h)
            response=conn.getresponse();return response.status,json.loads(response.read())
        finally:conn.close()

    def test_settings_get_save_publish_failure_and_retry(self):
        status,data=self.api('/api/settings');self.assertEqual(status,200)
        self.assertEqual(set(data),{'revision','settings'})
        data['settings']['subsidyCompensation']['dnk2']=.15
        self.pub.side_effect=RuntimeError('Публикация недоступна')
        status,result=self.api('/api/settings',data)
        self.assertEqual(status,200);self.assertTrue(result['saved']);self.assertFalse(result['published'])
        self.assertEqual(result['data']['settings'],data['settings'])
        self.pub.side_effect=None
        self.assertTrue(self.api('/api/settings',data)[1]['published'])
        self.assertEqual(self.api('/api/tools')[1]['revision'],result['data']['revision'])
        self.assertEqual(self.api('/api/tools',{'revision':data['revision'],'changes':[self.info]})[0],409)

    def test_settings_and_tools_same_security(self):
        body={'revision':self.catalog['revision'],'settings':self.catalog['settings']}
        for path in ('/api/settings','/api/tools'):
            for headers in ({'Cookie':''},{'Origin':'https://evil.example'},{'Host':'evil.example'},
                            {'X-CSRF-Token':'bad'},{'Sec-Fetch-Site':'cross-site'}):
                self.assertEqual(self.api(path,body,headers)[0],403)
            self.assertEqual(self.api(path,headers={'Cookie':''})[0],401)
        self.assertEqual(self.api('/automation/owner_catalog.py')[0],404)
        self.assertEqual(self.api('/api/session')[1]['storage'],'sqlite')

    def test_tools_preview_save_and_snapshot_is_public(self):
        request={'revision':self.catalog['revision'],'changes':[dict(self.info,name='Новое название')]}
        status,_=self.api(editor.EVENT,dict(request,preview=True));self.assertEqual(status,200)
        self.assertEqual(store.read(True),self.catalog)
        status,result=self.api('/api/tools',request);self.assertEqual(status,200)
        public=source.public_snapshot(result['data'])
        self.assertEqual(public['settings'],store.DEFAULT_SETTINGS)
        self.assertNotIn('Закрытая запись',json.dumps(public,ensure_ascii=False))
        self.assertNotIn('revision',public)
        self.assertEqual(self.api('/api/tools',request)[0],200)


    def test_info_promotions_in_prepare_cache_and_ai_revise_context(self):
        promo = dict(self.info, id='test-info-promotion', category='discount', params={'percent':.05})
        hidden = dict(promo, id='test-hidden-promotion', params={'percent':.04,'ownerOnly':True})
        current = store.save(self.catalog,self.catalog['revision'],[promo,hidden],lambda _,r:r,'edit')
        draft = dict(self.info, description='Новое описание')
        request = {'revision':current['revision'],'changes':[draft],'preview':True}
        self.assertEqual(self.api(editor.EVENT,request)[0],200)
        context = self.interpreter.call_args.args[2]
        self.assertIn(promo,context);self.assertNotIn(hidden,context)
        self.interpreter.reset_mock()
        self.assertEqual(self.api(editor.EVENT,request)[0],200)
        self.interpreter.assert_not_called()
        req = {'revision':current['revision'],'previous':self.info,'record':draft,
               'ticket':editor.ticket(current['revision'],self.info)}
        self.assertEqual(self.api('/api/ai/revise',req)[0],200)
        self.assertIn(promo,self.interpreter.call_args.args[2])

    def test_promotion_visibility_and_project_move_clean_references_atomically(self):
        promo = dict(self.info,id='test-move-promotion',category='discount',params={'percent':.05})
        linked = dict(self.info,params=dict(self.info['params'],compatiblePromotions=[promo['id']]))
        current = store.save(self.catalog,self.catalog['revision'],[promo,linked],lambda _,r:r,'edit')
        private_promo = dict(promo,params=dict(promo['params'],ownerOnly=True))
        status,result = self.api('/api/tools',{'revision':current['revision'],'changes':[private_promo]})
        self.assertEqual(status,200,result)
        current = result['data']
        self.assertEqual(next(r for r in current['records'] if r['id']==linked['id'])['params']['compatiblePromotions'],[])
        self.assertNotIn(promo['id'],[r['id'] for r in source.public_snapshot(current)['records']])
        # Возвращаем в общий список, снова связываем и переносим в другой проект.
        current = store.read(True)
        current = store.save(current,current['revision'],[promo,linked],lambda _,r:r,'edit')
        moved = dict(promo, project='dnk2' if promo['project']!='dnk2' else 'da1')
        status,result = self.api('/api/tools',{'revision':current['revision'],'changes':[moved]})
        self.assertEqual(status,200,result)
        self.assertEqual(next(r for r in result['data']['records'] if r['id']==linked['id'])['params']['compatiblePromotions'],[])
        self.assertIn(moved,result['data']['records'])


if __name__=='__main__':unittest.main()
