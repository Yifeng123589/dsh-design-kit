# 粗选（shortlist）规范

把「横向铺 3 个候选 → 只删/待定 → 待定到 3 个 → 三选一 → 换轴精调」做成 probe-kit 的第二个交互模式。
上限与归因按 2026-11-02 的设计讨论：**最多 4 轮 × 3 = 12 个候选；12 个都不满意不是继续生成，而是先归因、再决定换 skill/插件、补 brief、还是接受默认值。**

## 0. 边界

- 粗选负责「选世界/方向」；精调仍走现有的单轴 + JND 流程（`probe.mjs build/append/...`）。**不要用 shortlist 做微调**，否则会撞 JND。
- 零依赖、离线、`file://` 可用；页面不显示世界名、轴值、生成参数，只显示「位置 1/2/3」。
- 记录 append-only；删除必须带理由 chip（归因原料）。

## 1. 目录

```
probe-kit/
├── shortlist.mjs                 # CLI：init/generate/add/decide/final/report/verify/status/demo
├── lib/
│   ├── shortlist-recorder.mjs    # 轮次/终选状态机（无 DOM，页面与 Node 共用）— Lead
│   ├── shortlist.mjs             # 关系校验、上限、待定、归因、能力缺口 — Lead
│   └── worlds.mjs                # 12 张世界卡 + 渲染 — shortlist-worlds
├── fixtures/worlds/base.html     # 受控内容模板（山径书店 hero）— shortlist-worlds
├── templates/
│   ├── shortlist.html            # 轮次页 — shortlist-ui
│   └── shortlist-final.html      # 终选页 — shortlist-ui
├── shortlist-runs/<runId>/       # 生成物：brief.json / rounds.json / state.json / 页面 / candidate html
├── test/
│   ├── shortlist.test.mjs        # Lead
│   ├── shortlist-ui.test.mjs     # shortlist-ui
│   └── worlds.test.mjs           # shortlist-worlds
```

## 2. 数据模型

`brief.json`
```json
{ "schema": "shortlist-brief/1", "runId": "sl-...", "title": "...", "prompt": "...",
  "context": { "projectType": "...", "audience": "...", "device": "desktop" },
  "cap": { "maxRounds": 4, "perRound": 3, "maxPending": 3 }, "createdAt": "ISO" }
```

`rounds.json`
```json
{ "schema": "shortlist-rounds/1", "runId": "...", "rounds": [
  { "round": 1, "relation": { "relation": "lineage", "family": "print-tradition" },
    "generationContext": "fresh-<token>", "createdAt": "ISO", "pageSha": "16hex",
    "candidates": [ { "id": "w-swiss", "pos": 1, "world": { "material": "...", "type": "...", "layout": "...", "color": "...",
                      "family": "print-tradition", "variant": "理性网格", "contrast": { "ornament": "low", "image": "low" } },
                      "htmlSha": "16hex", "htmlPath": "candidates/r1-p1.html" } ] } ] }
```

`state.json`（由 CLI 维护，可重建）
```json
{ "schema": "shortlist-state/1", "runId": "...", "pending": [ { "id": "...", "world": {...}, "htmlPath": "...", "fromRound": 1 } ],
  "eliminated": [ { "id": "...", "world": {...}, "reasonId": "...", "note": "", "round": 1 } ],
  "decisionsByRound": { "1": [ ... ] }, "nextRound": 2, "finished": false, "outcome": null,
  "finalPageSha": null, "finalRejectReasonIds": [],
  "generationContexts": ["fresh-a", "fresh-b"] }
```

字段 `generationContext` 是软约束：同一 context 不能连续出现 2 轮，CLI 发现连续相同会警告（协议要求每轮独立生成上下文）。

## 3. 状态机契约（Lead 实现 `lib/shortlist-recorder.mjs`）

```js
export const SHORTLIST_VERSION = '1';
export function createRoundSession({ runId, round, candidateCount, maxDeferPerRound = 1, reasons })
// reasons: [{id,label,tag}]
// session.setAction(pos, 'eliminate'|'defer', { reasonId, note })
// session.clear(pos)
// session.canDefer(pos) -> boolean
// session.peek() -> { actions, deferCount, complete, errors: string[] }
// session.finalize() -> record；未完成/违约时抛中文 Error
export function createFinalSession({ runId, candidateCount, reasons })
// session.choose(pos); session.clearChoice(); session.setRejectReasons(reasonIds, note?)
// session.peek(); session.finalize() -> record
export function inlineSource(source) // 复用 recorder 的实现思路
```

