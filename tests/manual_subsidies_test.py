import copy
import json
import unittest
from unittest.mock import patch

from owner_catalog_test import LocalCatalogTest
import owner_catalog as store
import tools_source as source
import tools_editor as editor
import subsidy_catalog as bank
from sync_tools import merge_snapshot


class ManualSubsidiesTest(LocalCatalogTest):
    def setUp(self):
        super().setUp()
        self.bank_source = json.loads((source.ROOT/'assets/mortgage.json').read_text())
        self.bank_source['checked_at'] = '2026-11-18T10:00:00+00:00'
        incoming = bank.with_subsidies(self.catalog, self.bank_source)
        self.catalog = store.import_bank_snapshot(incoming)
        self.row = next(r for r in self.catalog['records'] if r.get('source')=='subsidies')
        self.mock(editor,'interpret',side_effect=lambda previous,draft,context:draft)

    def edit_row(self,draft):
        self.catalog = store.save(self.catalog,self.catalog['revision'],[draft],editor.prepare,'edit')
        return next(r for r in self.catalog['records'] if r['id']==draft['id'])

    def refresh(self):
        self.bank_source['checked_at']='2026-11-18T13:00:00+00:00'
        incoming=bank.with_subsidies(self.catalog,self.bank_source)
        self.catalog=store.import_bank_snapshot(incoming)
        return next(r for r in self.catalog['records'] if r['id']==self.row['id'])

    def test_imported_metadata_keeps_bank_rates_and_local_settings(self):
        promo=next(r for r in self.catalog['records'] if r['category']=='discount' and r['project']==self.row['project'] and not store.private(r))
        draft=copy.deepcopy(self.row)
        draft['params']['compatiblePromotions']=[promo['id']]
        draft.update(mode='sequential',combination='Локальное условие',name='Название владельца')
        self.edit_row(draft)
        previous_settings=copy.deepcopy(self.catalog['settings'])
        for p in self.bank_source['programs']:
            if bank.identity(p)==bank.identity(self.row['params']): p['subsidy']=.2321
        result=self.refresh()
        self.assertEqual(result['params']['subsidy'],.2321)
        self.assertEqual(result['params']['compatiblePromotions'],[promo['id']])
        self.assertEqual(result['mode'],'sequential')
        self.assertEqual(result['name'],'Название владельца')
        self.assertEqual(result.get('source'),'subsidies')
        self.assertFalse(result['params'].get('appManaged'))
        self.assertEqual(self.catalog['settings'],previous_settings)

    def test_numeric_bank_change_requires_ownership_then_survives_sync(self):
        draft=copy.deepcopy(self.row);draft['params']['rate']=.021
        with self.assertRaises(ValueError):self.edit_row(draft)
        draft.pop('source');draft['params']['appManaged']=True
        saved=self.edit_row(draft)
        self.assertIn('subsidyOrigin',saved['params'])
        for p in self.bank_source['programs']:
            if bank.identity(p)==bank.identity(self.row['params']):p['rate']=.078
        self.refresh()
        self.assertIn(saved,self.catalog['records'])
        self.assertNotIn('source',saved)
        self.assertEqual(saved['params']['rate'],.021)

    def test_cloud_snapshot_updates_only_banks_never_settings_or_manual(self):
        remote=source.public_snapshot(self.catalog)
        remote['settings']['subsidyCompensation']['da1']=.99
        manual=next(r for r in remote['records'] if not bank.bank_row(r))
        manual['name']='Нельзя заменить локальное имя'
        remote['mortgageCheckedAt']=dict.fromkeys(('da1','da2','dnk2'),'2026-11-18T14:00:00+00:00')
        row=next(r for r in remote['records'] if r['id']==self.row['id'])
        row['params']['subsidy']=.345
        original=store.read(True)
        after=store.import_bank_snapshot(remote)
        self.assertEqual(after['settings'],original['settings'])
        self.assertEqual([r for r in after['records'] if not bank.bank_row(r)],[r for r in original['records'] if not bank.bank_row(r)])
        self.assertEqual(next(r for r in after['records'] if r['id']==row['id'])['params']['subsidy'],.345)
        self.assertEqual(store.import_bank_snapshot(source.public_snapshot(original)),after)

    def test_cloud_sync_never_reads_all_tools_google(self):
        previous=source.public_snapshot(self.catalog)
        with patch.object(source,'read',side_effect=AssertionError('Нельзя читать старый каталог')):
            result=merge_snapshot(previous,self.bank_source)
        self.assertEqual(result['settings'],previous['settings'])
        self.assertEqual([r for r in result['records'] if not bank.bank_row(r)],[r for r in previous['records'] if not bank.bank_row(r)])


if __name__=='__main__':unittest.main()
