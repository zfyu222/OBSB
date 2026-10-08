# OBSB AI 管家 0.1.4

Obsidian 原生侧边栏客户端，连接已经部署的 NAS OpenCode 2.x。AI、模型密钥、Skills、笔记编辑和完整整理仍在服务器运行；本插件只发送用户输入、显示服务器会话和回答，以及打开本地 Markdown 引用。Windows 使用右侧栏，Android 使用 Obsidian 的移动端侧栏。未启动本地 Agent，也没有新增服务容器。

## 功能

- 从服务器读取 `/workspace` 会话，继续网页或其他设备已有的对话；支持更多会话和更早消息分页。
- 新对话不指定固定时间标题，交给 OpenCode 根据开头的对话自动生成主题名称；自动刷新同步当前会话标题，保留已加载的历史会话和当前选择。标题请求失败不影响消息显示。已有旧标题不批量重写，服务器生成失败时保留默认名称。
- 原生 Markdown 回答；点击 wikilink 的标题/块引用在当前 vault 打开笔记。也识别内联代码中的 `Raw/…md`、`vault/Raw/…md` 等路径，以及 Markdown 链接中的 `/workspace/vault/…md`。
- 聊天正文允许选中文字复制；每条消息提供“复制”按钮，复制原始 Markdown（保留链接），不包含工具状态或思考内容。空闲自动刷新不再重排未变化的消息，以免打断文字选择。
- 尚未同步到本机的笔记显示提示，不创建空笔记；服务器路径转换为 vault 相对路径。
- SSE 增量显示回答；若 WebView/CORS 不支持流式请求，自动改为约 1.5 秒获取运行中回答、8 秒检查空闲会话。回到前台或网络恢复时重新连接；不承诺 Android 后台执行。
- 当前笔记作为路径上下文，不自动上传整篇正文；选中文字作为用户材料发送。笔记读取以服务器已同步内容为准。
- `/run-nightly` 使用服务器正式命令接口，执行原有完整整理流程；其他服务器命令也可选择。附加上下文与命令不混合提交。
- 操作请求显示“允许这一次”和“拒绝”，遵循现有 OpenCode 配置，不另行自动授权；支持停止当前执行。

## 构建与安装

推荐通过 BRAT 安装：在 Obsidian 社区安装并启用 BRAT，在其设置中添加 `https://github.com/zfyu222/OBSB`，选择最新版本。安装和更新不需要解压或复制文件；详见 [工程首页](../../README.md)。当前尚未上架官方社区目录。

在本目录运行 `npm ci`、`npm run check`、`npm test`、`npm run build`。构建产物为 `dist/obsb-chat/{main.js,manifest.json,styles.css}`。依赖只用于构建/测试；运行时仅依赖 Obsidian，不需要设备安装 Node.js。

Windows 可从工程根目录执行：

```powershell
pwsh -File plugins/obsb-chat/scripts/install.ps1 -VaultPath H:\obsb
```

脚本只复制三个插件程序文件，不自动启用插件、不覆盖 `data.json`；升级前把原程序备份到工程 `artifacts/`。启用方式：Obsidian 设置 → 社区插件 → 已安装插件 → OBSB AI 管家。安装时可先关闭 Obsidian；已打开时重新启动以加载插件。

Android 解压安装包，把 `obsb-chat` 文件夹复制到手机仓库的 `.obsidian/plugins/`，然后重新打开 Obsidian并在社区插件中启用。本项目关闭了隐藏配置同步，所以两台设备分别安装和填写连接设置。

## 连接设置

| 设置 | 填写方式 |
| --- | --- |
| 服务器地址 | 你自己的 OpenCode HTTPS 地址，例如 `https://opencode.example.com`；新安装默认留空 |
| 用户名 | `opencode` |
| 登录密码 | 现有 OpenCode 登录密码；由用户在本机填写 |
| 服务器项目目录 | `/workspace` |
| 服务器笔记根目录 | `/workspace/vault` |

密码保存在本机 `.obsidian/plugins/obsb-chat/data.json` 中，不包含在插件安装包或 Git 中。不要填写 DeepSeek API Key。修改设置后在聊天面板点击“刷新”。点击左侧聊天图标，或运行命令“OBSB AI 管家：打开 AI 管家”。输入框支持 Enter 发送、Shift+Enter 换行，兼容 Ctrl/⌘+Enter 发送；中文输入法组合输入及选词确认不会触发发送。手机也可使用发送按钮。

## 验证边界

2026-10-08：0.1.3 已通过 23 项协议/界面模拟测试，并使用真实 NAS OpenCode 2.0.7 验证不指定标题的创建请求、`session.renamed` 事件及 GET 会话返回的主题标题“聊天接口测试成功”。测试会话已清理，没有读写笔记。自动命名复用服务器能力，没有另行增加模型或标题生成会话。

2026-10-08：0.1.2 增加 Enter 发送、Shift+Enter 换行，保留 Ctrl/⌘+Enter；键盘事件模拟覆盖中文输入法组合状态和移动端旧式 229 事件，实际输入法行为需客户端试用确认。

2026-10-08：0.1.1 修复聊天文字选择和刷新打断选择的问题，增加逐消息复制。模拟测试覆盖选中后重复刷新、复制 Markdown、剪贴板回退及失败提示；两端系统复制菜单仍需实机确认。

2026-10-03 已通过 TypeScript 检查、协议/界面模拟测试，以及真实 NAS OpenCode 2.0.7 的账号认证、会话读取、命令发现、普通消息生成和 SSE 增量事件测试。真实测试只创建临时对话、要求纯文本回复，结束后删除该测试会话，没有读写知识笔记。`/run-nightly` 仅验证命令发现和发送契约，没有因此运行整理任务。

界面模拟测试覆盖链接点击调用 Obsidian 跳转接口、缺失笔记不创建文件、失败发送保留输入和自动刷新恢复。尚未完成实际 Windows/Android Obsidian 内的渲染、标题/块定位、移动端键盘及前后台验收；声明 `isDesktopOnly: false` 不等于这些已经通过。正式使用前按 `docs/Obsidian初始化配置.md` 的插件清单完成两端试用。

## 参考

- [Obsidian 原生 MarkdownRenderer](https://docs.obsidian.md/plugins/guides/lifecycle-management)
- [OpenCode v2 API](https://opencode.ai/v2/docs/api)
- [windyboy/opencode-obsidian](https://github.com/windyboy/opencode-obsidian)：参考原生聊天面板方向。未复制其源码或依赖；它使用的旧版 SDK 和本地工具代理不纳入本插件。

暂未支持服务器交互式表单（如 question 工具的选项卡）和高级会话管理；遇到此类等待可在原 OpenCode 网页继续同一会话。
