---
name: assign-tags
description: Assign concise YAML tags to an organized Obsidian knowledge note by scanning the vault's existing tag vocabulary first. Use when creating or maintaining Raw note metadata.
---

# Assign tags

1. Run `python3 tools/tags.py --vault vault list --json` or `search QUERY --json`; do not read every note into model context to assemble the vocabulary.
2. Prefer an existing suitable or synonymous tag. Create a new tag only when none fits.
3. Use at most five tags, normally one to three. Tag only the note's core topics.
4. Preserve spelling from the existing vocabulary and preserve unrelated frontmatter keys.
5. Do not bulk-retag unrelated notes.
