import tempfile
import unittest
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from validate_vault import validate_note, visible  # noqa: E402


class ValidatorTests(unittest.TestCase):
    def note(self, text: str) -> tuple[tempfile.TemporaryDirectory, Path]:
        temp = tempfile.TemporaryDirectory()
        path = Path(temp.name) / "note.md"
        path.write_text(text, encoding="utf-8")
        return temp, path

    def test_visible_character_rules(self):
        self.assertEqual(visible("**标题** [显示](https://example.com) `代码`"), "标题显示代码")
        self.assertEqual(visible("裸链 https://example.com"), "裸链https://example.com")

    def test_valid_recursive_summary(self):
        temp, path = self.note(
            "---\ntags: [测试]\nsummary_1: 这是第一层递归摘要啊\nsummary_final: 核心\n---\n"
            + "正文内容" * 25
        )
        try:
            self.assertEqual(validate_note(path), [])
        finally:
            temp.cleanup()

    def test_rejects_overlong_and_noncontiguous(self):
        temp, path = self.note(
            "---\ntags: [a, b, c, d, e, f]\nsummary_2: 很长很长很长\nsummary_final: 最终摘要过于冗长\n---\n正文内容正文内容"
        )
        try:
            errors = "\n".join(validate_note(path))
            self.assertIn("maximum is 5", errors)
            self.assertIn("contiguous", errors)
        finally:
            temp.cleanup()

    def test_short_body_is_final(self):
        temp, path = self.note("---\ntags: [测试]\nsummary_final: 短文\n---\n短文")
        try:
            self.assertEqual(validate_note(path), [])
        finally:
            temp.cleanup()

    def test_first_summary_accepts_exactly_200_visible_characters(self):
        temp, path = self.note(
            "---\ntags: [测试]\nsummary_1: " + "摘" * 200 + "\nsummary_final: 核心\n---\n" + "文" * 1500
        )
        try:
            self.assertEqual(validate_note(path), [])
        finally:
            temp.cleanup()

    def test_first_summary_rejects_more_than_200_visible_characters(self):
        temp, path = self.note(
            "---\ntags: [测试]\nsummary_1: " + "摘" * 201 + "\nsummary_final: 核心\n---\n" + "文" * 1500
        )
        try:
            errors = "\n".join(validate_note(path))
            self.assertIn("summary_1 has 201 visible chars; maximum is 200", errors)
        finally:
            temp.cleanup()


if __name__ == "__main__":
    unittest.main()
