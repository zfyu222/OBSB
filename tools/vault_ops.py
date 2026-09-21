#!/usr/bin/env python3
"""Perform safe Markdown structural operations with link and asset checks."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import unquote

from validate_vault import validate_note

ALLOWED_TOP_LEVEL = {"InBox", "Raw", "Drived"}
WIKILINK_RE = re.compile(r"(?P<embed>!)?\[\[(?P<target>[^\]]+)\]\]")
MARKDOWN_LINK_RE = re.compile(
    r"(?P<embed>!)?\[[^\]]*\]\((?P<target><[^>]+>|[^)\s]+)(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\)"
)


def fail(message: str) -> "NoReturn":
    raise SystemExit(message)


def resolve_note(vault: Path, value: str, *, must_exist: bool) -> Path:
    raw = Path(value)
    path = raw if raw.is_absolute() else vault / raw
    path = path.resolve()
    try:
        rel = path.relative_to(vault)
    except ValueError:
        fail(f"outside vault: {value}")
    if not rel.parts or rel.parts[0] not in ALLOWED_TOP_LEVEL or path.suffix.lower() != ".md":
        fail(f"only Markdown under {sorted(ALLOWED_TOP_LEVEL)} is allowed: {value}")
    if must_exist and not path.is_file():
        fail(f"source does not exist: {value}")
    return path


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def note_files(vault: Path) -> list[Path]:
    return sorted(path for path in vault.rglob("*.md") if path.is_file())


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def clean_link_target(raw: str, *, wikilink: bool) -> str:
    target = raw.split("|", 1)[0] if wikilink else raw
    target = target.strip().strip("<>")
    target = unquote(target).replace("\\", "/")
    return target.split("#", 1)[0].strip()


def extract_links(text: str) -> list[dict[str, object]]:
    links: list[dict[str, object]] = []
    for regex, kind in ((WIKILINK_RE, "wikilink"), (MARKDOWN_LINK_RE, "markdown")):
        for match in regex.finditer(text):
            target = clean_link_target(match.group("target"), wikilink=kind == "wikilink")
            if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target, re.IGNORECASE):
                continue
            links.append(
                {
                    "format": kind,
                    "kind": "embed" if match.group("embed") else kind,
                    "target": target,
                    "line": line_number(text, match.start()),
                }
            )
    return links


def within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def resolve_link(vault: Path, referring_note: Path, target: str, *, markdown: bool) -> Path | None:
    raw = target.lstrip("/")
    candidates: list[Path] = []
    target_path = Path(raw)
    if markdown:
        candidates.extend([referring_note.parent / target_path, vault / target_path])
    else:
        candidates.extend([vault / target_path, referring_note.parent / target_path])
    if not target_path.suffix:
        candidates.extend(path.with_suffix(".md") for path in list(candidates))
    for candidate in candidates:
        resolved = candidate.resolve()
        if within(resolved, vault) and resolved.is_file():
            return resolved

    if "/" not in raw:
        names = {target_path.name.casefold()}
        if not target_path.suffix:
            names.add((target_path.name + ".md").casefold())
        matches = [path for path in vault.rglob("*") if path.is_file() and path.name.casefold() in names]
        if len(matches) == 1:
            return matches[0].resolve()
    return None


def references_to(vault: Path, target_path: Path, *, exclude: set[Path] | None = None) -> list[dict[str, object]]:
    excluded = {path.resolve() for path in (exclude or set())}
    references: list[dict[str, object]] = []
    for note in note_files(vault):
        if note.resolve() in excluded:
            continue
        text = note.read_text(encoding="utf-8")
        for link in extract_links(text):
            resolved = resolve_link(vault, note, str(link["target"]), markdown=link["format"] == "markdown")
            if resolved == target_path.resolve():
                references.append(
                    {
                        "source": note.relative_to(vault).as_posix(),
                        "line": link["line"],
                        "kind": link["kind"],
                        "target": link["target"],
                    }
                )
    return references


def referenced_assets(vault: Path, note: Path) -> list[Path]:
    assets = (vault / "Assets").resolve()
    if not assets.is_dir():
        return []
    found: set[Path] = set()
    text = note.read_text(encoding="utf-8")
    for link in extract_links(text):
        resolved = resolve_link(vault, note, str(link["target"]), markdown=link["format"] == "markdown")
        if resolved is not None and within(resolved, assets) and resolved.is_file():
            found.add(resolved)
    return sorted(found)


def link_names(vault: Path, source: Path, destination: Path) -> list[tuple[str, str]]:
    old_rel = source.relative_to(vault).with_suffix("").as_posix()
    new_rel = destination.relative_to(vault).with_suffix("").as_posix()
    pairs = [(old_rel, new_rel), (old_rel + ".md", new_rel + ".md")]
    same_stem = [p for p in note_files(vault) if p.stem.casefold() == source.stem.casefold()]
    if len(same_stem) == 1:
        pairs.extend([(source.stem, destination.stem), (source.name, destination.name)])
    return sorted(set(pairs), key=lambda pair: len(pair[0]), reverse=True)


def rewrite_links(vault: Path, source: Path, destination: Path) -> dict[Path, str]:
    pairs = link_names(vault, source, destination)
    changes: dict[Path, str] = {}
    for note in note_files(vault):
        if note == source:
            continue
        text = note.read_text(encoding="utf-8")
        updated = text
        for old, new in pairs:
            pattern = re.compile(r"(?P<prefix>!?\[\[)" + re.escape(old) + r"(?P<suffix>(?:[#|][^\]]*)?\]\])")
            updated = pattern.sub(lambda m: m.group("prefix") + new + m.group("suffix"), updated)
        if updated != text:
            changes[note] = updated
    return changes


def git(vault: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(vault), *args],
        text=True,
        encoding="utf-8",
        errors="surrogateescape",
        capture_output=True,
        check=check,
    )


def ensure_snapshot(vault: Path, source: Path, operation: str) -> str | None:
    repo = Path(git(vault, "rev-parse", "--show-toplevel").stdout.strip()).resolve()
    rel = source.relative_to(repo).as_posix()
    current = source.read_bytes()
    prior = git(repo, "show", f"HEAD:{rel}", check=False)
    if prior.returncode == 0 and prior.stdout.encode("utf-8") == current:
        return None
    git(repo, "add", "--", rel)
    committed = git(repo, "commit", "--only", "-m", f"Snapshot {rel} before {operation}", "--", rel)
    match = re.search(r"\[[^ ]+ ([0-9a-f]+)\]", committed.stdout)
    return match.group(1) if match else git(repo, "rev-parse", "HEAD").stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, default=Path("vault"))
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("move", "merge-remove"):
        cmd = sub.add_parser(command)
        cmd.add_argument("source")
        cmd.add_argument("destination")
    references = sub.add_parser("references")
    references.add_argument("note")
    delete = sub.add_parser("delete")
    delete.add_argument("note")
    delete.add_argument("--keep-orphan-assets", action="store_true")
    args = parser.parse_args()

    vault = args.vault.resolve()
    if not vault.is_dir():
        fail(f"vault does not exist: {vault}")
    if args.command == "references":
        note = resolve_note(vault, args.note, must_exist=True)
        result = {
            "ok": True,
            "operation": "references",
            "note": note.relative_to(vault).as_posix(),
            "references": references_to(vault, note, exclude={note}),
        }
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0

    if args.command == "delete":
        source = resolve_note(vault, args.note, must_exist=True)
        inbound = references_to(vault, source, exclude={source})
        if inbound:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "operation": "delete",
                        "source": source.relative_to(vault).as_posix(),
                        "error": "inbound references exist",
                        "references": inbound,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
            return 2

        assets = referenced_assets(vault, source)
        snapshot = ensure_snapshot(vault, source, "delete")
        source.unlink()
        deleted_assets: list[str] = []
        kept_assets: list[dict[str, object]] = []
        for asset in assets:
            references = references_to(vault, asset)
            relative = asset.relative_to(vault).as_posix()
            if references or args.keep_orphan_assets:
                kept_assets.append({"path": relative, "references": references})
                continue
            asset.unlink()
            deleted_assets.append(relative)
        result = {
            "ok": True,
            "operation": "delete",
            "source": source.relative_to(vault).as_posix(),
            "snapshot_commit": snapshot,
            "deleted_assets": deleted_assets,
            "kept_assets": kept_assets,
        }
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0

    source = resolve_note(vault, args.source, must_exist=True)
    destination = resolve_note(vault, args.destination, must_exist=args.command == "merge-remove")
    if source == destination:
        fail("source and destination are identical")

    snapshot = None
    if args.command == "move":
        if destination.exists():
            fail(f"destination already exists: {destination}")
    else:
        if source.relative_to(vault).parts[0] != "InBox":
            fail("merge-remove source must be under InBox")
        if destination.relative_to(vault).parts[0] != "Raw":
            fail("merge-remove destination must be under Raw")
        errors = validate_note(destination)
        if errors:
            fail("destination validation failed:\n" + "\n".join(errors))
        snapshot = ensure_snapshot(vault, source, "merge")

    rewrites = rewrite_links(vault, source, destination)
    if args.command == "move":
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, destination)
    else:
        source.unlink()
    for path, content in rewrites.items():
        atomic_write(path, content)

    result = {
        "ok": True,
        "operation": args.command,
        "source": source.relative_to(vault).as_posix(),
        "destination": destination.relative_to(vault).as_posix(),
        "rewritten": [path.relative_to(vault).as_posix() for path in rewrites],
        "snapshot_commit": snapshot,
    }
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
