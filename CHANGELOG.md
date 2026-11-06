# Changelog

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
