# dsh-design-kit

统一设计交付插件。把原来的 `dsh-ui-craft`（造界面）与 `dsh-probe-kit`（选方向 / 调参数）合成**一个技能入口 + `/dkit` 命令 + 10 个工具**，装一次就能覆盖从「定方向」到「验收界面」、再到「质检/导出/渲染 PPTX」的整条设计交付链路。

- 版本：`0.1.10`
- 技能：`design-kit`（1 个）
- 命令：`/dkit`（1 个），把对话转成 design-kit 流程；可带需求
- 工具：`design_tokens` / `design_lint` / `design_capture` / `probe_shortlist` / `probe_shortlist_preview` / `probe_shortlist_ui_action` / `probe_measure` / `deck_check` / `deck_export` / `deck_render`
- 客户端：DSH Web 端会把 `probe_shortlist_preview` 直接渲染成**对话内三栏 iframe 预览**，选择后自动发回结构化动作；删除/“都不行”可补自定义理由
- 当前证据：**真实 DSH 0.2.1-rc.5 验收 A–E 全通过**（design_lint 100 分、deck_check 0 error、deck_export 8 页、deck_render 8 PNG + missingFonts=[]、防覆盖生效）；mock 34/34、包内 smoke 11/11、包内 regression 10/10、axis-lock 5/5、UI↔CLI 契约 5/5；四轮独立 QA 无 Blocker

---

## 1. 它能做什么

先看一张判断表：

| 你说的话 | 它走哪条 | 产物 |
|---|---|---|
| 「做个落地页 / 改这个界面 / 审一下有没有 AI 味」 | **UI 交付** | 设计方向 + tokens + 页面 + lint 报告 + 审阅材料 + DESIGN.md |
| 「三个方向选一个 / 风格对比 / 都差点意思」 | **粗选** | 每轮 3 个候选的删除/待定页、终选页、`result.json` 或 `capability-gap.json` |
| 「这个红再收一点 / 字号用 16 还是 18 / 间距调大点」 | **精调** | 单轴盲测页、台账、`calibration.json` + JND 等效区间 |
| 「做成 PPT / 演示文稿 / 汇报稿」 | **PPT 交付** | `deck_check` / `deck_export` / `deck_render`：质检 → PPTX → PDF/PNG |

它**不是**：后端/纯数据脚本工具；不是「一句话出图」的生成器；不替代浏览器目检、真人评审或 PowerPoint 里的最终排版确认。

### UI 交付能具体到什么程度

- 从「一句话需求」推到可评审的界面：方向契约（THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM / FINISH）、设计 token、首屏、真实内容、状态与响应式。
- 量化验收：`design_lint` 检查 AI 味、对比度、字号/行宽、可访问性、中文排版；`design_capture` 做 390/768/1440 多宽度截图。
- 不能截图时**不假装看过**：生成 `contact-sheet.html` 审阅页，并明确告诉你「没看到渲染」。
- 可用真实案例（本工作区）：`demo/career-plan/index.html` —— `design_lint` **100/100**，A4 打印、零外部依赖。

### 粗选能具体到什么程度

- 每轮 3 个**彼此有关系**的候选，不盲比：
  - `lineage`：同族不同派（例：油画传统下印象派 / 写实派 / 表现派）；
  - `contrast`：同一对比轴 low / mid / high，且跨至少 2 个族（例：装饰密度极简 ↔ 繁复、影像参与度无图 ↔ 影像主导）。
- 工作台流水线：池最多 12，窗只亮 3。删除或路过就补位，整页短名单最多 3，不必每轮待定。喜欢 / save-trait 进 sidecar，已删候选仍可留下特征。
- 旧轮次页仍是「删除」（必须带理由）或「待定」（每轮最多 1 个）；待定满 3 进入三选一。
- 硬上限 **4 轮 × 3 = 12 个**，`brief.cap` 不能放宽。终选要有至少 1 张短名单，或声明底稿且特征袋至少 1 条。用尽或「都不行」→ 按理由归因到 `capability / brief / taste / no-preference` 并给路由。
- 候选 HTML 有 `pageSha` 防篡改；同轮 HTML 必须互不相同。

