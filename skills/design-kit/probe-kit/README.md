# probe-kit · 偏好探针仪器

把《Skill 探针协议（泛化版）V0.1》里最需要「仪器」的四件事做成可执行的最小件：

1. **盲呈现器**：同一骨架、只扰动一个参数的 3 个变体并排；页面不显示任何数值、变体 id、颜色名。
2. **指认记录**：绝对指认 / 区间指认、翻转次数、停留时长、把握程度，写进一条 `probe-answer/1` JSON。
3. **append-only 台账**：JSONL 事件流。有效期为 `min(硬时间, 有效次数, 环境指纹)`，禁止加权。
4. **到期复审**：`review` 给出状态与收敛结论；`apply` 只写默认值，过期拒绝写入。

用协议里已经实战验证过的 **R4（强调色的蓝饱和度）** 维度跑通。零依赖、离线、`file://` 直接打开。

## 快速开始（两轮真实流程）

```bash
cd probe-kit

# 第 1 轮：生成盲测回合，3 个变体顺序随机并由 seed 记录
node probe.mjs demo                    # 默认 r4（强调色饱和度）
node probe.mjs demo --axis r5          # 正文基准字号（15/17/19px）
node probe.mjs demo --axis r6          # 页面纵向节奏（12/24/36px）
# 打开 runs/r4-demo-1/run.html（本地文件，不联网）
# 在页面里：选区间（点两个位置）→ 选把握程度 → 锁定 → 下载 answer-r4-demo-1.jsonl

# 落账 + 归因
node probe.mjs append --run runs/r4-demo-1 --answer answer-r4-demo-1.jsonl
node probe.mjs attribute --run r4-demo-1 \
  --assumption "用户对强调色的偏好落在中低饱和度区间" \
  --falsified-by "区间指认落在中段，且改过一次主意" \
  --boundary "只在该卡片内容与桌面端成立" \
  --confidence low

# 第 2 轮：在指认区间内插值出微变体（协议 3.2 / 3.3）
node probe.mjs build --from-run runs/r4-demo-1 --between 1,3
# 打开 runs/r4-demo-1-r2/run.html，选一个位置并锁定

node probe.mjs append --run runs/r4-demo-1-r2 --answer answer-r4-demo-1-r2.jsonl
node probe.mjs review
node probe.mjs apply --run r4-demo-1-r2 --out calibration.json
```

如果某次出现硬失败、需要作废这个维度的偏好档位：

```bash
node probe.mjs revoke --run r4-demo-1-r2 --reason "该维度在真实任务里连续失败"
# 之后 review 判 expired，apply 会拒绝写校准值
```

仓库里已经放了一份**脚本模拟**的完整产物（不是真人指认，只用于演示链路）：

- `examples/answer-r4-demo-1.jsonl`（区间指认 + 1 次改主意，把握 2）
- `examples/answer-r4-demo-1-r2.jsonl`（插值回合选中 38%，把握 4）
- `examples/ledger.jsonl`（2 次 run + 1 次归因 + 1 次应用）
- `examples/calibration.json`（`accent_saturation = 38%`，带边界与到期信息）

另有**真实记录**（真人指认，2026-11-02）见 [REAL-RUN.md](REAL-RUN.md)，台账在 `ledger/ledger.jsonl`：

- r4 颜色：3 轮，42% + JND 等效带 [42.2%, 43.75%]，状态 due；
- r5 字号：1 轮，区间 [15,17]、低置信度，凭证 exploration；
- r6 纵向节奏：2 轮，R1 24px → R2 18px 差 6px ≤ JND，判同一档；凭证 **axis**，校准 `ledger/calibration-r6.json`（18px，等效带 [18,24]，2/3 轮 due）。

重放这批产物：

```bash
node probe.mjs review --ledger examples/ledger.jsonl
node probe.mjs status --ledger examples/ledger.jsonl
node probe.mjs apply --run r4-demo-1-r2 --out /tmp/cal.json --now 2026-11-25T00:00:00Z --ledger examples/ledger.jsonl
# 最后一条会以退出码 1 拒绝：凭证已过期
```

