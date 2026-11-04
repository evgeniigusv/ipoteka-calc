import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path
spec = importlib.util.spec_from_file_location('sync_macro', Path(__file__).resolve().parents[1] / 'automation/sync_macro.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class SnapshotTests(unittest.TestCase):
    def row(self):
        return {'house_id': 6736582, 'num': '1', 'floor': 2, 'rooms': 2, 'studio': 0, 'area': 40.0, 'price': 8000000.0, 'action': 7000000.0}

    def test_filter_validation(self):
        sync.validate([self.row()])
        for invalid in ({'price': 0}, {'area': 0}, {'num': ''}, {'house_id': 1}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                sync.validate([{**self.row(), **invalid}])

    def test_publication_guards(self):
        import base64, json
        old = {'updated': '04.11.2026, 13:33', 'source_ts': '2026-11-04T13:33:00', 'rows': [self.row()] * 4}
        remote = {'sha': 'sha', 'content': base64.b64encode(json.dumps(old).encode()).decode()}
        with patch.object(sync, 'gh', return_value=remote) as gh:
            with self.assertRaises(ValueError):
                sync.publish({'updated': '04.11.2026, 14:33', 'source_ts':'2026-11-04T14:33:00', 'rows':[self.row()]}, True)
            with self.assertRaises(ValueError):
                sync.publish({'updated': '04.11.2026, 12:33', 'source_ts':'2026-11-04T12:33:00', 'rows':[self.row()] * 4}, True)
            sync.publish(old, False)
            self.assertEqual(gh.call_count, 3) # GET only: no PUT

if __name__ == '__main__': unittest.main()
