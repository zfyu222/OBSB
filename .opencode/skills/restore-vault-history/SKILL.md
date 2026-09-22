---
name: restore-vault-history
description: Preview and safely apply restoration of one successful nightly organization task or one Markdown note from Git history. Use only for explicit rollback or note-version restoration requests; do not use for ordinary edits or repository-wide resets.
---

# Restore vault history

- Treat history inspection as read-only. Apply a restoration only when the user explicitly asks to undo a nightly task or restore a specific note version.
- Identify the exact commit and target note before applying. Do not infer an ambiguous revision from a date when multiple candidates exist.
- Preview first:
  - Task: `python3 tools/vault_restore.py --vault vault --worktrees /worktrees revert-task COMMIT`
  - Note: `python3 tools/vault_restore.py --vault vault --worktrees /worktrees restore-note REVISION NOTE`
- Review the returned paths. Use the same command with `--apply` only when they match the user's request.
- The tool creates a new recovery commit; never use `git reset`, force checkout, or rewrite Git history. A task reversal accepts only successful `Nightly memory organization ...` commits.
- The tool preserves later non-conflicting changes and stops when the selected reversal conflicts with later work or when the formal vault changes while restoration is prepared. Do not bypass a stopped operation with generic file or Git commands.
- A single-note restoration restores only the requested Markdown path. It does not restore, inspect, or delete attachments.
- Report the new recovery commit and restored paths. If preview or application stops, report the precise conflict or validation error and leave the formal vault unchanged.
