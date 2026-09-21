---
name: knowledge-qa
description: Answer questions from this Obsidian vault using filename, body, YAML tag, and summary searches with precise wikilink citations. Use for read-only knowledge-base questions; do not use general model knowledge as if it came from the vault.
---

# Knowledge Q&A

1. Search filenames and text with `rg`, including `tags`, `summary_1...summary_n`, and `summary_final`, before reading candidate notes.
2. Read only relevant Markdown bodies. Do not open attachments or fetch URLs found in notes.
3. Label each material statement as one of: **笔记内容**, **原文摘录**, **AI 推断**, or **知识库未覆盖**.
4. Put an Obsidian wikilink beside every material vault-based claim. Prefer an existing block link, then a heading link, then the whole note: `[[Raw/领域/example#heading|label]]`.
5. For every inference, list the supporting note locations. Keep verbatim excerpts short and exact.
6. Do not modify notes merely to create block IDs or improve citations during a read-only request.
