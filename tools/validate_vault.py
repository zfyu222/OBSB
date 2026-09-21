#!/usr/bin/env python3
"""Validate phase-two computable constraints for organized Raw notes."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import yaml

FRONTMATTER_END = re.compile(r"\n---(?:\r?\n|$)")
FENCED_MARKER = re.compile(r"^\s*(```+|~~~+).*?$", re.MULTILINE)
MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
WIKILINK = re.compile(r"!?\[\[([^\]]+)\]\]")
HTML_TAG = re.compile(r"<[^>]+>")
MARKERS = re.compile(r"(?m)^[ \t]{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s*|[*_~`]")
SUMMARY_ABSOLUTE_MAX = 200


def split_note(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        return {}, text
    match = FRONTMATTER_END.search(text, 3)
    if not match:
        raise ValueError("unterminated YAML frontmatter")
    data = yaml.safe_load(text[4 : match.start()])
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ValueError("YAML frontmatter must be a mapping")
    return data, text[match.end() :]


def visible(text: object) -> str:
    value = "" if text is None else str(text)
    value = FENCED_MARKER.sub("", value)
    value = MARKDOWN_LINK.sub(lambda m: m.group(1), value)

    def wiki_label(match: re.Match[str]) -> str:
        inside = match.group(1)
        target, sep, alias = inside.partition("|")
        shown = alias if sep else target
        return shown.split("#", 1)[0] if not sep else shown

    value = WIKILINK.sub(wiki_label, value)
    value = HTML_TAG.sub("", value)
    value = MARKERS.sub("", value)
    return "".join(ch for ch in value if not ch.isspace())


def validate_note(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        meta, body = split_note(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError, ValueError) as exc:
        return [f"{path}: {exc}"]

    tags = meta.get("tags")
    if not isinstance(tags, list) or not tags or any(not isinstance(tag, str) or not tag.strip() for tag in tags):
        errors.append(f"{path}: tags must be a non-empty string list")
    elif len(tags) > 5:
        errors.append(f"{path}: tags has {len(tags)} items; maximum is 5")

    numbered: dict[int, object] = {}
    for key, value in meta.items():
        match = re.fullmatch(r"summary_(\d+)", str(key))
        if match:
            numbered[int(match.group(1))] = value
    if numbered:
        expected = list(range(1, max(numbered) + 1))
        if sorted(numbered) != expected:
            errors.append(f"{path}: numbered summaries must be contiguous from summary_1")

    if "summary_final" not in meta or not isinstance(meta.get("summary_final"), str):
        errors.append(f"{path}: summary_final must be a string")
        return errors

    body_visible = visible(body)
    if not body_visible:
        errors.append(f"{path}: normalized body is empty")
        return errors

    previous = body_visible
    for index in sorted(numbered):
        current = visible(numbered[index])
        limit = min(SUMMARY_ABSOLUTE_MAX, len(previous) // 5)
        if not current:
            errors.append(f"{path}: summary_{index} is empty")
        if len(current) > limit:
            errors.append(f"{path}: summary_{index} has {len(current)} visible chars; maximum is {limit}")
        previous = current

    final = visible(meta["summary_final"])
    if len(body_visible) < 10 and not numbered:
        if final != body_visible:
            errors.append(f"{path}: short body must be used directly as summary_final")
    else:
        limit = min(SUMMARY_ABSOLUTE_MAX, len(previous) // 5)
        if len(final) > limit:
            errors.append(f"{path}: summary_final has {len(final)} visible chars; maximum is {limit}")
        if len(final) >= 10:
            errors.append(f"{path}: summary_final must contain fewer than 10 visible chars")
        if not final:
            errors.append(f"{path}: summary_final is empty")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, default=Path("vault"))
    parser.add_argument("paths", nargs="*", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = args.vault.resolve()
    targets: list[Path] = []
    if args.paths:
        for item in args.paths:
            candidate = item if item.is_absolute() else root / item
            if candidate.is_dir():
                targets.extend(sorted(candidate.rglob("*.md")))
            else:
                targets.append(candidate)
    else:
        targets = sorted((root / "Raw").rglob("*.md")) if (root / "Raw").is_dir() else []

    errors: list[str] = []
    checked = 0
    for path in targets:
        resolved = path.resolve()
        try:
            rel = resolved.relative_to(root)
        except ValueError:
            errors.append(f"{path}: outside vault")
            continue
        if rel.parts[0] != "Raw" or resolved.suffix.lower() != ".md":
            errors.append(f"{path}: validator accepts only Raw Markdown notes")
            continue
        checked += 1
        errors.extend(validate_note(resolved))
    result = {"ok": not errors, "checked": checked, "errors": errors}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        print(f"checked={checked} ok={str(not errors).lower()}")
        for error in errors:
            print(error)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
