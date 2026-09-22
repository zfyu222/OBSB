#!/usr/bin/env python3
"""Drive one reusable OpenCode session for the isolated nightly worktree.

This adapter intentionally never grants permissions.  A missing allow rule is a
failed nightly run, not an invitation for the scheduler to weaken safeguards.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API = os.environ.get("OPENCODE_API_URL", "http://127.0.0.1:4096/api").rstrip("/")
TIMEOUT_SECONDS = int(os.environ.get("NIGHTLY_OPENCODE_TIMEOUT_SECONDS", "1800"))


def request(method: str, path: str, payload: dict | None = None) -> object:
    password = os.environ.get("OPENCODE_SERVER_PASSWORD")
    if not password:
        raise RuntimeError("OPENCODE_SERVER_PASSWORD is unavailable")
    # The deployed OpenCode service and its healthcheck use this fixed basic
    # auth user.  Do not inherit OPENCODE_SERVER_USERNAME here: deployments
    # may also expose that name for an unrelated UI integration.
    username = "opencode"
    headers = {"Accept": "application/json"}
    headers["Authorization"] = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        headers["Content-Type"] = "application/json"
    try:
        with urlopen(Request(API + path, data=body, method=method, headers=headers), timeout=30) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        raise RuntimeError(f"OpenCode API returned HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"OpenCode API is unavailable: {exc.reason}") from exc
    return json.loads(raw) if raw else None


def payload_data(value: object) -> object:
    return value.get("data") if isinstance(value, dict) and "data" in value else value


def initial_prompt(vault: Path) -> str:
    tool_root = Path(os.environ.get("NIGHTLY_TOOL_ROOT", vault / ".nightly-tools"))
    return f"""Run the nightly-memory-organization Skill for this one isolated worktree: {vault}.

Never read or edit the formal vault, framework files, Assets, .obsidian, secrets,
runtime or any path outside this worktree. Read and modify Markdown only under
{vault}/InBox, {vault}/Raw and {vault}/Drived. Create missing Markdown folders if
needed. Never use /tmp, Git history, or an intermediate scratch file: use the
built-in Markdown read/write tools directly against this worktree. Search before
creating notes; preserve URL text and never fetch URLs or read attachments. First read {tool_root}/nightly-memory-organization.md. Use only
the deterministic tools in {tool_root} with --vault {vault} for tags, validation
and vault-ops. Organize Inbox conservatively,
maintain only the Raw candidates in .nightly-context.json. The orchestrator has
already filtered summary-only changes: do not run Git commands or inspect Git
history/diffs yourself. Do not repair an existing Raw note outside that list,
even if it fails validation. Validate only Raw notes created or modified during
this run. The context's skipped_paths are explicitly
marked nightly_maintenance: skip: do not edit, move, merge, delete, tag,
summarize, or validate them. Before ending, write {vault}/.nightly-operations.json as JSON with an
"operations" array. Add one item for each changed Markdown note other than the
daily report: {{"path":"Raw/example.md","actions":["created"],"detail":"一句不超过 100 字的自然中文处理概括"}}.
Actions may only be created, moved, merged, metadata_updated, inbox_removed, or
deleted. This audit journal is the sole permitted non-Markdown task file; do not
put note content in it. The detail must synthesize what was meaningfully done to
the note, not enumerate internal action names or metadata field names. A move
already implies removal from Inbox, so do not mention source removal separately.
Omit routine unchanged facts. The external orchestrator will
validate and apply it. Read the Raw candidate list from
{vault}/.nightly-context.json; do not look for it outside this worktree."""


def correction_prompt(errors: list[str]) -> str:
    rendered = "\n".join(f"- {error}" for error in errors)
    return f"""The independent validator rejected the current isolated worktree.
Repair only the listed Markdown violations in the same worktree, then re-run the
validator. Do not abandon the session or edit outside the worktree.

{rendered}"""


def session_file() -> Path:
    value = os.environ.get("NIGHTLY_SESSION_FILE")
    if not value:
        raise RuntimeError("NIGHTLY_SESSION_FILE is required")
    return Path(value)


def get_or_create(vault: Path) -> str:
    state = session_file()
    if state.is_file():
        data = json.loads(state.read_text(encoding="utf-8"))
        session = data.get("session")
        if isinstance(session, str) and session:
            return session
    created = payload_data(request("POST", "/session", {
        "title": f"Nightly memory organization {time.strftime('%Y-%m-%d')}",
        "agent": "build",
        "model": {"providerID": "deepseek", "id": "deepseek-flash"},
        "location": {"directory": str(vault)},
    }))
    if not isinstance(created, dict) or not isinstance(created.get("id"), str):
        raise RuntimeError("OpenCode did not return a session id")
    state.write_text(json.dumps({"session": created["id"]}) + "\n", encoding="utf-8")
    return created["id"]


def wait_for_completion(session: str) -> None:
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        pending = payload_data(request("GET", f"/session/{session}/permission"))
        if isinstance(pending, list) and pending:
            raise RuntimeError("nightly session requested an unapproved permission")
        # The deployed OpenCode server exposes active sessions as an ID map;
        # completed sessions disappear from it.  It does not emit an `idle`
        # pseudo-message, so message polling would wait until timeout.
        active = payload_data(request("GET", "/session/active"))
        if isinstance(active, dict) and session not in active:
            messages = payload_data(request("GET", f"/session/{session}/message?limit=20"))
            if not isinstance(messages, list):
                raise RuntimeError("OpenCode completed without readable session messages")
            assistants = [message for message in messages if isinstance(message, dict) and message.get("type") == "assistant"]
            if not assistants:
                raise RuntimeError("OpenCode completed without an assistant result")
            finish = assistants[-1].get("finish")
            # Some OpenCode builds mark a fully executed final tool turn as
            # `tool-calls` rather than emitting a following text-only turn.
            # Reaching this branch still requires no active session and no
            # pending permission; the orchestrator independently validates
            # the complete worktree before accepting any write.
            if finish in {"stop", "end-turn", "tool-calls"}:
                return
            raise RuntimeError(f"nightly session ended without a successful final response: {finish or 'unknown'}")
        time.sleep(2)
    raise RuntimeError("nightly OpenCode session timed out")


def main() -> int:
    vault_value = os.environ.get("NIGHTLY_VAULT")
    if not vault_value:
        print("NIGHTLY_VAULT is required", file=sys.stderr)
        return 2
    vault = Path(vault_value).resolve()
    try:
        session = get_or_create(vault)
        feedback = json.loads(os.environ.get("NIGHTLY_FEEDBACK", "[]"))
        prompt = correction_prompt(feedback) if feedback else initial_prompt(vault)
        request("POST", f"/session/{session}/prompt", {"text": prompt, "resume": True})
        wait_for_completion(session)
    except (RuntimeError, ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(session)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
