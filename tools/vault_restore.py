#!/usr/bin/env python3
"""Preview or apply safe Git-backed knowledge-vault restorations."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from nightly_orchestrator import ALLOWED_ROOTS, NightlyError, porcelain_paths, snapshot_visible_state


class RestoreError(RuntimeError):
    """A restoration that cannot be applied without risking current content."""


def git(repo: Path, *args: str, check: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        encoding="utf-8",
        errors="surrogateescape",
        input=input_text,
        capture_output=True,
    )
    if check and result.returncode:
        raise RestoreError((result.stderr or result.stdout).strip())
    return result


def git_bytes(
    repo: Path, *args: str, check: bool = True, input_bytes: bytes | None = None
) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        input=input_bytes,
        capture_output=True,
    )
    if check and result.returncode:
        detail = (result.stderr or result.stdout).decode("utf-8", errors="replace").strip()
        raise RestoreError(detail)
    return result


def resolve_commit(vault: Path, revision: str) -> str:
    result = git(vault, "rev-parse", "--verify", f"{revision}^{{commit}}", check=False)
    if result.returncode:
        raise RestoreError(f"unknown Git revision: {revision}")
    commit = result.stdout.strip()
    ancestor = git(vault, "merge-base", "--is-ancestor", commit, "HEAD", check=False)
    if ancestor.returncode:
        raise RestoreError("the requested revision is not an ancestor of the current vault")
    return commit


def resolve_note_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or path.suffix.lower() != ".md":
        raise RestoreError("the note must be a relative Markdown path")
    normalized = path.as_posix()
    if not path.parts or path.parts[0] not in ALLOWED_ROOTS:
        raise RestoreError(f"the note must be under {sorted(ALLOWED_ROOTS)}")
    return normalized


def changed_paths(worktree: Path) -> list[str]:
    output = git(worktree, "diff", "--cached", "--name-only", "-z").stdout
    paths = sorted(path for path in output.split("\0") if path)
    for path in paths:
        candidate = Path(path)
        if candidate.suffix.lower() != ".md" or not candidate.parts or candidate.parts[0] not in ALLOWED_ROOTS:
            raise RestoreError(f"restoration would change a forbidden path: {path}")
    return paths


def validate_paths(worktree: Path, paths: list[str]) -> None:
    # A restoration intentionally reproduces a historical Markdown state.
    # That state can predate today's tags/summary requirements, so applying
    # the full Raw metadata validator here would make a valid task reversal
    # impossible.  Keep the deterministic safety checks that still apply to
    # every historical patch: only approved paths and no conflict stages.
    # Git generates the staged binary patch and later applies it with
    # ``git apply --index --3way``; that is the integrity check.  ``git diff
    # --check`` is deliberately not used because it rejects otherwise valid
    # historical Markdown that ends in a blank line.
    unresolved = git(worktree, "diff", "--cached", "--name-only", "--diff-filter=U").stdout.strip()
    if unresolved:
        raise RestoreError("restoration leaves unresolved Git conflicts: " + unresolved)


def add_worktree(vault: Path, path: Path, revision: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    git(vault, "worktree", "add", "--detach", str(path), revision)


def remove_worktree(vault: Path, path: Path) -> None:
    git(vault, "worktree", "remove", "--force", str(path), check=False)
    shutil.rmtree(path, ignore_errors=True)
    git(vault, "worktree", "prune", check=False)


def prepare_restore(worktree: Path, command: str, revision: str, note: str | None) -> None:
    if command == "revert-task":
        subject = git(worktree, "show", "-s", "--format=%s", revision).stdout.strip()
        if not subject.startswith("Nightly memory organization ") or subject.startswith("Nightly memory organization failed "):
            raise RestoreError("revert-task accepts only a successful nightly organization commit")
        result = git(worktree, "revert", "--no-commit", revision, check=False)
        if result.returncode:
            raise RestoreError("the task cannot be reversed cleanly because later edits conflict with it")
        return

    assert note is not None
    exists = git(worktree, "cat-file", "-e", f"{revision}:{note}", check=False)
    if exists.returncode:
        raise RestoreError(f"the note does not exist at {revision}: {note}")
    git(worktree, "checkout", revision, "--", note)


def dirty_managed_paths(vault: Path) -> list[str]:
    try:
        return porcelain_paths(vault)
    except NightlyError as exc:
        raise RestoreError(str(exc)) from exc


def preview_or_apply(
    vault: Path,
    worktrees: Path,
    command: str,
    revision: str,
    note: str | None,
    *,
    apply: bool,
) -> dict[str, object]:
    vault = vault.resolve()
    worktrees = worktrees.resolve()
    if not vault.is_dir():
        raise RestoreError(f"vault does not exist: {vault}")
    git(vault, "rev-parse", "--is-inside-work-tree")
    worktrees.mkdir(parents=True, exist_ok=True)
    if apply:
        try:
            start_head = snapshot_visible_state(
                vault, "Technical server-state snapshot before history restoration"
            )
        except NightlyError as exc:
            raise RestoreError(str(exc)) from exc
    else:
        start_head = git(vault, "rev-parse", "HEAD").stdout.strip()
    target = resolve_commit(vault, revision)
    relative_note = resolve_note_path(note) if note is not None else None

    with tempfile.TemporaryDirectory(prefix="restore-", dir=worktrees) as temp:
        worktree = Path(temp) / "prepare"
        add_worktree(vault, worktree, start_head)
        try:
            prepare_restore(worktree, command, target, relative_note)
            paths = changed_paths(worktree)
            if not paths:
                raise RestoreError("the requested restoration would make no change")
            validate_paths(worktree, paths)
            patch = git_bytes(worktree, "diff", "--cached", "--binary", "--full-index").stdout
        finally:
            remove_worktree(vault, worktree)

        result: dict[str, object] = {
            "ok": True,
            "status": "preview",
            "operation": command,
            "target_revision": target,
            "paths": paths,
        }
        if not apply:
            return result

        concurrent = dirty_managed_paths(vault)
        overlap = sorted(set(concurrent) & set(paths))
        if overlap:
            raise RestoreError("formal vault changed concurrently: " + ", ".join(overlap))
        if concurrent:
            try:
                current_head = snapshot_visible_state(
                    vault, "Technical server-state snapshot during history restoration"
                )
            except NightlyError as exc:
                raise RestoreError(str(exc)) from exc
        else:
            current_head = git(vault, "rev-parse", "HEAD").stdout.strip()

        apply_worktree = Path(temp) / "apply"
        add_worktree(vault, apply_worktree, current_head)
        try:
            applied = git_bytes(apply_worktree, "apply", "--index", "--3way", "-", check=False, input_bytes=patch)
            if applied.returncode:
                detail = (applied.stderr or applied.stdout).decode("utf-8", errors="replace").strip()
                raise RestoreError(
                    "the restoration conflicts with changes made after the selected history point"
                    + (f": {detail}" if detail else "")
                )
            validate_paths(apply_worktree, paths)
            message = (
                f"Revert nightly organization {target[:12]}"
                if command == "revert-task"
                else f"Restore {relative_note} from {target[:12]}"
            )
            git(apply_worktree, "commit", "-m", message)
            restored_commit = git(apply_worktree, "rev-parse", "HEAD").stdout.strip()
        finally:
            remove_worktree(vault, apply_worktree)

        if dirty_managed_paths(vault):
            raise RestoreError("formal vault changed while the restoration was being prepared")
        if git(vault, "rev-parse", "HEAD").stdout.strip() != current_head:
            raise RestoreError("formal vault history changed while the restoration was being prepared")
        git(vault, "merge", "--ff-only", restored_commit)
        result["status"] = "applied"
        result["commit"] = restored_commit
        return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, default=Path("vault"))
    parser.add_argument("--worktrees", type=Path, required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    revert = sub.add_parser("revert-task")
    revert.add_argument("revision")
    revert.add_argument("--apply", action="store_true")
    restore = sub.add_parser("restore-note")
    restore.add_argument("revision")
    restore.add_argument("note")
    restore.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        outcome = preview_or_apply(
            args.vault,
            args.worktrees,
            args.command,
            args.revision,
            getattr(args, "note", None),
            apply=args.apply,
        )
    except RestoreError as exc:
        print(json.dumps({"ok": False, "status": "stopped", "error": str(exc)}, ensure_ascii=False, separators=(",", ":")))
        return 2
    print(json.dumps(outcome, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
