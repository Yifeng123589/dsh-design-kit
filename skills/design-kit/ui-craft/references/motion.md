# 动效

**何时读我**：页面结构已经能用，准备加动效时读我；如果你正打算给每个 section 加 fade-up，先停，读完第一节再决定。

## 一个作者时刻，其余沉默

动效预算是一次「记得住」的体验，不是均匀分配的装饰。先决定哪个时刻值得设计：

- 首屏主张的分行揭示：三行文字用遮罩上移，620ms 内结束。
- 列表缩略图进入详情时的共享元素：用户知道自己在哪，也知道怎么回去。
- 产品界面从静态截图切换成可操作界面：只做一次，不是每次滚动都来一遍。
- 表单提交成功后整块收拢成一行确认：结果替代了表单。

其余动效只做反馈：hover 140ms、面板展开 240ms、元素出现 200ms。不要给每个 section 配同一套动效。

**反例**：

```css
.section { opacity: 0; transform: translateY(24px); transition: all .6s; }
.section.is-visible { opacity: 1; transform: none; }
```

四个问题：内容依赖 JS 才可见，脚本失败就是白屏；每屏做同一个动作，等于没有设计；滚到哪都在等 600ms；`transition: all` 连布局属性一起动。

**正例**：首屏标题用一次遮罩揭示，全页只此一次，其余元素默认可见。

```css
@media (prefers-reduced-motion: no-preference) {
  .hero__line {
    animation: rise 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: calc(var(--i) * 60ms);
  }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(0.4em); clip-path: inset(0 0 100% 0); }
  to   { opacity: 1; transform: none; clip-path: inset(0 0 0 0); }
}
```

媒体查询是外层保险：减弱动效的用户直接看到最终状态，没有 JS 也照样可读。

## 时长与缓动

| 场景 | 时长 | 缓动 |
|---|---|---|
| 微交互（hover、按下、勾选） | 120-180ms | `--ease-out` |
| 页面元素（下拉、提示、卡片出现） | 200-300ms | `--ease-out` |
| 大场景（首屏揭示、浮层、转场） | 400-600ms | `--ease-out`，前 300ms 走完大半 |
| 退出（关闭、消失） | 进入时长的 50-70% | `--ease-in` |
| 循环与进度（spinner、进度条） | 不限 | `linear` |

```css
:root {
  --dur-1: 140ms; --dur-2: 240ms; --dur-3: 520ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

线性只给本来就没有起点和终点的东西：无限循环、进度条、加载指示。进入用 ease-out，退出用 ease-in，符合物理直觉：东西冲出来时减速，消失时加速。不要反射性地上 bounce 或 elastic，除非世界的设定就是玩具。

## 入场：默认可见

- 内容必须在 CSS 默认状态下可见，动效只写在 `prefers-reduced-motion: no-preference` 里。
- 首屏入场用 CSS 动画，不要用 JS 滚动监听，免得内容和脚本赛跑。
- stagger 上限 6 个元素，间隔 40-80ms，总延迟不超过 400ms。超过 6 个就整组一起动，或者只动第一行。

**反例**：12 张卡片每张延迟 80ms，最后一张 960ms 后才出现，用户已经滚过去了。**正例**：只给列表前 6 项加 stagger，其余随组出现；间隔 60ms，总延迟 300ms。

## 滚动与视差

只在「滚动本身携带空间关系」时用：长图叙事、横向画廊、滚动进度。列表、后台、文档不要做滚动动效。

- 红线：只动 `transform` 和 `opacity`。不碰 `width`、`height`、`top`、`margin`，也不要在滚动中做高频 `filter: blur()`。
- 用 `IntersectionObserver` 触发，不要在 `scroll` 事件里读 `getBoundingClientRect()`。
- 视差幅度：位移不超过 40px 或视口高度的 10%，最多两层。超过这个数，前庭敏感的用户会晕。
- `will-change` 只在动画期间加，结束后移除；常驻会一直占用合成层。
- 用 CSS scroll-driven animation 时，必须同时给静态降级。

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .parallax, .hero__line { transform: none !important; animation: none !important; }
  .reveal { opacity: 1 !important; transform: none !important; }
}
```

这段是兜底。更好的做法是逐组件降级：去掉位移，保留 opacity 和颜色变化，因为「操作成功了」这个反馈不该被一起关掉。

## 交互反馈

- hover 是预览：只改背景、边框、颜色，150ms 内完成，不要移动元素位置。
- `:focus-visible` 是可达性：2px 实线 outline，offset 2px，对比度 ≥3:1。它必须能和 hover 同时出现，不要被 hover 样式覆盖。
- `:active` 是确认：按下立刻反应，60-120ms 内出现颜色或位移变化，`transform: scale(0.98)` 就够。按下去没反应的按钮，用户会再点一次。
- 加载：超过 300ms 才出现指示，避免闪烁。已知结构的加载用骨架屏（列表、卡片、表格），未知结构或短操作才用 spinner。
- 骨架屏不要做高对比度的无限 shimmer，用 1.2-1.5s 的低对比度渐变，或者干脆静态灰块。
- 页面转场只在连续性重要时做：列表到详情、tab 切换。整页白屏淡出淡入 300ms 会让所有导航都变慢，不要给每次跳转都加。

## 性能与可访问性

- 可中断：CSS transition 天然可中断；Web Animations API 用 `animation.cancel()`。不要用 `setTimeout` 串一串不可打断的动作。
- 不阻塞输入：动画期间不锁 pointer 事件，不整页 `pointer-events: none`。
- 不闪烁：闪烁频率不超过每秒 3 次（WCAG 2.3.1）。无限旋转的装饰必须停，至少离开视口时停。
- 聚焦元素不要跑：用户点按钮时，按钮不能正在位移或缩放；正在输入的元素不要有持续动画。
- `scroll-behavior: smooth` 要放进 `prefers-reduced-motion: no-preference`，否则点击锚点会失控。

## 反模式

- **`transition: all`**：改成明确属性清单，例如 `transition: background-color 160ms, color 160ms, transform 160ms`。all 会把布局属性和 display 一起拖进来，卡顿和意外动画都从这里来。
- **无限旋转的装饰**：页脚转圈的 logo、转动的星星，用户看第二遍就烦，还一直耗电。装饰保持静止，除非它本身就是作品。
- **用动效掩盖加载慢**：1.2s 的精心编排盖不住 8s 的等待，用户只会觉得更慢。先修加载，再加动效。
- **滚动劫持**：把页面切成 100dvh 分屏、用 transform 代替滚动，用户没法用触控板、没法用键盘，也找不到自己在哪里。
- **自动播放带声音**：视频和音频默认静音并给暂停按钮，否则浏览器会拦，用户会关页面。

## 检查项

- [ ] 全页只有一个作者时刻，其余动效都能一句话说出「它在反馈什么」。
- [ ] 时长落在 120-180 / 200-300 / 400-600ms 三档里，退出比进入快。
- [ ] 关掉 JS 后内容依然可见，没有靠动效才出现的内容。
- [ ] stagger 不超过 6 个元素，总延迟不超过 400ms。
- [ ] 有 `prefers-reduced-motion: reduce` 路径，且保留了必要的状态反馈。
- [ ] 没有 `transition: all`、无限装饰旋转、滚动劫持。

版式节奏见 [layout.md](layout.md)，动效之后的状态与边界见 [states.md](states.md)。
