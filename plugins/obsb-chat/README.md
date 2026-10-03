# OBSB AI 管家 0.1.0

Obsidian 原生侧边栏客户端，连接已经部署的 NAS OpenCode 2.x。AI、模型密钥、Skills、笔记编辑和完整整理仍在服务器运行；本插件只发送用户输入、显示服务器会话和回答，以及打开本地 Markdown 引用。Windows 使用右侧栏，Android 使用 Obsidian 的移动端侧栏。未启动本地 Agent，也没有新增服务容器。

## 功能

- 从服务器读取 `/workspace` 会话，继续网页或其他设备已有的对话；支持更多会话和更早消息分页。
- 原生 Markdown 回答；点击 wikilink 的标题/块引用在当前 vault 打开笔记。也识别内联代码中的 `Raw/…md`、`vault/Raw/…md` 等路径，以及 Markdown 链接中的 `/workspace/vault/…md`。
- 尚未同步到本机的笔记显示提示，不创建空笔记；服务器路径转换为 vault 相对路径。
- SSE 增量显示回答；若 WebView/CORS 不支持流式请求，自动改为约 1.5 秒获取运行中回答、8 秒检查空闲会话。回到前台或网络恢复时重新连接；不承诺 Android 后台执行。
- 当前笔记作为路径上下文，不自动上传整篇正文；选中文字作为用户材料发送。笔记读取以服务器已同步内容为准。
- `/run-nightly` 使用服务器正式命令接口，执行原有完整整理流程；其他服务器命令也可选择。附加上下文与命令不混合提交。
- 操作请求显示“允许这一次”和“拒绝”，遵循现有 OpenCode 配置，不另行自动授权；支持停止当前执行。

## 构建与安装

在本目录运行 `npm ci`、`npm run check`、`npm test`、`npm run build`。构建产物为 `dist/obsb-chat/{main.js,manifest.json,styles.css}`。依赖只用于构建/测试；运行时仅依赖 Obsidian，不需要设备安装 Node.js。

Windows 可从工程根目录执行：

```powershell
pwsh -File plugins/obsb-chat/scripts/install.ps1 -VaultPath H:\obsb
```

脚本只复制三个插件程序文件，不自动启用插件、不覆盖 `data.json`；升级前把原程序备份到工程 `artifacts/`。启用方式：Obsidian 设置 → 社区插件 → 已安装插件 → OBSB AI 管家。安装时可先关闭 Obsidian；已打开时重新启动以加载插件。

Android 解压安装包，把 `obsb-chat` 文件夹复制到手机仓库的 `.obsidian/plugins/`，然后重新打开 Obsidian并在社区插件中启用。本项目关闭了隐藏配置同步，所以两台设备分别安装和填写连接设置。

## 连接设置

| 设置 | 当前部署值 |
| --- | --- |
| 服务器地址 | `https://brain.hytzfy.dpdns.org:40087` |
| 用户名 | `opencode` |
| 登录密码 | 现有 OpenCode 登录密码；由用户在本机填写 |
| 服务器项目目录 | `/workspace` |
| 服务器笔记根目录 | `/workspace/vault` |

密码保存在本机 `.obsidian/plugins/obsb-chat/data.json` 中，不包含在插件安装包或 Git 中。不要填写 DeepSeek API Key。修改设置后在聊天面板点击“刷新”。点击左侧聊天图标，或运行命令“OBSB AI 管家：打开 AI 管家”。发送按钮适用于手机；桌面也支持 Ctrl/⌘+Enter，普通 Enter 保留换行。

## 验证边界

2026-10-03 已通过 TypeScript 检查、协议/界面模拟测试，以及真实 NAS OpenCode 2.0.7 的账号认证、会话读取、命令发现、普通消息生成和 SSE 增量事件测试。真实测试只创建临时对话、要求纯文本回复，结束后删除该测试会话，没有读写知识笔记。`/run-nightly` 仅验证命令发现和发送契约，没有因此运行整理任务。

界面模拟测试覆盖链接点击调用 Obsidian 跳转接口、缺失笔记不创建文件、失败发送保留输入和自动刷新恢复。尚未完成实际 Windows/Android Obsidian 内的渲染、标题/块定位、移动端键盘及前后台验收；声明 `isDesktopOnly: false` 不等于这些已经通过。正式使用前按 `docs/Obsidian初始化配置.md` 的插件清单完成两端试用。

## 参考

- [Obsidian 原生 MarkdownRenderer](https://docs.obsidian.md/plugins/guides/lifecycle-management)
- [OpenCode v2 API](https://opencode.ai/v2/docs/api)
- [windyboy/opencode-obsidian](https://github.com/windyboy/opencode-obsidian)：参考原生聊天面板方向。未复制其源码或依赖；它使用的旧版 SDK 和本地工具代理不纳入本插件。

暂未支持服务器交互式表单（如 question 工具的选项卡）和高级会话管理；遇到此类等待可在原 OpenCode 网页继续同一会话。
