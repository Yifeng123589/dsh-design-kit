# Changelog

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
