# 独立 QA：deck_check / deck_export / deck_render（C 阶段，task-18）

- 对象：`dsh-design-kit` 的 C 阶段 deck 三件套；只读源码，未改源码/其他文档。
- 环境：Windows、Node v24.19.0、Python 3.14.7；沙箱 `spawnSync` 管道 EPERM。
- 方法：mock/注册、发现逻辑 import 测试、tool.execute 错误路径、在 `%TEMP%` 复制真实 8 页项目后直接跑 checker / `deck/export_shim.py` / dsoffice convert+render，并比对工具解析逻辑、zip 与文档。

## 1. 结论

**PASS WITH FIXES**。无 Blocker。注册/契约、发现逻辑、错误路径、真实 8 页底层链路、checker/export/render 解析、shim 语义均通过；但发现 2 个 Major：

1. **分发包里的 `lib/deck.js` 是旧版**（zip 构建于 disk 最后一次 deck.js 修复之前），缺少 `pagesDir` 的 `uniquePath`，zip 与源码逐字节不一致；
2. **`deck_export` 显式 `out` 会覆盖已存在的用户文件**，而 `SKILL.md:106` 明说“不覆盖用户输出”（实测 sentinel 被覆盖）。

其余为 Minor 文案/边界问题，修完这 2 个 Major 并重建 zip 后可 PASS。

## 2. 检查表

| 检查项 | 证据 | 结果 |
|---|---|---|
| 注册/契约 | mock：1 技能 + 8 工具、名字唯一、`TOOL_NAMES.length=8`、dispose=9；`node --check` 全 0 | 通过 |
| deck 三工具参数 | `deck_check.project` / `deck_export.project` / `deck_render.pptx` 必填；`pptMasterDir/pythonPath/rendererCli/timeoutMs/out/outDir` 可选 | 通过 |
| 发现逻辑 | 本机实际解析：master=`_sources/ppt-master-main/.../skills/ppt-master`；python 首候选 `dsh-primary-runtime/.../python.exe`；renderer 首候选 DSH 安装目录的 libreoffice-kit `cli.js`；显式/环境变量优先级实测正确 | 通过 |
| 错误路径 | 缺 project/pptx → 中文错误；无 master → 中文错误；EPERM 时 deck_check/export 返回“没有可用 Python…spawnSync … EPERM；若沙箱…”；deck_render convert 启动失败返回“LibreOffice Kit 渲染器启动失败…可能被沙箱拒绝…”，均不抛异常 | 通过（见 Minor 1/2） |
| checker 底层实测 | `%TEMP%` 项目 8 个 SVG，checker exit 0；`summary={total:8,passed:4,warnings:4,errors:0}`；报告写到 `validation/svg_quality_report.json`；8 个文件 `files[].errors` 均为数组，`summarizeCheckerReport` 返回 0 错误 | 通过 |
| deck_check 解析 | 实际报告结构 top-level `summary/files/...`，`summary.errors=0`，`errors=[]`；与代码读取路径/字段匹配 | 通过 |
| export shim 底层实测 | `PPT_MASTER_DIR=master python deck/export_shim.py <project> --quick-generate --no-notes -o <tmp>/deck-test.pptx` exit 0；PPTX 36097 B；`Slides: 8`；`[POSTFLIGHT] status=passed-with-warnings quality_gate=passed`；attribution guard 正常执行；只替换上游 `_create_writable_work_dir` | 通过 |
| export 解析 | `[PPTX]\s+(.+\.pptx)$`、`Slides:\s*(\d+)`、`[POSTFLIGHT] status=... quality_gate=...` 对真实输出全部匹配；默认输出为时间戳文件 `project_20261104_111058.pptx`，不覆盖旧导出 | 通过 |
| render 底层实测 | `dsoffice convert` exit0，PDF 531273 B，JSON `missingFonts=[]`；`dsoffice render` exit0，8 张 PNG，JSON `pageCount=8/images=8/missingFonts=[]` | 通过 |
| render 解析 | 真实 JSON 字段 `backend/pageCount/images/missingFonts` 与代码读取一致；convert/render 两份 JSON 合并后 missingFonts 为空 | 通过 |
| outDir/out 安全 | 源 `deck_render` 用 `uniquePath` 生成 PDF 和 pages 目录；默认导出安全；但 `deck_export` 显式 `out` 无 uniquePath，实测覆盖 sentinel（见 Major 2） | **部分通过** |
| zip 包内容 | 81 条、366492 B；含 `lib/deck.js`、`skills/design-kit/deck/export_shim.py`、更新后 SKILL/README/cordis；无 `test/qa-*`、无 `.tmp`/反斜杠；前缀正确 | 通过（但 deck.js 版本见 Major 1） |
| 文档数字 | 根 README：8 工具、16/16、81 条、358 KB；插件 README：8 工具、16 项、81 条/358 KB；实测 mock 16/16、zip 81/366492 B（≈357.9 KiB） | 通过 |
| 文档过时表述 | 根/插件 README 无“PPT 暂无工具/手工交接”；SKILL D 已改成 deck 工具；但仍有旧“五个工具/零依赖”文案与错误“不覆盖”声明（见 Minor 3/Major 2） | 部分通过 |

