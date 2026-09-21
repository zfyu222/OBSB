---
name: note-deletion
description: Inspect backlinks to an Obsidian Markdown note and safely delete a note after an explicit user request, including cleanup of attachments that the deleted note referenced and no remaining Markdown references use. Use for backlink, reference, note-removal, and orphan-attachment cleanup requests.
---

# Note references and deletion

- For a reference-only request, run `python3 tools/vault_ops.py --vault vault references NOTE` and report each source path and line. Do not modify the vault.
- Delete a note only when the user explicitly requests deletion and the target is unambiguous. Never substitute `rm`, `unlink`, or a generic file tool.
- Before deletion, run the `references` command. If inbound references exist, explain the affected notes and stop. Edit, remove, or retarget those references only when the user explicitly directs how to handle them, then check again.
- Delete with `python3 tools/vault_ops.py --vault vault delete NOTE`. The command preserves a recoverable Git snapshot when needed and refuses to leave known inbound wikilinks or Markdown links dangling.
- By default, deletion also removes only those files under `Assets/` that were referenced by the deleted note and have no references in any remaining Markdown note. It never performs a vault-wide orphan sweep and never reads attachment contents.
- If the user wants attachments retained, add `--keep-orphan-assets`.
- Report the deleted note, snapshot commit when present, deleted orphan attachments, and retained attachments. Treat a nonzero exit as a stopped operation, not a successful deletion.
