# Changelog

## 0.1.13

### Added

- 外部 skill 生成管线：`probe_shortlist plan` 写出 4 轮计划（2 轮 lineage + 2 轮 contrast）、锁定内容槽和 `data-slot` 内容契约；`probe_shortlist import` 导入外部 skill 生成的 12 页，校验后组装 `pool.json`，继续走 preview/final/verify。
- `data-slot="title|subtitle|bullet|meta|cta|foot"` 内容契约：自由生成的页面不必套固定布局模板，只要保留这六个槽；现有 class 仍兼容。
- 外部池审计：`verify` 检查 `skill.id/source/license`、`contentHash`、12 页 HTML 哈希、内容槽、关系、无外链和整池不重复。

### Notes

- 插件只读外部 skill 的 `SKILL.md` / `references/`，不执行其脚本；生成由 DSH 模型完成。
- 外部生成不承诺位级复现；`plan.json`、`skill` 元数据和 HTML 哈希用于事后审计。
- 模板池（18 世界 / 9 骨架）保留为 fallback、对照和回归夹具；built-in 自由生成模式 B 仍未做。

## 0.1.12

### Added

- 生成源从 12 张世界卡扩到 18 张：新增「公共现代」（站牌系统、市政公告、航站楼屏）与「自然印刷」（植物图鉴、田野笔记、档案盒）两族，每族 3 个 variant。
- 骨架库从 5 张扩到 9 张：新增 `hero-offset`、`minimal-list`、`editorial-index`、`poster-stack`，结构签名与内容槽均通过现有闸门。
- `pool` 改为按 seed 从扩展库抽 4 轮 × 3 = 12 个候选：前两轮 lineage、后两轮 contrast，12 个世界不重复。默认 seed 是 `brief.runId`，所以新回合会得到新组合；`--seed` 可复现同一批。
- `probe_shortlist` 新增可选 `seed` 参数；`pool.json` 记录 `seed` 与 `writer`，便于复查。
- `init` 的下一条提示改为默认 `pool → preview`，与 0.1.11 的工作台默认流程一致。

### Fixed

- 世界/骨架池计划在生成前做关系、跨族、档位、结构签名与 12 个不重复校验；找不到有效组合时会重试并最终给出中文错误，不写出半成品池。
- 池内各轮 `contentHash` 必须一致，避免混入不同内容槽的候选。

### Tests

- 新增 18 世界 / 6 族 / 9 骨架的计数与结构签名测试。
- 新增世界池与骨架池的 seed 复现、不同 seed 变化、关系校验和入库测试。

## 0.1.11

### Fixed

- 工作台动作（pipeline / decide / final）落账成功后同步 `.design-kit-state.json`。之前 UI 终选只写了回合 `state.json`，会话状态仍是 `shortlistFinished:false`，`probe_measure` 会被永久拦住；现在 UI final 后可直接进精调。
- 兼容 0.1.10 及更早的旧状态：`unfinishedShortlist` 会读取当前回合的 `state.json`，发现 `finished:true` 就自动回写会话状态并放行，不需要手工改文件。
- `probe_measure` 的 `ledger` 参数现在真正透传为 `--ledger`；`measureRun` 也从 `args` 里的 `--run` 取值，不再读取不存在的 `args.run`。
- `shortlist.mjs init` 先校验 `brief.content` 再创建回合目录；初始化写到一半失败会清理半成品目录，不再在 `shortlist-runs/` 留下空壳回合。
- 工作台浮层收到新的 preview 令牌时会重挂载候选卡，避免复用的 `seen` / 短名单 / 特征状态串到下一轮。
- 显式 `rendererCli` 指向原生可执行文件（如 `.exe`）时直接执行，不再错误地交给 `node`；`.js` / `.cjs` / `.mjs` 仍通过 node 调用。

### Tests

- 新增 UI 动作 → 状态机 → measure 的端到端回归；新增 `probe_measure` 自定义 ledger 回归；新增 init 失败不留空目录回归；新增原生渲染器路径回归。

## 0.1.10

### Added