## 3. 问题（按严重度）

### Major

**M1 分发包的 `lib/deck.js` 不是当前源码，缺少 `pagesDir` 的 uniquePath**
- 位置：`dist/dsh-design-kit-v0.1.0.zip` 内 `dsh-design-kit/lib/deck.js`（zip 18876 B） vs 磁盘 `dsh-design-kit/lib/deck.js`（18886 B）；zip mtime `11:07:32`，磁盘 mtime `11:07:39`。
- 差异：zip 里 `const pagesDir = join(outDir, base + '-pages');`；磁盘已改为 `uniquePath(outDir, base + '-pages', '')`（`lib/deck.js:422`）。
- 复现：Python 逐条比较 zip↔disk → `content_mismatch=['dsh-design-kit/lib/deck.js']`；diff 仅上述一行。
- 影响：安装 zip 的用户拿到旧的 `deck_render`；若 outDir 已有 `<base>-pages`，dsoffice render 会以 EEXIST 失败（我们手工预建 pages 目录时实际得到 EEXIST），源码的“不覆盖用户目录”修复没有交付。根 README 的 81 条/358 KB 描述的是这个旧 zip，不是当前源码。
- 修复：在 deck.js 最终修改后重建 zip（并回归核对 SHA）；如 zip 大小变化同步 README。

**M2 `deck_export` 显式 `out` 覆盖已存在用户文件；SKILL 却写“不覆盖用户输出”**
- 位置：`lib/deck.js:334-337`：`out = resolvePath(args?.out, cwd)` 后直接 `cli.push('-o', out)`，没有 uniquePath/存在性检查；`skills/design-kit/SKILL.md:106` 写“deck_export … 不覆盖用户输出”。
- 复现：在 temp 项目 `%TEMP%/.../export-out/deck-sentinel.pptx` 写入 20 B `SENTINEL-USER-FILE`；执行 `python deck/export_shim.py <temp-project> --quick-generate --no-notes -o deck-sentinel.pptx` → exit 0，文件变为 36097 B PPTX，sentinel 消失。`deck_export` 工具路径完全相同（代码只透传 out）。
- 影响：用户显式指定已存在路径时静默丢失原文件，与 SKILL 声明矛盾；默认 `<project>/exports/` 是时间戳文件，暂不覆盖，但显式 out 是文档承诺过的参数。
- 修复：`out` 也走 `uniquePath`（或已存在时返回中文错误/要求 force），并补一条底层 overwrite 测试；同步修正 SKILL/README 语义。

### Minor

- `deck_render` 的 render 步骤失败缺少 `error`：`lib/deck.js:423-433` 只在 convert `spawnError` 时返回中文错误（`:403-409`）；若 convert 成功而 render spawn 失败/非 0，返回 `ok:false + images:[] + stderr`，没有中文 error/hint。建议对 `render.spawnError`/`render.exitCode!==0` 补错误。
- `deck_check`/`deck_export` 的 EPERM 提示首句是“没有可用的 Python”（`lib/deck.js:267,344`），虽然后缀有“spawnSync 可能被 EPERM 拒绝”，但“没有可用”容易被读成未安装；建议首句改为“Python 启动失败（可能被沙箱拒绝）”。`deck_render` convert 的提示已经是“渲染器启动失败”，更准确。
- 旧文案：`dsh-design-kit/README.md:106` 仍写“五个工具都是零依赖 Node 脚本”；`package.json:4` 仍写“5 个零依赖工具”；`lib/index.js:5-8` 仍写“5 个工具 / 出 PPT 交接”。与 8 工具、deck 依赖 Python/dsoffice 不一致。
- `resolveRenderer` 若显式 `rendererCli` 指向已存在的原生可执行文件，代码按 Node CLI 处理（`lib/deck.js:111-113`，返回 `process.execPath + [value]`）；文档最好注明该参数指 libreoffice-kit 的 `cli.js`，或按扩展名区分。
- zip 仍含 dev 文件 `test/apply.mock.mjs` 和 `sync-kit.mjs`（无 `test/qa-*`，这是任务允许的过滤边界）；若要做纯运行时分发包可再过滤。
- 根 README:242 / 插件 README:8 的 QA 状态仍是 task-17 三轮（未纳入 task-18），发布前可补一条最终结论；不是功能问题。

