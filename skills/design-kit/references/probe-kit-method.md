# Probe Kit（方法文档）

设计决策要证据，不要反射。「粗选」解决方向选择，「精调」解决参数微调；两者都不要越界。

本插件注册两个工具：`probe_shortlist`（粗选）与 `probe_measure`（精调）。下面的示例用工具 JSON 写法；如果你在原始 `probe-kit/` 源码目录里工作，也可以直接跑 `node shortlist.mjs ...` / `node probe.mjs ...`，但记得把 `--run`、`--out`、`--ledger` 指到会话工作目录。

## 先判断用哪一半

| 问题 | 用 | 产物 |
|---|---|---|
| 方向没定，要在几个世界里选 | `probe_shortlist` | `result.json` 或 `capability-gap.json` |
| 方向已定，要调某一参数（饱和度/字号/圆角） | `probe_measure` | `calibration.json` + 等效区间 |
| 用户说「都差点意思」 | 先粗选并跑满规则，不生成第 13 个 | 归因 + 路由 |

**不要用粗选做微调**：世界级交互的最小差异远大于参数级，微调会撞 JND（真实数据：39.1% / 40.6% / 42.2% 三档肉眼不可辨）。

## 粗选：有关系地比，不盲比

**先 generate，再 add，再 preview。** 回合里还没有这一轮候选时，不要声称已经有三个方向，也不要手写三份 HTML。

`generate` 从 brief 得到三页共用的内容槽（title / subtitle / bullets 恰好 3 条 / cta / foot）。brief 可以自带 `content`；没有就按 title 和 prompt 做确定性截取。`generate` 不写 decide、不写台账；`--add` / `add: true` 才把候选交给 `add` 落账。

`--writer=worlds|archetype`。省略时：`probe-kit/archetypes/` 里有骨架就用 archetype，否则回落 worlds。

- `archetype`：按关系抽三张完整页骨架（结构不同），再套世界 token。首批五张：`hero-centered`、`hero-split`、`editorial`、`brutal-cards`、`minimal-band`。族是 `stage` / `press`。纪律见 [../probe-kit/archetypes/DISCIPLINE.md](../probe-kit/archetypes/DISCIPLINE.md)，来源见同目录 `NOTICE.md`。当前没有从 MIT 页面搬来的结构。
- `worlds`：同一份内容槽套 12 张世界卡里的一轮，只换视觉。族是印刷传统 / 手作纸品 / 图像展示 / 信息呈现。

自由生成（模式 B）没做。不从 Figma 转 HTML，也不运行外部 skill。

每轮候选之间**必须声明关系**。`add` 会拒收内容槽不一致、HTML 相同或带外链的文件；archetype 还会拒收 skeletonHash 或结构签名对不上的文件：

- `lineage`（同族不同派）：三个候选同属一个 `family`，`variant` 各不相同。
- `contrast`（对比轴三档）：三个候选在同一个命名 `axis` 上分别取 `low` / `mid` / `high`，且跨至少 2 个 `family`。轴是 `ornament`（装饰密度）和 `image`（影像参与度）。

`generate` 写出的候选 JSON 与 `add` 兼容。`writer` / `contentHash` / `skeletonHash` / `content` 会记进回合，供 verify 重算；decide 不读它们：

```jsonc
{ "relation": "lineage", "family": "stage",
  "writer": "phase2-archetype", "contentHash": "...", "skeletonHash": "...",
  "candidates": [ { "id": "hero-centered--w-swiss", "archetypeId": "hero-centered",
    "world": { "family": "stage", "variant": "居中论点",
    "material": "...", "type": "...", "layout": "居中首屏", "color": "..." }, "html": "<!doctype html>..." } ] }
```

世界卡模式仍是 `writer: "phase1-worlds"`，`family` 例如 `print-tradition`。

流程（`probe_shortlist`）：

