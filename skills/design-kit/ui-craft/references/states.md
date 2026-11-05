# 状态与边界

**何时读我**：组件开始落地、页面准备交付时读我；尤其在你只画了 happy path 的时候，这份文档决定上线后是修 bug 还是收工。

## 状态矩阵：先列全，再写样式

每个交互元素都要有六态，每个数据视图都要有五态。缺一个，上线后就会在某个用户那里出现。

| 对象 | 状态 | 必须做到 |
|---|---|---|
| 按钮、链接、输入框 | default | 一眼看出可点；不要只靠颜色区分，主按钮同时用填充、字重或位置区分 |
| | hover | 背景、边框或颜色变化，150ms 内完成；触屏设备没有 hover，功能不能只依赖它 |
| | focus-visible | 2px outline、offset 2px、对比度 ≥3:1；键盘用户靠它定位 |
| | active | 按下立刻有反馈（60-120ms），不要等松开 |
| | disabled | 保持可读（文字对比度 ≥3:1），不要只写 `opacity: .4`；说明为什么禁用 |
| | loading | 保留原宽度避免布局跳动，加 `aria-busy="true"`，并阻止重复提交 |
| 数据视图 | loading | 骨架屏或 spinner；超过 300ms 才出现，避免一闪而过 |
| | empty | 说明会有什么、为什么空、主行动（见下文） |
| | error | 说明发生了什么、能否重试、重试按钮；不要只写「加载失败」 |
| | partial | 局部失败时保留已有内容，失败区域单独标出，不要把整页替换成错误页 |
| | overlong | 标题 2 行截断、列表项单行省略、长数值换行但不撑破容器 |

六态写在同一套选择器里，别在六个地方各写一半：

```css
.btn { background: var(--accent); color: var(--accent-contrast); }
.btn:hover { background: var(--accent-hover); }
.btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.btn:active { transform: scale(0.98); transition-duration: 60ms; }
.btn:disabled { background: var(--surface); color: var(--text-faint); cursor: not-allowed; }
.btn[aria-busy="true"] { pointer-events: none; cursor: progress; }
```

## 表单

- 标签放在输入框外并始终可见。placeholder 只放格式示例（`name@company.com`），不能当标签，因为一输入它就消失了。
- 必填标记：字段少时标可选（在标签后写「选填」），字段多时标必填（`*` 加一行「* 为必填」）。两种都可以，全页统一。
- 校验时机：首次失焦后校验该字段；用户重新输入时清除该字段错误；提交时汇总错误，并把焦点移到第一个错误字段。不要每按一次键就弹错。
- 错误文案指向具体字段和改法：「邮箱格式不对，需要包含 @」比「输入有误」有用。错误文字放在字段下方 8px，用 `aria-describedby` 关联，输入框加 `aria-invalid="true"`。
- 成功反馈：3 秒内可见。保存类让按钮文案短暂变成「已保存」，提交类在表单上方给状态条（`role="status"`）。不要用 `alert()`。
- 防止重复提交：提交时按钮置 disabled 并加 `aria-busy`；失败时保留用户输入，重试不用重填。
- 密码可见切换：用 `type="button"` 的按钮，`aria-label` 在「显示密码」与「隐藏密码」之间切换，切换时不丢焦点和光标位置。
- 自动填充：给对 `autocomplete`，常用值有 `email`、`current-password`、`new-password`、`name`、`tel`、`one-time-code`。写错属性，用户就得手动填。

**反例**：`<input placeholder="请输入邮箱">`，placeholder 是唯一标签，用户一输入它就消失。

**正例**（标签外置、错误就近、必填标记齐全）：

```html
<label for="email">邮箱 <span aria-hidden="true">*</span></label>
<input id="email" name="email" type="email" required autocomplete="email"
       aria-describedby="email-hint email-error" aria-invalid="false">
<p id="email-hint" class="hint">用于接收订单通知</p>
<p id="email-error" class="error" role="alert"></p>
```

## 空状态

合格的空状态回答三件事：这里会有什么、为什么现在是空的、现在能做什么。

```text
还没有项目
项目把相关工作收在一起，团队可以在这里分工。
[新建项目]  [从模板开始]
```

- 首次空：用户从没用过这个功能。给示例、模板、一句话价值说明，甚至给「导入示例数据」。
- 清空后空：用户自己删完了。轻量处理，一句「还没有项目」加一个新建按钮，不要再放教程和插画。
- 搜索无结果：说明当前条件，给「清除筛选」，不要写「暂无数据」。

**反例**：一张灰色插画加「暂无数据」，用户不知道这里是干什么的，也不知道下一步。**正例**：一句「还没有项目」加两条具体出口，文案要能直接说清下一步，写法见 [copy.md](copy.md)。

## 错误与恢复