### 精调能具体到什么程度

- 一次只变一个轴，盲呈现、不显示数值，记录指认与置信度。
- 内置三条轴：`r4` 强调色饱和度（JND 5%，真实标定）、`r5` 正文基准字号（JND 1px 估算）、`r6` 页面纵向节奏（JND 6px 估算）。
- 结论写**等效区间 + 默认值**，不写精确值；区间宽 ≥ `4×JND` 才允许插值细分。
- V0.2 闸门：轴副作用代理、凭证三态（`axis` / `exploration` / `unverified`）、`apply --strict`、项目授权 `spectrum_only`。

---

## 2. 怎么安装

在 DSH profile 目录（例如 `~/.dsh/profiles/desktop`）：

```bash
pnpm add ../path/to/dsh-design-kit
```

然后在 profile 的 `package.json` 的 `dsh.profile.bundles` 里加入：

```json
"dsh-design-kit"
```

重启 DSH。装好后会同时出现技能 `design-kit`、`/dkit` 命令与 10 个工具。

> **A11 vendored 快照说明**：本包是 vendored 快照——`skills/design-kit/` 下除手写区外的 `ui-craft` / `probe-kit` 实现由维护者在源码仓库同步后打包，`.sync-manifest.json` 记录计数。**分发包不含 `sync-kit.mjs`，只拿 zip 无法重新 sync**；要更新实现请在源码仓库改 `ui-craft/` / `probe-kit/` 后重新同步并跑测试。手写区：`SKILL.md`、`references/deck-handoff.md`、`deck/export_shim.py`。

### 从旧插件迁移

- 工具名不变：旧提示词里直接调 `design_lint` / `probe_shortlist` 等仍然可用。
- **技能名变了**：`ui-craft` + `probe-kit` → `design-kit`。旧提示词如果点名旧技能，改成 `design-kit` 或直接描述任务。
- **不要再同时装** `dsh-ui-craft` 与 `dsh-probe-kit`，否则同名工具重复注册。

### 真实宿主兼容（DSH 0.2.1-rc.5）

首次真实加载时抓到并修掉 3 个问题，都已进包：

- **`package.json` 不能带 UTF-8 BOM**：DSH loader 的 `JSON.parse` 会报错并**静默跳过整个 bundle**（技能和工具都不出现）。
- **工具必须带 `output: { schema, render }`**：0.2.x 的 `ToolRuntime.register()` 会校验，缺了抛 `TypeError`；插件里的“注册失败只告警”会把它吞掉。统一在 `lib/tool-output.js` 补齐。
- **相对路径按会话 cwd 解析**：宿主进程 cwd 是 profile 目录，不是会话工作目录；用 `lib/cwd.js` 优先读 `workingDirectory` 服务（`inject` 已加 `workingDirectory`）。

### 可选配置

```yaml
- id: dsh-design-kit
  config:
    designTimeoutMs: 30000   # design_* 超时，默认 30s（1s–120s）
    probeTimeoutMs: 120000   # probe_* 超时，默认 120s（1s–300s）
    deckTimeoutMs: 180000    # deck_* 超时，默认 180s（5s–600s）
    timeoutMs: 30000         # 旧配置兼容：同时兜底 design/probe，各自再钳制
    ledgerPath: ""           # 探针台账；默认 <会话 cwd>/probe-kit-ledger/ledger.jsonl
    pptMasterDir: ""         # deck_*：ppt-master 技能目录；默认按工作区/环境发现
    pythonPath: ""           # deck_*：Python；默认 DSH runtime → PATH
    rendererCli: ""          # deck_render：dsoffice CLI；默认 DSH 安装目录 → PATH
```

---

## 3. 怎么用

### 方式 A：直接说任务（推荐）

技能描述覆盖了四类任务的关键词，通常会**自动命中** `design-kit`；也可以显式点名：