## 一次复审长这样

```
维度 accent_saturation · 情境 {"projectType":"demo","audience":"owner","device":"desktop"}
  状态: due  ·  轮次: 2/3  ·  到期: 2026-11-16T…Z
  理由: 已使用 2/3 次运行机会，接近上限
  收敛: evidence · R1 0.375 → R2 0.375，两轮差 0 ≤ 轴跨度 5%（0.05），视为一致；n=2 轮，样本小，仅作弱证据
  校准版本: 1
  边界: 单点指认 0.375，无区间，边界未知

协议诚实警告（不改数据，只提示解释边界）：
  - coverage 未度量：…（协议 P8）
  - 单评审人：…（协议 P5）
  - 轴纯度无事实核查：…（协议 P1）

结论: 1 个维度需要复审（accent_saturation）。到期复审是回归测试，不是重开探索。
```

`apply` 的规则：`fresh` 正常写；`due` 写入但告警；`expired` 拒绝（退出码 1）并写清到期理由。「次数用满 3 次」判 due（还能用第 3 次结果），第 4 次才越限判 expired。`review --run <runId>` 只看某一个回合。

**凭证门槛（V0.2）**：默认只告警（`unverified` / `exploration` 仍可写弱默认值）；加 `--strict` 后只有 `axis` 凭证允许写校准值，其余直接拒绝（退出码 1）。`apply --strict` 适合接入 CI 或对外交付。

**项目授权（V0.2）**：`--context-file` 里可写 `authorization: { question, scope: "spectrum_only", grantedBy }`。授权的语义只有一句：**这个项目值不值得花采样预算探这个维度**；它不判定偏好、不判定轴成立、只开频谱采样，不开放插值。`review` 会显示授权问题与范围；`apply --strict` 不因授权放行。

## 协议条款 → 实现状态

| 协议条款 | 本工具 | 状态 |
|---|---|---|
| 前提 1 问情境不问偏好 | `context` 由 `--context-file` 或默认值记录；CLI 不询问偏好 | 部分 |
| 前提 2 受控变体 | 单占位符替换、骨架一致性校验、seed 顺序记录 | 实现 |
| 前提 3 writer ≠ evaluator | 呈现器只收行为；没有 AI 评分环节 | 实现 |
| 前提 4 先剔硬伤 | 交给 ui-craft 的 `design-lint`，本工具不内建 | 外部 |
| 3.0 轴判据 | 轴以 `kind: continuous` 声明；V0.2 起登记 r4 颜色 / r5 正文基准字号 / r6 分组间距三条轴；轴纯度由副作用代理检查 | 部分（代理） |
| 3.1 受控扰动 | 唯一占位符 + 骨架字节级还原校验 + 顺序入账 | 实现 |
| 3.2 相对定位 | 「选区间」模式 → `chooseBetween` | 实现 |
| 3.3 区间插值 | `build --between` 按 1/4、1/2、3/4 生成微变体；插值后相邻变体差 = 区间宽/4，所以区间窄于 4×JND 时拒绝继续细分（除非 `--force`），否则三个微变体彼此不可辨 | 实现 |
| （协议未覆盖）可辨识阈值 JND | 轴声明 `jnd`；低于 JND 的差异视为同一档，`apply` 写「等效区间」而不是点值；这是真实三轮观察暴露的问题，协议 P4 未覆盖 | 新增 |
| （协议未覆盖）轴副作用代理 | 颜色轴算色度/色相/明度/对比度漂移；字号/间距轴核对占位符的声明位并登记已知感知耦合；串维时 `build` 拒绝生成 | 新增 |
| （协议未覆盖）凭证三态 | `axis`（副作用在界内 + 收敛 evidence，唯一可插值）/ `exploration`（只有频谱证据）/ `unverified`（没有通过的代理）；当前只读展示 + apply 告警，未阻断 | 新增 |
| （协议未覆盖）粗选交互 | 4 轮 × 3 = 12 个候选；只删/待定；待定满 3 三选一；用尽或否决 → 能力缺口归因。协议只覆盖单轴参数级探针，没有世界级选择 | 新增 |
| （协议未覆盖）失败归因路由 | 删除理由按 capability / brief / taste / no-preference 分类，输出 route 与 `capability-gap.json`；负结论 +1 年有效期 | 新增 |
| 3.4 收敛判定 | 两轮只认「差 ≤5%」；两轮差超出容差 → insufficient（要求第 3 轮）；≥3 轮看最近两段位移：同向 → evidence、翻转 → wobble；按 `dim + context` 分组，不跨情境迁移 | 实现 |
| 凭证制 min() 有效期 | 时间 / 次数超上限 / 环境指纹三路取最小，任一触发即过期；用满 3 次先判 due | 实现 |
| 维度级吊销 | `revoke --run/--dim` 追加 `credential.revoked`；状态机读取该事件，立即判 expired | 实现 |
| 到期复审 = 回归测试 | `review` 列出到期维度与边界；「不重开探索」靠流程约束 | 部分 |
| 冷启动分层 | 未做（协议建议 dry-run → 低风险 → 全信任） | 未做 |
| 预算法（P2） | 未做（阈值未定） | 未做 |
| 被动续期 | 未做（涉及静默观测，需要显式同意） | 未做 |
| P1 / P4 / P5 / P8 / P10 | 未解；`review` 固定输出三条诚实警告 | 未解 |

