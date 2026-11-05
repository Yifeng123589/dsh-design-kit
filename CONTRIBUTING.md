# Contributing

这是 `dsh-design-kit` 插件的 vendored 快照仓库：`skills/design-kit/` 下的 ui-craft / probe-kit 实现由源仓库同步生成，**不要直接改同步区**；改完源目录后同步并提交快照。

## 开发

```bash
npm test
node test/shortlist-ui-contract.test.mjs
node test/docs-consistency.mjs
node skills/design-kit/probe-kit/test/smoke.mjs
node skills/design-kit/probe-kit/test/regression.test.mjs
node skills/design-kit/probe-kit/test/axis-lock.test.mjs
```

## 发布

```bash
node scripts/release.mjs      # runtime / fixtures / docs + SHA256SUMS
node test/release-check.mjs
npm pack --pack-destination dist
```

打 tag `v<version>` 会触发 GitHub Release workflow，自动上传三件 zip、tgz、矩阵说明和校验和。

## 手写区

- `skills/design-kit/SKILL.md`
- `skills/design-kit/references/deck-handoff.md`
- `skills/design-kit/deck/export_shim.py`
- `lib/`、`test/`、`scripts/`

## 约束

- 只改 MIT 兼容代码；不要引入来源不明的大段外部代码。
- 新增工具必须带 `output: { schema, render }`，否则真实 DSH 会拒绝注册。
- `package.json` 必须保持 UTF-8 无 BOM；BOM 会导致 bundle 被跳过。
- 所有用户数据路径走 `lib/path-guard.js`；长任务走 `lib/process.js` 的 async runner。
