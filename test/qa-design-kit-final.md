# dsh-design-kit 发布前最终复核（task-17）

- 对象：`dsh-design-kit` 对 task-16 的 1 个 Major（M2r）与 Minor 修复后的发布前状态；只读源码。
- 环境：Windows、Node v24.19.0、Python 3.14.7；沙箱禁 `spawnSync` 管道（EPERM）。
- 方式：运行 sync 两次、mock、包内 smoke/regression、source smoke、node --check、独立链接扫描、Python 逐条核对 zip 与磁盘；未跑 `node --test`，未改源码，只写本报告。

## 1. 结论

**PASS WITH FIXES**。无 Blocker、无 Major：M2r 真修复（包内 smoke 11/11、regression 10/10，两种布局都通过，TMP 已到 tmpdir）；mock 13/13；zip 79 条/350341 B、无 `test/qa-*`、含 runs-real/ledger/smoke/regression；sync 两次逐字节稳定，手写 SKILL/deck 哈希不变；根/插件 README 的 13/13、79 条、342 KB、smoke/regression 数字与实测一致。仅剩 2 个 Minor 文案/状态陈旧（见 §3），不影响发布结论。

## 2. 检查表

| 检查项 | 证据 | 结果 |
|---|---|---|
| M2r 包内 smoke | `node skills/design-kit/probe-kit/test/smoke.mjs` → 11 项全过、`通过 11 / 失败 0`，exit 0；包内结构检查识别为 `dsh-design-kit` 并检查合并路径 | **通过** |
| M2r 源布局 smoke | 根目录 `node probe-kit/test/smoke.mjs` → 11/11，exit 0；跑前/跑后 `probe-kit` 106 个文件哈希 diff=0 | **通过** |
| M2r TMP/布局代码 | `smoke.mjs:12,24` 使用 `os.tmpdir()/dsh-smoke-<pid>`；`:26-43` `findPluginRoot()` 向上找带 `pkg.dsh` 的 package.json；`:258-289` 合并布局检查 `skills/design-kit/...` | **通过** |
| M2r 包内 regression | `node skills/design-kit/probe-kit/test/regression.test.mjs` → 10 项全过、`通过 10 / 失败 0`，exit 0 | **通过** |
| 回归/烟测不写包 | 包内 smoke+regression 连跑前后 81 个文件哈希 diff=0；TMP 在系统 tmpdir 并清理 | **通过** |
| mock 13 项 | `node test/apply.mock.mjs` → 13 项全过、`通过 13 / 失败 0`，exit 0；新增 `resolveTimeoutSettings` 断言默认 30s/120s、旧 `timeoutMs` 双兜底、999999→120000、1→1000（`apply.mock.mjs:175-182`） | **通过** |
| sync 字节稳定 | 两次 `node sync-kit.mjs` 均 exit 0，输出 `ui-craft 17 / probe-kit 49 / references 2`；diff1=0、diff2=0；SKILL.md 与 `references/deck-handoff.md` SHA256 不变；manifest 17/49/2 | **通过** |
| 独立链接扫描 | 23 个 skill markdown，独立解析相对链接（剥离代码块）→ `broken_links=0` | **通过** |
| M1 遗留 | `ui-craft/SKILL.md` 在 `ui-craft/` 下，`references/ui-craft-SKILL.md` 不再存在；SKILL 路径与链接均通 | **通过** |
| 证据文件 | 包内 `probe-kit/REAL-RUN.md`、`REVIEW-SUGGESTIONS.md`、`test/smoke.mjs`、`test/regression.test.mjs`、`test/fixtures/real-runs/*`、`runs-real/*`、`ledger/*` 均在；链接 0 坏 | **通过** |
| PROTOCOL 计数 | `PROTOCOL-V0.2.md:71` 已改 11 项，与 `:108`、根 README、参考 SKILL 一致 | **通过** |
| 插件 README 参考路径 | `README.md:42` 已改为 `ui-craft/SKILL.md` + `probe-kit/...` + `references/probe-kit-SKILL.md`，无旧 `references/ui-craft-SKILL.md` | **通过** |
| zip 清单 | 79 条、350341 B（≈342.1 KiB，与根 README 342 KB 相符）；全部 `dsh-design-kit/` 前缀、无反斜杠、无 `.tmp`；无 `test/qa-*` | **通过** |
| zip 内容 | 必需 lib/skills（SKILL、ui-craft、probe-kit 两份实现、references、证据）/cordis/README/LICENSE/package.json 全在；zip↔磁盘内容不一致 0；缺文件 0；磁盘多出 `test/qa-design-kit*.md`（被过滤，符合预期） | **通过** |
| zip 过滤边界 | 仍含 dev `test/apply.mock.mjs` 与 `sync-kit.mjs`（任务只要求无 `test/qa-*`，79 条计数也包含它们；与旧插件 zip 惯例一致）。 | **通过（观察项）** |
| 根 README 数字 | `13/13`、`79 个条目`、`342 KB`、smoke 11、regression 10 与实测一致（`README.md:167-173,202,239`） | **通过** |
| 插件 README 数字 | `13 项`（`README.md:39`）、timeoutMs 配置（`:29-32`）与实测一致 | **通过** |