轮次记录：
```json
{ "schema": "shortlist-decisions/1", "runId": "...", "round": 1,
  "startedAt": "ISO", "endedAt": "ISO", "durationMs": 12345,
  "decisions": [ { "pos": 1, "action": "eliminate", "reasonId": "too-loud", "note": "" },
                 { "pos": 2, "action": "defer" } ] }
```

终选记录：
```json
{ "schema": "shortlist-choice/1", "runId": "...", "kind": "candidate|none",
  "pos": 2, "reasonIds": ["missing-asset"], "note": "", "startedAt": "ISO", "endedAt": "ISO", "durationMs": 9999 }
```

约束：每个候选恰好一个动作；每轮最多 1 个 defer；删除必须带合法 reasonId；finalize 后不可改。

## 4. 页面契约（shortlist-ui）

### 4.1 `templates/shortlist.html`（轮次页）

占位符，恰好各 1 次：`__SHORTLIST_VERSION__`、`__ROUND_RECORDER_JS__`、`__ROUND_DATA_JSON__`。

`__ROUND_DATA_JSON__`（放 `<script type="application/json" id="round-data">`）：
```json
{ "schema": "shortlist-round/1", "runId": "...", "title": "...", "prompt": "...",
  "round": 2, "totalRounds": 4, "generatedCount": 6, "maxPending": 3, "pendingCount": 1, "maxDeferPerRound": 1,
  "reasonChips": [ { "id": "too-loud", "label": "太吵/太花", "tag": "taste" } ],
  "candidates": [ { "pos": 1, "html": "<!doctype html>..." } ],
  "pending": [ { "pos": 1, "html": "<!doctype html>..." } ] }
```

要求：
- 顶部状态：`第 2/4 轮 · 已生成 6/12 · 待定 1/3`；说明「删或待定；每轮最多待定 1 个；待定到 3 个进入三选一」。
- 待定区：横向缩略图（160×213，`transform: scale(0.444)` 包裹 360×480 iframe），标「位置 1」。
- 本轮候选：3 个固定 360×480 iframe 并排，srcdoc 注入；窄视口时与 presenter 一样的琥珀色告警「只能同屏看到约 N / 3 个」。
- 每个候选下方按钮：`删除`、`待定`。点删除必须先在行内 chip 中选一个理由（单选，选中高亮）；点待定在 `deferCount>=1` 时禁用并说明原因。
- 底部：`提交本轮`（未给全部候选动作时禁用），提交后展示 JSON、`下载 decisions-<runId>-r<round>.jsonl`、复制回退，锁定控件。
- 键盘可达：每帧 `tabindex="0"`，方向键切换、Delete=删除、D=待定（需已选理由）；`aria-live` 播报。
- 无外链/无网络/fetch/localStorage；file:// 可用；中性灰 chrome。
- 页脚：`shortlist v__SHORTLIST_VERSION__ · 记录 schema shortlist-decisions/1 · 本地运行，不联网`。

### 4.2 `templates/shortlist-final.html`（终选页）

占位符：`__SHORTLIST_VERSION__`、`__FINAL_RECORDER_JS__`、`__FINAL_DATA_JSON__`。
```json
{ "schema": "shortlist-final/1", "runId": "...", "title": "...", "prompt": "...", "rounds": 3,
  "reasonChips": [ ... ], "pending": [ { "pos": 1, "html": "..." } ] }
```
要求：3 个待定并排（同尺寸 360×480）；每个下方 `选它`；底部 `都不行，换方向`（展开理由 chips，多选 ≥1，可填一句话）；提交后展示并下载 `choice-<runId>.jsonl`；说明「三选一；都不行会进入归因，不会继续生成」；其余同轮次页（无外链、键盘、aria-live、中性 chrome、页脚 schema `shortlist-choice/1`）。

补充约定（集成时定稿）：终选页 JSON script 的 id 用 `final-data`（页面用 `script[type="application/json"]` 读取，改 id 不破坏页面）；轮次页键盘除 SPEC 摘要外还支持 `1/2/3` 聚焦、方向键移动、`U` 撤销、`Esc` 关闭理由面板；`maxDeferPerRound` 由页面 data 驱动，CLI 固定为 1。

测试 `test/shortlist-ui.test.mjs`（零依赖、`node test/shortlist-ui.test.mjs`，不要 `node --test`）：
1. 两个模板占位符各出现 1 次；
2. 无 `http://`、`https://` 外链、`@import`、`fetch(`、`localStorage`；
3. 注入样例 JSON 后可 `JSON.parse`；`</script` 已转义；
4. 内联脚本（不含 application/json）用 `new Function` 可解析；
5. 盲性：样例里的世界 id / 轴值字符串不出现在可见文本；
6. 断言存在 `srcdoc`、`aria-live`、`tabindex="0"`、`待定`、`删除`、`都不行`、`下载`。

