# 安装 dsh-design-kit

适用：DSH 0.2.1-rc.5（Web GUI + 插件系统），Windows / macOS / Linux。

安装物只有 **runtime**；`fixtures` / `docs` 是复核材料，不要装进 DSH。

## 方式 A：GitHub Release 的 runtime zip（推荐）

1. 打开 GitHub 仓库 Releases，下载 `dsh-design-kit-runtime-v<version>.zip`。
2. 解压得到 `dsh-design-kit/` 目录。
3. 把目录放到本机任意位置（建议 `~/dsh-plugins/dsh-design-kit`）。
4. 在 DSH 插件管理器里「添加插件」→「本地目录」→ 选择该目录；或手动安装：

```powershell
cd <DSH profile 目录>        # 例如 %USERPROFILE%\.dsh\profiles\desktop
pnpm add "<解压后的 dsh-design-kit 目录>"
```

5. 在 profile 的 `package.json` 的 `dsh.profile.bundles` 数组里加入 `"dsh-design-kit"`。
6. **完全退出 DSH 再启动**，不要只开新会话。

## 方式 B：Git 仓库地址

在 DSH 插件管理器里「添加插件」输入：

```text
https://github.com/Yifeng123589/dsh-design-kit
```

插件管理器会按 Git 仓库安装；如果界面只接受 npm 包名/本地目录，用方式 A 或方式 C。

## 方式 C：本地 clone 开发

```bash
git clone https://github.com/Yifeng123589/dsh-design-kit.git
cd dsh-design-kit
npm test          # 零依赖，不需要 pnpm install
```

然后把该目录作为本地插件安装（同方式 A 第 4 步）。

## 安装后确认

- 技能列表出现 `design-kit`（一个入口，不再是 `ui-craft` + `probe-kit` 两个）。
- 工具列表出现 10 个：`design_lint` / `design_tokens` / `design_capture` / `probe_shortlist` / `probe_shortlist_preview` / `probe_shortlist_ui_action` / `probe_measure` / `deck_check` / `deck_export` / `deck_render`。
- DSH 日志应有注册汇总：技能 1/1、工具 10/10。
- Web 端粗选卡片：先 `probe_shortlist add`，再 `probe_shortlist_preview`，对话里应出现三栏 iframe。

## 配置（可选）

在 profile 的插件 config 或环境变量里：

```yaml
- id: dsh-design-kit
  config:
    pptMasterDir: "<ppt-master 技能目录>"
    pythonPath: "<能 import pptx 的 python.exe>"
    rendererCli: "<DSH 安装目录>/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js"
```

- 只有 deck 工具需要这些；不配时会按配置/环境/常见布局自动发现，找不到返回结构化 `missing[]`。
- `design_capture` 需要真实浏览器；没有时降级为 `contact-sheet.html`，不假装截图成功。

## 更新 / 卸载

- 更新：卸载旧插件后安装新版本 runtime；或 `pnpm add <新目录>` 并重启。
- 卸载：插件管理器卸载，或从 profile `package.json` 的 `dsh.profile.bundles` 移除并重启。
- 不要同时安装 `dsh-ui-craft` / `dsh-probe-kit`，同名工具会重复注册。

## 常见问题

| 现象 | 处理 |
|---|---|
| 技能/工具都没出现 | 检查 profile `bundles`、是否完全重启、DSH 日志是否有 bundle 跳过 |
| 工具缺一部分 | 看日志「注册完成：工具 n/10」；核心工具失败会让插件 fatal，deck 失败是 degraded |
| `package.json` 被改出 BOM | 用 UTF-8 无 BOM 保存；BOM 会导致整个 bundle 被 loader 跳过 |
| 相对路径跑到别处 | 本插件按会话工作目录解析；路径越界会返回中文错误 |
| 三栏卡片不出现 | 确认 Web GUI、客户端入口已加载、DSH 已完全重启；旧宿主退回 round 页面流程 |
