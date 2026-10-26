# GitHub 单仓库发布与迁移

2026-10-08 用户授权公开迁移至 `zfyu222/OBSB`，保持外层框架和插件在同一仓库；不上传内层 vault、运行数据或秘密。迁移保留框架 Git 历史，旧腾讯仓库不删除、不再双向同步。

迁移前扫描了全部历史对象，与本地当前已知密码/Token/Key 比对，并检查私钥和 GitHub Token 特征，未命中。此检查不等于证明所有历史信息均无敏感性；历史部署域名、内网地址、用户名和机器路径仍随框架文档公开。插件新安装不再预填个人 NAS 地址，已有设备设置保留。

## 日常 Git

- Windows `origin` 使用 `https://github.com/zfyu222/OBSB.git`，通过本机 GitHub CLI 登录凭据推送。
- NAS 同一 `origin` 通过 HTTPS 拉取公开仓库，通过仅此仓库可写的 SSH deploy key 推送。私钥只放在 `runtime/opencode/.ssh/`，不在公开源码或 vault 中。
- `brain-agent` 需要 `openssh-client` 及 UID 1026 的用户记录（OpenSSH 不能只使用无 passwd 条目的数字 UID）；Dockerfile 已纳入，当前容器也已补齐，未来重新构建镜像后仍保留。
- 腾讯 Git Token 不用于 GitHub，不把本机 GitHub 全账号 Token 复制到 NAS。

## 插件发布

插件仍在 `plugins/obsb-chat/`；根目录 `manifest.json`、`versions.json` 是发布入口，与插件目录一致，构建时强制校验。发布 tag、Release 名称和 manifest 版本一致，不加 `v`。

运行插件编译与测试、提交并推送后，推送对应版本 tag，例如 `0.1.4`。`.github/workflows/plugin-release.yml` 在 GitHub 上构建验证，并把三个未压缩文件作为 Release 附件上传。BRAT 直接安装这些附件，不读取整个框架工程。

新用户在社区安装 BRAT → Add Beta Plugin → 填写 `https://github.com/zfyu222/OBSB` → 安装并启用。插件仅为现有 OpenCode 2.x 的客户端，每人填写自己的服务连接设置，不分享 NAS 密码或 DeepSeek Key。

当前未申请官方社区目录，也未替用户选择项目整体的开源许可证；若申请社区发布，再确认许可证和移动端验收。

## 思维导图 fork 的独立发布

2026-10-12 纳入项目维护的 Enhancing Mindmap 使用 `zfyu222/obsidian-enhancing-mindmap` 独立 fork，沿用上游许可证。它不在 `plugins/obsb-chat/`，也不使用 OBSB 的根 manifest、tag 或本仓库的发布工作流。
源码和 Release 在 fork，本项目通过[维护 Skill](../.opencode/skills/mindmap-plugin-maintenance/SKILL.md)按需加载[维护文档](思维导图插件维护.md)。BRAT 添加的是 `zfyu222/obsidian-enhancing-mindmap`，首版 `0.2.6-beta.1` 已发布；AI 管家的 BRAT 仓库仍为 `zfyu222/OBSB`。

## 任务管理插件的独立发布

2026-10-26 用户要求提交 Git 并提供 BRAT 更新。任务插件 ID 为 `obsb-tasks`，BRAT 仓库为 `zfyu222/obsb-tasks`，与 AI 管家、思维导图分别发行，根 manifest 和 tag 不混用。

开发主源在本仓库 `plugins/obsb-tasks/`，通过插件的 `scripts/export-release.mjs` 白名单导出到独立发行镜像。本机镜像位于被主工程忽略的 `runtime/obsb-tasks-release/`；不在插件目录中嵌入另一个 Git 仓库，也不导出 vault、框架、运行数据或秘密。独立仓库包含根 manifest、versions、构建源码与发布工作流，可以独立复现构建。

独立发行仓库提交并推送后，推送与 manifest 一致的版本 tag。独立仓库 `.github/workflows/release.yml` 运行检查、测试、构建，上传三个未压缩安装附件。BRAT 添加 `https://github.com/zfyu222/obsb-tasks`。维护步骤和测试边界见[插件说明](../plugins/obsb-tasks/README.md#git-与-brat-发布维护)。本次发行不代表已在 Windows／Android 安装验收。

首版 [0.1.0 Release](https://github.com/zfyu222/obsb-tasks/releases/tag/0.1.0) 已发布，源码提交 `f19094c49418453c34f0f44b5ebbff2bf08b3e4f`。[发布工作流](https://github.com/zfyu222/obsb-tasks/actions/runs/40315128968) 的 23 项测试、类型检查和构建通过；下载三个 Release 附件核对 SHA-256，均与本地构建一致。主工程当时存在 34 条既有未推送提交，本次保留其推送状态，仅在主工程保存当前任务提交，插件完整源码和 Release 已独立推送。
