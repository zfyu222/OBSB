import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TagsCliTests(unittest.TestCase):
    def test_list_and_search(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "Raw").mkdir()
            (vault / "Raw" / "a.md").write_text("---\ntags: [Python, 知识管理]\n---\nA", encoding="utf-8")
            (vault / "Raw" / "b.md").write_text("---\ntags:\n  - python\n---\nB", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "tools/tags.py"), "--vault", str(vault), "list", "--json"],
                text=True,
                capture_output=True,
                check=True,
            )
            rows = json.loads(result.stdout)
            self.assertEqual(rows[0], {"tag": "Python", "count": 2})
            result = subprocess.run(
                [sys.executable, str(ROOT / "tools/tags.py"), "--vault", str(vault), "search", "知识", "--json"],
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertEqual(json.loads(result.stdout), [{"tag": "知识管理", "count": 1}])


if __name__ == "__main__":
    unittest.main()