## 3. 新发现问题（按严重度）

### Minor

- **根 README QA 状态行仍是 task-16 的旧文字**：`README.md:240` 写“Major 已修（……mock 扩到 12 项），task-16 正在复核”；当前已是 mock 13、task-17 最终复核。数字 12 与 §2 的 13 冲突，且状态过期。建议改为 task-17 最终复核结论（PASS WITH FIXES 或 PASS）。
- **shipped smoke 的人工项文案仍是旧的 r6 JND 估值**：`skills/design-kit/probe-kit/test/smoke.mjs:302` 打印“字号 1px / 间距 2px 目前是估值”，但 `lib/axis.mjs:60` 的 r6 `jnd: 6`，PROTOCOL/README 的 r6 JND 也是 6px。建议改成“字号 1px / 间距 6px”，避免用户按 2px 理解证据。

### 观察（不构成缺陷）

- zip 仍包含 dev `test/apply.mock.mjs` 与 `sync-kit.mjs`；本轮只要求过滤 `test/qa-*`，且根 README 的 79 条计数包含它们。若要做纯运行时分发包可再过滤，但会改变 79 条/342 KB 的声明。
- 两个 QA 报告 `test/qa-design-kit.md`、`test/qa-design-kit-followup.md` 不在 zip 中（磁盘有，Python 对比显示被过滤），符合“无 test/qa-*”。

## 4. 未验证项

- 真实 DSH 宿主 `pnpm add`/cordis patch 加载、真实工具路由；只有假 ctx 与 mock。
- 5 个工具的真实成功路径（沙箱 `spawnSync` EPERM）；smoke/regression 已实跑，但 `probe_shortlist`/`probe_measure` 子进程成功路径仍未在非沙箱环境验证。
- zip 解压后的安装/权限与只读场景；打包脚本重建后的条目数未单独跑（当前 zip 现状已核对）。
- 浏览器里的设计页面与 PPT 目检；PPT 仍无 deck 工具（文档已明确）。
- 未运行 `node --test`（按要求）；本报告使用直接脚本与 mock。

## 5. 实际执行命令与结果

| 命令 | 结果 |
|---|---|
| `node --check lib/index.js`（tools.js/skill.js/sync-kit.mjs/test/apply.mock.mjs 同） | 全 exit 0 |
| `node sync-kit.mjs` ×2 | 均 exit 0；`ui-craft 17 / probe-kit 49 / references 2`；diff1=0、diff2=0；SKILL/deck-handoff 哈希不变 |
| `node test/apply.mock.mjs` | 13/13，exit 0 |
| `node skills/design-kit/probe-kit/test/smoke.mjs` | 11/11，exit 0 |
| `node skills/design-kit/probe-kit/test/regression.test.mjs` | 10/10，exit 0 |
| 包内 smoke+regression 前后哈希 | 81 个文件，diff=0 |
| `node probe-kit/test/smoke.mjs`（源布局） | 11/11，exit 0；源 `probe-kit` 106 文件哈希 diff=0 |
| 独立 markdown 链接扫描 | 23 个 md，0 坏链 |
| Python zip 核对 | 79 条 / 350341 B；前缀✓、无反斜杠、无 `.tmp`、无 `test/qa-*`；必需文件缺失 0；内容与磁盘不一致 0；磁盘多出 2 个 QA 报告（预期过滤） |
| 未执行 | `node --test`（按要求）；真实 DSH/非沙箱工具执行/解压安装未做 |

## 6. 最终结论

**PASS WITH FIXES**。发布阻断项为空；M2r、M3、sync、zip、M1 与 README 主数字全部实测通过。仅需修 2 个 Minor：根 README:240 的 task-16/12 项旧状态、smoke.mjs:302 的 r6 “间距 2px”旧文案（应为 6px）。修完即可视为 PASS。
