import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from nightly_orchestrator import changed_paths, execute, exclusive_lock, nightly_worktree_path, raw_candidates, read_operations, snapshot_visible_state, tool_bundle_manifest, tracked_markdown_status, validate, write_report  # noqa: E402


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
            self.assertEqual(outcome.status, "success", outcome.error)
            self.assertTrue((vault / "InBox/capture.md").exists())
            self.assertTrue((vault / "Drived/整理日志").glob("*.md"))
            self.assertEqual(list((root / "worktrees").iterdir()), [])
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

    def test_nightly_worktree_has_a_stable_project_facing_path(self):
        root = Path("temporary-worktrees")
        self.assertEqual(nightly_worktree_path(root), root / "nightly")

    def test_skip_metadata_excludes_raw_note_from_candidates_and_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = self.vault(Path(temp))
            previous = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            note = vault / "Raw/领域/base.md"
            note.write_text("---\nnightly_maintenance: skip\n---\n持续记录", encoding="utf-8")
            subprocess.run(["git", "-C", str(vault), "add", "Raw/领域/base.md"], check=True)
            subprocess.run(["git", "-C", str(vault), "commit", "-m", "record update"], check=True, capture_output=True)
            baseline = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            self.assertEqual(raw_candidates(vault, previous, baseline), [])
            self.assertEqual(validate(vault, ["Raw/领域/base.md"]), [])

    def test_skipped_record_is_not_sent_for_nightly_work_and_advances_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            note = vault / "Raw/领域/base.md"
            note.write_text("---\nnightly_maintenance: skip\n---\n宝宝午餐：米饭和蔬菜。", encoding="utf-8")
            agent = root / "agent.py"
            agent.write_text(
                "import json, os\nfrom pathlib import Path\nroot=Path(os.environ['NIGHTLY_VAULT'])\n"
                "context=json.loads((root/'.nightly-context.json').read_text(encoding='utf-8'))\n"
                "assert context['raw_candidates'] == []\n"
                "assert context['skipped_paths'] == ['Raw/领域/base.md']\n",
                encoding="utf-8",
            )
            outcome = execute(vault, root / "worktrees", root / "state", f"{sys.executable} {agent}")
            self.assertEqual(outcome.status, "no_changes", outcome.error)
            self.assertIn("nightly_maintenance: skip", note.read_text(encoding="utf-8"))
            self.assertEqual(list((vault / "Drived/整理日志").glob("*.md")), [])

    def test_tool_bundle_manifest_ignores_reproducible_python_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            bundle = Path(temp)
            (bundle / "tool.py").write_text("print('ok')", encoding="utf-8")
            cache = bundle / "__pycache__"
            cache.mkdir()
            (cache / "tool.cpython-314.pyc").write_bytes(b"cache")
            self.assertEqual(set(tool_bundle_manifest(bundle)), {"tool.py"})

    def test_report_groups_each_note_with_a_concise_processing_description(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = self.vault(Path(temp))
            path = "Raw/领域/new.md"
            (vault / path).write_text("---\ntags: [测试]\nsummary_final: 新笔记\n---\n新笔记", encoding="utf-8")
            baseline = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            report = write_report(
                vault,
                status="成功",
                baseline=baseline,
                session="session",
                changes=[path],
                error=None,
                operations=[{"path": path, "actions": ["created", "metadata_updated"], "detail": "整理为测试主题笔记并补充检索摘要。"}],
            )
            content = report.read_text(encoding="utf-8")
            self.assertIn("## 笔记处理", content)
            self.assertIn("[[Raw/领域/new]]：整理为测试主题笔记并补充检索摘要。", content)
            self.assertEqual(content.count("[[Raw/领域/new]]"), 1)
            self.assertNotIn("（新建、更新元数据）", content)

    def test_each_report_has_its_own_timestamped_filename_and_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = self.vault(Path(temp))
            baseline = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            first = write_report(
                vault, status="成功", baseline=baseline, session="session", changes=[], error=None,
                run_at=datetime(2026, 9, 22, 3, 1, 2, tzinfo=timezone.utc),
            )
            second = write_report(
                vault, status="成功", baseline=baseline, session="session", changes=[], error=None,
                run_at=datetime(2026, 9, 22, 3, 1, 3, tzinfo=timezone.utc),
            )
            self.assertEqual(first.name, "2026-09-22-030102.md")
            self.assertEqual(second.name, "2026-09-22-030103.md")
            self.assertIn("运行时间：2026-09-22 03:01:02 +0000", first.read_text(encoding="utf-8"))

    def test_report_omits_removed_inbox_source_when_destination_describes_move(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = self.vault(Path(temp))
            source_path = "InBox/capture.md"
            destination_path = "Raw/领域/capture.md"
            source = vault / source_path
            destination = vault / destination_path
            source.write_text("capture", encoding="utf-8")
            subprocess.run(["git", "-C", str(vault), "add", source_path], check=True)
            subprocess.run(["git", "-C", str(vault), "commit", "-m", "capture"], check=True, capture_output=True)
            baseline = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            source.rename(destination)
            subprocess.run(["git", "-C", str(vault), "add", "-A"], check=True)
            changes = changed_paths(vault, baseline, staged=True)
            operations_path = vault / ".nightly-operations.json"
            operations_path.write_text(
                json.dumps({"operations": [{"path": destination_path, "actions": ["moved", "metadata_updated", "inbox_removed"], "detail": "整理为领域笔记并补充检索摘要。"}]}, ensure_ascii=False),
                encoding="utf-8",
            )
            operations = read_operations(vault, baseline, changes)
            self.assertEqual([item["path"] for item in operations], [destination_path])

    def test_changed_paths_keeps_the_removed_inbox_source_of_a_move(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = self.vault(Path(temp))
            source = vault / "InBox/capture.md"
            destination = vault / "Raw/领域/capture.md"
            source.write_text("capture", encoding="utf-8")
            subprocess.run(["git", "-C", str(vault), "add", "InBox/capture.md"], check=True)
            subprocess.run(["git", "-C", str(vault), "commit", "-m", "capture"], check=True, capture_output=True)
            baseline = subprocess.run(["git", "-C", str(vault), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip()
            source.rename(destination)
            subprocess.run(["git", "-C", str(vault), "add", "-A"], check=True)
            self.assertEqual(changed_paths(vault, baseline, staged=True), ["InBox/capture.md", "Raw/领域/capture.md"])

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

    def test_preexisting_non_candidate_raw_validation_error_does_not_block_inbox_change(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            old = vault / "Raw/领域/legacy.md"
            old.write_text("---\ntags: [旧]\nsummary_final: 旧摘要\n---\n历史正文", encoding="utf-8")
            subprocess.run(["git", "-C", str(vault), "add", "Raw/领域/legacy.md"], check=True)
            subprocess.run(["git", "-C", str(vault), "commit", "-m", "legacy"], check=True, capture_output=True)
            agent = root / "agent.py"
            agent.write_text(
                "import os\nfrom pathlib import Path\nroot=Path(os.environ['NIGHTLY_VAULT'])\n"
                "(root/'InBox').mkdir(exist_ok=True)\n"
                "(root/'InBox'/'capture.md').write_text('capture', encoding='utf-8')\n",
                encoding="utf-8",
            )
            outcome = execute(vault, root / "worktrees", root / "state", f"{sys.executable} {agent}")
            self.assertEqual(outcome.status, "success", outcome.error)
            self.assertTrue((vault / "InBox/capture.md").is_file())

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

    def test_interrupted_run_releases_lock_and_does_not_advance_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vault = self.vault(root)
            with patch("nightly_orchestrator.run_agent", side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):
                    execute(vault, root / "worktrees", root / "state", "unused")
            self.assertFalse((root / "state/nightly.lock").exists())
            self.assertFalse((root / "state/nightly-state.json").exists())
            self.assertFalse((root / "worktrees/nightly").exists())

    def test_dead_runner_lock_is_reclaimed_but_live_runner_remains_exclusive(self):
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp) / "state"
            stale = state / "nightly.lock"
            stale.mkdir(parents=True)
            (stale / "owner.json").write_text('{"pid":999999,"token":"dead"}\n', encoding="utf-8")
            with exclusive_lock(state):
                self.assertTrue((state / "nightly.lock/owner.json").is_file())
                with self.assertRaisesRegex(Exception, "another nightly run is already active"):
                    with exclusive_lock(state):
                        pass
            self.assertFalse((state / "nightly.lock").exists())


if __name__ == "__main__":
    unittest.main()