- Design Kit 工作台：`probe_shortlist_preview` 打开 `shell.overlay` 全屏浮层，复用三栏候选卡。对话里只留「已打开」轻条，提交后关闭浮层。
- 粗选流水线：`shortlist pool` 预生成最多 12 个候选，工作台只亮 3 张。删除或路过后卡片消失，池里下一张补进窗口，不必每轮先待定。整页短名单最多 3 张。
- sidecar `likes.json`（`shortlist-likes/1`）记录 likes / traits / shortlist。已删除的候选仍可 save-trait。preview 带 `likedTraits`；下一轮 `generate` 把特征袋写进候选 JSON 和 stdout，不改 HTML，不写 decide，不写台账。
- 终选轻闸门：短名单至少 1 张，或声明底稿且特征袋至少 1 条。特征袋空且没有短名单时拒绝 final。

### Fixed

- `design_capture` 成功时不再返回 `note: undefined`，避免 DSH lossless JSON 校验报错。
- `/dkit` 路由改为对话正文里的中性选项，不再用带「推荐」的 `ask_user_question` 卡片。

### Notes

- 不把 12 张一次摊开，不做 blend，不做特征 token 化，12 的封顶不提高。删除理由不会自动变成生成约束。writer 仍不写 decide / 台账。内容槽锁定和现有 generate / archetype 路径保留。

## 0.1.9

### Added

- 粗选骨架库：`probe-kit/archetypes/` 五张自写完整页（hero-centered、hero-split、editorial、brutal-cards、minimal-band），带 family / axisTags / license / sourceNote / skeletonHash。`NOTICE.md` 说明当前没有 MIT 派生代码。`DISCIPLINE.md` 是仓内反模板摘要，不内置外部 skill，也不做打分。
- `generate --writer=worlds|archetype`。有骨架库时默认 archetype，库为空则回落 worlds。按 lineage / contrast 抽三张骨架，填入 Phase 1 内容槽，再套世界 token。`add` / `verify` 沿用内容槽、外链和关系闸门，并核对 skeletonHash 与结构签名。
- 不新增宿主工具。对话仍走 `probe_shortlist` 的 `generate`。

### Notes

- 自由生成模式 B、Figma 转 HTML、未清洗的社区整页，都没做。writer 不写 decide，也不自己写台账。

## 0.1.8

### Added

- 粗选生成源 Phase 1：`renderCandidate` 接受 brief 内容槽（title / subtitle / 3 条要点 / cta / foot），同一轮三个候选共用；不传内容时仍是山径书店演示文案。
- `shortlist.mjs generate` 与 `probe_shortlist` 的 `generate` 子命令：按现有 lineage / contrast 计划渲染 3 个完整页，写出可 `add` 的候选 JSON（`writer` / `contentHash` / `skeletonHash`）。不写 decide，不自己写台账；`--add` 才交给 `add` 落账。
- 入库闸门：内容槽不一致、HTML 相同或含外链的候选在 `add` 前拒收。

### Notes

- 没有新工具。宿主对话走现有 `probe_shortlist` 的 `generate` 子命令，避免模型绕过 CLI 继续手写三页。
- Phase 2（archetype 池）和自由生成模式 B 未做。不从 Figma 转 HTML，也不内置外部 skill。

## 0.1.7

### Added

- 新增 `/dkit` 宿主命令：把对话直接转成 design-kit 流程；无参数时先问目标，带参数时直接开始。
- 粗选三栏卡支持自定义删除理由：删除候选后可选填文本，终选“都不行”也可补理由；理由写入决策/选择记录，不替代固定 reason chip。

### Changed

- 未改 JS 行为与既有 id/data-goto；`/dkit` 在无 commands 服务的 profile 中自动跳过注册。

## 0.1.6

### Fixed

- 粗选预览改为每张卡片独立令牌：存在 `run/.ui-tokens/<token>.json`，重复 preview 不再覆盖旧卡片；`probe_shortlist_ui_action` 只消费当前卡片的令牌，其他预览仍可继续使用。
- 令牌目录自动清理过期记录并限制同回合数量（最多 32 个）；客户端按 `uiTokenExpiresAt` 在 30 分钟后禁用提交并提示重新预览。
- 清理 0.1.5 的单文件 `.ui-token.json`；旧卡片会明确提示重新预览，不再出现“旧卡片覆盖新卡片”的误报。

