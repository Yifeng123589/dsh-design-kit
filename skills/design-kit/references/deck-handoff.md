# PPT 交付：deck_* 工具 + ppt-master 手工兜底

本插件有 3 个 deck 工具：`deck_check`（质检）、`deck_export`（SVG→PPTX）、`deck_render`（PPTX→PDF/PNG）。**内容仍由你写**，工具不生成页面。

> 说明：`projects/career-deck_20261102/` 与 `dist/career-deck/` 是**本工作区**的参考实现，安装到别的 workspace 时不存在；通用步骤以本文件的命令为准。

## 前置条件

| 依赖 | 怎么给 | 默认发现 |
|---|---|---|
| ppt-master 技能目录 | `config.pptMasterDir` / 工具参数 `pptMasterDir` / env `PPT_MASTER_DIR` | 工作区 `_sources/ppt-master-main/.../skills/ppt-master`（以及 `skills/_sources`、上级 `_sources`） |
| Python | `config.pythonPath` / 参数 `pythonPath` / env `DSH_PYTHON` | DSH bundled runtime（`~/.dsh/dsh-runtimes/*/dependencies/python`）→ PATH `python3` / `python` |
| 渲染器（仅 deck_render） | `config.rendererCli` / 参数 `rendererCli` / env `DSO_OFFICE_CLI` | DSH 安装目录里的 `@deepseek-ai/libreoffice-kit` CLI（`dsoffice`）→ PATH |

ppt-master 需要 `scripts/svg_quality_checker.py` 与 `scripts/svg_to_pptx.py`；Python 需要能 import `pptx`（bundled runtime 已带）。可选依赖 PyYAML / skia-pathops / uharfbuzz 只在模板、合并形状、文字轮廓时用到。

## 标准流程

1. **内容**：6–8 页，每页一个论点；真实材料，不编造。参考 `projects/career-deck_20261102` 的 8 页结构。
2. **写 SVG**：1280×720（`ppt169`），根节点带 `data-pptx-page-role="cover|content|ending"`；每页一个语义组，文本用 `<text>` + `<tspan>` 显式换行。
3. **质检**：

```jsonc
deck_check({ "project": "projects/career-deck_20261102" })
// => { ok, summary: { passed, warnings, errors }, errors, reportPath }
```

0 error 才继续；warning 逐条给结论（改掉或说明保留）。

4. **导出**：

```jsonc
deck_export({ "project": "projects/career-deck_20261102" })
// => { ok, pptxPath, bytes, slides, postflight: { status, qualityGate } }
```

内部调用 `deck/export_shim.py`：先 `PPT_MASTER_DIR` 校验、attribution guard，再替换上游 `_create_writable_work_dir`（上游用 `Path.mkdir(mode=0o700)`，在 DSH 沙箱下会 PermissionError），其余导出逻辑保持上游。输出默认进 `<project>/exports/`。

5. **渲染 + 目检**：

```jsonc
deck_render({ "pptx": "projects/career-deck_20261102/exports/xxx.pptx" })
// => { ok, pdfPath, pagesDir, pageCount, images, missingFonts }
```

逐页打开 PNG，查文字溢出/换行/遮挡；`missingFonts` 为空只说明字体没缺，不等于排版正确。PowerPoint/WPS 里的最终效果仍要人确认。

## 沙箱下已知坑

- 上游导出器临时目录不可写 → 已由 `export_shim.py` 修掉；不要绕开 shim 直接跑 `svg_to_pptx.py`。
- 工具子进程在 DSH 沙箱里可能被 `spawnSync EPERM` 挡住（本机验证环境）；真实宿主放开后直接用工具，失败时看返回的中文原因。
- 文字框按测量宽度自动生成，渲染字体更宽时会在行尾换行；短行留余量或拆行。
- 质检的「段落拆成独立 text」只是 advisory；为版式稳定可以接受，但要在交付里说明。

## 手工兜底（工具不可用时）

```bash
PY=<python>
MASTER=<ppt-master skill dir>
"$PY" "$MASTER/scripts/svg_quality_checker.py" <project> \
  --quick-generate --canonical-authoring --stage final --json
PPT_MASTER_DIR="$MASTER" "$PY" skills/design-kit/deck/export_shim.py <project> --quick-generate --no-notes
node <dsoffice-cli> convert --input <pptx> --output <out.pdf>
node <dsoffice-cli> render --input <pptx> --output-dir <pages>
```

产物与工具返回的一致：`pptxPath` / `pdfPath` / `pagesDir` / `missingFonts`。

## 验收门槛

checker 0 error；导出 postflight 通过；渲染 0 缺失字体且逐页目检过。三条都满足才说「PPT 可用」。
