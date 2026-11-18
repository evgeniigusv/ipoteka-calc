import base64
import json
import unittest
from unittest.mock import patch

from owner_catalog_test import LocalCatalogTest
import owner_catalog as store
import tools_source as source
import publish_tools as publisher
import tools_editor as editor
import subsidy_catalog as bank


class PublishTest(LocalCatalogTest):
    def test_snapshot_filters_private_data_and_reports_pages_unavailable(self):
        payloads=[]
        def gh(args,body=None):
            if args[0]=='--method' and args[1]=='PUT':
                payloads.append(json.loads(base64.b64decode(body['content'])))
                self.assertEqual(body['sha'],'expected-checkout-sha')
                return {'commit':{'sha':'new-public-sha'}}
            raise RuntimeError('Pages недоступен')
        with patch.object(publisher,'gh',side_effect=gh):
            result=publisher.publish_snapshot(self.catalog,'test/repo','expected-checkout-sha')
        self.assertTrue(result['snapshotSaved']);self.assertFalse(result['published'])
        self.assertIn('Pages',result['error'])
        self.assertEqual(payloads[0]['settings'],store.DEFAULT_SETTINGS)
        self.assertNotIn('Закрытая запись',json.dumps(payloads[0],ensure_ascii=False))
        self.assertNotIn('revision',payloads[0])

    def test_remote_conflict_does_not_overwrite_or_claim_publication(self):
        with patch.object(publisher,'gh',side_effect=RuntimeError('409')) as gh:
            with self.assertRaises(RuntimeError):publisher.publish_snapshot(self.catalog,'test/repo','old-sha')
        self.assertEqual(gh.call_count,1)
        self.assertEqual(store.read(True),self.catalog)

    def test_local_publish_reads_current_db_not_stale_request(self):
        latest=self.edit(name='Новая версия')
        with patch.object(publisher,'remote_snapshot',return_value=('remote-sha',source.public_snapshot(self.catalog))), \
             patch.object(publisher,'publish_snapshot',return_value={'published':True,'snapshotSaved':True}) as publish:
            result=publisher.publish_local(self.catalog)
        self.assertEqual(result['data'],latest)
        self.assertEqual(publish.call_args.args[0],source.public_snapshot(latest))
        local=json.loads((self.root/'public-tools.json').read_text())
        self.assertEqual(local,source.public_snapshot(latest))

    def test_no_network_still_saves_safe_retry_snapshot(self):
        with patch.object(publisher,'remote_snapshot',side_effect=RuntimeError('Нет сети')):
            with self.assertRaises(RuntimeError):publisher.publish_local(self.catalog)
        local=json.loads((self.root/'public-tools.json').read_text())
        self.assertEqual(local,source.public_snapshot(self.catalog))
        self.assertEqual(store.read(True),self.catalog)

    def test_confirmed_pages_build_is_queued_not_finished(self):
        with patch.object(publisher,'gh',side_effect=[{'commit':{'sha':'abc'}},{'status':'built'},{'status':'queued'}]):
            result=publisher.publish_snapshot(self.catalog,'test/repo','sha')
        self.assertTrue(result['published'])
        self.assertEqual(result['publicationStatus'],'queued')

    def test_sheet_urls_and_private_promotion_references_not_exported(self):
        data=json.loads(json.dumps(self.catalog))
        row=next(r for r in data['records'] if not store.private(r))
        row['description']='Условия https://docs.google.com/spreadsheets/d/private-book/edit#gid=123'
        row['params']['compatiblePromotions']=['internal-test']
        data['privateSheetUrl']='https://docs.google.com/spreadsheets/d/another-secret/edit'
        clean=source.public_snapshot(data)
        self.assertNotIn('private-book',json.dumps(clean))
        self.assertNotIn('another-secret',json.dumps(clean))
        self.assertNotIn('internal-test',json.dumps(clean))
        self.assertEqual(next(r for r in clean['records'] if r['id']==row['id'])['params']['compatiblePromotions'],[])


    def test_failed_put_after_bank_import_returns_current_sqlite_revision(self):
        remote = source.public_snapshot(self.catalog)
        remote['mortgageCheckedAt'] = dict.fromkeys(('da1','da2','dnk2'),'2026-11-18T12:00:00+00:00')
        changed = next(r for r in remote['records'] if bank.bank_row(r))
        changed['params']['subsidy'] = .1234
        with patch.object(publisher,'remote_snapshot',return_value=('remote-sha',remote)), \
             patch.object(publisher,'config',return_value=self.conf), \
             patch.object(publisher,'publish_snapshot',side_effect=RuntimeError('GitHub PUT failed')), \
             patch.object(editor,'publish',side_effect=publisher.publish_local), \
             patch.object(store,'backups'):
            response = editor.publication_response(self.catalog)
        actual = store.read(True)
        self.assertTrue(response['saved'])
        self.assertFalse(response['published'])
        self.assertIn('GitHub PUT failed',response['error'])
        self.assertNotEqual(actual['revision'],self.catalog['revision'])
        self.assertEqual(response['data'],actual)
        self.assertEqual(next(r for r in actual['records'] if r['id']==changed['id'])['params']['subsidy'],.1234)
        # Следующая правка из UI применима без искусственного конфликта старой ревизии.
        updated = store.save(actual,response['data']['revision'],[dict(self.info,name='Следующая правка')],lambda _,rows:rows,'edit')
        self.assertNotEqual(updated['revision'],actual['revision'])

    def test_failed_reload_does_not_present_stale_revision_as_current(self):
        with patch.object(editor,'publish',side_effect=RuntimeError('GitHub PUT failed')), \
             patch.object(editor,'read_catalog',side_effect=RuntimeError('SQLite unavailable')), \
             patch.object(store,'backups'):
            response = editor.publication_response(self.catalog)
        self.assertTrue(response['saved'])
        self.assertFalse(response['published'])
        self.assertIsNone(response['data'])
        self.assertTrue(response['refreshRequired'])
        self.assertIn('GitHub PUT failed',response['error'])


if __name__=='__main__':unittest.main()
