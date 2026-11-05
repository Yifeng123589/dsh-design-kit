// 轴定义与插值：协议里「轴判据 + 相对定位 + 区间插值」的最小实现。
// V0.2 起登记三条轴：r4 颜色（色度副作用代理）、r5 正文基准字号 / r6 分组间距（声明位代理）。
// 其余轴按同一 schema 追加，并必须声明 sideEffectKind 与对应的副作用检查方式。

export const AXES = {
  r4: {
    id: 'r4',
    dim: 'accent_saturation',
    label: '强调色的蓝饱和度',
    kind: 'continuous', // continuous | discrete | none
    unit: 'fraction',
    min: 0,
    max: 1,
    // 可辨识阈值（JND）：来自 2026-11-02 的真实三轮观察——
    // 39.1% / 40.6% / 42.2% 三档肉眼不可辨，故把 5 个百分点定为「低于此差异视为同一档」。
    // build 在区间窄于 4×JND 时拒绝细分（3 个内部点，相邻只差宽/4，否则内部点会低于 JND），
    // apply 会写「等效区间」而不是点值。
    jnd: 0.05,
    // 从 R4 的实战值反推：75% → chroma ≈ 0.167，蓝色 hue 246，明度固定 66%
    chroma: (value) => 0.02 + value * 0.22,
    placeholder: '{{ACCENT}}',
    render: (value) => `oklch(66% ${(0.02 + value * 0.22).toFixed(4)} 246)`,
    format: (value) => `${Math.round(value * 100)}%`,
    sideEffectKind: 'color',
    templateRel: 'fixtures/r4/base.html',
  },
  r5: {
    id: 'r5',
    dim: 'body_font_size',
    label: '正文基准字号',
    kind: 'continuous',
    unit: 'px',
    min: 14,
    max: 20,
    // 未做真人标定，先按常见建议取 1px：低于 1px 的字号差在正文里基本不可辨。
    jnd: 1,
    placeholder: '{{FONT_SIZE}}',
    render: (value) => `${Math.round(value * 10) / 10}px`,
    format: (value) => `${Math.round(value * 10) / 10}px`,
    sideEffectKind: 'declaration',
    sideEffectProperty: '--reader-size',
    invariants: ['行高（单位行高 1.7）', '字距（letter-spacing）', '颜色与结构'],
    knownCouplings: [
      '字号变化会改变每行字数与折行位置（measure 未在渲染层测量）',
      '标题使用固定 px，不随正文缩放，标题/正文层级比例会变化',
    ],
    templateRel: 'fixtures/r5/base.html',
  },
  r6: {
    id: 'r6',
    dim: 'stack_gap',
    label: '页面纵向节奏（分组间距与内边距）',
    kind: 'continuous',
    unit: 'px',
    min: 10,
    max: 40,
    // 首次实测（2026-11-02）：12/18/24px（6px 步长）评审人看不出差异 → 6px 低于可辨阈。
    // 因此把 JND 从 2px 上调到 6px（保守估值，未做阶梯法标定）；demo 档位改为 12/24/36（2×JND）。
    // 两轮真实指认：R1 24px → R2 18px，差 6px ≤ JND，判同一档，已发 axis 凭证（校准 18px，等效带 [18,24]）。
    jnd: 6,
    placeholder: '{{STACK_GAP}}',
    render: (value) => `${Math.round(value)}px`,
    format: (value) => `${Math.round(value)}px`,
    sideEffectKind: 'declaration',
    sideEffectProperty: '--stack-gap',
    invariants: ['字号与行高', '颜色', '圆角与边框'],
    knownCouplings: [
      '间距变量同时作用于页头留白、卡片内边距、分组间距与页脚，不是「纯分组间距」',
      '间距变化会改变一屏能放下的内容量，影响「疏密感」的整体读数',
    ],
    templateRel: 'fixtures/r6/base.html',
  },
};

export function axisById(id) {
  const axis = AXES[id];
  if (!axis) throw new RangeError(`未知的轴：${id}（可用：${Object.keys(AXES).join(', ')}）`);
  return axis;
}

export function formatValue(axis, value) {
  return axis.format(value);
}

/** 均匀取 n 个点，避开两端（0.25/0.5/0.75 用于 n=3，与协议实例的「频谱 3 点」对齐）。 */
export function spectrumPoints(axis, n) {
  if (!Number.isInteger(n) || n < 2) throw new RangeError('点数至少为 2');
  const span = axis.max - axis.min;
  return Array.from({ length: n }, (_, i) => axis.min + (span * (i + 1)) / (n + 1));
}

/** 在两个端点之间按 fractions 插值（默认 3 个微变体：1/4、1/2、3/4）。 */
export function interpolate(axis, lo, hi, fractions = [0.25, 0.5, 0.75]) {
  if (!(lo >= axis.min && lo <= axis.max && hi >= axis.min && hi <= axis.max)) {
    throw new RangeError(`插值端点超出轴范围 [${axis.min}, ${axis.max}]`);
  }
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  return fractions.map((f) => a + (b - a) * f);
}

export function clamp(axis, value) {
  return Math.min(axis.max, Math.max(axis.min, value));
}

/** 给区间指认算中心值与半宽（用于归因里的 applicability_boundary）。 */
export function intervalOf(axis, lo, hi) {
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  return { lo: a, hi: b, mid: (a + b) / 2, half: (b - a) / 2 };
}