`review` 输出的三条固定警告对应协议自己的问题保留清单：coverage 未度量（P8）、单评审人（P5）、轴纯度无事实核查（P1）。这不是免责声明，是提醒不要把单次结论当证据。

## 粗选模式（shortlist）

精调之前先选「世界」。`shortlist` 是第二个交互模式。0.1.12 起，`pool` 从 18 张世界卡 / 9 张骨架里按 seed 抽最多 12 张进池，窗里只亮 3 张：删除或路过就补位，整页短名单最多 3，不必每轮待定。喜欢和特征写在 `likes.json`。旧的轮次页仍是每轮 3 个候选、最多待定 1 个，待定满 3 进入三选一。用满 **12 个** 或终选「都不行」，就停止生成，先归因再决定下一步，不做第 13 个。默认 seed 是 `brief.runId`，新回合会换组合；`--seed` 可复现。

```bash
node shortlist.mjs pool --run shortlist-runs/<id> [--seed <id>]   # 抽 ≤12，不写 decide / 台账
node shortlist.mjs plan --run shortlist-runs/<id> [--seed <id>]   # 外部 skill：4 轮计划 + data-slot 契约
node shortlist.mjs import --run shortlist-runs/<id> --bundle <bundle.json> # 外部 skill：导入 12 页
node shortlist.mjs likes --run shortlist-runs/<id> --file likes.json
```

外部 skill 的页面可以用 `data-slot="title|subtitle|bullet|meta|cta|foot"` 锁内容槽，不必套世界卡/骨架布局；`import` 会校验 4×3、内容槽等于 `plan.content`、关系、HTML 互异、无外链/脚本和 12 个不重复。

```bash
cd probe-kit
node shortlist.mjs demo --scenario both        # 两条模拟链路：success / capability-gap
node shortlist.mjs init --brief brief.json     # { title, prompt, context? }（cap 固定，不需填）
node shortlist.mjs add --run shortlist-runs/<id> --candidates r1.json --context-token fresh-a
node shortlist.mjs decide --run shortlist-runs/<id> --round 1 --decisions decisions-r1.jsonl
node shortlist.mjs final --run shortlist-runs/<id> --choice choice.jsonl
node shortlist.mjs report --run shortlist-runs/<id>
node shortlist.mjs verify --run shortlist-runs/<id>
```

规则：

