# dsh-design-kit

> **本包是 DeepSeek Harness（DSH）插件，不是通用 Skill 包。** 换宿主不会自动获得工具；没有注册 `design_* / probe_* / deck_*` 时，按 `skills/design-kit/SKILL.md` 的脚本兜底执行。
>
> 统一设计交付插件：设计审查、设计 tokens、多方向粗选、参数级精调、PPT 质检/导出/渲染。

[![CI](https://github.com/Yifeng123589/dsh-design-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Yifeng123589/dsh-design-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

- 版本：`0.1.8`
- DSH 兼容：0.2.1-rc.5（真实宿主 A–E 已在 0.1.0–0.1.4 通过）；0.1.6 已在隔离 profile + DSH 0.2.2-rc.1 验证 headless 工具调用与 Web 三栏卡片回写
- 一个技能入口：`design-kit`
- 一个斜杠命令：`/dkit`，把对话直接切到 design-kit 流程（可带需求）
- 10 个工具：`design_lint` / `design_tokens` / `design_capture` / `probe_shortlist` / `probe_shortlist_preview` / `probe_shortlist_ui_action` / `probe_measure` / `deck_check` / `deck_export` / `deck_render`
- Web 客户端：粗选三栏 iframe 预览，选择后回传结构化动作（每张卡片独立一次性令牌）；删除/“都不行”可补自定义理由

## 安装

推荐下载 GitHub Release 的 **runtime** 包：

```
dsh-design-kit-runtime-v0.1.8.zip
```

解压后在 DSH 插件管理器选「本地目录」，或：

```powershell
cd <DSH profile 目录>
pnpm add "<解压后的 dsh-design-kit 目录>"
```

再把 `"dsh-design-kit"` 加入 profile `package.json` 的 `dsh.profile.bundles`，**完全重启 DSH**。

完整步骤、Git 仓库安装、配置与排障：[docs/INSTALL.md](docs/INSTALL.md)。

> `fixtures` / `docs` 是复核材料，不要装进 DSH。

> 完整设计与实现说明（长文）：[docs/README-FULL.md](docs/README-FULL.md)

## 快速开始

在对话开始输入：

```text
/dkit
```

不带参数时，插件会要求模型加载 `design-kit` 技能并先问清目标；也可以直接带需求：

```text
/dkit 做一个设计工具落地页，先给三个方向
```

`/dkit` 只是把命令转成一条普通用户消息，不会绕过技能里的方向、证据和选型门。

## 能做什么

| 你说的话 | 走哪条 | 产物 |
|---|---|---|
| 做个落地页 / 改界面 / 审 AI 味 | UI 交付 | 方向 + tokens + 页面 + lint 报告 + DESIGN.md |
| 三个方向选一个 / 都差点意思 | 粗选 | 先 generate 锁定文案，再每轮 3 个世界、删除/待定/三选一、12 个封顶后归因 |
| 红色收一点 / 字号 16 还是 18 | 精调 | 单轴盲测 + 台账 + JND 区间 + calibration |
| 做成 PPT / 汇报 | PPT 交付 | deck_check → PPTX → PDF/PNG |

核心约束：

- 声明不是证据；代理不是证明；chip 是弱先验，不是量化测量。
- 粗选固定 4×3=12、每轮最多 1 个待定；先 `generate` 再预览，三页文案相同、HTML 必须互异、无外链；final 前自动完整性校验。
- 生成源 Phase 1 只参数化 12 张世界卡。Phase 2（archetype 池）和自由生成模式 B 还没做。
- 精调一次一轴，结论写等效区间，不写精确值。
- deck 依赖 ppt-master + Python + LibreOffice Kit；缺依赖返回结构化 `missing[]`，不假装成功。

## 开发与测试

```bash
npm test
node test/shortlist-ui-contract.test.mjs
node test/generate-round.test.mjs
node test/docs-consistency.mjs
node skills/design-kit/probe-kit/test/smoke.mjs
node skills/design-kit/probe-kit/test/regression.test.mjs
node skills/design-kit/probe-kit/test/axis-lock.test.mjs
```

发布：

```bash
node scripts/release.mjs
node test/release-check.mjs
npm pack --pack-destination dist
```

- 测试与真实宿主验收清单：[docs/TESTING.md](docs/TESTING.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)
- 贡献说明：[CONTRIBUTING.md](CONTRIBUTING.md)

## 仓库结构

```
lib/                        插件注册、工具、客户端、异步/路径/状态
skills/design-kit/          技能、行内实现（ui-craft / probe-kit）、deck shim
test/                        mock、契约、发布物与验收/QA
scripts/release.mjs          runtime / fixtures / docs 三件发布物
cordis.patch.yml             DSH bundle patch
```

## 已知边界

- 真实浏览器视觉目检、PowerPoint/WPS 逐页排版、真人 JND 标定仍需人工完成。
- 路径牢笼与一次性令牌不是完整安全沙箱；只从可信来源安装。
- 旧插件 `dsh-ui-craft` / `dsh-probe-kit` 不要与本插件同时安装。
- 0.1.7 的 `/dkit` 命令与自定义删除理由已过本地 mock/契约测试；真实宿主斜杠菜单与卡片输入尚未独立复验，升级后需重启 DSH 再点一轮确认。
- 0.1.8 的生成源只覆盖参数化世界卡。brief 没写 `content` 时，要点是从 title / prompt 截出来的，不是自由撰写。

## License

MIT。设计方法参考 impeccable（Apache-2.0）与 ppt-master（MIT），未复制其源码。
