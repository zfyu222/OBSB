# 默认工作：维护 Obsidian 知识库

OpenCode `workspace` 的日常对话默认围绕 `vault/` 中的笔记：先搜索相关 Markdown，再按用户要求回答或直接编辑正式 vault。普通正文编辑保留现有属性、来源和链接；标签与递归摘要可以留到下一次完整整理。问答使用笔记位置的 Obsidian 链接，并区分笔记内容与 AI 推断。

- `vault/InBox/` 收集未整理内容；`vault/Raw/` 保存知识笔记；`vault/Drived/整理日志/` 保存完整整理报告；附件只放在 `vault/Assets/`，不读取附件内容。
- 笔记编辑、问答、标签、摘要、结构操作和恢复，按任务加载 `.opencode/skills/` 中对应的 Skill。结构操作通过 `tools/vault_ops.py`；不要直接移动或删除笔记。
- 用户要求完整记忆整理时，使用 `/run-nightly`，让编排器执行隔离、校验、冲突检查、报告和 Git 流程。日常对话不要自行模拟该流程。需要细则时再读 `docs/知识库维护规则.md`；完整整理的隔离会话会单独收到这份规则。
- 日常知识库任务只检索相关的 `vault/` Markdown，不预先读取 `docs/`、`deploy/`、`tools/`、`tests/` 或框架 Git 历史。只有用户明确讨论或开发知识库框架、部署、配置与运行机制时，才先读 `docs/框架开发入口.md`，再按其中索引读取所需文档。
- 不修改 `.obsidian/`、`secrets/` 或二进制附件，除非用户明确要求且符合对应工作流。
