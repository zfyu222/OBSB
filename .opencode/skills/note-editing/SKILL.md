---
name: note-editing
description: Create or edit Markdown notes in the formal Obsidian vault during an explicit interactive user request. Use for direct note changes; route moves, renames, and post-merge removal through vault-ops. Use note-deletion for backlink inspection and standalone note deletion.
---

# Interactive note editing

- Work directly in `vault/`; do not create another session or worktree for an explicit live request.
- Search filenames, tags, summaries, and body text before creating a note. Reuse an existing destination when overlap is strong; otherwise create a focused note.
- Put uncategorized captures in `vault/InBox/`. Organized notes belong below `vault/Raw/项目`, `vault/Raw/领域`, or `vault/Raw/归档`.
- Preserve sources, URLs, user-defined frontmatter, wikilinks, and attachment references. Never read or alter binary attachments except for deterministic orphan cleanup performed by the `note-deletion` workflow after an explicitly requested note deletion.
- Prioritize the user's requested content change. For an ordinary interactive body edit, preserve existing frontmatter but do not rescan tags, regenerate recursive summaries, or repair unrelated metadata merely because the body changed; the nightly workflow maintains those fields later.
- If the user explicitly asks to organize, finalize, tag, summarize, or validate the note now, produce the fully organized Raw metadata and invoke `assign-tags` and `recursive-summary` as needed.
- Use `python3 tools/vault_ops.py --vault vault move ...` for moves or renames. For a completed Inbox merge, edit the destination first and then use the `merge-remove` operation. Never replace these structural commands with `mv`, `rm`, or bulk search-and-replace.
- Route standalone note deletion and backlink inspection through the `note-deletion` Skill and `vault-ops references/delete` commands.
- Run `python3 tools/validate_vault.py --vault vault <changed paths>` only when the user requests an immediately organized or validated Raw result. Ordinary direct edits may sync before metadata maintenance.