## 5. 世界卡契约（shortlist-worlds）

`lib/worlds.mjs` 导出：

```js
export const WORLD_AXES = ['material', 'type', 'layout', 'color'];
export const CONTRAST_AXES = [{ id:'ornament', label:'装饰密度', levels:{...} }, { id:'image', label:'影像参与度', ... }];
export const WORLDS = [ /* 12 个世界，4 族 × 3 variant */ ];
export const WORLD_FAMILIES = [ { id, label, variants, worldIds } ];
export const WORLD_ROUNDS = [ /* 4 轮计划：2 轮 lineage + 2 轮 contrast */ ];
export function roundPlan(roundIndex) // 1-based：{ relation, family|axis, worlds }
export function renderCandidate(world, content?) // -> 完整 HTML；content 省略时用山径书店演示文案
export function generateRound({ brief, relationPlan, round, content }) // -> add 兼容的候选 JSON；不写文件/台账
```

每个世界（语义字段不参与渲染）：

```js
{ id: 'w-swiss', label: '瑞士网格',
  family: 'print-tradition', variant: '理性网格',
  contrast: { ornament: 'low', image: 'low' },   // 对比轴档位 low/mid/high
  axes: { material: '纸面网格', type: '国际主义无衬线', layout: '十二列网格', color: '纸白 + 信号红' },
  tokens: { BG:'#f7f7f5', SURFACE:'#ffffff', INK:'#141414', MUTED:'#5c5c5c', ACCENT:'#d32f2f', ACCENT_INK:'#ffffff',
            RULE:'#d9d9d9', RADIUS:'0px', FONT_HEAD:'"Helvetica Neue", Arial, sans-serif', FONT_BODY:'...' },
  layoutClass: 'layout-grid', decor: ['rules'] }
```

`fixtures/worlds/base.html`：同一骨架，内容槽为 title / subtitle / 3 条要点 / cta / foot（占位符 `TITLE` `SUBTITLE` `BULLET_1`…`BULLET_3_META` `CTA` `FOOT`），视觉占位符 `BG` `SURFACE` `INK` `MUTED` `ACCENT` `ACCENT_INK` `RULE` `RADIUS` `FONT_HEAD` `FONT_BODY` `LAYOUT_CLASS` `DECOR_CLASSES` `DECOR_CSS`。不传 content 时渲染山径书店演示文案。同一轮三个世界共用同一内容槽，只有视觉世界不同；**不得使用外部字体/图片/网络**。`add` 会拒收内容槽不一致、HTML 相同或带外链的候选。

**世界之间必须有关系，不能盲比**：

- `lineage`（同族不同派）：同一 `family` 下的 3 个不同 `variant`。例：印刷传统里理性网格 / 旧式密排 / 粗野拼贴；油画里印象派 / 写实派 / 表现派。
- `contrast`（对比轴三档）：同一命名 `axis` 上 `low/mid/high` 各一个，且跨 ≥2 个 `family`。例：装饰密度从极简到繁复；影像参与度从无影像到影像主导。

12 个世界分 4 族（每族 3 个 variant）：印刷传统 / 手作纸品 / 图像展示 / 信息呈现。4 轮建议计划 = 2 轮 lineage + 2 轮 contrast（装饰密度、影像参与度各一轮）。

测试 `test/worlds.test.mjs`：12 个世界、id 唯一、每族 3 个 variant 且不重复、每族渲染互不相同且无外链、lineage 轮同族、contrast 轮档位恰好各一次且跨 ≥2 family、`roundPlan` 4 轮覆盖全部 12 个世界、渲染 HTML 无外链/无 `{{` 残留、两次渲染一致、HTML 长度上限（< 40KB）。

## 6. CLI（Lead 实现 `shortlist.mjs`）

```
node shortlist.mjs init --brief <brief.json> [--run-id <id>] [--out shortlist-runs]
node shortlist.mjs generate --brief <brief.json> | --run <dir> [--writer worlds|archetype] [--round 1] [--relation lineage|contrast] [--family <id>] [--axis <id>] [--content <slots.json>] [--out candidates/rN.json] [--add]
node shortlist.mjs add --run <dir> --candidates <candidates.json> [--context-token <token>]
node shortlist.mjs decide --run <dir> --round <n> --decisions <file.jsonl>
node shortlist.mjs final --run <dir> --choice <file.jsonl>
node shortlist.mjs report --run <dir> [--now <ISO>]
node shortlist.mjs verify --run <dir>
node shortlist.mjs status
node shortlist.mjs demo [--scenario success|gap|both] [--out shortlist-runs]
```

