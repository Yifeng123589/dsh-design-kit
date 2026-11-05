# dsh-design-kit 独立 QA 审计

- 对象：`<repo>`（package.json、cordis.patch.yml、lib/{index,skill,tools}.js、skills/design-kit/*、test/apply.mock.mjs、dist/dsh-design-kit-v0.1.0.zip；历史审计记录，文件名以当前发布物为准）。
- 环境：Windows、Node v24.19.0、Python 3.14.7；沙箱禁止 `spawnSync` 管道（EPERM，已知限制）。
- 方法：只读代码 + 按要求运行 `node --check`、sync 两次、mock、Python zip 清单核对、Node 相对链接扫描与旧插件 schema 对比；未改源码，只写本报告。

## 1. 结论

**PASS WITH FIXES**。包结构、配置字段、5 个工具命名/参数、同步不覆盖手写 SKILL.md、mock 9/9、zip 必需文件与 55 条清单均通过；但同步出来的参考文档有 27 个坏链接（其中 25 个在 `references/ui-craft-SKILL.md`），probe-kit 文档引用了被 sync 排除的 REAL-RUN / REVIEW-SUGGESTIONS / test 文件并在安装包里不可得，mock 未覆盖新配置与默认落点/重复注册等高风险项。没有阻断性 Blocker；修完 Major/Minor 可发。

## 2. 实际执行命令与结果

| 命令 | 结果 |
|---|---|
| `node --check dsh-design-kit/lib/index.js`（tools.js / skill.js / sync-kit.mjs / test/apply.mock.mjs 同） | 全部 exit 0 |
| `cd dsh-design-kit && node sync-kit.mjs`（连跑两次） | 均 exit 0，输出 `ui-craft 16 / probe-kit 25 / references 3`；两次 payload 只有 `.sync-manifest.json` 变化；SKILL.md 与 `references/deck-handoff.md` SHA256 不变 |
| `node test/apply.mock.mjs` | 9 项全过，`通过 9 / 失败 0`，exit 0 |
| Python `zipfile` 清单核对（dist/dsh-design-kit-v0.1.0.zip） | 55 条、288365 B；全部 `dsh-design-kit/` 前缀 + 正斜杠；无 `.tmp`；必需的 lib/skills/cordis.patch.yml/README/LICENSE/package.json 均在；磁盘缺失文件 0；内容不一致仅 `.sync-manifest.json`（见 m1） |
| Node 相对链接扫描（21 个 md，解析 `[..](..)`） | `broken_links=27`：`references/ui-craft-SKILL.md` 25 条 + `probe-kit/PROTOCOL-V0.2.md` 1 条 + `probe-kit/README.md` 1 条 |
| Node 工具 schema 对比（旧 `dsh-ui-craft/lib/tools.js` + `dsh-probe-kit/lib/tools.js`） | 5 个工具名一致；design_* / probe_* 的 description 与 parameters 与旧实现逐项相等；enum 与旧一致 |
| 静态检查 | 配置字段/默认值/上限与 cordis、README、lib/tools.js 一致；probe-kit 运行必需文件存在；源 `probe-kit/test/` 存在但未进包 |
| 未运行 | 按任务要求没有跑 `node --test`；工具真实成功路径受 EPERM 限制未实测 |

## 3. Blocker

- 无。注册逻辑、同步、打包均无阻断；风险集中在文档完整性与测试覆盖。

## 4. Major

### M1 同步复制 ui-craft SKILL 后相对链接全部失效（25 处）
- 位置：`skills/design-kit/references/ui-craft-SKILL.md:23`（首个 `[modes.md](references/modes.md)`，同文件共 25 处）；根因 `sync-kit.mjs:32-34` 把 `ui-craft/SKILL.md` 复制到 `references/` 但未改写 `references/` 前缀。
- 复现：Node 相对链接扫描 → `references/ui-craft-SKILL.md` 下 25 条目标不存在（如 `skills/design-kit/references/references/modes.md`）。
- 影响：`SKILL.md:15,32,102` 把完整 UI 流程指向这份参考，用户点任何 reference 链接都 404。
- 修复：复制到 `skills/design-kit/ui-craft/SKILL.md`（那里 `references/...` 天然正确），或 sync 时把链接改写为 `ui-craft/references/...`；补一个 markdown 链接测试。

### M2 同步后的 probe-kit 文档引用了被排除的文件与测试，安装包里不可得
- 位置：`sync-kit.mjs:41-52` 排除 `test/`、`REAL-RUN.md`、`REVIEW-SUGGESTIONS.md`；但
  `probe-kit/PROTOCOL-V0.2.md:7` 链接 `REVIEW-SUGGESTIONS.md`、`:84-85` 引用 `test/fixtures/real-runs/` 与 `test/regression.test.mjs`；
  `probe-kit/README.md:55` 链接 `REAL-RUN.md`、`:170` 引用 `test/fixtures/real-runs/` 与 `test/regression.test.mjs`、`:179-180` 给 `test/smoke.mjs` / `test/regression.test.mjs` 命令；
  `references/probe-kit-SKILL.md:104,108` 同样要求 `test/regression.test.mjs` / `test/smoke.mjs`。
- 复现：`Test-Path skills/design-kit/probe-kit/test` = false；链接扫描报上述坏链接；zip 内无 test 目录。
- 影响：合并包对外宣称的“可复现证据/仪器通电”在安装包里没有对应文件；新手按文档跑命令会 ENOENT。另有 smoke 数量不一致：`references/probe-kit-SKILL.md:108` 写 9 项，`PROTOCOL-V0.2.md:108` 与根 README:179 写 11 项。
- 修复：二选一——把 REAL-RUN/REVIEW-SUGGESTIONS/test 必要夹具同步进包；或改写/删除这些链接并明确“回归夹具与 smoke 仅存在于源 probe-kit 仓库”，统一 smoke 计数。

### M3 mock 9/9 但漏掉本轮新增高风险项
- 位置：`test/apply.mock.mjs`（9 个 check，`51-167`）；manifest 只校验 `>10`（`:80-81`）；没有覆盖：`designTimeoutMs` / `probeTimeoutMs` / `ledgerPath` / 旧 `timeoutMs` 兜底（新配置逻辑）、`probe_shortlist`/`probe_measure` 的默认 out/ledger 是否落 cwd、旧/新插件同时安装的同名工具重复注册、manifest 精确计数、同步区 markdown 链接完整性、工具 schema 是否与旧实现等价。工具成功路径受 EPERM 限制未测（README 已诚实说明，不算失败）。
- 复现：读 mock 9 个 check 名单；旧实现有 8 个 check（`dsh-probe-kit/test/apply.mock.mjs`）与 4 个 node:test（`dsh-ui-craft/test/apply.test.mjs`），合并后数量增加但上述新风险仍未覆盖；M1/M2 的坏链接正是没有链接测试的结果。
- 修复：把命令拼装/默认路径抽成可单测的纯函数；补配置字段、默认 out/ledger、精确 manifest 计数、重复注册（old+new 同时 apply）、markdown 链接扫描测试；用可注入 runner 测成功路径，避免依赖 spawn。

## 5. Minor

- **m1 sync 不是字节级幂等、会让 zip 过期**：`sync-kit.mjs:96-103` 每次写入新的 `syncedAt`；复跑两次只有 `.sync-manifest.json` diff（Python 对比 zip 也只剩这一条内容不一致）。建议 manifest 去掉时间戳或用内容哈希，发布流程在 sync 后重建 zip。
- **m2 zip 含开发文件**：zip 有 `sync-kit.mjs`、`test/apply.mock.mjs`（`package.json files` 未列）以及 `.sync-manifest.json`；任务允许 manifest，但 sync 脚本/test 不是运行必需，若按“干净分发包”理解应过滤（旧插件 zip 也有同款 test，属既有惯例）。`_build/zip.mjs` 打包整个目录，后续 `test/qa-design-kit.md` 也会进包，建议 zip 过滤 `test/qa-*`。
- **m3 JND 规则文案/注释不一致**：`references/probe-kit-SKILL.md:95` 写“步长小于 JND/2 就停止”，但 `probe-kit/probe.mjs:484` 要求区间宽 ≥4×JND（相邻宽/4 ≥JND）；`probe-kit/lib/axis.mjs:16` 注释仍写“窄于 2×JND 时拒绝”。建议统一为 4×JND，并删掉 JND/2 的旧句。
- **m4 probe_measure 内联参数可被默认值覆盖**：`lib/tools.js:393-398` 只用 `extra.includes('--out')` / `includes('--ledger')` 判断；若调用方传 `["--out=custom"]` / `["--ledger=x"]`，工具仍追加默认 `--out/--ledger`，parseArgs 后者覆盖前者。建议同时匹配 `--out=` / `--ledger=` 前缀。
- **m5 timeoutMs 兼容只在根 README 说明**：代码 `lib/tools.js:28-36` 支持 `config.timeoutMs` 兜底，根 README:247 有写，但插件 README 的配置节（`:24-32`）和 cordis.patch.yml（`:11-13`）未提；建议补一句，避免旧用户误以为要改配置键。
- **m6 deck 交接指向工作区专有路径**：`references/deck-handoff.md:5` 的 `projects/career-deck_20261102/` 与 `dist/career-deck/` 在本工作区存在，但不在插件包内；安装到别的 workspace 时这两个“参考实现”路径不存在。建议标注“本工作区参考”，或把最小复现说明随包。
- **m7 同步清理不完整**：`sync-kit.mjs` 没有清理 `references/` 里源已删除的旧文件（只覆盖两个 SKILL 参考）；`SKIP_DIRS` 硬编码 `.tmp-qa2/.tmp-qa3`。建议按目录重建 references 或明确手写文件白名单。
- **m8 旧 mock 的“缺技能文件”测试退化**：旧 `dsh-ui-craft/test/apply.test.mjs:71-77` 有该场景（虽实现较弱），新 mock 用 `ctx.skills.register` 抛错模拟（check 9），没有真正删 SKILL.md 验证 readFileSync 失败路径；建议加真实缺文件测试。

## 6. 已验证通过项

- package.json：name/version/type/main/exports/files/dsh.bundle.patch/engines 与旧插件同构；cordis insert 的 id/name=`dsh-design-kit`，config 三个字段与 `lib/tools.js`、README 完全一致，默认值/限制（design 30s/1–120s，probe 120s/1–300s，ledger 默认 cwd/probe-kit-ledger）一致。
- lib/index.js：inject/apply、技能与 5 工具注册、逐项 try/catch 告警、dispose 注销器与旧插件同构；mock 实测注销器 6 个、注册失败不抛。
- 工具：5 个名字与旧插件一致；design_* / probe_* 的 description 和 parameters 与旧实现逐项相等；`probe_shortlist`/`probe_measure` 默认 out/ledger 已落会话 cwd（旧 bug 已修）；未知命令/缺参返回中文错误不抛；配置 `ledgerPath`/双 timeout 已实现。
- 同步：手写 `SKILL.md`、`references/deck-handoff.md` 未被覆盖（哈希不变）；payload 两次一致；`.sync-manifest.json` 存在且计数 16/25/3 与实际文件数一致；`skills/design-kit/probe-kit` 的 lib/templates/fixtures/probe.mjs/shortlist.mjs/PROTOCOL 等运行必需文件齐全。
- SKILL：name=design-kit，description 覆盖造页面/粗选/精调/PPT 四类并有中英路由词；正文无 `http(s)` 外链；`references/...` 顶层链接与 `ui-craft/references/`、`probe-kit/PROTOCOL-V0.2.md` 都存在；明确旧技能名迁移；PPT 明确“暂无 deck 工具”。
- zip：55 条、288365 B（根 README 称 55 条/282 KB，实际约 281.6 KiB 相符）；含 lib、skills/design-kit（SKILL/两个实现/references/ui-craft 资源）、cordis.patch.yml、README.md、LICENSE、package.json；无 `.tmp`、无前缀/反斜杠问题、磁盘缺失文件 0。
- 文档诚实性：根 README 与插件 README 明确写了“未在真实 DSH 宿主加载”“工具成功路径未实测（EPERM）”“PPT 暂无工具”；mock 9/9 与 zip 55 条声明与实测一致。

## 7. 未验证项

- 真实 DSH 宿主 `pnpm add` 加载、cordis patch 应用与运行时技能路由；本环境只有源码和假 ctx。
- 5 个工具的真实成功路径（EPERM）；只有错误路径/注册结构/mock 覆盖，工具 stdout、文件落点与设计脚本输出未实跑。
- zip 解压安装后的权限与只读场景；sync 在 SKILL.md 缺失、目标只读、进程中断等异常场景的幂等性。
- 浏览器里的设计页面与 PPT 渲染/目检；PPT 仍无 deck 工具（已明确）。
- `config.timeoutMs` 旧键实际覆盖行为未执行（仅代码审查）；`probe_measure` 内联 `--out=`/`--ledger=` 的覆盖顺序未实跑（沙箱 spawn 限制）。

## 8. 最终结论

**PASS WITH FIXES**。无 Blocker；M1（ui-craft 参考 25 个坏链接）、M2（probe 文档引用被排除文件/测试，且 smoke 计数 9 vs 11）、M3（mock 漏掉配置/默认落点/重复注册等高风险）建议发布前修；其余为文档小项与打包观察。工具与包结构本身相对旧插件没有退步，配置字段与实现一致。
