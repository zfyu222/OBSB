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

2026-10-27 [0.1.1 Release](https://github.com/zfyu222/obsb-tasks/releases/tag/0.1.1) 已发布：Tab／Enter 直接建节点、节点名称原位编辑、右侧属性和节点类型自动保存。发行源码提交 `2f24add457d917d621ec9611d34da00e34d40e6a`，[CI](https://github.com/zfyu222/obsb-tasks/actions/runs/40452350574) 的 33 项测试、类型检查、构建通过，下载三个附件与本地构建 SHA-256 比对一致。BRAT 更新仓库仍为 `zfyu222/obsb-tasks`；未自动更新客户端。

2026-10-27 [0.2.0 Release](https://github.com/zfyu222/obsb-tasks/releases/tag/0.2.0) 已发布，发行源码提交 `83d76d1dbfaaa0c53dc822dd88ed07940f7fa951`。[CI](https://github.com/zfyu222/obsb-tasks/actions/runs/40493135681) 通过 45 项测试、类型检查、构建及新增实际 bundle 检查。提取 Enhancing Mindmap beta.41 内核，保留 MIT 声明；下载 main.js、manifest.json、styles.css 的 SHA-256 均与本地构建一致，实际发布包中已核对版权声明。生产包浏览器夹具中验证鼠标平移、节点拖入领域和撤销；原 fork 未修改，任务文件无需迁移，客户端实机仍待验收。

2026-10-27 [0.2.1 Release](https://github.com/zfyu222/obsb-tasks/releases/tag/0.2.1) 已发布，发行源码提交 `0bfc0cd6ea795cd59402725e1c943e27a465f921`。[CI](https://github.com/zfyu222/obsb-tasks/actions/runs/40494666198) 通过 46 项测试、类型检查、构建及实际 bundle 检查。完成时间由 ISO 文本改为本地日期时间选择器，新增上海／纽约时区往返保存和自动填写回归；三个附件下载 SHA-256 与本地构建一致。BRAT 更新后重新加载插件，旧任务格式兼容，实机仍待验收。

2026-10-27 [0.3.0 Release](https://github.com/zfyu222/obsb-tasks/releases/tag/0.3.0) 已发布，发行源码提交 `7a523d38dbdb8c3651d3e0bfde384dd9d95d26cc`。[CI](https://github.com/zfyu222/obsb-tasks/actions/runs/40498418928) 通过 57 项测试、类型检查、构建及实际发布包检查。数据改为可读 Markdown 树，原节点 ID、属性与注释保留；新增精确原文备份和逐文件迁移命令，并以同级位置修正移动子树的撤销。实际包验证迁移命令先保存草稿、产生新格式及原文备份；三个附件下载 SHA-256 与本地构建一致。所有设备先更新再迁移；原生搜索需排除格式备份目录，框架 AI 检索规则已更新。未直接迁移正式 vault，Windows／Android 与同步待实机验收。
