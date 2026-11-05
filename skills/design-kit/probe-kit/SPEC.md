# probe-kit 构建规范（内部契约）

把《Skill 探针协议（泛化版）V0.1》里的「呈现器 + 指认记录 + 台账 + 到期复审」做成可执行的最小件。
先用 R4（blue saturation，已实战验证的连续轴）跑通。

## 定位边界

- 这是**仪器**，不是协议全实现。不做：被动续期、coverage 度量、tier 自动升级、多评审人、权重模块。
- 硬约束：零依赖、零网络、Node ≥ 18；呈现器是单文件 HTML，`file://` 直接打开可用（不能依赖 fetch/ESM 加载）。
- 客观层（lint/对比度/DOM）由 ui-craft 负责，本工具只做**偏好引出 + 台账**。
- 所有记录 append-only，不覆盖、不回滚。

## 目录

```
probe-kit/
├── README.md                  # 用户向：是什么、怎么用、协议映射、未落地项
├── SPEC.md                    # 本文件
├── probe.mjs                  # CLI：demo/build/append/attribute/review/apply/status/verify/selftest
├── lib/
│   ├── recorder.mjs           # 指认状态机（无 DOM，Node 与浏览器共用）—— Lead 所有
│   ├── axis.mjs               # 轴定义、谱点、插值—— Lead 所有
│   └── ledger.mjs             # 事件台账、有效期、收敛判定—— probe-ledger 所有
├── templates/presenter.html   # 呈现器模板（单文件）—— probe-presenter 所有
├── fixtures/r4/base.html      # 受控内容模板，含 {{ACCENT}} 占位—— Lead 所有
├── test/
│   ├── selftest.mjs           # Lead 集成测试
│   ├── ledger.test.mjs        # probe-ledger 所有
│   └── presenter.test.mjs     # probe-presenter 所有
├── runs/<runId>/run.html + run.json    # 生成物
├── ledger/ledger.jsonl                 # 生成物（示例用 examples/）
└── examples/                           # 演示用的台账与 calibration
```

## 一、指认记录契约（recorder, 已实现，勿改）

`lib/recorder.mjs` 导出：`RECORDER_VERSION`、`createSession({runId, positionCount, sessionId?, startedAt?, clock?})`、
`validateAnswer(record, positionCount)`、`inlineSource(source)`。

session 方法：`markEnter(pos)`、`markLeave(pos)`、`choose(pos)`、`chooseBetween(a,b)`、`clear()`、
`setConfidence(1..4|null)`、`setEnvironment(obj)`、`peek()`、`answerSummary()`、`flushDwell()`、`lock()`。

锁定产出的记录 schema：

```json
{
  "schema": "probe-answer/1", "recorder": "1", "runId": "...", "sessionId": null,
  "startedAt": "ISO", "endedAt": "ISO", "durationMs": 12345,
  "answer": { "kind": "absolute|between", "chosenPos": 2, "betweenPos": [1,3] },
  "flips": 1, "dwellMs": { "1": 1200, "2": 800, "3": 300 },
  "confidence": 3, "env": { "viewport": { "w": 1440, "h": 900 } }
}
```

## 二、呈现器契约（probe-presenter 实现 `templates/presenter.html`）

模板里必须且只能出现这三个占位符，生成时被替换（占位符形式：双下划线包住的名字，见下）：

| 占位符 | 内容 |
|---|---|
| `__PRESENTER_VERSION__` | 呈现器版本号字符串，渲染到页脚（记录里的 env 由 CLI 按清单写入，不依赖页面） |
| `__RECORDER_JS__` | `lib/recorder.mjs` 源码经 `inlineSource()` 处理后的原文，直接内联进 `<script>` |
| `__RUN_DATA_JSON__` | 下面是 run data 的 JSON 序列化；生成器会把 `</script` 转义成 `<\/script`，可直接放进 `<script type="application/json" id="run-data">` |

run data（`__RUN_DATA_JSON__` 的内容）：