- 错误边界：让失败停在局部。一张数据卡片挂了，页面其他部分照常可用，卡片内显示错误和重试。不要用一个全局错误把整页替换掉。
- 重试：保留用户输入和滚动位置，按钮写「重试」而不是「确定」。
- 离线：顶部挂持续可见的提示条（不是 3 秒消失的 toast），说明当前离线、哪些功能不可用；恢复后自动刷新或给「重新加载」。
- 权限不足：403 要说清缺什么权限、找谁开，不要伪装成 404。只读模式显式标注「只读」，并隐藏编辑控件，而不是让它们点了报错。
- 404 给搜索框和返回入口；500 给错误编号或请求 ID，方便用户报给客服。

## 边界内容

- 超长文本：标题最多 2 行，用 `-webkit-line-clamp`；用户名、邮箱、文件名单行省略，同时给 `title` 或展开入口。
- 多语言：按 1.4 倍长度预留（德语、俄语都比中文长），不要给按钮和标签写死宽度。
- 0 条、1 条、巨大数量：0 条用空状态而不是「0 条结果」；超过 1000 条用分页或虚拟滚动；表格里的 0 和 1 要单独测文案。
- 图片加载失败：给 `img` 背景色和 alt 文字，失败时显示替代文字，不要出现破图标。
- 数值为 0 或负数：图表要能画 0 和负值；金额为负时同时给负号和「支出」标签，不能只靠红色区分。

```css
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
```

## 可访问性基线

- 语义标签：按钮用 `<button>`，链接用 `<a>`，控件配 `<label>`。不要用 `div` 加 `onclick` 冒充按钮。
- 标题顺序：每页一个 `h1`，不跳级（`h2` 下面不能直接是 `h4`）。视觉大小用 CSS 调，不要为了字号选错标题级别。
- 焦点可见：`outline: none` 是硬性禁止，统一写成下面这样。

```css
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
```

- 键盘顺序：DOM 顺序等于视觉顺序，不要用大于 0 的 `tabindex` 调整。
- 异步反馈：用 `role="status"`（等价 `aria-live="polite"`）播报成功和数量变化，`role="alert"`（等价 `aria-live="assertive"`）只给错误。不要每次按键都触发。
- 图片 alt：有信息的图片写内容（「2025 年四季度营收 2.4 亿元，环比增长 12%」），装饰图写 `alt=""`。
- 对比度：正文 4.5:1，大字号 3:1，焦点环和图标 3:1。
- 触摸目标：至少 44×44px，元素本身小时用 padding 补。
- 语言：`<html lang="zh-CN">`。整段外文才单独标 lang，中英混排的句子不要逐词包 span。
- 动效：所有动画都要有 `prefers-reduced-motion: reduce` 降级路径，写法见 [motion.md](motion.md)。

## 移动端与键盘

- 安全区：`viewport-fit=cover` 加 `env(safe-area-inset-*)`，底部固定按钮写 `padding-bottom: max(12px, env(safe-area-inset-bottom))`。
- 软键盘：整页高度用 `100dvh` 不用 `100vh`；输入框加 `scroll-margin-top`，聚焦时能滚进可见区域；键盘弹起时底部固定元素要么上移要么隐藏。
- 滚动锁定：打开浮层时锁 `body` 滚动，关闭后恢复原滚动位置；iOS Safari 需要 `position: fixed` 方案。
- 关闭：浮层、下拉、对话框必须响应 `Esc`，关闭后焦点回到触发它的元素。
- 焦点陷阱：对话框内 Tab 循环、不出界；优先用原生 `<dialog>` 或 `inert`，不要手写一堆 keydown。

## 反模式

- **只有 happy path**：没网、空、报错、超长都靠用户自己发现，最后变成一堆线上工单。
- **错误用红字堆在顶部**：用户不知道是哪一项错了，还要自己找。错误要挨着字段。
- **`outline: none`**：键盘用户彻底失去位置，改用 `:focus-visible` 样式。
- **禁用态不可读**：`opacity: .3` 的灰按钮，用户既看不清也不知道为什么不能点。
- **空状态只有插画**：没有说明、没有出口，等于把用户扔在空白页。

## 检查项

- [ ] 每个按钮和输入都过了一遍六态表，focus-visible 用键盘验证过。
- [ ] 每个数据视图都有 loading / empty / error / partial / overlong 五态。
- [ ] 表单的错误文案指向具体字段，提交时焦点落在第一个错误上。
- [ ] 空状态回答「有什么、为什么空、能做什么」，且区分首次空与清空后空。
- [ ] 长标题、长邮箱、0 条、1000 条、图片加载失败都不破版。
- [ ] 只用键盘能走完全流程，Esc 能关浮层，焦点回到触发点。

整体验收见 [craft-floor.md](craft-floor.md)。
