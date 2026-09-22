---
name: nightly-memory-organization
description: Organize Inbox and maintain changed Raw notes only inside the nightly Git worktree.
---

# Nightly memory organization

Use this Skill only inside the isolated worktree created by the deterministic
orchestrator, never the formal vault.

1. Read `.nightly-tools/nightly-rules.md` and
   `.nightly-context.json`. Use only this worktree for all operations.
   Do not use `/tmp`, the formal framework checkout, Git history, or any
   scratch path outside this worktree. Use the built-in Markdown read/write
   tools directly; do not create intermediate files for note content.
2. Search filenames, body text, YAML tags and summaries before creating or merging notes.
3. Process Inbox conservatively. Preserve URL text, do not fetch URLs or read attachments.
4. Use `.nightly-tools/tags.py`, `.nightly-tools/validate_vault.py` and
   `.nightly-tools/vault_ops.py` with the current worktree as `--vault` for their
   respective deterministic duties.
5. Do not edit `Assets/`, `.obsidian/`, secrets, runtime data or framework files.
6. Do not edit an existing Raw note unless it is listed in `.nightly-context.json`.
   A pre-existing invalid Raw note outside that list must be reported as a gap,
   not repaired during this run.
7. Before ending, run the validator against only Raw Markdown created or modified
   during this run, and state concisely which
   Inbox items were created, moved, merged, skipped or failed. The orchestrator
   independently validates and applies results.