```text
用 design-kit 给「呼吸科排班冲突看板」做一个产品界面，操作模式，先别写代码。
用 design-kit 帮我在三个方向里选：印刷感 / 手作感 / 数据仪表，每轮 3 个。
用 design-kit 把强调色饱和度从 50% 往下调一档，盲测，别告诉我数值。
用 design-kit 把这份生涯规划做成 8 页 PPT。
```

它会先判断走哪条，再按对应流程读技能里的参考、调工具；不会把粗选、精调、UI 构建混在一次回答里。

### 方式 B：直接调工具

前 5 个工具 + 2 个粗选 UI 工具（preview/action）是 Node 脚本；3 个 deck 工具需要 Python / ppt-master / LibreOffice Kit（见 §4.4）。参数校验失败都返回中文错误、不抛异常。

```jsonc
// 生成设计 token（OKLCH 色板 + 字阶 + 间距 + 对比度自检）
design_tokens({ "outDir": "tokens", "name": "career-plan", "hue": 18, "mood": "editorial", "mode": "both" })

// 静态审查：有 error 时退出码 1，属正常结果
design_lint({ "target": "index.html" })
design_lint({ "target": "src/", "minSeverity": "warn" })

// 多宽度截图；无浏览器时返回 unavailable=true + contact-sheet.html
design_capture({ "target": "index.html", "outDir": ".review", "widths": "390,768,1440" })
```

```jsonc
// 粗选：init → add → decide → final
probe_shortlist({ "command": "init", "brief": "brief.json" })
probe_shortlist({ "command": "add", "run": "shortlist-runs/<runId>", "candidates": "r1.json", "contextToken": "fresh-a" })
probe_shortlist({ "command": "decide", "run": "shortlist-runs/<runId>", "round": 1, "decisions": "decisions-<runId>-r1.jsonl" })
probe_shortlist({ "command": "final", "run": "shortlist-runs/<runId>", "choice": "choice-<runId>.jsonl" })
probe_shortlist({ "command": "report", "run": "shortlist-runs/<runId>" })

// 对话内三栏预览（DSH Web 客户端渲染）与动作落账
probe_shortlist_preview({ "run": "shortlist-runs/<runId>" })
probe_shortlist_ui_action({ "payload": "<卡片消息 [probe-shortlist-ui] 后面的 JSON>" })

// 精调：demo 起一个回合；其余参数放 args 透传
probe_measure({ "command": "demo", "args": ["--axis", "r5"] })
probe_measure({ "command": "build", "args": ["--from-run", "runs/<runId>", "--between", "1,2"] })
probe_measure({ "command": "review", "args": ["--run", "runs/<runId>"] })
probe_measure({ "command": "apply", "args": ["--run", "runs/<runId>", "--out", "calibration.json", "--strict"] })
```

```jsonc
// PPT：质检 → 导出 → 渲染（需要 ppt-master + Python；render 还需要 dsoffice）
deck_check({ "project": "projects/career-deck_20261102" })
deck_export({ "project": "projects/career-deck_20261102" })
deck_render({ "pptx": "projects/career-deck_20261102/exports/xxx.pptx" })
```

---

## 4. 四类任务怎么走

### 4.1 UI 交付：五步，三个门

1. **定世界**：先读现有 `DESIGN.md` / tokens / 页面；问 2–3 个会改变结果的问题；写一句机制 + 方向契约六字段；收敛 1 主 2 备。
   - **门**：用户选定方向，或用户授权你定且你说明依据。
2. **定系统**：先生成 tokens，再按世界改性格；页面里不出现没有出处的颜色/字号/间距。
   - **门**：`tokens.css` 落地 + 对比度自检全绿。
3. **构建**：首屏是论点；真实文案；状态/交互一起写；一个作者时刻；390 到 1440 都成立。
   - **门**：真实文案 + 真实断点不溢出。
4. **审阅**：`design_lint` 修完所有 error、warn 逐条给结论；`design_capture` 能截图就逐张看，`CAPTURE_UNAVAILABLE` 就交 `contact-sheet.html` 并声明未看。
   - **门**：无 error；每条 warn 有结论；没看的明确说。
