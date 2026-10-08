---
description: 在隔离工作区执行一次完整记忆整理
---

本次手动记忆整理已经由确定性编排器完整执行。它会先快照服务器已可见的 Markdown，再使用隔离 worktree、单独的 OpenCode 夜间 Session、权威校验、冲突检查、带时间戳的整理报告、Git 提交和成功基准推进；不要在当前会话直接编辑 vault 来替代该流程。

执行结果：

!`python3 /workspace/tools/nightly_orchestrator.py --vault /workspace/vault --worktrees /worktrees --state-dir /var/lib/brain-agent/nightly --agent-command "python3 /workspace/tools/nightly_opencode_agent.py"`

仅根据上面的 JSON 用中文简洁说明状态、受影响路径、报告位置和下一步；若失败，说明错误但不要尝试绕过编排器直接修改正式 vault。