- **每轮候选必须声明关系，不能盲比**：`lineage` = 同族不同派（同一 `family` 的三个不同 `variant`，如油画印象派/写实派/表现派）；`contrast` = 同一对比轴三档（同一 `axis` 上 `low/mid/high` 各一个，且跨 ≥2 个 `family`，如极简↔华丽）。候选文件是 `{ relation, family?/axis?, candidates:[...] }`，缺关系会被拒绝。
- 同一轮候选的 HTML 必须互不相同；候选 HTML 不得有外链（含协议相对 `//`）。**工具只能校验声明的族/轴与 HTML 互异；「风格真的不同」由生成器负责**（建议每轮换独立上下文与材料家族）。
- 内置 18 张世界卡分 6 族（印刷传统 / 手作纸品 / 图像展示 / 信息呈现 / 公共现代 / 自然印刷）；`pool` 按 seed 抽 4 轮 = 2 轮 lineage + 2 轮 contrast（装饰密度 / 影像参与度），12 个世界不重复。经典 `generate` 仍用固定的 4 轮代表计划。
- archetype 池的 12 个候选会复用骨架（常 6–9 个唯一结构），唯一性按 `archetypeId--worldId` 对计；结构差异有限，更多方向用 external skill 或 `writer: "worlds"`。
- **上限固定**：4 轮 / 12 个 / 待定 3 个由工具强制，`brief.cap` 改成别的值会被拒绝；待定满 3 后不能再 add/decide，只能 final。
- 每轮最多待定 1 个；每轮使用独立的 `generationContext`（连续相同会告警），避免候选关系坍缩成同质三胞胎。
- 必须先 decide 上一轮才能生成下一轮；已结束的回合不能再落 decisions。
- 待定满 3 → `final.html` 三选一；三选一或「都不行」都要落账。`final` 前会先跑完整性校验，校验不过不允许终选。
- **12 个用尽或终选否决 → 生成 `capability-gap.json`**：按**删除理由 + 终选否决理由**的 tag 归因到 `capability / brief / taste / no-preference`，给出路由，负结论带 1 年硬有效期。
- 归因阈值：capability ≥ 40% → 换能力（skill/插件）；brief ≥ 40% → 回提问补情境；no-preference ≥ 40% → 接受默认值；否则 taste → 扩大世界候选。
- `verify` 现在有 6 项：上限与轮次连续性、**关系成立**（lineage 同族不同派 / contrast 三档跨族）且 HTML 互异、候选/页面 HTML 的 sha 与外链、决策与轮次连续性、待定数、收口产物与状态一致性（`result.json` / `capability-gap.json` 可重算）。`round-N.html` 与 `final.html` 也会按 `pageSha` / `finalPageSha` 校验，手改页面会被打红。

**粗选 vs 精调**：shortlist 只负责世界选择。选定后用 `probe.mjs` 的单轴 + JND 做参数微调。拿 shortlist 做微调会撞分辨率下限（真实数据：39.1% / 40.6% / 42.2% 三档肉眼不可辨）。

两条 demo 的实际结果（模拟决策，不是真人数据）：

- `success`：3 轮 9 个候选（R1 印刷传统三派 lineage、R2 手作纸品三派 lineage、R3 装饰密度三档 contrast）→ 待定满 3 → 选中 `w-archive`（索引归档，R2）→ `nextStep.mode = axis`。
- `gap`：4 轮 12 个全删 → `attribution = capability`，缺失能力「真实素材、动效与交互原型」，负结论到期 2027-11-02；`verify` 通过。

页面：`shortlist-runs/sl-demo-success/round-1.html`、`shortlist-runs/sl-demo-success/final.html`、`shortlist-runs/sl-demo-gap/capability-gap.json`。

## 设计取舍