5. **交付**：写 `DESIGN.md`（模板在 `skills/design-kit/ui-craft/templates/DESIGN.md`）+ 交付说明（方向、关键 token、已知限制、下一步）。
   - **门**：有 DESIGN.md 或交付说明。

完整方法、12 条硬法则与失败模式：`skills/design-kit/ui-craft/METHOD.md` 与其 `references/`（world / type / color / layout / motion / states / copy / audit / design-system 等）。

### 4.2 粗选：有关系的 3 个，删或待定

候选必须先 `generate` 再 `add`。没有候选文件时不要说已经有三个方向，也不要手写三份 HTML。brief 收成一份内容槽（可写在 `content` 里；省略则按 title / prompt 确定性截取），三页共用。默认把这槽填进三张结构不同的骨架，再套世界的颜色和字体；`writer: "worlds"` 才回到 12 张世界卡。自由生成模式 B 未做。

`add` 会拒绝：没有关系、内容槽不一致、HTML 相同、或带外链。先写 brief（只有 `title` / `prompt` 必填；`cap` 固定 12，填了也不能放宽）：

```jsonc
// brief.json
{ "title": "山径书店官网", "prompt": "做一个独立书店的品牌首页，读者是 25–35 岁城市人群。" }
```

```jsonc
// lineage：同族不同派
{ "relation": "lineage", "family": "oil-painting",
  "candidates": [
    { "id": "oil-impression", "world": { "family": "oil-painting", "variant": "印象派", "material": "…", "type": "…", "layout": "…", "color": "…" }, "html": "<!doctype html>…" }
  ] }

// contrast：同轴 low / mid / high，且跨 ≥2 个 family
{ "relation": "contrast", "axis": "ornament",
  "candidates": [
    { "id": "calm", "world": { "family": "print-tradition", "variant": "理性网格", "contrast": { "ornament": "low" }, "material": "…", "type": "…", "layout": "…", "color": "…" }, "html": "…" }
  ] }
```

流程（推荐，对话内完成；A3 一次性令牌）：`init` 建回合 → `generate`（可 `add: true`）→ `probe_shortlist_preview` 在对话里起三栏 iframe → 用户点删除/待定（或终选）→ 卡片自动发回 `[probe-shortlist-ui] {json}`（含一次性 `uiToken`，绑定 run/轮次/候选，30 分钟过期、用一次失效）→ agent 调 `probe_shortlist_ui_action` 落账 → 下一轮再 `generate` 或终选。令牌按卡片分别存放在 `run/.ui-tokens/`，重复 preview 不会覆盖旧卡片；只消费当前卡片令牌。令牌缺失/伪造/过期/轮次不符会被拒收；被拒就重新 preview，不要手写令牌。`generate` 本身不写 decide、不写台账。

兼容旧流程：打开工具返回的轮次页，删除/待定后下载 `decisions-*.jsonl` → `decide`；待定满 3 开终选页 → `final`。两条路落同一套台账，不要同时用。

硬规则（工具强制，不要绕）：

- 工作台：`pool` 预生成最多 12，窗只显示 3。删除或路过就补位，不必先待定；整页短名单最多 3。`likes.json` 记 likes / traits / shortlist。下一轮 `generate` 读取特征袋，不改 HTML。
- 旧 `decide` 仍是每轮恰好 3 个候选、最多待定 1 个；删除必须带理由 chip。未 decide 上一轮不能 `add` 下一轮；已有池时不要再 add。
- 上限固定 12 个。final：短名单 ≥ 1，或声明底稿且特征袋 ≥ 1。特征袋空且无短名单则拒绝。
- final 前自动完整性校验；同轮 HTML 互不相同；`pageSha` 防篡改。

12 个用尽或「都不行」→ 按理由 tag 统计（阈值 40%）做**弱先验归因**（chip 是用户自我报告，不是证明；capability 还要看 `capability-gap.evidence` 的页面事实核查）：

| 归因 | 路由 |
|---|---|
| `capability` | 换能力：加载/安装具备缺失能力的 skill 或插件 |
| `brief` | 回提问：补 project_type / target_audience / 约束 |
| `no-preference` | 接受默认值，记录负结论 |
| `taste` | 扩大世界候选：换材料家族 |

