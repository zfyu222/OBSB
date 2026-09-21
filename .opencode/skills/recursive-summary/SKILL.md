---
name: recursive-summary
description: Generate or update the recursive YAML summaries required for organized Raw notes, using the vault's visible-character counting rule. Use when Raw note content or summaries change.
---

# Recursive summaries

1. Summarize the visible body, then summarize the immediately preceding summary repeatedly.
2. Each summary must be a genuine rewrite and contain at most `min(200, floor(previous_visible_length / 5))` normalized visible Unicode characters. The absolute 200-character ceiling applies to every summary layer, including `summary_1`.
3. Stop when `summary_final` is strictly fewer than 10 characters. Store the final layer only as `summary_final`, never duplicate it as `summary_n`.
4. If the normalized body is already fewer than 10 characters, use it directly as `summary_final`. An empty normalized body is a processing failure.
5. Count Chinese characters, letters, digits, and punctuation as one each; exclude YAML, Markdown formatting markers, and whitespace. Count link labels but not Markdown link destinations. Count bare URLs, code contents, and table-cell contents.
6. Run `python3 tools/validate_vault.py --vault vault PATH` and rewrite any overlong layer; never mechanically truncate it.
