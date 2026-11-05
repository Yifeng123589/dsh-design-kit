# 测试与真实宿主验收

## 本地自动化（零依赖）

```bash
npm test                                  # mock 注册/契约/路径/令牌/状态机 32 项
node test/shortlist-ui-contract.test.mjs  # UI↔CLI 契约 4 项
node test/docs-consistency.mjs            # 文档工具计数 4 项
node skills/design-kit/probe-kit/test/smoke.mjs       # 11 项
node skills/design-kit/probe-kit/test/regression.test.mjs  # 10 项
node skills/design-kit/probe-kit/test/axis-lock.test.mjs   # 5 项
node scripts/release.mjs
node test/release-check.mjs               # runtime 不含测试/证据/QA 2 项
```

## 真实 DSH 验收（必须人工 / 真实环境）

1. **加载**：完全重启 DSH；确认 `design-kit` 技能与 10 个工具出现，日志注册汇总 10/10。
2. **UI 路径**：跑 `design_lint`、`design_tokens`、`design_capture`；确认 capture 失败时如实返回 `unavailable`，不假装看过。
3. **粗选路径**：`probe_shortlist init → add → probe_shortlist_preview`；点三栏卡片删除/待定，确认 `[probe-shortlist-ui]` 回传与 `probe_shortlist_ui_action` 落账；验证过期/伪造令牌被拒。
4. **精调路径**：`probe_measure demo/build → append → review → apply --strict`；确认粗选未 final 时状态机拦截。
5. **deck 路径**：`deck_check → deck_export → deck_render`；确认 PPTX/PDF/PNG 与 `missingFonts`；在 PowerPoint/WPS 里逐页看排版（LibreOffice 渲染不等于 PowerPoint）。
6. **安装物**：用 GitHub Release 的 runtime zip 做一次干净安装，确认不依赖源码目录。

## 已知未自动化的部分

- 浏览器视觉目检、PPT 在 PowerPoint/WPS 的逐页排版。
- 真人评审与 JND 重新标定。
- 三栏卡片在真实 Web GUI 的点击/解压/令牌链路（需重启后人工点验）。
