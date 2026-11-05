# 真实宿主验收记录（复验清单）

> **验收结果（2026-11-04，DSH 0.2.1-rc.5）**：A–E **全部通过**（直接调用工具，不是底层命令替代）。
> 兼容修复：`package.json` 去 BOM（否则整个 bundle 被 loader 跳过）、10 个工具补 `output` 契约（`lib/tool-output.js`）、相对路径改用会话 `workingDirectory`（`lib/cwd.js`）；mock 扩到 33/33。
> 下面保留复验步骤，本工作区已按此完成一轮；最新安装状态：profile 已 link 本插件并加入 bundles。

目标：在真实 DSH 宿主里确认 `dsh-design-kit` 的 1 个技能 + 10 个工具能加载、路由并真正执行成功路径。

## 1. 安装（在普通终端，不要在沙箱里）

```powershell
# 把两个占位符替换为本机实际路径：<DSH profile 目录>、<解压/仓库里的 dsh-design-kit 目录>
cd <DSH profile 目录>
pnpm add "<dsh-design-kit 目录>"
```

然后编辑同目录 `package.json`，在 `dsh.profile.bundles` 数组末尾加一项：

```json
"dsh-design-kit"
```

完整示例（只加最后一项，其它保持不动）：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-experimental-agent-team-profile",
  "dshmarket",
  "dsh-ppt",
  "dsh-whale-widget",
  "dsh-design-kit"
]
```

## 2. 重启 DSH

必须**完全退出并重新启动**（托盘退出，不是只开新对话）；否则 profile 的 bundle 不会重新加载。

## 3. 新会话验收（按顺序发这几句）

### A. 技能 + 设计工具

```text
用 design-kit 审一下 demo/career-plan/index.html 的界面质量，只审不改。
```

期望：技能命中 `design-kit`；调用 `design_lint`；返回 0 error（该 demo 之前是 100/100）。

### B. deck 质检

```text
用 design-kit 对 projects/career-deck_20261102 跑 deck_check。
```

期望：`ok=true`、`summary.total=8`、`summary.errors=0`、`reportPath` 指向 `validation/svg_quality_report.json`。

### C. deck 导出

```text
deck_export 同一个项目。
```

期望：`ok=true`、`pptxPath` 是 `projects/career-deck_20261102/exports/...pptx`、`slides=8`、`postflight.qualityGate=passed`。

### D. deck 渲染

```text
deck_render 刚才导出的那个 pptx。
```

期望：`ok=true`、`pdfPath`、`pagesDir`、`pageCount=8`、`images` 8 条、`missingFonts=[]`。逐页打开 PNG 确认没有明显溢出。

### E. 防覆盖

```text
deck_export 这个项目，out 指向刚才那个 pptx 的同一个路径。
```

期望：`ok=false`，中文错误说明「输出路径已存在，拒绝覆盖」，原文件不被动。

### F. 对话内三栏预览（客户端卡片）

重启 DSH 后，让 agent 直接调用：

```jsonc
probe_shortlist_preview({ "run": "probe-kit/shortlist-runs/sl-ui-demo" })
```

期望：对话里出现一张三栏卡片（候选 A/B/C 的 iframe 预览 + 删除/待定按钮）。点任意候选的「删除」→ 选一个理由→ 该候选标删除；三个候选都有决策后「提交本轮」→ 卡片自动发一条 `[probe-shortlist-ui] {json}` 消息 → agent 应调用 `probe_shortlist_ui_action` 落账。

如果卡片不出现：检查 DSH 是否完全重启、浏览器控制台是否有 `dsh-design-kit` 客户端加载错误；退回 `round-1.html` 旧流程。

## 4. 如果失败，优先看这三个

| 现象 | 处理 |
|---|---|
| 10 个工具/技能没出现 | bundles 没加、没完全重启、或 pnpm 安装失败；看 DSH 日志与 profile `node_modules/dsh-design-kit` |
| `deck_check` 找不到 ppt-master | 新会话 cwd 不是 skills 根目录；显式传 `pptMasterDir: "<ppt-master 技能目录>"` |
| Python/渲染器找不到 | 显式传 `pythonPath: "<能 import pptx 的 python.exe>"`；渲染器 `rendererCli: "<DSH 安装目录>/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js"` |

也可以把这些写进 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-design-kit
  name: dsh-design-kit
  config:
    pptMasterDir: "<ppt-master 技能目录>"
    pythonPath: "<能 import pptx 的 python.exe>"
    rendererCli: "<DSH 安装目录>/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js"
```

## 5. 把结果带回来

新会话结束后告诉我：哪几步通过、工具返回的 `ok/exitCode/error`、以及任何中文错误原文。通过后下一步才是把 `deck_*` 写进 README 的「已实测」状态，否则维持当前「底层实测、工具成功路径未验证」的诚实口径。