```json
{
  "schema": "probe-run/1",
  "runId": "r4-demo-1",
  "skill": "ui-craft",
  "title": "偏好校准 · 强调色的蓝饱和度",
  "prompt": "同一张卡片，只有强调色的饱和度不同。凭直觉选一个；也可以点两个，表示「在两者之间」。",
  "dimLabel": "强调色的蓝饱和度",
  "confidenceLabels": ["猜的", "一般", "比较确定", "非常确定"],
  "positions": [ { "pos": 1, "html": "<!doctype html>..." }, { "pos": 2, "html": "..." } ],
  "createdAt": "ISO"
}
```

呈现器要求：

1. **盲**：页面里不得出现轴名以外的数值、不得出现 variant id、不得出现任何颜色/饱和度标签；位置标签只有「位置 1..N」。
2. **同尺寸**：每个 variant 用固定尺寸 iframe（宽 360、高 480，不随窗口缩放），并排 n 列；窄屏时横向滚动而不是缩小。
3. **中性外框**：呈现器自己的 chrome 用中性灰，不得使用饱和色/装饰，避免影响判断。
4. **交互**：
   - 模式切换：「选一个」/「选区间」。
   - 选一个：点某个 frame 即 `choose(pos)`；再次点另一个会算一次 flip。
   - 选区间：依次点两个 frame 即 `chooseBetween(a,b)`；再点会重排。
   - 「清空指认」按钮调用 `clear()`。
   - 把握程度 4 档必选（记录 `setConfidence(1..4)`）；未选时锁定按钮可用但要提示。
   - 「锁定本回合」按钮调用 `session.lock()`；锁定后展示结果 JSON，并提供「下载 answer.jsonl」与「复制 JSON」两条出路（下载名 `answer-<runId>.jsonl`，内容为记录 JSON 单行 + `\n`）。
   - 锁定后不得再修改记录。
   - 停留时长：每个 frame 外层 wrapper 的 `mouseenter/mouseleave` 调 `markEnter/markLeave`；`window.blur` 与 `document.visibilitychange` 时调 `flushDwell()`。
   - `setEnvironment({viewport:{w,h}, lang, reducedMotion})` 在页面加载时调用一次。
   - 键盘：每个 frame wrapper `tabindex="0"`，Enter/Space 在「选一个」模式等于点击；`aria-live="polite"` 播报当前指认。
5. **不联网、无外部资源**：不得出现 `http://`、`https://`、`src="`（iframe 内容走 `srcdoc`）、`@import`、字体外链。
6. **file:// 可用**：不得用 `fetch`、`import`、`localStorage`、`navigator.clipboard` 作为唯一路径（复制要有 textarea 回退）。
7. 页脚显示：`呈现器 v__PRESENTER_VERSION__ · 记录 schema probe-answer/1 · 本地运行，不联网`。

## 三、台账契约（probe-ledger 实现 `lib/ledger.mjs`）

JSONL，一行一个事件，append-only。所有事件带 `t`、`schema`、`at`。schema 固定 `probe-ledger/1`。

事件类型：

```json
{ "t": "run.recorded", "runId": "...", "skill": "ui-craft", "dim": "accent_saturation",
  "dimKind": "continuous", "round": 1,
  "context": { "projectType": "...", "audience": "...", "device": "desktop" },
  "env": { "platform": "win32", "node": "24.19.0", "presenter": "1", "recorder": "1",
           "fingerprint": "sha-ish 短哈希" },
  "axis": { "name": "accent_saturation", "unit": "fraction", "min": 0, "max": 1 },
  "variants": [ { "pos": 1, "id": "v1", "value": 0.25 } ],
  "answer": { ...probe-answer/1 的 answer 字段... , "flips": 2, "dwellMs": {...}, "confidence": 3, "durationMs": 12000 },
  "derived": { "chosenValue": 0.5, "betweenValues": [0.25, 0.75], "interval": { "lo": 0.25, "hi": 0.75, "mid": 0.5, "half": 0.25 } } }

{ "t": "attribution.recorded", "runId": "...", "assumption": "...", "falsifiedBy": "...",
  "boundary": "...", "confidence": "low|medium|high", "note": "..." }

{ "t": "credential.revoked", "runId": "...", "reason": "...", "dims": ["accent_saturation"] }

{ "t": "review.done", "now": "ISO", "dims": [ { "dim": "...", "state": "fresh|due|expired", "reasons": [...] } ] }

{ "t": "calibration.applied", "runId": "...", "dim": "...", "value": 0.5, "out": "calibration.json" }
```

