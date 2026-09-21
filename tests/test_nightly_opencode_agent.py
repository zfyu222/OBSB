import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import nightly_opencode_agent as adapter  # noqa: E402


class NightlyOpenCodeAdapterTests(unittest.TestCase):
    def test_initial_prompt_limits_the_agent_to_the_isolated_worktree(self):
        prompt = adapter.initial_prompt(Path("/worktrees/nightly-test"))
        self.assertIn("nightly-test/InBox", prompt)
        self.assertIn("Never read or edit the formal vault", prompt)
        self.assertIn("Assets", prompt)

    def test_existing_session_is_reused_without_creating_another(self):
        with tempfile.TemporaryDirectory() as temp:
            session_file = Path(temp) / "session.json"
            session_file.write_text(json.dumps({"session": "ses_existing"}), encoding="utf-8")
            original = os.environ.get("NIGHTLY_SESSION_FILE")
            os.environ["NIGHTLY_SESSION_FILE"] = str(session_file)
            try:
                self.assertEqual(adapter.get_or_create(Path(temp)), "ses_existing")
            finally:
                if original is None:
                    os.environ.pop("NIGHTLY_SESSION_FILE", None)
                else:
                    os.environ["NIGHTLY_SESSION_FILE"] = original


if __name__ == "__main__":
    unittest.main()
