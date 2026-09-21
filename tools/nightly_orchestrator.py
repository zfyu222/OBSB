#!/usr/bin/env python3
"""Run one isolated nightly vault-maintenance attempt.

The program deliberately owns every deterministic boundary: Git snapshots,
worktree lifetime, allowed-path checks, validation, conflict detection, reports,
and the successful baseline.  The supplied agent command only makes semantic
changes inside the temporary worktree; it never receives the formal vault path.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from validate_vault import validate_note


ALLOWED_ROOTS = {"InBox", "Raw", "Drived"}


class NightlyError(RuntimeError):
    """An expected run failure that must leave the successful baseline intact."""


def run(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, text=True, encoding="utf-8", capture_output=True)
    if check and result.returncode:
        raise NightlyError(f"{' '.join(args)} failed: {(result.stderr or result.stdout).strip()}")
    return result


def git(vault: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run("git", "-C", str(vault), *args, cwd=vault, check=check)


def tracked_markdown_status(vault: Path) -> list[str]:
    status = git(vault, "status", "--porcelain=v1", "--untracked-files=all").stdout.splitlines()
    paths: list[str] = []
    for row in status:
        path = row[3:]
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[1]
        candidate = Path(path)
        if candidate.suffix.lower() != ".md" or not candidate.parts or candidate.parts[0] not in ALLOWED_ROOTS:
            raise NightlyError(f"unexpected working-tree change outside managed Markdown: {path}")
        paths.append(path)
    return paths


def visible_server_state_status(vault: Path) -> list[str]:
    """Validate the formal vault state before its technical snapshot.

    The inner repository's root `.gitignore` is the sole non-Markdown file
    required to express the Markdown-only tracking policy.  It may need to be
    committed together with server-visible notes, but it is never an allowed
    output of the unattended agent worktree.
    """
    status = git(vault, "status", "--porcelain=v1", "--untracked-files=all").stdout.splitlines()
    paths: list[str] = []
    for row in status:
        path = row[3:]
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[1]
        if path == ".gitignore":
            paths.append(path)
            continue
        candidate = Path(path)
        if candidate.suffix.lower() != ".md" or not candidate.parts or candidate.parts[0] not in ALLOWED_ROOTS:
            raise NightlyError(f"unexpected working-tree change outside managed Markdown: {path}")
        paths.append(path)
    return paths


def snapshot_visible_state(vault: Path) -> str:
    visible_server_state_status(vault)
    stage_managed(vault)
    if (vault / ".gitignore").is_file():
        git(vault, "add", "--", ".gitignore")
    staged = git(vault, "diff", "--cached", "--quiet", check=False)
    if staged.returncode == 1:
        git(vault, "commit", "-m", "Technical server-state snapshot before nightly organization")
    elif staged.returncode != 0:
        raise NightlyError("could not inspect staged server state")
    return git(vault, "rev-parse", "HEAD").stdout.strip()


def stage_managed(vault: Path) -> None:
    """Stage only managed roots that actually exist (Git rejects absent roots)."""
    roots = [name for name in sorted(ALLOWED_ROOTS) if (vault / name).exists()]
    if roots:
        git(vault, "add", "-A", "--", *roots)


def changed_paths(vault: Path, baseline: str, *, staged: bool = False) -> list[str]:
    args = ("diff", "--cached", "--name-only", "-z", baseline) if staged else ("diff", "--name-only", "-z", baseline)
    raw = git(vault, *args).stdout
    return sorted(path for path in raw.split("\0") if path)


def previous_successful_baseline(state_dir: Path) -> str | None:
    state = state_dir / "nightly-state.json"
    if not state.is_file():
        return None
    try:
        baseline = json.loads(state.read_text(encoding="utf-8")).get("baseline")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise NightlyError("could not read nightly-state.json") from exc
    return baseline if isinstance(baseline, str) and baseline else None


def raw_candidates(vault: Path, previous: str | None, baseline: str) -> list[str]:
    """Return Raw notes whose non-summary content changed since success.

    Summary-only edits are deliberately omitted so a previous automated
    maintenance pass does not continuously trigger itself.
    """
    if not previous:
        return []
    ancestor = git(vault, "merge-base", "--is-ancestor", previous, baseline, check=False)
    if ancestor.returncode:
        raise NightlyError("saved nightly baseline is not an ancestor of the current vault")
    names = git(vault, "diff", "--name-only", "-z", previous, baseline, "--", "Raw").stdout.split("\0")
    candidates: list[str] = []
    summary_line = re.compile(r"summary_(?:final|[1-9][0-9]*):")
    for path in (item for item in names if item.endswith(".md")):
        diff = git(vault, "diff", "--unified=0", previous, baseline, "--", path).stdout.splitlines()
        changed = [line[1:].strip() for line in diff if line[:1] in {"+", "-"} and not line.startswith(("+++", "---"))]
        if any(not summary_line.fullmatch(line) and not summary_line.match(line) for line in changed):
            candidates.append(path)
    return sorted(candidates)


def assert_allowed(paths: list[str]) -> None:
    for path in paths:
        candidate = Path(path)
        if candidate.suffix.lower() != ".md" or not candidate.parts or candidate.parts[0] not in ALLOWED_ROOTS:
            raise NightlyError(f"nightly task changed a forbidden path: {path}")


def validate(worktree: Path) -> list[str]:
    errors: list[str] = []
    raw = worktree / "Raw"
    if raw.is_dir():
        for note in sorted(raw.rglob("*.md")):
            errors.extend(validate_note(note))
    return errors


def write_report(vault: Path, *, status: str, baseline: str, session: str | None, changes: list[str], error: str | None) -> Path:
    day = datetime.now().astimezone().date().isoformat()
    report = vault / "Drived" / "整理日志" / f"{day}.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# 夜间整理报告 {day}",
        "",
        f"- 状态：{status}",
        f"- 开始基准：`{baseline}`",
        f"- OpenCode Session：{session or '未启动'}",
    ]
    if changes:
        lines.extend(["", "## 检测到的 Markdown 变更", ""])
        lines.extend(f"- `{path}`" for path in changes)
    if error:
        lines.extend(["", "## 失败原因", "", error])
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report


def commit_report(vault: Path, report: Path, message: str) -> None:
    git(vault, "add", "--", str(report.relative_to(vault)))
    git(vault, "commit", "-m", message)


@contextmanager
def exclusive_lock(state_dir: Path):
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = state_dir / "nightly.lock"
    try:
        lock.mkdir()
    except FileExistsError as exc:
        raise NightlyError("another nightly run is already active") from exc
    try:
        yield
    finally:
        lock.rmdir()


@dataclass
class Outcome:
    status: str
    baseline: str
    session: str | None
    changes: list[str]
    error: str | None = None


def run_agent(command: str, worktree: Path, session_file: Path, context_file: Path, feedback: list[str] | None = None) -> str | None:
    environment = os.environ.copy()
    environment["NIGHTLY_VAULT"] = str(worktree)
    environment["NIGHTLY_WORKTREE"] = str(worktree)
    environment["NIGHTLY_SESSION_FILE"] = str(session_file)
    environment["NIGHTLY_CONTEXT_FILE"] = str(context_file)
    environment["NIGHTLY_FEEDBACK"] = json.dumps(feedback or [], ensure_ascii=False)
    # The deployed runner is Linux, but keeping Windows test execution working
    # prevents a drive-letter path from being split at its backslash escapes.
    result = subprocess.run(
        shlex.split(command, posix=os.name != "nt"),
        cwd=worktree,
        env=environment,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise NightlyError(f"agent command failed: {detail}")
    if session_file.is_file():
        try:
            session = json.loads(session_file.read_text(encoding="utf-8")).get("session")
            if isinstance(session, str) and session:
                return session
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    return result.stdout.strip() or None


def execute(vault: Path, worktrees: Path, state_dir: Path, agent_command: str) -> Outcome:
    vault = vault.resolve()
    if not (vault / ".git").exists():
        raise NightlyError("vault is not an initialized Git repository")
    with exclusive_lock(state_dir):
        baseline = snapshot_visible_state(vault)
        run_id = datetime.now().astimezone().strftime("nightly-%Y%m%d-%H%M%S")
        worktree = worktrees / run_id
        session_file = state_dir / f"{run_id}.session.json"
        context_file = state_dir / f"{run_id}.context.json"
        context_file.write_text(
            json.dumps({"baseline": baseline, "raw_candidates": raw_candidates(vault, previous_successful_baseline(state_dir), baseline)}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        worktrees.mkdir(parents=True, exist_ok=True)
        git(vault, "worktree", "add", "--detach", str(worktree), baseline)
        session: str | None = None
        try:
            session = run_agent(agent_command, worktree, session_file, context_file)
            tracked_markdown_status(worktree)
            stage_managed(worktree)
            changes = changed_paths(worktree, baseline, staged=True)
            assert_allowed(changes)
            errors = validate(worktree)
            for _ in range(2):
                if not errors:
                    break
                session = run_agent(agent_command, worktree, session_file, context_file, errors)
                tracked_markdown_status(worktree)
                stage_managed(worktree)
                changes = changed_paths(worktree, baseline, staged=True)
                assert_allowed(changes)
                errors = validate(worktree)
            if errors:
                raise NightlyError("validation failed:\n" + "\n".join(errors))
            if not changes:
                (state_dir / "nightly-state.json").write_text(json.dumps({"baseline": baseline}, ensure_ascii=False) + "\n", encoding="utf-8")
                return Outcome("no_changes", baseline, session, [])

            # Include a deterministic review report in the same isolated change set.
            report = write_report(worktree, status="成功", baseline=baseline, session=session, changes=changes, error=None)
            git(worktree, "add", "--", str(report.relative_to(worktree)))
            changes = changed_paths(worktree, baseline, staged=True)
            assert_allowed(changes)

            # `git diff baseline` does not include untracked files.  A note
            # which reaches the formal vault while the isolated task is
            # running is still a real concurrent edit and must prevent an
            # overlapping patch from being applied.  Porcelain status covers
            # both tracked and untracked Markdown; the diff covers the
            # baseline comparison explicitly as well.
            concurrent = sorted(set(changed_paths(vault, baseline)) | set(tracked_markdown_status(vault)))
            overlap = sorted(set(changes) & set(concurrent))
            if overlap:
                raise NightlyError("formal vault changed concurrently: " + ", ".join(overlap))
            patch = git(worktree, "diff", "--cached", "--binary", baseline).stdout
            applied = subprocess.run(["git", "-C", str(vault), "apply", "--index", "--binary", "-"], input=patch, text=True, encoding="utf-8", capture_output=True)
            if applied.returncode:
                raise NightlyError("could not apply validated worktree patch: " + applied.stderr.strip())
            git(vault, "commit", "-m", f"Nightly memory organization {datetime.now().astimezone().date().isoformat()}")
            new_baseline = git(vault, "rev-parse", "HEAD").stdout.strip()
            (state_dir / "nightly-state.json").write_text(json.dumps({"baseline": new_baseline}, ensure_ascii=False) + "\n", encoding="utf-8")
            return Outcome("success", new_baseline, session, changes)
        except NightlyError as exc:
            report = write_report(vault, status="失败", baseline=baseline, session=session, changes=[], error=str(exc))
            commit_report(vault, report, f"Nightly memory organization failed {datetime.now().astimezone().date().isoformat()}")
            return Outcome("failed", baseline, session, [], str(exc))
        finally:
            git(vault, "worktree", "remove", "--force", str(worktree), check=False)
            session_file.unlink(missing_ok=True)
            context_file.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, default=Path("vault"))
    parser.add_argument("--worktrees", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--agent-command", required=True, help="command run in the isolated worktree")
    args = parser.parse_args()
    try:
        outcome = execute(args.vault, args.worktrees, args.state_dir, args.agent_command)
    except NightlyError as exc:
        print(json.dumps({"status": "startup_failed", "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(outcome.__dict__, ensure_ascii=False, separators=(",", ":")))
    return 0 if outcome.status != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
