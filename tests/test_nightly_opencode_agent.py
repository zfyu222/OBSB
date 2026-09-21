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
    def test_internal_api_user_is_not_overridden_by_an_ambient_variable(self):
        original = os.environ.get("OPENCODE_SERVER_USERNAME")
        original_password = os.environ.get("OPENCODE_SERVER_PASSWORD")
        os.environ["OPENCODE_SERVER_USERNAME"] = "unrelated-ui-user"
        original_open = adapter.urlopen

        class Response:
            def read(self):
                return b"{}"

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        captured = {}

        def fake_open(request, timeout):
            captured["authorization"] = request.headers["Authorization"]
            return Response()

        adapter.urlopen = fake_open
        try:
            os.environ["OPENCODE_SERVER_PASSWORD"] = "test-password"
            adapter.request("GET", "/info")
        finally:
            adapter.urlopen = original_open
            if original is None:
                os.environ.pop("OPENCODE_SERVER_USERNAME", None)
            else:
                os.environ["OPENCODE_SERVER_USERNAME"] = original
            if original_password is None:
                os.environ.pop("OPENCODE_SERVER_PASSWORD", None)
            else:
                os.environ["OPENCODE_SERVER_PASSWORD"] = original_password
        decoded = __import__("base64").b64decode(captured["authorization"].split(" ", 1)[1]).decode()
        self.assertEqual(decoded, "opencode:test-password")

    def test_initial_prompt_limits_the_agent_to_the_isolated_worktree(self):
        prompt = adapter.initial_prompt(Path("/worktrees/nightly-test"))
        self.assertIn("nightly-test/InBox", prompt)
        self.assertIn("Never read or edit the formal vault", prompt)
        self.assertIn("Assets", prompt)
        self.assertIn(".nightly-tools/nightly-memory-organization.md", prompt)
        self.assertNotIn("/workspace/tools", prompt)

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

    def test_wait_finishes_when_session_leaves_the_active_map(self):
        original_request = adapter.request
        original_timeout = adapter.TIMEOUT_SECONDS
        calls = []

        def fake_request(method, path, payload=None):
            calls.append(path)
            if path.endswith("/permission"):
                return []
            if path == "/session/active":
                return {"another-session": {"type": "running"}}
            if path.endswith("/message?limit=20"):
                return [{"type": "assistant", "finish": "stop"}]
            raise AssertionError(path)

        adapter.request = fake_request
        adapter.TIMEOUT_SECONDS = 1
        try:
            adapter.wait_for_completion("ses_finished")
        finally:
            adapter.request = original_request
            adapter.TIMEOUT_SECONDS = original_timeout
        self.assertEqual(calls, ["/session/ses_finished/permission", "/session/active", "/session/ses_finished/message?limit=20"])

    def test_wait_accepts_a_completed_tool_turn_after_independent_validation(self):
        original_request = adapter.request

        def fake_request(method, path, payload=None):
            if path.endswith("/permission"):
                return []
            if path == "/session/active":
                return {}
            if path.endswith("/message?limit=20"):
                return [{"type": "assistant", "finish": "tool-calls"}]
            raise AssertionError(path)

        adapter.request = fake_request
        try:
            adapter.wait_for_completion("ses_finished")
        finally:
            adapter.request = original_request


if __name__ == "__main__":
    unittest.main()
