---
name: organize-inbox
description: Organize an Obsidian Inbox Markdown capture into Raw or merge it into an existing note while preserving provenance and links. Use only when the user explicitly requests interactive Inbox organization; unattended nightly organization belongs to phase three.
---

# Organize Inbox

1. Read the literal Markdown only. Preserve HTTP/HTTPS URLs exactly; never open, validate, download, or infer their targets. Do not inspect attachments.
2. Search filenames, tags, summaries, and bodies for related notes and suitable existing Raw folders.
3. Merge only when the capture is short or strongly overlaps an existing note. Otherwise create a focused Raw note under the appropriate existing folder, creating a subfolder only when none fits.
4. Invoke `assign-tags` and `recursive-summary` for the organized note. Preserve unknown frontmatter keys.
5. For a move, call `python3 tools/vault_ops.py --vault vault move SOURCE DESTINATION`.
6. For a merge, edit and validate the destination first, then call `python3 tools/vault_ops.py --vault vault merge-remove SOURCE DESTINATION`. The command preserves a Git snapshot when required, updates inbound wikilinks, and removes the Inbox source.
7. If processing or validation fails, leave the Inbox source in place and state the exact failure.