- `generate`：按 brief 内容槽渲染 3 个 HTML，写出可 `add` 的候选 JSON（附 `writer` / `contentHash` / `skeletonHash`）。`--writer` 省略时有骨架库则用 archetype（`archetypes/` 的完整页 + 世界 token，并按 lineage/contrast 抽签），否则 worlds（`roundPlan` 的 12 张世界卡）。不写 decide、不写台账。`--add` 交给 `add` 入库。verify 对 archetype 重算 skeletonHash 和结构签名。
- `add`：校验 3 个候选与关系（lineage 同族不同派 / contrast 同一轴 low/mid/high 跨≥2 family）、内容槽锁定、html 互异、html 无外链、生成 `candidates/r<n>-p<pos>.html`、更新 rounds.json、渲染 `round-<n>.html`；输出下一步。
- `decide`：校验记录（schema/positions/每轮 ≤1 defer/理由合法），更新 state，追加台账事件 `shortlist.decisions`；pending 达 3 → 渲染 `final.html` 并提示 `final`；达到 4 轮或 12 个且**所有已生成轮次都已决策**仍未到 3 → 生成归因报告并提示不能用第 13 个。
- `final`：**先跑一次完整性校验**（不过则拒绝）；kind=candidate → 写 `result.json`、台账 `shortlist.chosen`、提示「进入精调：用 probe.mjs 单轴 + JND」；kind=none → 先写 `shortlist.chosen` 再归因 → 写 `capability-gap.json`、台账 `capability.gap`。
- 闸门：上限固定为 4 轮 / 12 个 / 待定 3 个，`brief.cap` 与此不符直接拒绝；待定满 3 后拒绝 add/decide；未 decide 上一轮拒绝 add；`state.finished` 后拒绝 decide；候选 id 跨轮唯一；同轮 HTML 必须互不相同。
- `status`：统计台账事件与能力缺口记录（CLI 清单里的第 7 个命令）。
- `report`：状态、理由直方图、4 轴覆盖、归因、路由建议。
- 默认台账 `probe-kit/ledger/ledger.jsonl`（与 probe.mjs 一致）；事件里只存 world 与 htmlSha，不存完整 html。

归因规则（写进 `lib/shortlist.mjs`，阈值可调）：
- 按理由 chip 的 `tag` 统计：capability / brief / taste / no-preference。
- capability 占比 ≥ 0.4 → `capability`，路由「换能力：加载具备 X 的 skill/插件」。
- 否则 brief 占比 ≥ 0.4 → `brief`，路由「回提问：补 project/audience/constraints」。
- 否则 no-preference 占比 ≥ 0.4 → `no-preference`，路由「接受默认值，记录负结论」。
- 否则 → `taste`，路由「扩大世界候选：下一轮换材料家族」。
- `capability-gap.json` 带 `attribution / route / missingCapabilities / reasonCounts / axisCoverage / expiresHard`（+1 年）。

## 7. 分工与写盘边界

| 作者 | 只写 |
|---|---|
| Lead | `SHORTLIST-SPEC.md`、`shortlist.mjs`、`lib/shortlist-recorder.mjs`、`lib/shortlist.mjs`、`test/shortlist.test.mjs`、`lib/ledger.mjs`（事件扩展）、README 相关段落 |
| shortlist-ui | `templates/shortlist.html`、`templates/shortlist-final.html`、`test/shortlist-ui.test.mjs` |
| shortlist-worlds | `lib/worlds.mjs`、`fixtures/worlds/base.html`、`test/worlds.test.mjs` |

## 8. 验收

- 三套测试全绿（`node test/xxx.test.mjs`）。
- `node shortlist.mjs demo --scenario both`：success 线在 3 轮内凑齐 3 个待定并终选；gap 线 4 轮 12 个被删光后生成 `capability-gap.json`（attribution 正确）。
- `verify`：6 项——上限与轮次；关系成立且 HTML 互不相同；HTML sha 与无外链（含协议相对 `//`）；决策与轮次连续性；待定数正确；收口产物与状态一致（`result.json` / `capability-gap.json` 存在，且 attribution / reasonCounts 可由 state 重算）。
- 页面：静态断言全部通过；`file://` 打开无外链。
- 台账：新增事件通过 `validateEvent`，`probe.mjs status` 能统计。