归因写入 `capability-gap.json`，负结论有 1 年硬有效期，到期前不要重复烧候选。

### 4.3 精调：单轴 + JND + 凭证

流程：`demo` / `build` 生成盲测页 → 用户指认 → 下载 `answer.jsonl` → `append` 落账 → `review` 看凭证 → 需要时 `attribute` 写四字段、`apply` 写校准。

- 三条轴：`r4` 颜色（JND 5%）、`r5` 字号（JND 1px 估算）、`r6` 间距（JND 6px 估算）。
- 结论是区间与默认值，不是排序依据；`build --between` 要求区间宽 ≥ 4×JND，否则拒绝细分。
- **凭证三态**：`axis`（副作用在界内 + 收敛证据，唯一可插值）> `exploration`（只有频谱证据）> `unverified`（没有通过的代理）；`--strict` 只允许 axis 写校准。
- **轴副作用闸门**：颜色轴查色相/明度/对比度漂移与色度单调；字号/间距轴查占位符声明位与已知耦合。越界拒绝生成，不许绕。
- **项目授权**：`--context-file` 可带 `authorization: { "question": "…", "scope": "spectrum_only" }`；只回答值不值得花预算，不证明轴成立、不开放插值。
- 归因必须写四字段：`--assumption` / `--falsified-by` / `--boundary` / `--confidence`。

完整口径见 `skills/design-kit/references/probe-kit-method.md` 与 `skills/design-kit/probe-kit/PROTOCOL-V0.2.md`。

### 4.4 PPT：deck_* 工具（质检 → 导出 → 渲染）

工具负责链路，**内容仍然由你写**；它不生成页面。

1. 每页一个论点，6–8 页；材料真实、不编造。
2. 写 SVG（1280×720，`data-pptx-page-role`）。
3. `deck_check({ project })`：跑 `svg_quality_checker.py --quick-generate --canonical-authoring --stage final --json`，返回 `summary { passed, warnings, errors }`；**0 error 才继续**。
4. `deck_export({ project })`：调用随包的 `deck/export_shim.py`（修掉上游在 DSH 沙箱下临时目录不可写的问题，其余导出逻辑保持上游），返回 `pptxPath / bytes / slides / postflight`。
5. `deck_render({ pptx })`：用 DSH 自带的 LibreOffice Kit（`dsoffice`）输出 PDF + 逐页 PNG + `missingFonts`；**逐页看 PNG**，没看就不说「已检查」。

前置依赖：

| 依赖 | 怎么给 | 默认发现 |
|---|---|---|
| ppt-master 技能目录 | `config.pptMasterDir` / 参数 / env `PPT_MASTER_DIR` / `PPT_MASTER_SKILL_DIR` | 工作区/祖先目录的 `skills/ppt-master`，或 `_sources/<任意解压名>/.../skills/ppt-master`；显式配置无效直接报错，不偷偷换目录 |
| Python | `config.pythonPath` / env `DSH_PYTHON` | DSH bundled runtime → PATH |
| 渲染器 | `config.rendererCli` / 参数 / env `DSO_OFFICE_CLI` | DSH 安装目录的 libreoffice-kit `lib/cli.js` → PATH `dsoffice` |

`rendererCli` 指 libreoffice-kit 的 `lib/cli.js`（用当前 Node 运行），不是原生 exe；若给 PATH 命令则直接调用。

找不到依赖时工具返回中文原因；这时按 `skills/design-kit/references/deck-handoff.md` 的手工兜底继续，不假装工具成功。

---

## 5. 产物与默认路径

| 产物 | 默认位置 |
|---|---|
| 粗选回合 | `<会话 cwd>/shortlist-runs/<runId>/` |
| 精调回合 | `<会话 cwd>/runs/<runId>/` |
| 探针台账 | `<会话 cwd>/probe-kit-ledger/ledger.jsonl`（append-only，别手改） |
| design token | 你传的 `outDir/`（`tokens.css` / `tokens.json` / `tokens-preview.html`） |
| 审阅截图/降级页 | 你传的 `outDir/`（PNG + `report.json`，或 `contact-sheet.html`） |
| deck 质检报告 | `<project>/validation/svg_quality_report.json` |
| deck 导出 PPTX | 默认 `<project>/exports/`，或参数 `out` |
| deck 渲染 | 默认 `<会话 cwd>/deck-render/`（PDF + `*-pages/` + PNG） |

