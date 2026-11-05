# dsh-design-kit 修复复核（task-16 follow-up）

- 对象：`dsh-design-kit` 对 task-15 报告 `dsh-design-kit/test/qa-design-kit.md` 的修复；只读源码。
- 环境：Windows、Node v24.19.0、Python 3.14.7；沙箱禁止 `spawnSync` 管道（EPERM）。
- 方式：读改后代码 → 重跑 sync 两次、mock、node --check → 独立 markdown 链接扫描 → Python zip 清单/内容对比 → 核对 M1/M2/M3 与 README 数字。未跑 `node --test`；除本报告外未写文件。

## 1. 结论

**PASS WITH FIXES**。M1（ui-craft 参考路径）与 M3（mock 扩到 12 项）确实修复；M2 的证据文件已随包、链接已 0 坏、参考 SKILL 的 smoke=11 与 4×JND 文案已改；sync 两次字节稳定，zip 66 条/318221 B，根/插件 README 的 12/12、66 条、311 KB 主数字相符。无 Blocker；仍有 1 个 Major（随包的 `smoke.mjs` 仍按旧 `dsh-probe-kit` 布局做结构检查，在合并插件内运行会失败）和几个 Minor（PROTOCOL 一处 smoke=9、插件 README 一处旧参考路径、zip 含 dev 测试/QA 报告、probe README 仍引用未随包的 ledger 数据、mock 仍有少量覆盖缺口）。

## 2. 实际执行命令与结果

| 命令 | 结果 |
|---|---|
| `node --check dsh-design-kit/lib/index.js`（tools.js / skill.js / sync-kit.mjs / test/apply.mock.mjs 同） | 全部 exit 0 |
| `cd dsh-design-kit && node sync-kit.mjs`（连续两次） | 均 exit 0，输出 `ui-craft 17 / probe-kit 35 / references 2`；`diff1=0`、`diff2=0`（payload 逐字节稳定）；SKILL.md 与 references/deck-handoff.md SHA256 不变 |
| `node test/apply.mock.mjs` | 12 项全过，`通过 12 / 失败 0`，exit 0 |
| 独立 markdown 相对链接扫描（23 个 md，剥离代码块，解析 `[..](..)`） | `broken_links=0` |
| Python `zipfile` 清单+逐条内容对比（`dist/dsh-design-kit-v0.1.0.zip`） | 66 条、318221 B；全部 `dsh-design-kit/` 前缀、无反斜杠、无 `.tmp`/目录条目；必需文件缺失 0；zip↔磁盘内容不一致 0；磁盘多出文件 0 |
| 实际计数 | `ui-craft=17`、`probe-kit=35`、`references=2`，与 `.sync-manifest.json` 完全一致 |
| 静态核对 | 证据文件存在；SKILL 指向 `ui-craft/SKILL.md`；参考 SKILL smoke=11；`axis.mjs:16` 4×JND；README 主数字见下；未跑 node --test |

## 3. M1 / M2 / M3 修复验证

| 项 | 证据 | 判定 |
|---|---|---|
| M1 参考路径 | `skills/design-kit/ui-craft/SKILL.md` 存在；旧的 `references/ui-craft-SKILL.md` 已不存在；`SKILL.md:15,32,40,102` 均指向 `ui-craft/SKILL.md`；独立链接扫描 23 md / 0 broken；mock 的链接扫描 check 通过 | **通过**（插件 README:42 仍有旧路径文字，Minor） |
| M2 证据文件 | `probe-kit/REAL-RUN.md`、`REVIEW-SUGGESTIONS.md`、`test/regression.test.mjs`、`test/smoke.mjs`、`test/fixtures/real-runs/*` 均在包内；链接扫描 0；`references/probe-kit-SKILL.md:108` smoke=11、`:95` 只保留 4×JND；`axis.mjs:16` 4×JND | **部分通过**：文件/文案/链接已修；但 `test/smoke.mjs` 仍把结构检查指向旧 `dsh-probe-kit`（见新问题 M2r），`PROTOCOL-V0.2.md:71` 仍写 9 项 |
| M3 mock 12 项 | mock 12/12；新增检查覆盖：精确 manifest 计数（check 2）、markdown 链接扫描（check 3）、配置字段被接受（check 6）、`buildProbeMeasureArgv` 默认/内联 `--out=`/`--ledger=`（check 7）、工具名唯一（check 5）；execute 确实使用 `buildProbeMeasureArgv`（`lib/tools.js:409`） | **通过**（残余覆盖缺口见 Minor） |
| 顺手修的关键 Minor | sync manifest 去掉时间戳后两次 diff=0；`hasInlineOption`/`buildProbeMeasureArgv` 已实现且被 execute 使用；cordis:11-14 与插件 README:29-32 补了 `timeoutMs` 兼容说明；deck-handoff.md:3 加了“本工作区参考”注解 | **通过** |

## 4. 新发现问题（按严重度）

### Major

