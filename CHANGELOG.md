# Changelog

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
