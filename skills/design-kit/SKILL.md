---
name: design-kit
description: "统一设计交付入口：造页面、改界面、审前端（网页、落地页、后台、组件、设计系统、AI 味审查），多方向粗选（同族不同派 lineage / 同轴三档 contrast，删/待定/三选一，12 个封顶后归因），参数级精调（单轴 + JND + 台账 + 凭证三态），以及出演示文稿（deck_check/deck_export/deck_render 质检、导出 PPTX、渲染 PDF/PNG）。Use when the user wants to design, redesign, build, critique, audit, or polish a UI; choose between design directions or worlds; fine-tune a design parameter with evidence; or turn content into a slide deck/PPT. 用于设计/评审/打磨界面、选方向、调参数、出 PPT。Not for backend-only tasks."
version: 0.1.0
license: MIT
user-invocable: true
---

# Design Kit · 统一设计交付

一个入口，四类任务。先判断用户要哪一类，再走对应流程；不要把所有模式混在一次回答里。

| 用户要什么 | 走哪条 | 主要工具 | 完整方法 |
|---|---|---|---|
| 造页面、改界面、评审、打磨、设计系统 | **A. UI 交付** | `design_tokens` / `design_lint` / `design_capture` | [ui-craft/SKILL.md](ui-craft/SKILL.md) + `ui-craft/references/` |
| 几个方向选一个、「都差点意思」、风格对比 | **B. 粗选** | `probe_shortlist` + `probe_shortlist_preview` / `probe_shortlist_ui_action` | [references/probe-kit-SKILL.md](references/probe-kit-SKILL.md) |
| 方向已定，调饱和度/字号/间距等参数 | **C. 精调** | `probe_measure` | 同上 + `probe-kit/PROTOCOL-V0.2.md` |
| 出 PPT / 演示文稿 / 汇报稿 | **D. PPT 交付** | `deck_check` / `deck_export` / `deck_render` | [references/deck-handoff.md](references/deck-handoff.md) |

判断口诀：**界面没做 → A；界面有好几个方向 → B；方向定了但参数拿不准 → C；要幻灯片 → D。**
只审阅不改的需求直接走 A 的审阅分支；后端接口、纯数据脚本不启动本技能。

## 共通底线（四条，所有模式都适用）

1. **数字优先于印象。** 对比度、字号、间距、JND 由脚本/台账判定；脚本说的优先于你的感觉。
2. **证据分级，不越级。** 声明不是证据；代理不是证明；单评审人、n<3、未过 JND 只能当弱先验。
3. **不假装看过。** 截图失败就说失败并给降级路径；渲染没看就不说「已检查」。
4. **产物写会话工作目录。** 回合、台账、截图、token 都写 `<会话 cwd>`，不写插件安装目录。

## A. UI 交付

完整流程在 `ui-craft/SKILL.md`，按需读 `ui-craft/references/`（world / type / color / layout / motion / states / copy / audit / design-system 等）。这里是压缩版门：

1. **定世界**：读既有 DESIGN.md/tokens/页面；问 2–3 个会改变结果的问题；写一句机制 + 方向契约六字段；收敛 1 主 2 备。**门：用户选定，或用户授权且你宣布依据。**
2. **定系统**：先生成 tokens，再按世界改性格；页面里不出现没有出处的颜色/字号/间距。**门：`tokens.css` 落地 + 对比度自检全绿。**
3. **构建**：首屏是论点；真实文案；状态/交互一起写；一个作者时刻；从 390 到 1440 验证。**门：真实文案 + 真实断点不溢出。**
4. **审阅**：`design_lint` 修全部 error、逐条结论 warn；`design_capture` 能截图就逐张看，`CAPTURE_UNAVAILABLE` 就用 contact-sheet.html 请用户确认。**门：无 error；每条 warn 有结论；未看的明确声明。**
5. **交付**：新世界/体系变更写 `DESIGN.md` + tokens 唯一来源；写清选了什么方向、关键 token、已知限制、下一步。**门：有 DESIGN.md 或交付说明。**

硬法则见 `ui-craft/SKILL.md` §4；最常踩的坑是：方向写成形容词、等大卡片堆砌、紫蓝渐变+玻璃+发光、只在 1440 成立、只有 happy path。

## B. 粗选（方向选择）

用 `probe_shortlist`。每轮恰好 3 个候选，且**候选之间必须声明关系**，工具会拒绝无关系/同族同派：

- `lineage`：同属一个 `family`，三个 `variant` 各不相同。
- `contrast`：同一 `axis` 上 low / mid / high，且跨 ≥2 个 `family`。

```jsonc
probe_shortlist({ "command": "init", "brief": "brief.json" })
probe_shortlist({ "command": "add", "run": "shortlist-runs/<id>", "candidates": "r1.json", "contextToken": "fresh-a" })
probe_shortlist({ "command": "report", "run": "shortlist-runs/<id>" })
```

### 对话内三栏预览（默认体验）

