---
name: note-editing
description: Create or edit Markdown notes in the formal Obsidian vault during an explicit interactive user request. Use for direct note changes; route moves, renames, and post-merge removal through vault-ops. Use note-deletion for backlink inspection and standalone note deletion.
---

# Interactive note editing

- OBSB task documents under `Raw/任务管理/` have two supported formats; read `plugins/obsb-tasks/README.md#markdown-树格式人工与-ai-编辑约定` before editing. In format 2 (`obsb-file` has `format: 2`), two-space list indentation is parentage, `- 领域：` is an area, and task checkboxes encode status. Preserve unique trailing `^n-...` IDs, file metadata, per-node `obsb-meta`, unknown extensions, archive-context markers and `nightly_maintenance: skip`. Visible properties use `[名称:: 值]`. Notes have one extra quote envelope (`> ` per line), so lists/fences inside it are note content, never child tasks. New nodes need unique stable IDs; move an entire subtree including properties/notes, keep legal task/area parentage, and validate by reloading the plugin. Legacy format without `format` still uses same-level headings, `obsb-node` JSON parentage and `obsb-end`; preserve its boundaries and do not interpret heading depth as parentage or hand-migrate it. The plugin can back up and migrate it. Do not merge/split/move whole task files as ordinary prose. Completed nodes remain current until explicit archive; default retrieval excludes archive/sleeping/transaction/format-backup records. Do not restore archived or backup content implicitly.

- For mind map notes or Markdown containing `mm:node` / `mm:summaries`, first load [mindmap-reading](../mindmap-reading/SKILL.md) to understand hierarchy and summary references and preserve their metadata while editing.

- Work directly in `vault/`; do not create another session or worktree for an explicit live request.
- Search filenames, tags, summaries, and body text before creating a note. Reuse an existing destination when overlap is strong; otherwise create a focused note.
- Put uncategorized captures in `vault/InBox/`. Organized notes belong below `vault/Raw/项目`, `vault/Raw/领域`, or `vault/Raw/归档`.
- Preserve sources, URLs, user-defined frontmatter, wikilinks, and attachment references. Never read or alter binary attachments except for deterministic orphan cleanup performed by the `note-deletion` workflow after an explicitly requested note deletion.
- Prioritize the user's requested content change. For an ordinary interactive body edit, preserve existing frontmatter but do not rescan tags, regenerate recursive summaries, or repair unrelated metadata merely because the body changed; the nightly workflow maintains those fields later.
- If the user asks for a note to be excluded from unattended maintenance, set or preserve `nightly_maintenance: skip`. Remove it only when the user asks to restore normal nightly maintenance.
- If the user explicitly asks to organize, finalize, tag, summarize, or validate the note now, produce the fully organized Raw metadata and invoke `assign-tags` and `recursive-summary` as needed.
- Use `python3 tools/vault_ops.py --vault vault move ...` for moves or renames. For a completed Inbox merge, edit the destination first and then use the `merge-remove` operation. Never replace these structural commands with `mv`, `rm`, or bulk search-and-replace.
- Route standalone note deletion and backlink inspection through the `note-deletion` Skill and `vault-ops references/delete` commands.
- Run `python3 tools/validate_vault.py --vault vault <changed paths>` only when the user requests an immediately organized or validated Raw result. Ordinary direct edits may sync before metadata maintenance.