- **盲性优先于方便**：页面里只有「位置 1..N」，数值只在 `append` 时由台账解析。`verify` 检查三件事：可见文本与常用属性里没有数值/变体 id/百分数；清单顺序能用 seed 重放；每个位置的页面 HTML 必须等于「按清单值重新渲染」的结果，改一个数值就会失败。
- **证据链可校验**：`append` 先跑一次完整性校验再落账，同一 `runId` 不允许重复落账；`verify` 的每个勾都能被一个真实的篡改测试打红（自测里就是这么做的）。
- **append-only**：台账只追加。重复 `apply` 是新版本，不覆盖旧记录；需要撤销就 `revoke` 追加吊销事件，状态机立即判 expired。
- **有效期禁止加权**：`min(硬时间, 有效次数, 环境指纹)`。次数项不能买通时间项，否则就是协议点名的 fail-open。
- **仪器分辨率优先**：轴必须声明可辨识阈值 `jnd`（R4 实测为 5 个百分点：39.1/40.6/42.2 肉眼不可辨）。插值会生成 3 个内部点、相邻点只差区间宽/4，所以区间窄于 **4×JND** 时 `build` 直接拒绝细分；低于 JND 的两轮差异判为「同一档」，`apply` 写等效区间。没有 JND 的细分只是在制造噪声。
- **不制造统计幻觉**：两轮同向只叫 `evidence`，`note` 明写「n=2 轮，样本小，仅作弱证据」；两轮差超出容差直接判 `insufficient`，不硬凑结论；跨情境不自动迁移。
- **客观层不重复造**：硬伤检查属于 ui-craft 的 lint，本工具只做偏好引出与台账，不混两种证据。
- **轴纯度用副作用代理，不用 AST（V0.2）**：颜色轴直接算色相/明度/对比度漂移与色度单调性；色相漂 >2°、明度漂 >0.5pt、对比度漂 >0.15 或色度不单调 → 判串维，`build` 拒绝生成。它只证明「扰动没有同时改动别的感知量」，是可推翻的代理，不证明「这个变量就是一条感知轴」。详见 [PROTOCOL-V0.2.md](PROTOCOL-V0.2.md)。
- **能力归因要过页面事实核查（V0.2）**：用户说「缺素材/动效/图表/3D」时，扫描所有候选 HTML 里对应特征是否真的完全没有；核对不上的归因只作弱先验（`attributionConfidence = weak`），不直接换工具。
- **已知结论冻结成回归夹具（V0.2）**：R1–R3 的真实事件、清单、指认、校准在 `test/fixtures/real-runs/`，任何改动先跑 `test/regression.test.mjs`；「有回归用例才有资格当证据层」。

## 测试

```bash
node test/ledger.test.mjs        # 26 个台账用例
node test/presenter.test.mjs     # 41 条精调呈现器静态断言
node test/selftest.mjs           # 32 个精调集成用例（状态机/轴/生成/校验/台账全链路/防篡改/吊销/JND）
node test/side-effects.test.mjs  # 11 个轴副作用用例（颜色串维/声明位/三条轴 build-verify）
node test/smoke.mjs              # 11 项仪器通电检查（三条轴/链路/凭证三态与门槛/授权/env_fp 复位/页面/插件结构）
node test/regression.test.mjs    # 10 项真实运行回归夹具（R1-R3 结论复现）
node test/worlds.test.mjs        # 18 张世界卡（6 族 × 3 variant）+ seed 池计划（关系/复现断言）
node test/shortlist-ui.test.mjs  # 82 条粗选页面静态断言
node test/shortlist.test.mjs     # 32 个粗选用例（关系/状态机/归因/能力证据/上限闸门/CLI 全链路）
node probe.mjs selftest          # 精调集成用例的 CLI 入口
node probe.mjs verify --run runs/r4-demo-1
node shortlist.mjs verify --run shortlist-runs/sl-demo-success
```

当前结果：26 + 41 + 32 + 11 + 11 + 10 + 1179 + 82 + 32 全绿；精调四个 demo 回合（r4/r5/r6 与 r4 第二轮）、粗选两个 demo 回合 `verify` 均通过。协议评审结论与暂缓项见 [PROTOCOL-V0.2.md](PROTOCOL-V0.2.md)。