`design_lint` 返回 `findings / counts / score / scanned`；有 error 时退出码 1，这是正常结果不是工具崩溃。`probe_*` 的 exit 1/2 是规则拒绝或参数错误，看返回里的中文原因。

---

## 6. 边界与已知限制

- **deck_* 依赖外部环境**：需要 ppt-master 技能目录、能 import `pptx` 的 Python；渲染还需要 DSH 自带 LibreOffice Kit。找不到时工具返回中文原因，不兜底成假成功。
- **B2 薄状态机**：会话 cwd 的 `.design-kit-state.json` 记录阶段；粗选未 `final` 时 `probe_measure` 直接拒绝（`status` / `review` / `verify` 查看类放行），final 后才允许精调。
- **B6 注册失败分级**：核心工具（lint / shortlist / measure / preview / action）失败 = `fatal` 抛错；deck 等可选能力失败 = `degraded` 告警降级，不再全有或全无。
- **B4 deck 发现去硬编码**：不再写死 `_sources/ppt-master-main/ppt-master-main`；按「显式配置 → 标准 env → 工作区/祖先目录常见布局」发现任意解压名。Python 增加 `PYTHON`、`runtimes/`；渲染器增加 `DSH_APP_ROOT` / `DSH_RESOURCES_DIR` / `DSH_LIBREOFFICE_KIT_CLI`。
- **B5 preview 载荷瘦身**：三份候选 HTML 改为 gzip+base64（`htmlGzip`），客户端用 `DecompressionStream` 解压；本机实测 25.7KB → 11.4KB（约 44%），不再把原始 HTML 塞进工具结果。
- **B9 chip 归因弱先验**：删除理由 chip 明确为自我报告弱先验、不是证明；`capability-gap` 增加 `reasonSignal: self-report` 与 `evidenceStrength`，capability 路由要求先看页面事实核查（corroborated）。
- **B10 发布物矩阵**：runtime（59 文件 / 约 323 KB，不含 test/证据/QA）/ fixtures（约 55 KB）/ docs（约 99 KB）；`dist/RELEASE-README.md` + `SHA256SUMS.txt` 记录矩阵和哈希；npm tarball 是运行时 + 文档，不含 test/证据/QA。
- **A6 启动健康检查**：`apply()` 汇总「技能 x/1、工具 n/10、缺失清单」；正常写 info，异常写 warn 汇总，并暴露 `getRegistrationHealth()` / `ctx.designKitHealth`。
- **A7 JSON 输出契约**：`design-lint --json` 输出 `__DESIGN_KIT_JSON__` 标记行；`parseJsonOutput` 只认标记行或最后一行纯 JSON，不再从首个 `{` 切到末尾 `}`。
- **A8 UI↔CLI 契约测试**：`test/shortlist-ui-contract.test.mjs` 锁 preview → persistAction → `shortlist-decisions/1` / `shortlist-choice/1` 字段，并对比 UI 与 CLI 的 reason chips（实际抓出并修复缺失的 `no-preference`）。
- **A9 deck 依赖缺口**：`deck_check` / `deck_export` / `deck_render` 缺 ppt-master / Python / LibreOffice 时返回结构化 `missing[{kind,hint,configKey,env}]`。
- **A4 锁验证（不做 AST，按约定口径）**：`build --from-run` 前先 `verifyRun` 父回合；`run.json` 的轴声明（dim/kind/unit/min/max/jnd/placeholder/sideEffectKind）与当前登记轴比对不一致就拒收；未知/伪造轴、越界值拒收；旧清单缺新增字段仍兼容；`--strict` 仍只放行 axis 凭证。
- **安装包不带原始证据仓（A5）**：`ledger/` 与 `runs-real/` 不再进运行时包；回归所需真实回合在 `test/fixtures/real-runs/runs-real/`，原始台账/回合只保留在源码仓库。
- **异步执行（A2）**：所有工具 `execute` 返回 Promise，长任务用 async spawn；超时配置见 §2，超时会杀直接子进程并返回 `timedOut:true`；没有中途取消 API，超时后需重跑。
- **路径牢笼（A1）**：`design_*` / `probe_*` / `deck_*` 的用户数据路径必须位于会话工作目录；越界或 URL 误用返回中文错误，不抛异常。
- **iframe 是静态预览（A12）**：`sandbox=""`、不执行脚本；要交互/动效请走 round 页面。
- **三栏预览依赖 DSH Web 客户端**：`lib/client.js` 通过 `window.__ModuleLoader__` 注册 `tool.call.toolview`；旧宿主或非 Web 端不显示卡片时，退回浏览器轮次页流程（同一套台账）。客户端入口改动后需重启 DSH 才生效。
- **已在真实 DSH 宿主实测**：0.2.1-rc.5 里 A–E 全部通过（工具成功路径 + 防覆盖），证据见 `test/ACCEPTANCE.md`；仍缺 PowerPoint/WPS 里的逐页排版确认，旧 0.1.x 宿主兼容性未测。
- **`design_capture` 可能截图不可用**：会降级到 `contact-sheet.html`，不会假装看过渲染。
- **粗选/精调的证据强度有限**：关系标签与 HTML 互异是工具能查的；删除理由是用户 chip，不是量化测量；r5/r6 的 JND 是估值，结论按弱证据处理。
- **旧插件不在本仓库**：`dsh-ui-craft` 与 `dsh-probe-kit` 仅由作者在本地源仓库维护，不随本仓库发布；不要与本插件同时安装。