`add` 之后**先不要**让用户去浏览器：调用

```jsonc
probe_shortlist_preview({ "run": "shortlist-runs/<id>" })
```

DSH 会把结果渲染成对话内的三栏 iframe（候选 A/B/C，盲性：不显示世界名/轴值），下面是删除/待定（终选时是三选一/都不行）。**iframe 是 `sandbox=""` 静态预览、不执行脚本**；需要点击/动效等交互时，改走外开 round 页流程。

用户点完后，卡片会自动往会话里发一条以 `[probe-shortlist-ui] ` 开头的消息，后面是一段 JSON。你**不要重新问一遍**，直接调用：

```jsonc
probe_shortlist_ui_action({ "payload": "<[probe-shortlist-ui] 后面的 JSON 字符串>" })
```

安全门（A3）：卡片携带**一次性预览令牌**（绑定 run / 轮次 / 候选，30 分钟过期，用一次即失效）。缺少、伪造、过期、轮次/候选不匹配的 payload 会被拒绝；被拒时**重新调用 `probe_shortlist_preview`** 让用户重点，不要手写或复用过令牌，也不要绕过它直接调 `probe_shortlist decide/final` 来伪造 UI 选择。

它会写决策/终选文件并调 `shortlist.mjs` 落账。成功后：
- `decide` → 若待定未满 3，生成下一轮候选后再次 `probe_shortlist_preview`；
- `final` → 读 `result.json`，进入精调或归因。

如果客户端 view 没显示（例如旧宿主/非 Web 端），退回原来的「打开 round 页面、下载 decisions」流程；两条路都落同一套台账，不要同时用。

硬规则：每轮 3 个、每轮最多待定 1 个、删除必须带理由 chip；上限固定 **4×3=12**，`brief.cap` 不能放宽；待定满 3 后只能 final；final 前自动完整性校验。12 个用尽或「都不行」→ 按理由做**弱先验归因**（阈值 40%，chip 是用户自我报告、不是证明；capability 还要看 `capability-gap.evidence` 页面事实核查）到 capability / brief / taste / no-preference，再决定换能力、回提问、接受默认还是换材料家族。负结论带 1 年硬有效期。

**不要用粗选做微调**：世界级差异远大于参数级；真实数据里 39.1%/40.6%/42.2% 三个饱和度肉眼不可辨。

## C. 精调（参数级盲测）

状态机：粗选未 `final` 时工具会拒绝进入精调（`status`/`review`/`verify` 查看类仍可用）；先完成 final 再跑 `probe_measure`。

用 `probe_measure`，参数放 `args` 透传：

```jsonc
probe_measure({ "command": "demo" })                                   // 默认 r4；args 可加 ["--axis","r5"] / ["--axis","r6"]
probe_measure({ "command": "build", "args": ["--from-run","runs/<id>","--between","1,2"] })
probe_measure({ "command": "append", "args": ["--run","runs/<id>","--answer","answers.jsonl"] })
probe_measure({ "command": "attribute", "args": ["--run","runs/<id>","--assumption","…","--falsified-by","…","--boundary","…","--confidence","low"] })
probe_measure({ "command": "apply", "args": ["--run","runs/<id>","--out","calibration.json"] })  // 可加 --strict
```

规则：一次只变一个轴；盲呈现不显示数值；轴必须声明 `jnd`（低于 JND 算同一档）；区间宽 <4×JND 不允许插值细分；`apply` 写「等效区间 + 默认值」，不写精确值。

V0.2 闸门：

- **轴副作用**：颜色轴查色相/明度/对比度漂移与色度单调；字号/间距轴查声明位 + 已知耦合；越界拒绝生成，不许绕。
- **凭证三态**：`axis`（可插值）> `exploration`（只有频谱证据）> `unverified`；`--strict` 只允许 axis 写校准。
- **授权**：`--context-file` 可带 `authorization: { question, scope: "spectrum_only" }`；只回答值不值得花预算，不证明轴、不开放插值。
- **归因四字段**：`--assumption` / `--falsified-by` / `--boundary` / `--confidence`。

能当证据 = 回归夹具复现 + `verify` 全过 + 副作用在阈值内 + 差异过 JND + 凭证 axis；其余最多算弱先验。

## D. PPT 交付（deck 工具）

现在有 `deck_check` / `deck_export` / `deck_render`，但**内容仍由你写**：本插件不生成页面内容，只负责质检、导出、渲染。前置条件是能找到 ppt-master 技能目录（`config.pptMasterDir` 或 env `PPT_MASTER_DIR`，默认会找工作区 `_sources/ppt-master-main/...`）和 Python；渲染还需要 DSH 自带的 LibreOffice Kit（`dsoffice`）。

流程：