## 已知限制

- **没有真人数据**：示例台账是 `examples/simulate-answer.mjs` 脚本模拟的，验证链路而不是结论。真实一次指认需要你在浏览器里打开 `run.html` 点一次。
- **构建环境无法启动浏览器**：Chrome/Edge headless 被沙箱拒绝，呈现器只做了静态断言与 stub DOM 冒烟，**没有实际渲染验证**；视觉与交互需要你在浏览器确认。
- 呈现器在 iframe 上盖了一层透明命中层（否则跨文档 iframe 吞掉点击与悬停），因此候选内容不可交互。这是有意的。
- 单评审人、单场景，结论强度上限就是「一个人的一次偏好」。
- 环境指纹较保守：node 版本或呈现器版本变化都会让旧凭证过期。这是有意的 fail-closed。
- 登记了三条轴：r4 颜色（JND 5 个百分点，真实三轮观察）、r5 字号（JND 暂按 1px 估）、r6 纵向节奏（首次 12/18/24px 的 6px 步长看不出差异，JND 上调到 6px 估值，demo 改为 12/24/36px）。r4 的 JND 换内容/显示器/人需重测；r5/r6 的 JND 未做真人标定，结论只能算弱证据。
- 副作用代理有边界：颜色轴证明的是「色相/明度/对比度没跟着动」，字号/间距轴证明的是「占位符落在声明的属性上」；感知耦合（行宽、一屏内容量、标题比例）只登记、未测量。
- 凭证三态（axis / exploration / unverified）目前只读展示并告警，还没有阻断 `apply`；阻断要等 smoke test 与预算阈值定稿后再开。
- `verify` 防的是「清单与页面对不上」和「手改数值」这类篡改，不是密码学签名：同时伪造清单、模板与页面的人仍能骗过它。要更强保证需要签名或外部锚点。
- `review.done` 事件已定义但 CLI 还没写（复审本身不落账）；`status` 分别打印「最近回合落账」与「台账最后事件」，两者含义不同。
- 旧版本生成的回合缺 `input.values`，会被 verify 拒绝（fail-closed）；重新 `build` 生成即可。
- 台账并发写入只保证追加行级原子性，多进程同时 append 未做锁；单机单人使用没问题。

## 目录

```
probe-kit/
├── probe.mjs                 # 精调 CLI：demo/build/append/attribute/revoke/review/apply/status/verify/selftest
├── shortlist.mjs             # 粗选 CLI：init/generate/pool/add/likes/decide/final/report/verify/demo/status
├── lib/recorder.mjs          # 指认状态机（无 DOM，浏览器与 Node 共用）
├── lib/shortlist-recorder.mjs# 粗选轮次/终选状态机
├── lib/shortlist.mjs         # 理由 chips、关系校验、上限、归因、能力缺口
├── lib/worlds.mjs            # 18 张世界卡、候选渲染与 seed 池计划
├── lib/archetypes.mjs        # 骨架库：关系抽签、内容槽、世界 token
├── archetypes/               # 九张完整页骨架、索引、DISCIPLINE、NOTICE
├── lib/axis.mjs              # 轴定义、谱点、插值、JND
├── lib/ledger.mjs            # 台账事件、有效期、收敛判定
├── templates/presenter.html  # 精调：单轴盲呈现器
├── templates/shortlist.html  # 粗选：轮次页
├── templates/shortlist-final.html # 粗选：终选页
├── fixtures/r4/base.html     # 精调受控内容模板
├── fixtures/worlds/base.html # 18 个世界共用的受控内容骨架
├── examples/                 # 模拟指认、示例台账、校准文件
├── runs/                     # 精调回合（run.html + run.json）
├── shortlist-runs/           # 粗选回合（brief/rounds/state/页面/候选）
└── test/                     # 单测 + 集成自测
```

协议原文：《Skill 探针协议（泛化版）V0.1》草案（2026-10-25）。本工具是它的仪器子集，不是协议全实现。
