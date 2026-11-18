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


    def test_ambiguous_rate_changes_preserve_each_local_text_field_in_both_imports(self):
        template = next(p for p in self.bank_source['programs'] if bank.identity(p) == bank.identity(self.row['params']))
        programs = [dict(template, bank='Регрессионный банк', rate=rate) for rate in (.04, .05)]
        initial_source = copy.deepcopy(self.bank_source)
        initial_source['programs'].extend(programs)
        initial_source['checked_at'] = '2026-11-18T11:00:00+00:00'
        baseline = store.import_bank_snapshot(bank.with_subsidies(self.catalog, initial_source))
        project = self.row['project']
        pair = [r for r in baseline['records'] if r['project'] == project and r['params'].get('bank') == 'Регрессионный банк']
        self.assertEqual(len(pair), 2)
        self.assertTrue(all(not bank.has_local_metadata(r) for r in pair))
        fresh_source = copy.deepcopy(initial_source)
        fresh_source['checked_at'] = '2026-11-18T12:00:00+00:00'
        for p in fresh_source['programs']:
            if p['bank'] == 'Регрессионный банк': p['rate'] += .001
        remote = source.public_snapshot(baseline)
        remote['mortgageCheckedAt'] = dict.fromkeys(('da1','da2','dnk2'), fresh_source['checked_at'])
        for r in remote['records']:
            if r['params'].get('bank') == 'Регрессионный банк':
                r['id'] += '-new'
                r['params']['rate'] += .001
        def selected(data):
            return [r for r in data['records'] if r['project'] == project and r['params'].get('bank') == 'Регрессионный банк']
        for field in ('name', 'description', 'note', 'combination', 'empty_note'):
            with self.subTest(field=field):
                changes = copy.deepcopy(pair)
                for i, r in enumerate(changes):
                    target = r['params'] if field in ('note','empty_note') else r
                    target['note' if field == 'empty_note' else field] = '' if field == 'empty_note' else 'Локальный текст ' + str(i)
                current = store.read(True)
                current = store.save(current,current['revision'],changes,lambda _,rows:rows,'edit')
                before = selected(current)
                direct = bank.with_subsidies(current, fresh_source)
                self.assertEqual(selected(direct), before)
                self.assertIn('однозначно', direct['mortgageWarnings'][project])
                self.assertEqual(direct['mortgageCheckedAt'][project], current['mortgageCheckedAt'][project])
                imported = store.import_bank_snapshot(remote)
                self.assertEqual(selected(imported), before)
                self.assertIn('однозначно', imported['mortgageWarnings'][project])
                self.assertEqual(imported['mortgageCheckedAt'][project], current['mortgageCheckedAt'][project])
                self.assertEqual(imported['settings'],current['settings'])
                # Старый публичный резерв без локальных текстов не должен вытеснить их и на первом импорте.
                undated = dict(current)
                undated.pop('mortgageCheckedAt')
                stale = self.root/'stale-public.json'
                stale.write_text(json.dumps(source.public_snapshot(baseline)))
                with patch.object(bank,'PUBLISHED',stale):
                    first_import = bank.with_subsidies(undated,fresh_source)
                self.assertEqual(selected(first_import),before)
                self.assertIn('однозначно',first_import['mortgageWarnings'][project])

        # Контроль: если локального текста нет, новые варианты не задерживаются без причины.
        current = store.read(True)
        current = store.save(current,current['revision'],pair,lambda _,rows:rows,'edit')
        direct = bank.with_subsidies(current,fresh_source)
        self.assertNotIn(project,direct['mortgageWarnings'])
        self.assertEqual(sorted(round(r['params']['rate'],6) for r in selected(direct)), [.041,.051])
        imported = store.import_bank_snapshot(remote)
        self.assertNotIn(project,imported['mortgageWarnings'])
        self.assertEqual(sorted((r['params']['rate'],r['name'],r['description']) for r in selected(imported)),
                         sorted((r['params']['rate'],r['name'],r['description']) for r in selected(direct)))


if __name__=='__main__':unittest.main()
