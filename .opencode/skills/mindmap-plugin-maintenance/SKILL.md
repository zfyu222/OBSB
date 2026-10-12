---
name: mindmap-plugin-maintenance
description: 开发、排查、构建和发布 OBSB 项目维护的 obsidian-enhancing-mindmap fork；处理节点交互、Markdown 保存和 BRAT 更新，不用于普通笔记编辑或 AI 管家插件开发。
---

# 思维导图插件维护

本项目维护用户已选择的 Enhancing Mindmap fork，普通 Markdown 是内容源。
源码和 Release 属于 `zfyu222/obsidian-enhancing-mindmap`，本工程保存维护知识；不要把它混入 `plugins/obsb-chat/` 或使用 OBSB 的发布 tag。

按当前任务读取 [维护文档](../../../docs/思维导图插件维护.md) 中所需部分：

- 首次进入或定位工程：读取“仓库与当前状态”。Windows 已有 checkout 为 `J:\AIProject\obsidian-enhancing-mindmap`；其他环境按 GitHub 远端查找或克隆，不能假设该路径存在。
- 修改行为或修复问题：读取“开发与验证”。先核验源码仓库的 `git status`、分支与 `origin`；保留未提交修改。使用 `codex/` 分支，基线按当前已发布版本及 PR 状态选择。
- 发布、安装或更新：读取“发布流程”或“BRAT 安装”。发布必须包含实际构建的三个附件，不把源码 ZIP 当作插件；用户要求发布即包含推送 tag 和核验 Release 的授权，单纯开发请求不自动变成发布请求。

维护节点行为时保持子树层级、Markdown 正文、独立节点 ID 和撤销重做；节点文字编辑期间保留原生快捷键。插件测试和构建在 fork 中运行；主工程文档与 fork 源码分别提交。

批量操作共享同一选择集合：按文档顺序取顶层选中根，过滤已有选中祖先的后代，整组只记一次撤销。鼠标交互修改按维护文档的可用环境运行 `test:browser`；模拟节点浏览器测试仍不等于 Obsidian 实机验收。

检查覆盖哪些行为就报告哪些行为；构建或模拟测试通过不等于 Windows/Android 实机验收。未明确要求安装时，不修改设备的 `.obsidian/` 配置，也不自动部署至 NAS。更新需求或发布状态时修改专题文档，日常规则只保留路由。

已发现上游 TypeScript 源码与 0.2.5 Release 的快捷键行为不同。维护键盘操作时同时核验 Tab/Enter 和节点撤销；发布前在构建后运行 `npm run test:bundle` 检查实际附件行为，不只测试源码中的子树命令。
