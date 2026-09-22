import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class VaultRestoreTests(unittest.TestCase):
    def init_vault(self, root: Path) -> Path:
        vault = root / "vault"
        (vault / "Raw/领域").mkdir(parents=True)
        (vault / "InBox").mkdir()
        (vault / "Drived/整理日志").mkdir(parents=True)
        (vault / "Raw/领域/a.md").write_text("---\ntags: [测试]\nsummary_final: 初始\n---\n初始", encoding="utf-8")
        (vault / "Raw/领域/b.md").write_text("---\ntags: [测试]\nsummary_final: 其他\n---\n其他", encoding="utf-8")
        subprocess.run(["git", "-C", str(vault), "init"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(vault), "config", "user.name", "Test"], check=True)
        subprocess.run(["git", "-C", str(vault), "config", "user.email", "test@example.com"], check=True)
        subprocess.run(["git", "-C", str(vault), "add", "."], check=True)
        subprocess.run(["git", "-C", str(vault), "commit", "-m", "base"], check=True, capture_output=True)
        return vault

    def commit(self, vault: Path, message: str) -> str:
        subprocess.run(["git", "-C", str(vault), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(vault), "commit", "-m", message], check=True, capture_output=True)
        return subprocess.run(
            ["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True
        ).stdout.strip()

    def run_cli(self, vault: Path, worktrees: Path, *args: str, expect: int = 0):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/vault_restore.py"), "--vault", str(vault), "--worktrees", str(worktrees), *args],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, expect, result.stderr or result.stdout)
        return json.loads(result.stdout)

    def test_preview_does_not_change_vault(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.init_vault(root)
            note = vault / "Raw/领域/a.md"
            note.write_text("---\ntags: [测试]\nsummary_final: 夜间\n---\n夜间", encoding="utf-8")
            nightly = self.commit(vault, "Nightly memory organization 2026-09-22")
            head = nightly
            payload = self.run_cli(vault, root / "worktrees", "revert-task", nightly)
            self.assertEqual(payload["status"], "preview")
            self.assertEqual(subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip(), head)
            self.assertIn("夜间", note.read_text(encoding="utf-8"))

    def test_revert_task_preserves_later_nonconflicting_edit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.init_vault(root)
            first = vault / "Raw/领域/a.md"
            second = vault / "Raw/领域/b.md"
            first.write_text("初始", encoding="utf-8")
            self.commit(vault, "pre-nightly capture")
            first.write_text("---\ntags: [测试]\nsummary_final: 夜间\n---\n夜间", encoding="utf-8")
            nightly = self.commit(vault, "Nightly memory organization 2026-09-22")
            second.write_text("---\ntags: [测试]\nsummary_final: 后续\n---\n后续", encoding="utf-8")
            self.commit(vault, "later edit")

            payload = self.run_cli(vault, root / "worktrees", "revert-task", nightly, "--apply")
            self.assertEqual(payload["status"], "applied")
            self.assertEqual(first.read_text(encoding="utf-8"), "初始")
            self.assertIn("后续", second.read_text(encoding="utf-8"))
            subject = subprocess.run(["git", "-C", str(vault), "show", "-s", "--format=%s"], text=True, capture_output=True, check=True).stdout.strip()
            self.assertTrue(subject.startswith("Revert nightly organization"))

    def test_revert_task_stops_on_conflicting_later_edit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.init_vault(root)
            note = vault / "Raw/领域/a.md"
            note.write_text("---\ntags: [测试]\nsummary_final: 夜间\n---\n夜间", encoding="utf-8")
            nightly = self.commit(vault, "Nightly memory organization 2026-09-22")
            note.write_text("---\ntags: [测试]\nsummary_final: 用户后改\n---\n用户后改", encoding="utf-8")
            head = self.commit(vault, "later conflicting edit")

            payload = self.run_cli(vault, root / "worktrees", "revert-task", nightly, "--apply", expect=2)
            self.assertEqual(payload["status"], "stopped")
            self.assertIn("用户后改", note.read_text(encoding="utf-8"))
            current = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            self.assertEqual(current, head)

    def test_revert_task_preserves_historical_trailing_blank_line(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.init_vault(root)
            report = vault / "Drived/整理日志/2026-09-22.md"
            report.write_text("# 报告\n\n", encoding="utf-8")
            self.commit(vault, "report before nightly")
            report.write_text("# 报告\n\n<!-- probe -->\n", encoding="utf-8")
            nightly = self.commit(vault, "Nightly memory organization 2026-09-22")

            payload = self.run_cli(vault, root / "worktrees", "revert-task", nightly, "--apply")
            self.assertEqual(payload["status"], "applied")
            self.assertEqual(report.read_text(encoding="utf-8"), "# 报告\n\n")

    def test_restore_one_note_from_history_creates_new_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.init_vault(root)
            base = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            note = vault / "Raw/领域/a.md"
            note.write_text("---\ntags: [测试]\nsummary_final: 新版\n---\n新版", encoding="utf-8")
            self.commit(vault, "new version")

            payload = self.run_cli(vault, root / "worktrees", "restore-note", base, "Raw/领域/a.md", "--apply")
            self.assertEqual(payload["status"], "applied")
            self.assertIn("初始", note.read_text(encoding="utf-8"))
            self.assertEqual(payload["paths"], ["Raw/领域/a.md"])

    def test_revert_task_rejects_non_nightly_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.init_vault(root)
            base = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            payload = self.run_cli(vault, root / "worktrees", "revert-task", base, expect=2)
            self.assertIn("successful nightly", payload["error"])


if __name__ == "__main__":
    unittest.main()