1. 按 `references/deck-handoff.md` 写 6–8 页 SVG（1280×720，`data-pptx-page-role`），内容真实、不编造。
2. `deck_check({ project })` → 0 error 才继续；返回 summary / errors / reportPath。
3. `deck_export({ project })` → 返回 pptxPath / bytes / slides / postflight；导出 shim 已修掉沙箱下临时目录不可写的问题。
4. `deck_render({ pptx })` → 返回 pdfPath / pagesDir / pageCount / images / missingFonts；**逐页看 PNG**，没看就不说「已检查」。
5. 找不到 ppt-master / Python / 渲染器时，工具返回中文原因；按 `references/deck-handoff.md` 的手工兜底继续，不要假装工具成功。

## 工具清单

| 工具 | 用途 | 关键约束 |
|---|---|---|
| `design_tokens` | 生成 OKLCH 色板、字阶、间距、圆角、阴影、动效 token | 输出目录必填；对比度自检全绿 |
| `design_lint` | 静态审 AI 味、对比度、排版、可访问性、中文排版 | error 要修完；exit 1 是正常结果 |
| `design_capture` | 多宽度截图或 contact-sheet 降级页 | 无浏览器时 `unavailable=true`，不假装成功 |
| `probe_shortlist` | 粗选 3 个有关系候选，删/待定/三选一，封顶归因 | 12 个上限、待定 3、理由 chip |
| `probe_shortlist_preview` | 读取当前轮/终选候选，返回对话内三栏 iframe 数据 | 只读；不改变回合状态 |
| `probe_shortlist_ui_action` | 执行卡片发回的结构化 decide/final | 写决策文件并调 shortlist.mjs 落账 |
| `probe_measure` | 单轴盲测 + JND + 台账 + 校准 | 一次一轴；凭证三态；区间不写精确值 |
| `deck_check` | ppt-master 项目最终质检（checker JSON） | 0 error 才导出；需要 ppt-master + Python |
| `deck_export` | SVG → 可编辑 PPTX（export shim） | 返回 pptxPath/postflight；不覆盖用户输出 |
| `deck_render` | PPTX → PDF + 逐页 PNG（dsoffice） | 返回 missingFonts；没看渲染不算检查 |

工具默认把回合写到 `<cwd>/shortlist-runs`、`<cwd>/runs`，台账写到 `<cwd>/probe-kit-ledger/ledger.jsonl`。所有工具都是异步 execute；长任务超时会返回 `timedOut:true` 并杀掉直接子进程，没有中途取消 API，超时后需重跑。

## 资源地图

- `ui-craft/SKILL.md`：完整 UI 流程、硬法则、失败模式。
- `references/probe-kit-SKILL.md`：粗选/精调完整命令、归因、证据口径。
- `references/deck-handoff.md`：ppt-master Quick 路线、deck_* 用法与手工兜底。
- `deck/export_shim.py`：沙箱安全的导出包装（替换上游临时目录创建逻辑）。
- `ui-craft/references/`：world / type / color / layout / motion / states / copy / audit / design-system / product-ui / craft-floor / modes。
- `ui-craft/scripts/`：design-tokens / design-lint / capture 零依赖脚本。
- `ui-craft/templates/DESIGN.md`：交付文档模板。
- `probe-kit/PROTOCOL-V0.2.md`：代理/授权/判定边界与暂缓项。
- `probe-kit/SPEC.md`、`probe-kit/SHORTLIST-SPEC.md`：协议与粗选条款。

## 汇报格式

- A：方向 + 关键 token + lint 分数 + 未看的渲染 + 已知限制。
- B：runId、轮次/候选数/待定数、关系（lineage/contrast + axis）、理由直方图、归因与下一步。
- C：轴、jnd、指认与置信度、凭证类型、等效区间/默认值、是否适用边界。
- D：用了哪条路线、质检/渲染结果、哪些没验证。

## 诚实边界

- `design_capture` 在无浏览器环境只能生成审阅页；不能替代人工目检。
- 粗选的关系标签与 HTML 互异是工具能查的；「是否真的同族/真的相反」仍需人复核。
- 删除理由是用户点的 chip，不是量化测量；能力类归因只做页面事实核查（支持/弱）。
- 精调的 JND 部分来自单场景/单评审人；r5/r6 的 JND 是估值，结论按弱证据处理。
- `deck_*` 只做质检/导出/渲染，**不生成内容**；需要 ppt-master + Python，渲染还需要 DSH 的 LibreOffice Kit。找不到依赖时工具返回中文原因，按 deck-handoff 手工兜底。
- 渲染结果必须逐页看；`deck_render` 返回 `missingFonts` 不等于排版正确，PowerPoint/WPS 里的最终效果仍要人确认。

## 从旧插件迁移

工具名 `design_lint` / `design_tokens` / `design_capture` / `probe_shortlist` / `probe_measure` 保持不变；技能入口从 `ui-craft` + `probe-kit` 合并为 `design-kit`。装本插件后不要再同时装 `dsh-ui-craft` 与 `dsh-probe-kit`，否则会重复注册同名工具。C 阶段新增的 `deck_check` / `deck_export` / `deck_render` 是纯新增，不影响旧调用。