## 0.1.5

### Fixed

- Windows 克隆 CRLF 导致 `verify` 误报「页面被篡改」：证据哈希与页面内容比较先归一化行尾；新增 `.gitattributes`（`* text=auto eol=lf`）。
- `npm test` 不再把「沙箱外 CLI 正常执行」当失败：EPERM 断言改为成功或带 `spawnError` 的沙箱拦截；smoke 用 `package.json` 的 `name` 判断布局，不依赖克隆目录名。
- 去掉 `ui-craft/SKILL.md` 与 `references/probe-kit-SKILL.md` 的伪 frontmatter，改为 `ui-craft/METHOD.md` / `references/probe-kit-method.md`，分发物只保留一份真正可注册的 `SKILL.md`。
- 入口 SKILL 增加「工具不可用时的脚本兜底」；README 首行声明本包是 DSH 插件，不是通用 Skill 包。
- 入口 D 路线增加「先查依赖再承诺」；修正 `_sources` 发现路径文档漂移。
- `cordis.patch.yml` 与 package description 统一为 10 个工具；删除 SKILL 里过期的 `version` 字段。
- CLI 默认台账/回合目录改到调用者 cwd，不再写安装目录；`design-tokens` 覆盖前写入 `.bak`。
- 路径牢笼使用 realpath（含不存在目标的最近存在祖先）解析，修复 Windows 8.3 短名误判；候选 HTML 改用 `isWithinRoot`。
- 清理 `shortlist-ui` 空 `finally`、sync-kit 旧文案与 README-FULL 旧插件描述。

## 0.1.4

### Fixed

- `shortlist decide` 现在会把 `state.nextRound` 推进到已生成轮数 + 1；修复下一轮 `add` 被错误编号为旧轮、覆盖原候选的问题。
- `shortlist add` 改为按实际轮次编号并提示状态漂移，不再信任可能过期的 `nextRound`。

## 0.1.3

### Fixed

- 三栏预览卡片被 DSH 的“过程/活动”折叠组包住时不可见：卡片挂载后自动展开最近的过程组，并滚动到卡片位置。

## 0.1.2

### Fixed

- 修复 `probe_shortlist_preview` / `probe_shortlist_ui_action` 参数 schema 的属性级 `required: true`（JSON Schema 要求 `required` 为数组），真实宿主曾报 `Invalid schema ... true is not of type "array"`。
- 增加递归 schema 回归测试，锁住所有工具参数不再出现非数组 `required`。

## 0.1.1

### Added

- 对话内三栏粗选预览：`probe_shortlist_preview` + `probe_shortlist_ui_action` + Web 客户端 `tool.call.toolview`。
- 一次性预览令牌：绑定 run / 轮次 / 候选，30 分钟过期、用后即焚；伪造/过期/状态不匹配拒收。
- 会话路径牢笼：用户数据路径必须在会话工作目录内。
- 异步 execute / async spawn：长任务不再阻塞宿主事件循环，返回 `timedOut`。
- 注册健康检查与分级：核心工具失败 fatal，deck 等可选能力 degraded。
- 薄状态机：粗选未 final 时 `probe_measure` 拒绝进入精调。
- 锁验证：轴声明、模板 sha、变体范围；未知/伪造轴拒收（不启动 AST）。
- deck 依赖缺口结构化 `missing[]`；deck 发现去硬编码。
- 发布物矩阵：runtime / fixtures / docs 三件，runtime 与 npm tarball 不含测试/证据/QA。

### Changed

- preview 候选 HTML 改 gzip+base64，客户端 `DecompressionStream` 解压（约减少 56%）。
- 删除理由 chip 明确为弱先验，不是证明；`capability-gap` 增加 `reasonSignal` / `evidenceStrength`。
- `design-lint --json` 输出 `__DESIGN_KIT_JSON__` 标记行。

## 0.1.0

- 首个统一 `design-kit` 插件：ui-craft + probe-kit + deck 工具 + Web 客户端预览。
- 真实 DSH 0.2.1-rc.5 验收 A–E 通过（工具成功路径）。
