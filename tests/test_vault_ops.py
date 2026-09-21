import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class VaultOpsTests(unittest.TestCase):
    def run_cli(self, vault: Path, *args: str):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/vault_ops.py"), "--vault", str(vault), *args],
            text=True,
            capture_output=True,
        )
        if result.returncode:
            self.fail(result.stderr or result.stdout)
        return result

    def init_git(self, vault: Path):
        subprocess.run(["git", "-C", str(vault), "init"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(vault), "config", "user.name", "Test"], check=True)
        subprocess.run(["git", "-C", str(vault), "config", "user.email", "test@example.com"], check=True)
        subprocess.run(["git", "-C", str(vault), "add", "."], check=True)
        subprocess.run(["git", "-C", str(vault), "commit", "-m", "base"], check=True, capture_output=True)

    def test_move_rewrites_full_and_unique_short_links(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "InBox").mkdir()
            (vault / "Raw/domain").mkdir(parents=True)
            (vault / "InBox/old-note.md").write_text("content", encoding="utf-8")
            ref = vault / "Raw/domain/reference.md"
            ref.write_text("[[InBox/old-note#section|display]] and ![[old-note]]", encoding="utf-8")
            result = self.run_cli(vault, "move", "InBox/old-note.md", "Raw/domain/new-note.md")
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertFalse((vault / "InBox/old-note.md").exists())
            self.assertEqual(ref.read_text(encoding="utf-8"), "[[Raw/domain/new-note#section|display]] and ![[new-note]]")

    def test_merge_remove_requires_valid_destination_and_snapshots_source(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "InBox").mkdir()
            (vault / "Raw/domain").mkdir(parents=True)
            source = vault / "InBox/capture.md"
            source.write_text("capture", encoding="utf-8")
            destination = vault / "Raw/domain/knowledge.md"
            destination.write_text("---\ntags: [测试]\nsummary_final: 知识\n---\n知识", encoding="utf-8")
            self.init_git(vault)
            source.write_text("new capture", encoding="utf-8")
            result = self.run_cli(vault, "merge-remove", "InBox/capture.md", "Raw/domain/knowledge.md")
            payload = json.loads(result.stdout)
            self.assertIsNotNone(payload["snapshot_commit"])
            self.assertFalse(source.exists())
            shown = subprocess.run(
                ["git", "-C", str(vault), "show", "HEAD:InBox/capture.md"],
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertEqual(shown.stdout, "new capture")

    def test_references_reports_wikilinks_and_relative_markdown_links(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "Raw/domain").mkdir(parents=True)
            target = vault / "Raw/domain/target.md"
            target.write_text("target", encoding="utf-8")
            (vault / "Raw/wiki.md").write_text("[[Raw/domain/target#part|Target]]", encoding="utf-8")
            (vault / "Raw/domain/markdown.md").write_text("[Target](target.md)", encoding="utf-8")

            result = self.run_cli(vault, "references", "Raw/domain/target.md")
            payload = json.loads(result.stdout)
            self.assertEqual(
                {(item["source"], item["line"]) for item in payload["references"]},
                {("Raw/wiki.md", 1), ("Raw/domain/markdown.md", 1)},
            )

    def test_delete_refuses_when_inbound_references_exist(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "Raw").mkdir()
            target = vault / "Raw/target.md"
            target.write_text("target", encoding="utf-8")
            (vault / "Raw/reference.md").write_text("[[target]]", encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "tools/vault_ops.py"),
                    "--vault",
                    str(vault),
                    "delete",
                    "Raw/target.md",
                ],
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertFalse(json.loads(result.stdout)["ok"])
            self.assertTrue(target.exists())

    def test_delete_removes_only_source_orphan_assets_and_snapshots_note(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "Raw").mkdir()
            (vault / "Assets").mkdir()
            source = vault / "Raw/delete-me.md"
            source.write_text(
                "![[Assets/orphan.png]]\n![shared](../Assets/shared.png)\n",
                encoding="utf-8",
            )
            keeper = vault / "Raw/keeper.md"
            keeper.write_text("![[Assets/shared.png]]", encoding="utf-8")
            orphan = vault / "Assets/orphan.png"
            shared = vault / "Assets/shared.png"
            unrelated = vault / "Assets/unrelated.png"
            for asset in (orphan, shared, unrelated):
                asset.write_bytes(b"asset")
            self.init_git(vault)
            source.write_text(source.read_text(encoding="utf-8") + "changed", encoding="utf-8")

            result = self.run_cli(vault, "delete", "Raw/delete-me.md")
            payload = json.loads(result.stdout)
            self.assertFalse(source.exists())
            self.assertFalse(orphan.exists())
            self.assertTrue(shared.exists())
            self.assertTrue(unrelated.exists())
            self.assertEqual(payload["deleted_assets"], ["Assets/orphan.png"])
            self.assertEqual(payload["kept_assets"][0]["path"], "Assets/shared.png")
            self.assertIsNotNone(payload["snapshot_commit"])
            shown = subprocess.run(
                ["git", "-C", str(vault), "show", "HEAD:Raw/delete-me.md"],
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertIn("changed", shown.stdout)

    def test_delete_can_keep_orphan_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp)
            (vault / "Raw").mkdir()
            (vault / "Assets").mkdir()
            source = vault / "Raw/delete-me.md"
            source.write_text("![[Assets/keep.png]]", encoding="utf-8")
            asset = vault / "Assets/keep.png"
            asset.write_bytes(b"asset")
            self.init_git(vault)

            result = self.run_cli(vault, "delete", "Raw/delete-me.md", "--keep-orphan-assets")
            payload = json.loads(result.stdout)
            self.assertTrue(asset.exists())
            self.assertEqual(payload["deleted_assets"], [])
            self.assertEqual(payload["kept_assets"][0]["path"], "Assets/keep.png")


if __name__ == "__main__":
    unittest.main()
