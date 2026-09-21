#!/usr/bin/env python3
"""Scan YAML tags from Markdown without creating a second tag database."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import yaml


def frontmatter(text: str) -> dict:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    data = yaml.safe_load(text[4:end])
    return data if isinstance(data, dict) else {}


def scan(vault: Path) -> Counter[str]:
    canonical: dict[str, str] = {}
    counts: Counter[str] = Counter()
    for path in sorted(vault.rglob("*.md")):
        try:
            tags = frontmatter(path.read_text(encoding="utf-8")).get("tags", [])
        except (OSError, UnicodeError, yaml.YAMLError):
            continue
        if isinstance(tags, str):
            tags = [tags]
        if not isinstance(tags, list):
            continue
        for raw in tags:
            if not isinstance(raw, str):
                continue
            tag = raw.strip().lstrip("#")
            if not tag:
                continue
            key = tag.casefold()
            spelling = canonical.setdefault(key, tag)
            counts[spelling] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, default=Path("vault"))
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("list", "search"):
        cmd = sub.add_parser(name)
        if name == "search":
            cmd.add_argument("query")
        cmd.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.vault.is_dir():
        parser.error(f"vault does not exist: {args.vault}")
    counts = scan(args.vault)
    rows = [
        {"tag": tag, "count": count}
        for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold()))
        if args.command != "search" or args.query.casefold() in tag.casefold()
    ]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    else:
        for row in rows:
            print(f"{row['tag']}\t{row['count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
