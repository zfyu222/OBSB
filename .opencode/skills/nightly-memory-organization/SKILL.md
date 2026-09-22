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
   tools directly; do not create intermediate files for note content. The
   orchestrator has already calculated `raw_candidates`; do not run Git
   commands yourself to rediscover or filter candidates.
2. Search filenames, body text, YAML tags and summaries before creating or merging notes.
3. Process Inbox conservatively. Preserve URL text, do not fetch URLs or read attachments.
4. Use `.nightly-tools/tags.py`, `.nightly-tools/validate_vault.py` and
   `.nightly-tools/vault_ops.py` with the current worktree as `--vault` for their
   respective deterministic duties.
5. Do not edit `Assets/`, `.obsidian/`, secrets, runtime data or framework files.
6. Do not edit a note listed in `.nightly-context.json` under `skipped_paths`:
   it has `nightly_maintenance: skip` and is excluded from unattended work.
   Do not edit an existing Raw note unless it is listed in `raw_candidates`.
   A pre-existing invalid Raw note outside that list must be reported as a gap,
   not repaired during this run.
7. Before ending, run the validator against only Raw Markdown created or modified
   during this run. Then create the permitted task audit file
   `.nightly-operations.json`: `{"operations":[...]}`. Include one item for
   each changed Markdown note other than the daily report, with its `path`, one
   or more actions from `created`, `moved`, `merged`, `metadata_updated`,
   `inbox_removed`, `deleted`, and a factual one-sentence `detail` of at most
   100 characters. Write the detail as a natural, concise synthesis of what was
   meaningfully done to that note, not as a list of internal actions or YAML
   fields. A move already implies removal from Inbox, so do not state source
   removal separately; omit routine unchanged facts. Do not put note content
   in this file. The orchestrator uses
   it only to write the human-readable report, then independently validates and
   applies results.
