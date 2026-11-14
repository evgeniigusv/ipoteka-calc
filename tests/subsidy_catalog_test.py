import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import subsidy_catalog as catalog
from tools_source import ROOT, public_snapshot


def cards(data, project):
    return [r for r in data['records'] if r['project'] == project and catalog.managed(r)]


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / 'tests/fixtures/tools-initial.json').read_text())
        self.source = json.loads((ROOT / 'assets/mortgage.json').read_text())
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'tools.json'
        binding = patch.object(catalog, 'PUBLISHED', self.path)
        binding.start()
        self.addCleanup(binding.stop)
        self.path.write_text(json.dumps(self.data))
        self.previous = catalog.with_subsidies(self.data, self.source)
        del self.previous['mortgageCheckedAt']  # Первый запуск со старым форматом.
        self.path.write_text(json.dumps(self.previous))

    def test_error_then_retry_then_recovery(self):
        self.source['checked_at'] = '2026-11-14T09:00:00+00:00'
        self.source['errors'] = {'da': 'Ошибка G34'}
        for p in self.source['programs']:
            if p['type'] == 'Семейная ипотека':
                p['subsidy'] = .2345
        data = copy.deepcopy(self.data)
        # Изменение другого инструмента сохраняется даже при ошибке в ДА.
        edited = next(r for r in data['records'] if r['kind'] == 'info')
        edited['description'] = 'Исправлены условия'
        first = public_snapshot(catalog.with_subsidies(data, self.source))
        self.assertIn(edited, first['records'])
        for project in ('da1', 'da2'):
            self.assertEqual(cards(first, project), cards(self.previous, project))
            self.assertEqual(first['mortgageCheckedAt'][project], self.previous['checked_at'])
        self.assertNotEqual(cards(first, 'dnk2'), cards(self.previous, 'dnk2'))
        self.assertEqual(first['mortgageCheckedAt']['dnk2'], self.source['checked_at'])
        self.assertEqual(first['mortgageWarnings'], {'da1': 'Ошибка G34', 'da2': 'Ошибка G34'})

        first['checked_at'] = '2026-11-14T10:00:00+00:00'
        self.path.write_text(json.dumps(first))
        self.source['checked_at'] = '2026-11-14T11:00:00+00:00'
        self.source['errors']['dnk'] = 'Ошибка ДНК'
        retry = catalog.with_subsidies(data, self.source)
        self.assertEqual(retry['mortgageCheckedAt'], first['mortgageCheckedAt'])
        self.assertEqual(retry['records'], first['records'])

        self.source['errors'].clear()
        recovered = catalog.with_subsidies(data, self.source)
        self.assertFalse(recovered['mortgageWarnings'])
        self.assertEqual(set(recovered['mortgageCheckedAt'].values()), {self.source['checked_at']})
        self.assertNotEqual(cards(recovered, 'da1'), cards(self.previous, 'da1'))

    def test_sharp_drop_rejects_whole_source_only(self):
        self.source['programs'] = [p for p in self.source['programs'] if p['projects'] == catalog.PROJECTS['da']]
        snapshot = catalog.with_subsidies(self.data, self.source)
        self.assertEqual(set(snapshot['mortgageWarnings']), {'dnk2'})
        self.assertEqual(cards(snapshot, 'dnk2'), cards(self.previous, 'dnk2'))


if __name__ == '__main__':
    unittest.main()
