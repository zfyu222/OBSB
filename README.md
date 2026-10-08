# OBSB 与 AI 管家插件

一个仓库维护 Obsidian 知识库框架及原生 AI 聊天插件。插件源码位于 `plugins/obsb-chat/`；框架、Skills、工具和部署文档仍在同一个仓库，不需要维护第二份插件工程。

## 手机和电脑安装插件

1. 在 Obsidian 的“设置 → 社区插件 → 浏览”中安装并启用 **BRAT**。
2. 打开 BRAT 设置，选择 **Add Beta Plugin**，填写 `https://github.com/zfyu222/OBSB`，选择最新版本并安装。
3. 在社区插件中启用 **OBSB AI 管家**。
4. 在 AI 管家设置中填写你自己的 OpenCode 服务器地址、登录账号和密码，然后打开聊天面板点击“刷新”。默认项目为 `/workspace`，笔记根目录为 `/workspace/vault`，请按自己的部署调整。

无需下载压缩包、解压或复制文件；后续在 BRAT 中检查更新。Windows 与 Android 分别安装，不依赖 LiveSync 传播 `.obsidian/`。

本插件尚未进入 Obsidian 官方社区目录。它连接用户已有的 **OpenCode 2.x** 服务，不提供公共 AI 服务、模型密钥或共享知识库。笔记编辑和记忆整理依赖服务器 Skills、命令和已同步笔记；安装插件本身不会部署这些服务。

支持服务器会话、主题自动命名、增量回答、Markdown 引用跳转、选段上下文、消息复制，以及 Enter 发送 / Shift+Enter 换行。详细功能、配置和验证边界见 [插件说明](plugins/obsb-chat/README.md)。

0.2.0 新增 AI 追问表单、当前项目对话批量删除/清空及 `/compact` 历史压缩；服务器命令列表继续动态读取。发布与 BRAT 可更新版本以 GitHub Release 为准。

## 框架开发与发布

- 日常维护入口：[AGENTS.md](AGENTS.md)；框架开发入口：[开发文档](docs/框架开发入口.md)。
- 在 `plugins/obsb-chat/` 运行 `npm ci`、`npm run check`、`npm test`、`npm run build`。
- 发布前同步插件和根目录的 `manifest.json`、`versions.json` 及 npm 版本。构建会校验一致性。
- 推送与插件版本相同的 Git tag（例如 `0.1.4`，不加 `v`），GitHub Actions 自动构建并上传 `main.js`、`manifest.json`、`styles.css` 三个 Release 附件，供 BRAT 安装。
- 正式唯一框架远端：`https://github.com/zfyu222/OBSB.git`，分支 `main`。腾讯 Git 旧仓库保留作迁移前历史备份，不再双向同步。

## 数据范围

此公开仓库只管理外层框架。`vault/`、`secrets.local.env`、服务密钥、运行数据、附件和设备插件配置不上传。历史部署文档包含原部署的域名、内网地址及路径，属于部署记录，不代表公共服务；不要照抄为自己的生产配置。公开不代表已申请 Obsidian 社区审核；第三方 Skill 的许可证见其目录，项目整体许可证尚未选定。

安装机制参考：[BRAT 官方说明](https://github.com/TfTHacker/obsidian42-brat)、[Obsidian 发布文档](https://docs.obsidian.md/plugins/releasing/submit-plugin)。