```jsonc
probe_shortlist({ "command": "init", "brief": "brief.json" })              // 建回合
probe_shortlist({ "command": "generate", "run": "shortlist-runs/<id>", "round": 1, "add": true, "contextToken": "fresh-a" })
probe_shortlist_preview({ "run": "shortlist-runs/<id>" })                  // 对话内三栏；不要跳过
probe_shortlist({ "command": "decide", "run": "shortlist-runs/<id>", "round": 1, "decisions": "decisions-<runId>-r1.jsonl" })
probe_shortlist({ "command": "final", "run": "shortlist-runs/<id>", "choice": "choice-<runId>.jsonl" })
probe_shortlist({ "command": "report", "run": "shortlist-runs/<id>" })     // 理由直方图 + 世界覆盖 + 归因
probe_shortlist({ "command": "verify", "run": "shortlist-runs/<id>" })     // 6 项完整性
```

脚本等价物：`node shortlist.mjs generate --run <dir> --round 1 --add --context-token fresh-a`。只要世界卡时加 `--writer=worlds`。只写文件、不入库时去掉 `--add`。

默认把回合写到 `<会话 cwd>/shortlist-runs/`，台账写到 `<会话 cwd>/probe-kit-ledger/ledger.jsonl`；可用 `out` / `ledger` 覆盖。

硬规则（工具强制，不要试图绕过）：

- 每轮恰好 3 个候选；每轮最多待定 1 个；删除必须带理由 chip。
- 上限固定 **4 轮 × 3 = 12 个、待定满 3**；`brief.cap` 不能放宽。
- 待定满 3 后不能再 add/decide，只能 final；未 decide 上一轮不能生成下一轮。
- final 前自动跑完整性校验；页面 HTML 有 `pageSha` 防篡改。
- 同轮 HTML 必须互不相同，且三页内容槽（title / subtitle / 3 条要点 / cta / foot）必须一致。archetype 还要结构签名彼此不同，且和骨架文件的 skeletonHash 一致。工具能查的是声明的族/轴、内容槽锁定、结构差异与哈希，**像不像仍要人看**。

### 12 个用尽或终选「都不行」：先归因，不要自动换工具

按删除理由 + 终选否决理由的 tag 统计（阈值 40%）：

| 归因 | 判定 | 路由 |
|---|---|---|
| capability | capability ≥ 40% | 换能力：加载/安装具备缺失能力的 skill 或插件 |
| brief | brief ≥ 40% | 回提问：补 project_type / target_audience / 约束 |
| no-preference | no-preference ≥ 40% | 接受默认值，记录负结论 |
| taste | 其余 | 扩大世界候选：换材料家族 |

`capability-gap.json` 带 `missingCapabilities`、`reasonCounts`、`axisCoverage`、`expiresHard`（+1 年）。负结论到期前不要重复烧候选。

## 精调：单轴 + JND

用 `probe_measure`（参数放 `args` 数组，原样透传给 `probe.mjs`）：

```jsonc
probe_measure({ "command": "demo" })                                     // 默认 r4 颜色；args 可加 ["--axis","r5"] 或 ["--axis","r6"]
probe_measure({ "command": "build", "args": ["--from-run", "runs/<id>", "--between", "1,2"] })
probe_measure({ "command": "append", "args": ["--run", "runs/<id>", "--answer", "answers.jsonl"] })
probe_measure({ "command": "attribute", "args": ["--run", "runs/<id>", "--assumption", "…", "--falsified-by", "…", "--boundary", "…", "--confidence", "low"] })
probe_measure({ "command": "review", "args": ["--run", "runs/<id>"] })
probe_measure({ "command": "apply", "args": ["--run", "runs/<id>", "--out", "calibration.json"] })
```