**M2r 随包的 `smoke.mjs` 仍按旧插件布局做结构检查，合并包内运行会失败**
- 位置：`skills/design-kit/probe-kit/test/smoke.mjs:10,20-23,237-238`。第 22 行 `ROOT=resolve(KIT,'..')` 在合并包内等于 `skills/design-kit`，第 238 行 `join(ROOT,'dsh-probe-kit')` 指向 `skills/design-kit/dsh-probe-kit`（不存在）；结构检查会报缺少 package.json/cordis 等。
- 复现：`Test-Path dsh-design-kit/skills/design-kit/dsh-probe-kit` = False；从包内运行 `node probe-kit/test/smoke.mjs` 时第 6 项“插件包结构齐全（dsh-probe-kit）”必然失败。另 `TMP=join(KIT,'.tmp-smoke')`（`:23`）写在插件技能目录，安装为只读时也会失败，违反“产物写会话 cwd”的底线。
- 修复：把结构检查改为 `dsh-design-kit` 的包根/SKILL/PROTOCOL 路径；`TMP` 改 `os.tmpdir()` 或会话 cwd；同步 `README/probe-kit-SKILL` 中对 smoke 的引用。若不想维护两套布局，可只在源 `probe-kit` 仓库保留 smoke，不随合并包分发，但需改文档。

### Minor

- **M2 文档计数遗留**：`probe-kit/PROTOCOL-V0.2.md:71` 写“9 项仪器通电检查”，同文件 `:108` 与 `README:179`、`references/probe-kit-SKILL.md:108` 都是 11；建议统一为 11。
- **M1 文档残留**：`dsh-design-kit/README.md:42` 仍写同步区包含 `references/ui-craft-SKILL.md`；实际文件已移到 `ui-craft/SKILL.md`（`references/` 只有 `probe-kit-SKILL.md` 与手写 `deck-handoff.md`）。改一行即可。
- **M2 证据路径残留**：`probe-kit/README.md:55,59` 与 `REAL-RUN.md:3,47,147,180,188,209,218` 仍引用 `ledger/ledger.jsonl`、`ledger/answers/*`、`ledger/calibration-*.json`；sync 仍排除 `ledger/`，这些“真实记录”原始数据不在安装包内。若只承诺 REAL-RUN/REVIEW/test 子集，建议在 README/REAL-RUN 标注“原始 ledger 仅在源 probe-kit 仓库”。
- **M3 覆盖缺口**：12 项检查对“配置字段”只断言无告警（`test/apply.mock.mjs:151-160`），没有断言 design/probe 超时取值/钳制、`ledgerPath` 实际传入 probe 工具；没有旧/新插件同时安装的重复注册测试；`probe_shortlist` 默认 out/ledger 未测；工具成功路径与删除必需资源仍不可测/未覆盖（EPERM 已知）。
- **打包清洁度**：zip 的 66 条里包含 dev 的 `test/apply.mock.mjs`、内部 QA 报告 `test/qa-design-kit.md`、dev 脚本 `sync-kit.mjs`。旧插件 zip 也带 dev 测试，属既有惯例，可接受；但 QA 报告不是运行必需，且本次 follow-up 报告若重建 zip 会再进包（打包脚本 `_build/zip.mjs` 打包整个目录）。建议过滤 `test/qa-*`，并在 README 说明 zip 含 dev 测试。
- **sync 清理**：`sync-kit.mjs:67-69` 仍硬编码 `.tmp-qa2/.tmp-qa3`；`references/` 只保留 `probe-kit-SKILL.md` + `deck-handoff.md`，删除源已移除的旧参考这点已OK，但临时目录名单可去掉。

## 5. 已确认修复的项

- M1 的 25 个旧坏链接随 `references/ui-craft-SKILL.md` 删除而消失；新 `ui-craft/SKILL.md` 的 `references/...` 链接天然成立，独立扫描 23 个 md 为 0 坏链。
- M2 证据文件已随包；`references/probe-kit-SKILL.md:108` smoke 已改 11、JND/2 旧句已删、`axis.mjs:16` 已改 4×JND；链接扫描 0。
- M3 mock 从 9 扩到 12，新增的精确 manifest、链接扫描、配置接受、argv 默认/内联、工具名唯一检查全部真实通过；execute 使用被测的 `buildProbeMeasureArgv`，不是自欺测试（`lib/tools.js:409`）。
- 小项：manifest 无时间戳 → sync 两次 payload diff=0；`--out=`/`--ledger=` 内联写法不被默认覆盖；cordis/README 补了 `timeoutMs`；deck-handoff 加了本工作区限定。
- 数字核对：根 README `12/12`、`66 个条目`、`311 KB` 与实测（mock 12/12、zip 66 条、318221 B ≈ 310.8 KiB）相符；插件 README `12 项` 与 config 的 `timeoutMs` 已更新；task-16 状态行也在。

## 6. 未验证项

- 真实 DSH 宿主加载/`pnpm add` 与 cordis patch 应用；只有 mock ctx。
- 5 个工具的真实成功路径（EPERM）；`smoke.mjs`/`regression.test.mjs` 未实际执行（按只读要求，且 smoke 会写 `.tmp-smoke`；其结构检查失败是静态路径推断）。
- zip 解压安装后的权限/只读场景；打包脚本 `_build/zip.mjs` 重建后的条目数未实跑（当前 66 条仅核对现状）。
- 浏览器里的设计页面与 PPT 目检；PPT 仍无 deck 工具（文档已明确）。
- `regression.test.mjs` 在包内可运行性只按导入/夹具路径静态判断，未跑。

## 7. 最终结论

**PASS WITH FIXES**。无 Blocker；M1、M3 与关键 Minor 已实测修复；M2 的文件/链接/文案基本修复，但随包 `smoke.mjs` 仍按旧 `dsh-probe-kit` 布局检查且写插件目录（Major），加上 PROTOCOL 一处 9 vs 11、插件 README 一处旧参考路径、probe README/REAL-RUN 的 ledger 引用、zip 含 dev/QA 文件等 Minor，建议发布前至少修掉 smoke 布局与这三处文档，再考虑是否过滤 zip 的 test/qa-*。
