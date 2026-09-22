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
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from validate_vault import validate_note


ALLOWED_ROOTS = {"InBox", "Raw", "Drived"}
INTERNAL_TOOL_DIR = ".nightly-tools"
INTERNAL_CONTEXT_FILE = ".nightly-context.json"
INTERNAL_OPERATIONS_FILE = ".nightly-operations.json"

REPORT_SECTIONS = (
    ("created", "新建"),
    ("moved", "移动"),
    ("merged", "合并"),
    ("metadata_updated", "元数据更新"),
    ("inbox_removed", "删除的 Inbox 源文件"),
    ("deleted", "删除"),
)
REPORT_ACTIONS = {action for action, _ in REPORT_SECTIONS}


class NightlyError(RuntimeError):
    """An expected run failure that must leave the successful baseline intact."""


def run(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, text=True, encoding="utf-8", capture_output=True)
    if check and result.returncode:
        raise NightlyError(f"{' '.join(args)} failed: {(result.stderr or result.stdout).strip()}")
    return result


def git(vault: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run("git", "-C", str(vault), *args, cwd=vault, check=check)


def porcelain_paths(vault: Path) -> list[str]:
    """Read status paths without Git's quoting of Unicode or whitespace."""
    fields = git(vault, "status", "--porcelain=v1", "-z", "--untracked-files=all").stdout.split("\0")
    paths: list[str] = []
    index = 0
    while index < len(fields):
        field = fields[index]
        if not field:
            index += 1
            continue
        if len(field) < 4:
            raise NightlyError("could not parse Git porcelain status")
        state, path = field[:2], field[3:]
        paths.append(path)
        # With `-z`, rename/copy records carry the destination in the first
        # record and the source in the following NUL-delimited record.
        if "R" in state or "C" in state:
            index += 1
            if index >= len(fields) or not fields[index]:
                raise NightlyError("could not parse renamed Git status path")
            paths.append(fields[index])
        index += 1
    return paths


def tracked_markdown_status(vault: Path, *, allow_internal_tools: bool = False) -> list[str]:
    paths: list[str] = []
    for path in porcelain_paths(vault):
        if allow_internal_tools and (
            path == INTERNAL_CONTEXT_FILE
            or path == INTERNAL_OPERATIONS_FILE
            or path == INTERNAL_TOOL_DIR
            or path.startswith(INTERNAL_TOOL_DIR + "/")
        ):
            continue
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
    paths: list[str] = []
    for path in porcelain_paths(vault):
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
    # A move must be visible as both an added destination and a removed source:
    # the report must explicitly name a deleted Inbox source, rather than hide
    # it behind Git's rename heuristic.
    args = ("diff", "--cached", "--no-renames", "--name-only", "-z", baseline) if staged else ("diff", "--no-renames", "--name-only", "-z", baseline)
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


def validate(worktree: Path, paths: list[str]) -> list[str]:
    """Validate only Raw notes produced or maintained by this run.

    A historical Raw note outside the candidate set is not silently rewritten
    by an unattended run.  Its pre-existing metadata debt must therefore not
    prevent a valid Inbox organization from being applied.
    """
    errors: list[str] = []
    for relative in sorted(path for path in paths if path.startswith("Raw/") and path.endswith(".md")):
        note = worktree / relative
        if note.is_file():
            errors.extend(validate_note(note))
    return errors


def assert_raw_changes_are_in_scope(worktree: Path, baseline: str, changes: list[str], candidates: list[str]) -> None:
    """Permit new Raw notes and only candidate-based edits to existing Raw."""
    permitted = set(candidates)
    for relative in changes:
        if not relative.startswith("Raw/") or not relative.endswith(".md"):
            continue
        existed = git(worktree, "cat-file", "-e", f"{baseline}:{relative}", check=False).returncode == 0
        if existed and relative not in permitted:
            raise NightlyError(f"nightly task modified a Raw note outside this run's candidate set: {relative}")


def report_link(path: str, vault: Path) -> str:
    """Return an Obsidian link for extant notes, otherwise a literal path."""
    candidate = vault / path
    if candidate.is_file() and path.endswith(".md"):
        return f"[[{path.removesuffix('.md')}]]"
    return f"`{path}`"


def fallback_operation(vault: Path, baseline: str, path: str) -> dict[str, object]:
    """Describe a changed note conservatively when the agent supplied no detail."""
    existed = git(vault, "cat-file", "-e", f"{baseline}:{path}", check=False).returncode == 0
    exists_now = (vault / path).is_file()
    if not existed and exists_now:
        action, detail = "created", "新建笔记；已纳入本次整理结果。"
    elif existed and not exists_now:
        action = "inbox_removed" if path.startswith("InBox/") else "deleted"
        detail = "整理完成后移除原始 Inbox 笔记。" if action == "inbox_removed" else "本次变更中移除该笔记。"
    elif path.startswith("Raw/"):
        action, detail = "metadata_updated", "更新知识笔记的标签或递归摘要。"
    else:
        action, detail = "metadata_updated", "更新笔记内容或整理元数据。"
    return {"path": path, "actions": [action], "detail": detail}


def read_operations(vault: Path, baseline: str, changes: list[str]) -> list[dict[str, object]]:
    """Read the agent's concise audit trail and cover omissions from Git facts.

    The journal is presentation data only. It never controls filesystem work;
    all allowed-path, validation and Git checks remain deterministic.
    """
    journal = vault / INTERNAL_OPERATIONS_FILE
    supplied: dict[str, dict[str, object]] = {}
    if journal.is_file():
        try:
            data = json.loads(journal.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise NightlyError("could not read nightly operations journal") from exc
        items = data.get("operations") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise NightlyError("nightly operations journal must contain an operations list")
        for item in items:
            if not isinstance(item, dict):
                raise NightlyError("nightly operations journal contains an invalid item")
            path, actions, detail = item.get("path"), item.get("actions"), item.get("detail")
            if (
                not isinstance(path, str)
                or path not in changes
                or not isinstance(actions, list)
                or not actions
                or not all(isinstance(action, str) and action in REPORT_ACTIONS for action in actions)
                or not isinstance(detail, str)
            ):
                raise NightlyError("nightly operations journal contains an invalid operation")
            concise = " ".join(detail.split())
            if not concise or len(concise) > 180:
                raise NightlyError("nightly operations journal detail must be 1-180 characters")
            supplied[path] = {"path": path, "actions": list(dict.fromkeys(actions)), "detail": concise}
    return [supplied.get(path, fallback_operation(vault, baseline, path)) for path in changes if not path.startswith("Drived/整理日志/")]


def write_report(vault: Path, *, status: str, baseline: str, session: str | None, changes: list[str], error: str | None, operations: list[dict[str, object]] | None = None) -> Path:
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
    if operations:
        lines.extend(["", "## 笔记处理", ""])
        for action, heading in REPORT_SECTIONS:
            entries = [item for item in operations if action in item["actions"]]
            lines.extend([f"### {heading}", ""])
            if entries:
                for item in entries:
                    lines.append(f"- {report_link(str(item['path']), vault)}：{item['detail']}")
            else:
                lines.append("- 无")
            lines.append("")
    elif changes:
        lines.extend(["", "## 检测到的 Markdown 变更", ""])
        lines.extend(f"- `{path}`" for path in changes)
    if error:
        lines.extend(["", "## 失败原因", "", error])
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report


def commit_report(vault: Path, report: Path, message: str) -> None:
    git(vault, "add", "--", str(report.relative_to(vault)))
    git(vault, "commit", "-m", message)


def tool_bundle_manifest(bundle: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(bundle)): path.read_bytes()
        for path in sorted(bundle.rglob("*"))
        # Python may generate this cache while an agent invokes a bundled
        # validator.  It contains no task input and is deleted with the
        # worktree; source files remain integrity-checked byte-for-byte.
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    }


def prepare_tool_bundle(worktree: Path) -> tuple[Path, dict[str, bytes]]:
    """Copy the deterministic helpers and Skill into the isolated worktree.

    Keeping these inputs in the worktree avoids granting an unattended
    OpenCode session any access to the formal framework checkout.
    """
    source_tools = Path(__file__).resolve().parent
    source_root = source_tools.parent
    source_skill = source_root / ".opencode" / "skills" / "nightly-memory-organization" / "SKILL.md"
    files = {
        "tags.py": source_tools / "tags.py",
        "validate_vault.py": source_tools / "validate_vault.py",
        "vault_ops.py": source_tools / "vault_ops.py",
        "nightly-memory-organization.md": source_skill,
        # The worktree cannot read the framework checkout.  This is the
        # authoritative rule set copied in with the deterministic helpers.
        "nightly-rules.md": source_root / "AGENTS.md",
    }
    if not all(path.is_file() for path in files.values()):
        raise NightlyError("nightly tool bundle source is incomplete")
    bundle = worktree / INTERNAL_TOOL_DIR
    bundle.mkdir()
    for name, source in files.items():
        shutil.copy2(source, bundle / name)
    return bundle, tool_bundle_manifest(bundle)


def assert_tool_bundle_intact(bundle: Path, expected: dict[str, bytes]) -> None:
    if tool_bundle_manifest(bundle) != expected:
        raise NightlyError("nightly tool bundle was modified by the agent")


def remove_tool_bundle(worktree: Path, bundle: Path) -> None:
    if bundle.name != INTERNAL_TOOL_DIR or bundle.parent.resolve() != worktree.resolve():
        raise NightlyError("refusing to remove an unexpected nightly tool path")
    shutil.rmtree(bundle, ignore_errors=True)


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
    environment["NIGHTLY_TOOL_ROOT"] = str(worktree / INTERNAL_TOOL_DIR)
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
        candidate_raw = raw_candidates(vault, previous_successful_baseline(state_dir), baseline)
        run_id = datetime.now().astimezone().strftime("nightly-%Y%m%d-%H%M%S")
        worktree = worktrees / run_id
        session_file = state_dir / f"{run_id}.session.json"
        worktrees.mkdir(parents=True, exist_ok=True)
        git(vault, "worktree", "add", "--detach", str(worktree), baseline)
        # OpenCode's server-side tool processes do not inherit the adapter's
        # environment.  Keep this task input inside the isolated worktree so
        # the session can read it without requesting an external directory.
        context_file = worktree / INTERNAL_CONTEXT_FILE
        context_file.write_text(
            json.dumps({"baseline": baseline, "raw_candidates": candidate_raw}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        bundle, bundle_manifest = prepare_tool_bundle(worktree)
        session: str | None = None
        try:
            session = run_agent(agent_command, worktree, session_file, context_file)
            assert_tool_bundle_intact(bundle, bundle_manifest)
            tracked_markdown_status(worktree, allow_internal_tools=True)
            stage_managed(worktree)
            changes = changed_paths(worktree, baseline, staged=True)
            assert_allowed(changes)
            assert_raw_changes_are_in_scope(worktree, baseline, changes, candidate_raw)
            errors = validate(worktree, changes)
            for _ in range(2):
                if not errors:
                    break
                session = run_agent(agent_command, worktree, session_file, context_file, errors)
                assert_tool_bundle_intact(bundle, bundle_manifest)
                tracked_markdown_status(worktree, allow_internal_tools=True)
                stage_managed(worktree)
                changes = changed_paths(worktree, baseline, staged=True)
                assert_allowed(changes)
                assert_raw_changes_are_in_scope(worktree, baseline, changes, candidate_raw)
                errors = validate(worktree, changes)
            if errors:
                raise NightlyError("validation failed:\n" + "\n".join(errors))
            if not changes:
                (state_dir / "nightly-state.json").write_text(json.dumps({"baseline": baseline}, ensure_ascii=False) + "\n", encoding="utf-8")
                return Outcome("no_changes", baseline, session, [])

            # Include a deterministic review report in the same isolated change set.
            # The agent's journal supplies concise semantic descriptions; Git
            # fills any omitted changed path with a conservative description.
            operations = read_operations(worktree, baseline, changes)
            report = write_report(worktree, status="成功", baseline=baseline, session=session, changes=changes, error=None, operations=operations)
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
            remove_tool_bundle(worktree, bundle)
            git(vault, "worktree", "remove", "--force", str(worktree), check=False)
            session_file.unlink(missing_ok=True)


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
