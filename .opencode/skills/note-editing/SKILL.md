---
name: note-editing
description: Create or edit Markdown notes in the formal Obsidian vault during an explicit interactive user request. Use for direct note changes; route moves, renames, and post-merge removal through vault-ops. Use note-deletion for backlink inspection and standalone note deletion.
---

# Interactive note editing

- Work directly in `vault/`; do not create another session or worktree for an explicit live request.
- Search filenames, tags, summaries, and body text before creating a note. Reuse an existing destination when overlap is strong; otherwise create a focused note.
- Put uncategorized captures in `vault/InBox/`. Organized notes belong below `vault/Raw/项目`, `vault/Raw/领域`, or `vault/Raw/归档`.
- Preserve sources, URLs, user-defined frontmatter, wikilinks, and attachment references. Never read or alter binary attachments except for deterministic orphan cleanup performed by the `note-deletion` workflow after an explicitly requested note deletion.
- Organized Raw notes require `tags`, contiguous `summary_1...summary_n` when needed, and `summary_final`. Invoke `assign-tags` and `recursive-summary` when those fields change.
- Use `python3 tools/vault_ops.py --vault vault move ...` for moves or renames. For a completed Inbox merge, edit the destination first and then use the `merge-remove` operation. Never replace these structural commands with `mv`, `rm`, or bulk search-and-replace.
- Route standalone note deletion and backlink inspection through the `note-deletion` Skill and `vault-ops references/delete` commands.
- Run `python3 tools/validate_vault.py --vault vault <changed paths>` after a substantive Raw edit. Report validation failures rather than claiming success.
