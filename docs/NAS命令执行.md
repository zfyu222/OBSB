# 从 Windows 执行 NAS 维护命令

SSH 别名 `zfyynas` 已支持密钥登录。需要管理员权限的命令使用项目脚本，不依赖另一个终端中的 `sudo -v` 缓存，也不配置全局 `NOPASSWD`。

在工程根目录已有的 `secrets.local.env` 中增加 `NAS_SUDO_PASSWORD=...`（NAS 登录账号的 sudo 密码）。按原有格式直接填写等号后的密码，不额外加引号。该文件已被外层 Git 忽略，不上传到 NAS、不加入插件包或普通文档。

脚本要求 PowerShell 7，通过 SSH 标准输入向 sudo 传递密码，不将密码放到命令参数或输出。仅执行本次明确传入的维护命令，不改变 NAS 权限配置。需要远端标准输入的交互式命令不适用此脚本。

只读检查：

```powershell
pwsh -File deploy/scripts/invoke-nas-command.ps1 -Command 'id'
```

先检查框架工作区，再快进更新；有未提交改动时先确认其归属，不覆盖：

```powershell
pwsh -File deploy/scripts/invoke-nas-command.ps1 -Command '/var/packages/ContainerManager/target/usr/bin/docker exec --user 1026:100 brain-agent git -C /workspace status --short'
pwsh -File deploy/scripts/invoke-nas-command.ps1 -Command '/var/packages/ContainerManager/target/usr/bin/docker exec --user 1026:100 brain-agent git -C /workspace pull --ff-only origin main'
```

命令默认等待最多 120 秒，可用 `-TimeoutSeconds` 调整。超时只确认本地 SSH 被终止，不保证远端命令已停止，应先检查状态再决定是否重试。凭据缺失或错误时停止，不反复尝试。
