import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from nightly_orchestrator import execute, snapshot_visible_state, tracked_markdown_status  # noqa: E402


class NightlyOrchestratorTests(unittest.TestCase):
    def vault(self, root: Path) -> Path:
        vault = root / "vault"
        for folder in ("InBox", "Raw/领域", "Drived/整理日志", "Assets"):
            (vault / folder).mkdir(parents=True, exist_ok=True)
        (vault / "Raw/领域/base.md").write_text("---\ntags: [测试]\nsummary_final: 基础\n---\n基础", encoding="utf-8")
        subprocess.run(["git", "-C", str(vault), "init"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(vault), "config", "user.name", "Test"], check=True)
        subprocess.run(["git", "-C", str(vault), "config", "user.email", "test@example.com"], check=True)
        subprocess.run(["git", "-C", str(vault), "add", "."], check=True)
        subprocess.run(["git", "-C", str(vault), "commit", "-m", "base"], check=True, capture_output=True)
        return vault

    def test_success_applies_isolated_markdown_and_advances_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            agent = root / "agent.py"
            agent.write_text(
                "import os\nfrom pathlib import Path\nroot=Path(os.environ['NIGHTLY_VAULT'])\n"
                "(root/'InBox').mkdir(exist_ok=True)\n"
                "(root/'InBox'/'capture.md').write_text('capture', encoding='utf-8')\n",
                encoding="utf-8",
            )
            outcome = execute(vault, root / "worktrees", root / "state", f"{sys.executable} {agent}")
            self.assertEqual(outcome.status, "success")
            self.assertTrue((vault / "InBox/capture.md").exists())
            self.assertTrue((vault / "Drived/整理日志").glob("*.md"))
            state = json.loads((root / "state/nightly-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["baseline"], outcome.baseline)

    def test_snapshot_allows_only_the_required_root_gitignore(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            (vault / ".gitignore").write_text("# inner policy\n*\n!*/\n!.gitignore\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(vault), "add", "-f", ".gitignore"], check=True)
            subprocess.run(["git", "-C", str(vault), "commit", "-m", "ignore policy"], check=True, capture_output=True)
            (vault / ".gitignore").write_text("# amended policy\n*\n!*/\n!.gitignore\n", encoding="utf-8")
            snapshot = snapshot_visible_state(vault)
            self.assertTrue(snapshot)
            status = subprocess.run(["git", "-C", str(vault), "status", "--short"], text=True, capture_output=True, check=True)
            self.assertEqual(status.stdout, "")

    def test_status_accepts_unicode_and_space_markdown_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = self.vault(Path(temp))
            relative = "InBox/第一期 Windows 测试.md"
            (vault / relative).write_text("测试", encoding="utf-8")
            self.assertEqual(tracked_markdown_status(vault), [relative])

    def test_failure_writes_report_without_applying_worktree_change(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            agent = root / "agent.py"
            agent.write_text(
                "import os\nfrom pathlib import Path\nroot=Path(os.environ['NIGHTLY_VAULT'])\n"
                "(root/'Raw'/'bad.md').write_text('no frontmatter', encoding='utf-8')\n",
                encoding="utf-8",
            )
            outcome = execute(vault, root / "worktrees", root / "state", f"{sys.executable} {agent}")
            self.assertEqual(outcome.status, "failed")
            self.assertFalse((vault / "Raw/bad.md").exists())
            reports = list((vault / "Drived/整理日志").glob("*.md"))
            self.assertEqual(len(reports), 1)
            self.assertIn("失败", reports[0].read_text(encoding="utf-8"))

    def test_no_change_is_silent_and_only_advances_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            agent = root / "agent.py"
            agent.write_text("", encoding="utf-8")
            outcome = execute(vault, root / "worktrees", root / "state", f"{sys.executable} {agent}")
            self.assertEqual(outcome.status, "no_changes")
            self.assertEqual(list((vault / "Drived/整理日志").glob("*.md")), [])
            commits = subprocess.run(["git", "-C", str(vault), "rev-list", "--count", "HEAD"], text=True, capture_output=True, check=True)
            self.assertEqual(commits.stdout.strip(), "1")

    def test_validation_error_is_returned_for_one_correction_round(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            agent = root / "agent.py"
            agent.write_text(
                "import json, os\nfrom pathlib import Path\nroot=Path(os.environ['NIGHTLY_VAULT'])\n"
                "note=root/'Raw'/'fixed.md'\n"
                "if json.loads(os.environ['NIGHTLY_FEEDBACK']):\n"
                " note.write_text('---\\ntags: [测试]\\nsummary_final: 完成\\n---\\n完成',encoding='utf-8')\n"
                "else:\n note.write_text('invalid',encoding='utf-8')\n",
                encoding="utf-8",
            )
            outcome = execute(vault, root / "worktrees", root / "state", f"{sys.executable} {agent}")
            self.assertEqual(outcome.status, "success")
            self.assertTrue((vault / "Raw/fixed.md").exists())

    def test_concurrent_untracked_note_blocks_overlapping_apply(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            agent = root / "agent.py"
            agent.write_text(
                "import os\nfrom pathlib import Path\nroot=Path(os.environ['NIGHTLY_VAULT'])\n"
                "(root/'InBox').mkdir(exist_ok=True)\n"
                "(root/'InBox'/'same.md').write_text('worktree', encoding='utf-8')\n"
                "(root.parent.parent/'vault'/'InBox'/'same.md').write_text('formal', encoding='utf-8')\n",
                encoding="utf-8",
            )
            outcome = execute(vault, root / "worktrees", root / "state", f"{sys.executable} {agent}")
            self.assertEqual(outcome.status, "failed")
            report = next((vault / "Drived/整理日志").glob("*.md"))
            self.assertIn("formal vault changed concurrently", report.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
