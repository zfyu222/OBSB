# GitHub 单仓库发布与迁移

2026-10-08 用户授权公开迁移至 `zfyu222/OBSB`，保持外层框架和插件在同一仓库；不上传内层 vault、运行数据或秘密。迁移保留框架 Git 历史，旧腾讯仓库不删除、不再双向同步。

迁移前扫描了全部历史对象，与本地当前已知密码/Token/Key 比对，并检查私钥和 GitHub Token 特征，未命中。此检查不等于证明所有历史信息均无敏感性；历史部署域名、内网地址、用户名和机器路径仍随框架文档公开。插件新安装不再预填个人 NAS 地址，已有设备设置保留。

## 日常 Git

- Windows `origin` 使用 `https://github.com/zfyu222/OBSB.git`，通过本机 GitHub CLI 登录凭据推送。
- NAS 同一 `origin` 通过 HTTPS 拉取公开仓库，通过仅此仓库可写的 SSH deploy key 推送。私钥只放在 `runtime/opencode/.ssh/`，不在公开源码或 vault 中。
- `brain-agent` 需要 `openssh-client`；Dockerfile 已纳入依赖。当前容器也需安装该包，未来重新构建镜像后依赖仍保留。
- 腾讯 Git Token 不用于 GitHub，不把本机 GitHub 全账号 Token 复制到 NAS。

## 插件发布

插件仍在 `plugins/obsb-chat/`；根目录 `manifest.json`、`versions.json` 是发布入口，与插件目录一致，构建时强制校验。发布 tag、Release 名称和 manifest 版本一致，不加 `v`。

运行插件编译与测试、提交并推送后，推送对应版本 tag，例如 `0.1.4`。`.github/workflows/plugin-release.yml` 在 GitHub 上构建验证，并把三个未压缩文件作为 Release 附件上传。BRAT 直接安装这些附件，不读取整个框架工程。

新用户在社区安装 BRAT → Add Beta Plugin → 填写 `https://github.com/zfyu222/OBSB` → 安装并启用。插件仅为现有 OpenCode 2.x 的客户端，每人填写自己的服务连接设置，不分享 NAS 密码或 DeepSeek Key。

当前未申请官方社区目录，也未替用户选择项目整体的开源许可证；若申请社区发布，再确认许可证和移动端验收。
