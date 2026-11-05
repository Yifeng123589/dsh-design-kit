# 设计系统

何时读我：项目需要把设计决策沉淀下来（新世界完成、多人协作、要复用组件、要做第二三个页面）；或既有项目已有设计系统，需要判断新页面是否跑偏。

设计系统的目的只有一个：**让下一个人（或下一次对话）不必重新猜。** 不是产出漂亮文档。

## 1. 两个产物，一个来源

| 产物 | 内容 | 地位 |
|---|---|---|
| `tokens.css` | CSS 自定义属性：颜色、字号、间距、圆角、阴影、动效 | **唯一来源**，代码从这里取值 |
| `DESIGN.md` | 决策与理由：世界、策略、组件约定、未决问题 | 说明与约束，不重复 token 数值 |
| `TASTE.md` | 只追加的取舍日志：试过什么、为什么否决 | 防止下一个 agent 重复提案，见第 6 节 |

不要在 `DESIGN.md` 里抄一遍 hex 值。抄了就会漂移：改一处忘一处。`DESIGN.md` 写「为什么」，`tokens.css` 写「是多少」。

既有项目如果 token 分散在多个文件或 Tailwind 配置里，先合并到一个可读来源，再写文档。

## 2. tokens.css 的结构

命名用「角色 + 层级」，不用「颜色名」。`--color-accent` 好过 `--color-purple`，因为换色时不用改名。

```css
:root {
  /* 语义色 */
  --color-bg: oklch(98% 0.006 250);
  --color-surface: oklch(100% 0 0);
  --color-surface-raised: oklch(96% 0.008 250);
  --color-text: oklch(22% 0.02 250);
  --color-text-muted: oklch(46% 0.018 250);
  --color-text-faint: oklch(60% 0.014 250);
  --color-border: oklch(88% 0.01 250);
  --color-accent: oklch(56% 0.16 28);
  --color-accent-hover: oklch(50% 0.17 28);
  --color-on-accent: oklch(99% 0.01 28);
  --color-success: oklch(58% 0.12 150);
  --color-warning: oklch(72% 0.14 75);
  --color-danger: oklch(56% 0.18 25);
  --color-focus: oklch(62% 0.18 255);

  /* 字体 */
  --font-sans: "HarmonyOS Sans SC", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
  --font-serif: "Source Han Serif SC", "Noto Serif SC", serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;

  /* 字号：流体，不必逐断点覆盖 */
  --text-sm: clamp(0.8125rem, 0.79rem + 0.12vw, 0.875rem);
  --text-base: clamp(1rem, 0.97rem + 0.15vw, 1.0625rem);
  --text-lg: clamp(1.125rem, 1.08rem + 0.23vw, 1.25rem);
  --text-2xl: clamp(1.5rem, 1.38rem + 0.6vw, 1.875rem);
  --text-4xl: clamp(2.25rem, 1.9rem + 1.75vw, 3.5rem);

  /* 间距：4px 基准 */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-24: 6rem;

  /* 形状与深度 */
  --radius-sm: 4px;
  --radius-md: 10px;
  --radius-lg: 18px;
  --shadow-sm: 0 1px 2px oklch(20% 0.02 250 / 0.06);
  --shadow-md: 0 4px 16px oklch(20% 0.02 250 / 0.08);

  /* 动效 */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 140ms;
  --duration-base: 240ms;
}
```

以上只是结构示例。实际数值由 `scripts/design-tokens.mjs` 生成后按世界调整，对比度以生成时的自检结果为准。

命名约定：

- `--color-<角色>`、`--color-<角色>-hover`、`--color-on-<底>`。
- `--text-<尺寸>`、`--space-<档位>`、`--radius-<尺寸>`、`--shadow-<尺寸>`、`--duration-<速度>`、`--ease-<性格>`。
- 语义变量指向基础变量，页面只用语义变量。要换主题时只改一层。

## 3. DESIGN.md 的结构

用 `templates/DESIGN.md` 起步，八个段落，不要加第十个：

1. **世界**：一句话机制、文化来源、这个界面要证明什么。
2. **方向契约**：`THESIS` / `OWN-WORLD` / `STORY` / `FIRST VIEWPORT` / `FORM` / `FINISH` 六字段。
3. **色彩策略**：克制 / 承诺 / 全彩 / 浸染，选一个并给理由。
4. **排版**：字体配对与理由、阶梯档位、行宽与行高规则。
5. **空间**：间距基准、栅格、断点、容器最大宽。
6. **组件**：每个基准件的结构、尺寸、状态、变体。只写组件级约定，不写一次性布局。
7. **动效**：一个作者时刻是什么、在哪里、时长与降级。
8. **未决问题**：还没定的、有争议的、依赖外部输入的。

写作规则：

- 决策写成句子，不写成形容词。「主色承担页面的 40%，用于整块区域而非小面积强调」比「主色醒目」有用。
- 每条决策附一句理由。没有理由的约束会被下一个 agent 当噪音删掉。
- 变化时同步更新。文档描述当前状态，不保留历史版本（历史在 git 里）。

## 4. 组件约定

每个基准组件写清四件事：

| 项 | 内容 |
|---|---|
| 结构 | DOM 层次与语义标签，是否允许内嵌 |
| 尺寸 | 高度、内边距、图标尺寸，取自哪个 token |
| 状态 | 六态是否都有，focus 用什么表现 |
| 变体 | 主次/危险/幽灵等，各自使用场景 |

不要为每个页面单独定义组件变体。出现第三个特例时，改组件；不要加判断分支。

## 5. 扩展与漂移

- **新增页面**：先对照 `DESIGN.md`，能用现有系统解决就不要新增 token。
- **新增 token**：说明为什么现有 token 不够。一次只加一个层级，不要加一整套。
- **怀疑漂移**：把新页面与代表性老页面并排放，删掉内容只看骨架。骨架不一致就是漂移。
- **不主动修既有漂移**：报告它，等用户决定。顺手修会让改动范围失控。

## 6. 记忆：试过与否决

设计系统只记录「是什么」，不记录「试过什么、为什么否决」。少了这一层，下一个 agent 会把你已经否掉的方案再提一次，或者反过来把否决理由当噪音删掉。

在项目里维护一个追加式的 `TASTE.md`（或 DESIGN.md 的「已否决」小节），只记三行：

```markdown
- 方案：主色用青瓷绿 #5E8C7B 铺满导航区
  否决于：2026-11-02
  原因：与医疗场景的「冷静」冲突，且暗色模式下对比不足 3:1
```

规则：

- 只追加，不删历史。改主意就追加一条新记录，并注明推翻了哪条。
- 写「否定理由」，不写「不好看」。理由要能复用到下一个决策。
- 不记录一次性的实现细节，只记录可复用的取舍。
- 用户明确表达过的偏好（「不要圆角」「必须能打印」）属于品牌承诺，写进 `DESIGN.md`，不留在 `TASTE.md`。

## 7. 自查

- [ ] `tokens.css` 是唯一数值来源，`DESIGN.md` 不重复具体数值
- [ ] 所有颜色、字号、间距可在 tokens 里找到出处
- [ ] 六个方向契约字段齐全，且能被外人读懂
- [ ] 每个基准组件有结构、尺寸、状态、变体四项
- [ ] 「未决问题」不是空的，且没有把已定问题写进去
- [ ] 文档与代码一致，改动能在一处完成

相关：[world.md](world.md) 负责方向，[color.md](color.md) 与 [type.md](type.md) 负责具体数值原则，[audit.md](audit.md) 负责验收。