---

## 7. 开发与验收

```bash
node scripts/release.mjs   # 重建 dist 发布物（runtime / fixtures / docs）
node test/apply.mock.mjs   # 假 ctx 注册测试（33 项）
node test/shortlist-ui-contract.test.mjs  # UI↔CLI 契约（4 项）
node skills/design-kit/probe-kit/test/axis-lock.test.mjs  # A4 锁验证/假轴 5 项
node test/docs-consistency.mjs  # 工具计数/文档同源检查
node test/release-check.mjs     # B10 发布物矩阵检查（2 项）
node skills/design-kit/probe-kit/test/smoke.mjs       # 包内 smoke（11/11）
node skills/design-kit/probe-kit/test/regression.test.mjs  # 包内回归（10/10）
```

- 发布物（在 workspace 根运行 `node _build/release.mjs`）：
  - `runtime`：**59 文件 / 约 323 KB**，只含技能 + 10 工具 + 客户端，不含测试/证据/QA；
  - `fixtures`：测试、真实回合证据与回归夹具；
  - `docs`：验收、QA、粗选/精调协议与参考；
  - `dist/RELEASE-README.md` + `SHA256SUMS.txt` 列出三件的大小与哈希；
  - 兼容旧文件名 `dsh-design-kit-v0.1.7.zip` 与 runtime 内容相同；npm tarball 带 docs，但不含 test/证据/QA。
- 安装只用 runtime；fixtures/docs 不要装进 DSH。
- 手写区：`skills/design-kit/SKILL.md`、`skills/design-kit/references/deck-handoff.md`、`skills/design-kit/deck/export_shim.py`；同步区不要手改，改源目录后由维护者重新同步并打包。
- 同步清单：`skills/design-kit/.sync-manifest.json`（ui-craft 17 / probe-kit 40 / references 2）。
- 验收记录：`test/ACCEPTANCE.md`（真实宿主 A–E 结果）；四轮独立 QA 报告：`test/qa-design-kit.md`、`test/qa-design-kit-followup.md`、`test/qa-design-kit-final.md`、`test/qa-deck-tools.md`。

## License

MIT。设计方法参考 impeccable（Apache-2.0）与 ppt-master（MIT），未复制其源码。
