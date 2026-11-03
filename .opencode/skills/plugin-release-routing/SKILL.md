---
name: plugin-release-routing
description: 提交、推送或发布本工程代码前，判断改动属于哪个仓库：OBSB 主库、obsb-tasks 发行镜像还是 obsidian-enhancing-mindmap fork；包含任务插件版本号同步、导出镜像、打 tag 与核验 Release 附件的顺序。只负责路由和校验，不替代各插件 README 的测试边界。
---

# 代码提交与发行路由

本工程对应三个 GitHub 仓库。改动落在哪条路径，就决定提交到哪个库；主库提交成功不代表用户在 Obsidian 里能拿到新版。

## 仓库职责

| 仓库 | 内容 | 用户安装入口 |
| --- | --- | --- |
| `zfyu222/OBSB`（本工作区） | 框架（`docs/`、`deploy/`、`tools/`、`tests/`、`.opencode/`）、`plugins/obsb-chat/`、`plugins/obsb-tasks/` 开发源 | BRAT 填 `zfyu222/OBSB` 得到 AI 管家 |
| `zfyu222/obsb-tasks` | 任务插件发行镜像，由主库白名单导出，独立构建和发布 | BRAT 填 `zfyu222/obsb-tasks` 得到任务插件 |
| `zfyu222/obsidian-enhancing-mindmap` | 思维导图 fork 的源码、测试和 Release | BRAT 选择该仓库的 beta |

## 先判断改动归属

- `plugins/obsb-tasks/**`：开发源在主库；要交付给 BRAT，必须再导出到 `zfyu222/obsb-tasks` 并发布 tag。
- `plugins/obsb-chat/**`、根 `manifest.json`、根 `versions.json`：只在主库；主库 tag 触发 `.github/workflows/plugin-release.yml` 发布 AI 管家。
- `docs/`、`deploy/`、`tools/`、`tests/`、`.opencode/`、根 `README.md`：只在主库。
- 思维导图插件源码不在本工作区，位于并列 checkout `J:\AIProject\obsidian-enhancing-mindmap`（其他环境按远端查找或克隆，不假设该路径存在）；主库只保存维护文档，按 `.opencode/skills/mindmap-plugin-maintenance/SKILL.md` 执行。

## 提交纪律

- 提交前跑 `git status --short`，只 `git add` 本次相关文件；无关的已修改文件、`.codebuddy/`、`runtime/`、`vault/`、`secrets/` 不进入提交。
- `vault/` 是内层 Git，由知识库整理流程维护，不混入框架或插件的提交。
- 用户要求「提交并推送」时，按上面的归属推到对应仓库；涉及插件交付时明确说清还缺镜像、tag 或 Release 哪一步，不要说成已完成。
- 主工程内 `git push` 在 `opencode.jsonc` 中被 deny：完成提交后把待推送分支或 tag 交回用户，或说明需要具备推送权限的环境；不修改权限配置绕过。
- 发布 tag 和上传 Release 只在用户明确要求时执行；只需保存开发源时提交主库即可。

## 任务插件发行顺序

1. 同步版本信息：`package.json`、`package-lock.json`、`manifest.json`、`versions.json`（新版本号对应 `minAppVersion`）、`release-notes.md`，以及插件 `README.md` 的版本标题与说明；版本号必须一致，否则构建前置检查失败。
2. 在 `plugins/obsb-tasks` 运行 `npm run check`、`npm test`、`npm run build`、`npm run test:bundle`；只报告实际跑过的检查。
3. 提交并推送主库。
4. `node scripts/export-release.mjs <镜像目录绝对路径>`；镜像目录是主工程忽略的 `runtime/obsb-tasks-release/`，不要手改镜像，改动会在下次导出被覆盖。
5. 镜像内提交、推送 `main`，再推送与 manifest 相同的 tag（不加 `v`）。
6. 等镜像仓库工作流完成，核对 Release 版本与 `main.js`、`manifest.json`、`styles.css` 三个附件，SHA-256 与本地 `dist/obsb-tasks/` 一致；附件缺失或哈希不符时如实报告，不宣称已发布。

## AI 管家发行

主库 tag 触发 `plugin-release.yml`，构建 `plugins/obsb-chat` 并上传三个附件。tag 与根 `manifest.json` 版本一致；不要把任务插件的版本号打在主库 tag 上。

## 常见错误

- 只推送 `zfyu222/OBSB` 就宣告插件已更新：BRAT 拿不到，必须推镜像仓库并发布 Release。
- 把任务插件 tag 打在主库，或把主库 tag 当成任务插件版本。
- 漏改四处版本号中的任意一处，导致构建或发布失败。
- 混用 BRAT 入口：`zfyu222/OBSB` 只会安装 AI 管家。
- 在 `runtime/` 镜像里直接改源码，主工程忽略该目录，改动会丢失。

## 细节文档

- 任务插件测试与发布维护：`plugins/obsb-tasks/README.md` 的「Git 与 BRAT 发布维护」。
- 发行历史与 CI 记录：`docs/GitHub发布与迁移.md`。
- 思维导图 fork：`docs/思维导图插件维护.md`。