## 4. 未验证项

- 真实 DSH 宿主 `pnpm add` / 工具真实子进程成功路径：沙箱 `spawnSync` EPERM，仅底层命令与错误路径实测；`deck_export`/`deck_render` 的 tool.execute 成功路径未跑。
- `deck_render` 的 render 步骤失败（convert 成功后 render 失败）无法在 EPERM 沙箱中构造，仅代码审查。
- zip 重建后的实际字节数/条目（当前核对的是旧 zip）；未解压安装测试。
- PowerPoint/WPS 中逐页排版目检；只验证了 PPTX 存在、8 页、PDF+8 PNG、missingFonts 空。
- `deck_export` 的默认输出/显式 out 不同文件名策略未覆盖所有上游命名分支。

## 5. 实际执行命令与结果

| 命令 | 结果 |
|---|---|
| `node --check lib/index.js lib/tools.js lib/skill.js lib/deck.js test/apply.mock.mjs` | 全部 exit 0 |
| `node test/apply.mock.mjs` | 16/16，exit 0（含 8 工具/唯一名/dispose=9/发现/checker 收敛/deck 参数校验） |
| `node --input-type=module` 运行 `resolvePptMasterDir/pythonCandidates/resolveRenderer/buildDeckTools` | 实际解析出真实 master、DSH runtime Python、DSH 安装目录 dsoffice CLI；显式/环境变量优先级正确 |
| `deck_check/deck_export/deck_render.execute` 错误路径 | 缺参数/无 master/EPERM 均返回中文且不抛；deck_render 提示“渲染器启动失败…可能被沙箱拒绝” |
| checker（真实 8 页项目的 `%TEMP%` 副本） | exit 0；8 个 SVG；`passed=4 warnings=4 errors=0`；报告 JSON 实际生成 |
| export shim（真实 8 页，temp out） | exit0；PPTX 36097 B；8 slides；postflight passed-with-warnings/quality_gate=passed；默认导出时间戳文件名 |
| export 显式 out 覆盖 sentinel | sentinel 20 B → 36097 B PPTX，exit0（M2 证据） |
| dsoffice convert | exit0；PDF 531273 B；`missingFonts=[]` |
| dsoffice render（目录不存在时） | exit0；8 PNG；`pageCount=8 images=8 missingFonts=[]`；预建 pages 目录时上游报 EEXIST（说明 uniquePath 必要） |
| 解析对照 | `[PPTX]`/`Slides:`/`[POSTFLIGHT]` 与 checker summary/files[].errors 对真实输出全部匹配 |
| Python zip 核对 | 81 条/366492 B；含 deck.js+shim+SKILL/README；无 QA、无 `.tmp`；`content_mismatch` 仅 `lib/deck.js`；磁盘多出 3 个 QA 报告（被过滤） |
| 文档核对 | 根/插件 README 8 工具、16/16、81 条、358 KB 与实测一致；发现旧“五个工具/零依赖”文案与 SKILL 不覆盖声明 |

临时项目/导出/渲染均位于 `%TEMP%/dsh-qa-deck-task18`，已清理；未跑 `node --test`，未改源码。

## 6. 最终结论

**PASS WITH FIXES**。无 Blocker；核心链路与解析通过。发布前必须：重建 zip（当前 zip 的 `lib/deck.js` 是旧版，缺少 pagesDir uniquePath），以及修复 `deck_export` 显式 `out` 覆盖（与 SKILL 承诺一致）；Minor 文案/错误提示可一并处理。