`lib/ledger.mjs` 导出（CLI 会调用，签名必须一致）：

```js
export const LEDGER_SCHEMA = 'probe-ledger/1';
export const PREFERENCE_TIER = { maxRuns: 3, hardDays: 14, tier: 'preference-short' };

export function appendEvent(ledgerPath, event)        // 追加一行；返回 { ok, line? , error? }
export function readEvents(ledgerPath)                 // 读全部事件；坏行抛错并指出行号
export function validateEvent(event)                   // { ok, errors[] }
export function envFingerprint({ platform, node, presenter, recorder })  // 稳定短哈希（非加密即可）
export function makeRunEvent({ runManifest, answer, context, env, round }) // 由 run.json + answer 组装 run.recorded，含 derived
export function credentialState({ events, dim, context, now })            // { tier, recordedAt, validUntil, runCount, maxRuns, fingerprint, state, reasons }
export function reviewState({ events, now })           // { dims: [...credentialState + convergence], warnings: [...] }
export function convergence({ events, dim, context })  // { rounds, verdict: 'evidence'|'wobble'|'insufficient', note }
export function resolveVariantValues({ runManifest, answer }) // { chosenValue, betweenValues, interval }
```

规则：

- `derived.chosenValue`：absolute 取对应 variant 的 value；between 取区间中点。`interval` 仅 between 有。
- 有效期：`validity = min(recordedAt + hardDays, 次数超过 maxRuns, 环境指纹变化)`。**禁止加权求和**。环境指纹变化时 `state = 'expired'`，理由写明「环境指纹变化」。
- `state`：`fresh`（有效）/`due`（临期：剩余 ≤2 天、已用次数 ≥ maxRuns-1、或已用满 maxRuns）/`expired`（过期 / 指纹变化 / `runCount > maxRuns` / 被 `credential.revoked` 吊销）。
- 收敛判定：同一 `dim` + 同一 `context` 的 `run.recorded` 按 round 排序；不足 2 轮 → `insufficient`。两轮只在「差 ≤ 轴跨度 5%」时判 `evidence`，差超出容差判 `insufficient`（需要第 3 轮，不硬凑方向）。三轮及以上看最近两段位移方向：同向 → `evidence`、翻转 → `wobble`、某段落在容差内按实现细则处理。**禁止把「同在轴中点一侧」单独当 evidence**。
- `reviewState.warnings` 固定输出三条协议自带的诚实警告：coverage 未度量（P8）、单评审人（P5）、轴纯度无事实核查（P1）。
- 同一 `dim`+`context` 的 `calibration.applied` 不得覆盖：再次 apply 视为新的版本追加。

## 四、CLI（Lead 实现 `probe.mjs`）

```
node probe.mjs demo [--out runs] [--seed 7]
node probe.mjs build --from-run <dir> --between <posA>,<posB> [--round 2] [--out runs]
node probe.mjs append --run <dir> --answer <file.jsonl> [--context-file <json>] [--ledger <path>]
node probe.mjs attribute --run <runId> --assumption <s> --falsified-by <s> --boundary <s> --confidence <low|medium|high> [--note <s>] [--ledger <path>]
node probe.mjs revoke --run <runId>|--dim <dim> --reason <s> [--ledger <path>]
node probe.mjs review [--run <runId>] [--now <ISO>] [--ledger <path>]
node probe.mjs apply --run <runId> --out <calibration.json> [--now <ISO>] [--ledger <path>]
node probe.mjs status [--ledger <path>]
node probe.mjs verify --run <dir>
node probe.mjs selftest
```

默认 ledger 路径：`probe-kit/ledger/ledger.jsonl`（相对 `probe.mjs` 所在目录）。
所有命令失败用退出码：0 成功；1 校验失败；2 参数错误。

## 五、分工与写盘边界

| 作者 | 只写 |
|---|---|
| Lead | `SPEC.md`、`lib/recorder.mjs`、`lib/axis.mjs`、`probe.mjs`、`fixtures/r4/base.html`、`test/selftest.mjs`、`README.md` |
| probe-presenter | `templates/presenter.html`、`test/presenter.test.mjs` |
| probe-ledger | `lib/ledger.mjs`、`test/ledger.test.mjs` |