- `demo` / `build` 默认输出到 `<会话 cwd>/runs/`；若 args 里自带 `--out` 则以你的为准。
- 三条轴：r4 颜色（JND 已实测 5%）、r5 正文基准字号（JND 估 1px）、r6 页面纵向节奏（JND 估 6px；首次 6px 步长看不出差异后上调，demo 用 12/24/36px）。r5/r6 的 JND 未做真人标定，结论按弱证据处理。
- 每次只变一个轴；指认时盲呈现，不显示数值。
- 轴必须声明 `jnd`：低于 JND 的差异算同一档，不当作证据或抖动。
- `apply` 写等效区间，不写「精确值」。`build --between` 要求区间宽 ≥ 4×JND（插值生成 3 个内部点，相邻只差宽/4），否则拒绝细分。
- **轴副作用闸门（V0.2）**：颜色轴查色相/明度/对比度漂移与色度单调性；字号/间距轴查占位符是否落在声明的 CSS 属性上并登记已知感知耦合。越界或声明位不符直接拒绝生成；`verify` 重算副作用，`review` 打印声明位/Δ。被拒绝时换值或换轴，不要绕闸门。
- **凭证三态（V0.2）**：`review` 会打印 `axis`（副作用在界内 + 收敛 evidence，唯一可插值）/ `exploration`（只有频谱证据）/ `unverified`（没有通过的代理）；`apply` 默认对非 axis 凭证告警，`args` 加 `--strict` 后只允许 axis 写校准值。
- **项目授权（V0.2）**：`append` 的 `--context-file` 可带 `authorization: { "question": "...", "scope": "spectrum_only" }`；授权只回答「这个项目值不值得花预算探这个维度」，不判定偏好/轴成立，也不开放插值；`review` 会展示。
- 归因命令必须写清四个字段：`--assumption`（被检验的隐含假设）、`--falsified-by`（什么证据推翻它）、`--boundary`（适用边界）、`--confidence`（low/medium/high）。
- 结论是区间与默认值，不是排序依据。

判定口径（写死）：

- 能当证据：真实运行回归夹具复现（`test/regression.test.mjs`）+ `verify` 全过 + 副作用在阈值内 + 差异过 JND + 凭证类型为 `axis`。
- 只能当弱先验：单评审人指认、chip 自我报告、n < 3、未过 JND 的同向变化、凭证类型为 `exploration`。
- 不能当证据：源码代理单独成立、被拒绝的串维变体、没有回归复现的结论、凭证 `unverified`。

仪器通电用 `test/smoke.mjs`（11 项自动化）；浏览器目检、真实 DSH 加载、工具子进程、真人 JND 标定仍需人工，脚本末尾会列出来。

完整评审结论与暂缓项见技能目录下的 `PROTOCOL-V0.2.md`。

## 与 ui-craft 的关系

粗选候选走 `generate`（参数化世界卡），不要用 ui-craft 现写三页再塞进 `add`。ui-craft 仍负责模式 A 的正式页面。每轮换独立 `contextToken`，下一轮换 `round`（也就是换材料家族或对比轴），否则关系会坍缩成同质三胞胎。

## 诚实边界

- 本工具不替代浏览器目检：页面只在静态层面验证，视觉溢出、字体回退、窄屏断行仍需人工看。
- 删除理由是声明式信号（用户点的 chip），不是量化测量；能力类理由会核对候选页面里对应特征是否真的缺失（`capability-gap.evidence`，支持/弱两档），但这仍是核查不是证明。
- 单评审人、候选由骨架库或世界卡生成：关系标签、内容槽锁定、结构签名与 HTML 互异是工具能查的，「是否真的同族/真的相反」最终要人复核。文案来自 brief 的内容槽或确定性截取，不是自由撰写。
- 台账 append-only，不要手改；`verify` 失败时先修产物，不要绕过闸门。

## 汇报格式

给出 `runId`、当前轮次/已生成候选数/待定数、本轮关系（lineage 或 contrast + 轴）、删/待定的理由分布、下一步工具调用。不要只报「已经选好了」。
