---
name: nightly-memory-organization
description: Organize Inbox and maintain changed Raw notes only inside the nightly Git worktree.
---

# Nightly memory organization

Use this Skill only when the deterministic orchestrator provides `NIGHTLY_VAULT`.
That path is the isolated worktree, never the formal vault.

1. Read `AGENTS.md` and use only `NIGHTLY_VAULT` for all Markdown operations.
2. Search filenames, body text, YAML tags and summaries before creating or merging notes.
3. Process Inbox conservatively. Preserve URL text, do not fetch URLs or read attachments.
4. Use `/workspace/tools/tags.py`, `/workspace/tools/validate_vault.py` and
   `/workspace/tools/vault_ops.py` with `--vault "$NIGHTLY_VAULT"` for their
   respective deterministic duties.
5. Do not edit `Assets/`, `.obsidian/`, secrets, runtime data or framework files.
6. Before ending, run the validator against the worktree and state concisely which
   Inbox items were created, moved, merged, skipped or failed. The orchestrator
   independently validates and applies results.