## 六、验收

- 三个脚本 Node 语法通过（`node --check`）。
- `node probe.mjs selftest` 全绿。
- `node probe.mjs demo` 生成 run.html + run.json；`verify` 通过（骨架一致、顺序可复现、答案可解析）。
- 用脚本模拟一次指认 → append → attribute → review → apply 全链路通过；`--now +30 天` 复审为 expired。
- 呈现器：`test/presenter.test.mjs` 用 Node 做静态断言（占位符、无外链、JSON 注入、内联脚本语法、盲性：页面不含数值）。

## 七、集成后补齐的实现细则

以下是实现时定下来、上面正文没写死的细节，改行为时先改这里。

1. **收敛判定（保守优先）**：两轮只认「`|差| ≤ 轴跨度 5%`」→ evidence；两轮差超出容差 → insufficient（说明需要第 3 轮），不返回 evidence。三轮及以上看最近两段位移：都超出容差且同向 → evidence；都超出且翻转 → wobble；最近一段在容差内 → evidence（停在端点）；其余 → insufficient。所有 note 写「n=轮数，样本小」。**禁止用「同在轴中点一侧」单独判 evidence**。
2. **apply 语义**：`fresh` 正常写；`due` 写入并在 stderr 告警；`expired` 拒绝（退出码 1）并写清到期理由。`--now` 可注入时间用于复审演练。次数语义：用满 `maxRuns`（3）判 due，`runCount > maxRuns` 才 expired。
3. **目录与 runId**：`build` 遇到同名回合目录时，目录名与 `runId` 一起加数字后缀，避免「目录带 -2 但 runId 没变」的错位。
4. **空台账**：`credentialState` 返回 `fresh`、`validUntil: null`，理由「尚无运行记录，偏好档位未建立」；`review` 对空台账只提示先跑 demo。
5. **between 的 derived**：`betweenValues` 按数值升序；`interval = {lo, hi, mid, half}`；absolute 时二者为 null。
6. **指纹**：`envFingerprint` 取 platform/node/presenter/recorder 的稳定串 sha256 前 12 位，缺失字段用 `?`；传了当前指纹但记录缺指纹时不判变化。
7. **时间**：`validUntil = recordedAt + 14 天`（ISO）；`at` 只接受带时区的完整 ISO；有效性三条件互相独立，任一触发即 expired。
8. **退出码**：答案 runId 不符、答案非法 JSON、validateAnswer 失败、apply 找不到 run、apply 过期、重复落账、回合完整性失败、台账坏行 → 1；参数缺失/端点不存在/同端点/未知命令/未知参数 → 2；空台账 review/status → 0。
9. **verify 证据链**：① 骨架一致 + 模板 sha256；② 用 `input.values` + seed 重放生成顺序并与清单比对；③ 每个位置的 run-data HTML 必须等于「按清单值 + 模板重新渲染」的结果（改值即失败）；④ 可见文本与 `aria-label/title/alt` 里不得出现本回合数值、变体 id、任意百分数、`0.xx` 小数；⑤ 占位符干净、run-data 可解析且位置数一致。
10. **append 前置门**：落账前先跑 `verifyRun`，失败拒绝（防「台账与页面所见不一致」）；同一 `runId` 不允许二次落账（append-only，重测要新回合）。
11. **吊销**：`revoke --run <runId>` 或 `--dim <dim>` + `--reason`，追加 `credential.revoked`（`dims: [...]`，可选 `context`）；`credentialState` 读取匹配 dim 的吊销事件并立即判 expired。
12. **review**：`--run <runId>` 只看该回合所属 dim+context；输出「边界」（区间指认给 `[lo, hi]`，单点给「无区间」）与最近一次归因边界。
13. **未知参数**：任何未声明的 `--flag` 退出码 2 并提示 `--help`；usage 里列出 revoke、`apply --now`。
14. **错误呈现**：台账坏行等读取错误转成中文单行 `CliError`，不把堆栈抛给用户。
15. **可辨识阈值 JND（真实观察新增）**：轴可声明 `jnd`（R4 实测 0.05 = 5 个百分点）。`build --between` 在区间宽 < `4×jnd` 时拒绝细分（退出码 2，除非 `--force`）——插值生成 1/4、1/2、3/4 三个内部点，相邻点只差区间宽/4，`2×jnd` 只保证端点可辨、中间点仍可能不可辨（真实使用暴露的规则漏洞）；`convergence` 把 `|差| ≤ jnd` 判为同一档并返回 `jndBand`；`apply` 遇 `jndBand` 写 `boundary.kind = 'jnd-band'` 而不是点值；`review` 输出轴分辨率与同档提示。协议 P4（stopping rule）未覆盖分辨率下限，这是新增规则。
16. **轴副作用代理（V0.2 新增）**：`lib/side-effects.mjs` 按轴类型分派——颜色轴算色相/明度/对比度漂移与色度单调性（阈值见 `DEFAULT_THRESHOLDS`）；字号/间距轴走声明位检查（占位符必须落在轴声明的 CSS 属性上，并登记已知感知耦合）。`build` 越界/声明位不符直接拒绝（退出码 2，不生成）；`manifest.sideEffects` 落盘并随 `run.recorded` 事件入账；`verify` 从 `input.values` 重算并比对；`review` 打印。它是**可推翻的代理**，不证明「该变量就是一个感知维度」。
17. **粗选能力归因的事实核查（V0.2 新增）**：`lib/shortlist.mjs` 的 `analyzeCapabilityEvidence({ htmls, reasonIds })` 只核查实际用到的能力理由，扫描候选 HTML 里 image/motion/data/threeD 特征；`capability-gap.json` 增 `evidence` 与 `attributionConfidence`（`supported` / `weak` / `not-applicable`）；`verify` 从候选页面重算 evidence。`<svg>` 单独出现不算真实素材。
18. **真实运行回归夹具（V0.2 新增）**：「有回归用例才有资格当证据层」。`test/fixtures/real-runs/` 冻结 R1–R3 的事件/清单/指认/校准，`test/regression.test.mjs` 复现已知结论；任何协议或实现改动必须先过这组夹具。
19. **三轴与 JND（V0.2 新增）**：`lib/axis.mjs` 登记 r4 颜色（JND 0.05，真实标定）、r5 正文基准字号（范围 14–20px，JND 1px 估值）、r6 分组间距（范围 10–26px，JND 2px 估值）。`demo --axis r4|r5|r6` 分别用对应受控模板；`build` 从父回合继承模板路径。r5/r6 的 JND 未做真人标定，结论按弱证据处理。
20. **凭证三态（V0.2 新增，只读）**：`credentialState` 增 `kind` / `kindReason`——`axis`（副作用在界内 + 收敛 evidence）/ `exploration`（只有频谱证据）/ `unverified`（无代理记录或未通过）。`review` 展示、`apply` 告警；阻断 apply 暂缓到 smoke test 与预算阈值定稿。
21. **Smoke test（V0.2 新增）**：`test/smoke.mjs` 覆盖运行环境、三条轴 build+verify、完整链路、env_fp 漂移/复位、页面结构、凭证门槛与项目授权、插件包结构；脚本末尾显式列出需要人工/真实环境完成的项目。
22. **凭证写入门槛 `--strict`（V0.2 新增）**：`apply` 默认仍只告警（unverified/exploration 可写弱默认值，保持旧流程）；`--strict` 时只有 `axis` 凭证允许写校准值，其余拒绝（退出码 1，信息写清当前类型与原因）。
23. **项目授权（V0.2 新增）**：`--context-file` 的 `authorization` 字段必须包含非空 `question`，`scope` 只能是 `spectrum_only`（授权不开放插值）；`grantedBy` 可选，默认 `user`；`authorizedAt` 缺省取落账时间。授权随 context 进入 `run.recorded`，`review` 显示授权问题与范围；`apply --strict` 不因授权放行。

## 八、V0.2 评审结论

决策备忘录见 `PROTOCOL-V0.2.md`：P1 只能被代理约束、不能被证明；当前走 A（模板填充）不启动 AST；用户授权只作项目级情境层；chip 归因保留路由但加事实核查。暂缓项与理由也写在该文件第 3 节。

