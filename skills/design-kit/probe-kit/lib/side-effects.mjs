// 轴副作用代理：对「一维颜色轴」检查扰动是否只动了目标维度。
//
// 背景（协议 P1）：轴纯度目前只有声明。完整 AST 变更集能证明「源码只变了一个变量」，
// 但证明不了「这一个变量对应一个感知维度」。颜色轴有一条便宜得多的路：
// 直接计算变体的 Oklch 色相 / 明度 / 对比度是否跟着漂移。漂移超界 = 串维，拒绝发准。
//
// 目前只覆盖 oklch() 渲染的颜色轴；其它轴（字号、间距、圆角）按同一 schema 后补。
// 零依赖：只用正则、数学与 WCAG 相对亮度公式。

export const SIDE_EFFECT_SCHEMA = 'side-effects/1';

export const DEFAULT_THRESHOLDS = Object.freeze({
  // 色相漂移超过 2° 视为颜色不再是同一个色相（饱和度轴不该动 hue）
  hueDeg: 2,
  // 明度（Oklch L，0-1）漂移超过 0.5 个百分点视为动了明度
  lightness: 0.005,
  // 与底色对比度变化超过 0.15（比值绝对值）视为动了可读性
  contrastRatio: 0.15,
});

const OKLCH_PATTERN = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/i;
const BACKGROUND_PATTERN = /--paper\s*:\s*(#[0-9a-fA-F]{6})/;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

/** 解析 oklch(L% C H) 字符串；不支持的格式返回 null。 */
export function parseOklch(color) {
  if (typeof color !== 'string') return null;
  const match = OKLCH_PATTERN.exec(color);
  if (match === null) return null;
  const l = Number(match[1]) / 100;
  const c = Number(match[2]);
  const h = Number(match[3]);
  if (![l, c, h].every((value) => Number.isFinite(value))) return null;
  return { l, c, h };
}

/** Oklab（极坐标转直角坐标后）→ 线性 sRGB。 */
function oklabToLinearSrgb(l, a, b) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

function linearToSrgb(value) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Oklch → sRGB（0-255），用于相对亮度与对比度。 */
export function oklchToSrgb({ l, c, h }) {
  const radians = (h * Math.PI) / 180;
  const linear = oklabToLinearSrgb(l, c * Math.cos(radians), c * Math.sin(radians));
  return {
    r: Math.round(clamp01(linearToSrgb(linear.r)) * 255),
    g: Math.round(clamp01(linearToSrgb(linear.g)) * 255),
    b: Math.round(clamp01(linearToSrgb(linear.b)) * 255),
  };
}

export function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function relativeLuminance({ r, g, b }) {
  const [red, green, blue] = [r, g, b].map((channel) => srgbToLinear(channel / 255));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(rgbA, rgbB) {
  const la = relativeLuminance(rgbA);
  const lb = relativeLuminance(rgbB);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** 从受控模板里读底色；读不到时退到白底。 */
export function extractBackground(templateHtml) {
  const match = BACKGROUND_PATTERN.exec(templateHtml ?? '');
  return match === null ? '#ffffff' : match[1].toLowerCase();
}

/**
 * 对一组颜色轴值做副作用分析。
 *
 * @param {object} options
 * @param {object} options.axis  轴定义（需要 render(value) 返回 oklch(...)）
 * @param {number[]} options.values 变体值
 * @param {string} [options.templateHtml] 受控模板（用来取底色）
 * @param {object} [options.thresholds] 覆盖默认阈值
 * @returns {{ok:boolean, violations:string[], ...}} 分析结果
 */
export function analyzeColorSideEffects({ axis, values, templateHtml, thresholds = {} }) {
  const limit = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const backgroundHex = extractBackground(templateHtml);
  const backgroundRgb = hexToRgb(backgroundHex);
  const baseLuminance = relativeLuminance(backgroundRgb);

  const variants = values.map((value, index) => {
    const color = axis.render(value);
    const oklch = parseOklch(color);
    if (oklch === null) {
      throw new Error(`轴 ${axis.id ?? '?'} 的渲染结果不是 oklch()：${String(color).slice(0, 80)}`);
    }
    const rgb = oklchToSrgb(oklch);
    return {
      index,
      value,
      color,
      oklch: { l: round(oklch.l), c: round(oklch.c, 5), h: round(oklch.h, 3) },
      rgb,
      luminance: round(relativeLuminance(rgb), 6),
      contrastVsBackground: round(contrastRatio(rgb, backgroundRgb), 4),
    };
  });

  const chromas = variants.map((variant) => variant.oklch.c);
  const monotonicChroma =
    chromas.every((chroma, index) => index === 0 || chroma > chromas[index - 1]) ||
    chromas.every((chroma, index) => index === 0 || chroma < chromas[index - 1]);

  const hues = variants.map((variant) => variant.oklch.h);
  const lightnesses = variants.map((variant) => variant.oklch.l);
  const contrasts = variants.map((variant) => variant.contrastVsBackground);
  const span = (list) => Math.max(...list) - Math.min(...list);
  const hueDeg = round(span(hues), 3);
  const lightness = round(span(lightnesses), 6);
  const contrastDelta = round(span(contrasts), 4);

  const violations = [];
  if (hueDeg > limit.hueDeg) violations.push(`色相漂移 ${hueDeg}° > ${limit.hueDeg}°：饱和度扰动同时改变了色相`);
  if (lightness > limit.lightness) violations.push(`明度漂移 ${(lightness * 100).toFixed(2)} 个百分点 > ${(limit.lightness * 100).toFixed(1)}：扰动同时改变了明度`);
  if (contrastDelta > limit.contrastRatio) violations.push(`对比度漂移 ${contrastDelta} > ${limit.contrastRatio}：扰动同时改变了可读性`);
  if (!monotonicChroma) violations.push('色度不随轴值单调：数值顺序与感知顺序不一致');

  const chromaDelta = round(span(chromas), 5);
  return {
    schema: SIDE_EFFECT_SCHEMA,
    kind: 'color',
    axis: {
      id: typeof axis.id === 'string' ? axis.id : null,
      dim: typeof axis.dim === 'string' ? axis.dim : null,
      label: typeof axis.label === 'string' ? axis.label : null,
      kind: typeof axis.kind === 'string' ? axis.kind : 'unknown',
    },
    background: backgroundHex,
    variants,
    deltas: { chroma: chromaDelta, hueDeg, lightness, contrastRatio: contrastDelta },
    monotonicChroma,
    thresholds: { ...limit },
    violations,
    ok: violations.length === 0,
    note:
      violations.length === 0
        ? '扰动只动了色度：色相、明度、对比度都在阈值内，作为颜色轴纯度的可推翻代理'
        : '扰动越界：这组变体不能当单轴证据，降级为自由变体或重生成',
    backgroundLuminance: round(baseLuminance, 6),
  };
}

/**
 * 声明位代理：适用于字号/间距等「一个 CSS 变量控制一类属性」的轴。
 *
 * 模板模式下占位符只出现一次，所以「其它属性会不会跟着变」在源码层是可控的；
 * 真正无法自动证明的是感知耦合（字号影响行宽、间距影响一屏内容量）。
 * 这些耦合必须由轴显式声明（knownCouplings），并在凭证里标注「已声明、未测量」。
 *
 * @param {{axis: object, templateHtml: string}} options
 */
export function analyzeDeclarationSideEffects({ axis, templateHtml }) {
  const placeholder = typeof axis.placeholder === 'string' ? axis.placeholder : '';
  const expectedProperty = typeof axis.sideEffectProperty === 'string' ? axis.sideEffectProperty : '';
  const text = typeof templateHtml === 'string' ? templateHtml : '';
  const violations = [];
  if (placeholder === '') violations.push('轴没有声明 placeholder，无法做声明位检查');
  if (expectedProperty === '') violations.push('轴没有声明 sideEffectProperty，无法核对占位符位置');
  const count = placeholder === '' ? 0 : text.split(placeholder).length - 1;
  if (count !== 1) violations.push(`模板里占位符 ${placeholder || '(空)'} 出现 ${count} 次，应恰好 1 次`);

  let property = null;
  if (count === 1) {
    const index = text.indexOf(placeholder);
    const before = text.slice(0, index);
    const boundary = Math.max(before.lastIndexOf('{'), before.lastIndexOf(';'));
    const declaration = before.slice(boundary + 1);
    const match = /([A-Za-z-]+)\s*:\s*[^;{}]*$/.exec(declaration);
    property = match === null ? null : match[1];
    if (property === null) violations.push('找不到占位符所在的 CSS 声明，无法核对');
    else if (expectedProperty !== '' && property !== expectedProperty) {
      violations.push(`占位符落在 ${property} 上，但轴声明的是 ${expectedProperty}：声明位不一致`);
    }
  }

  const invariants = Array.isArray(axis.invariants) ? axis.invariants : [];
  const knownCouplings = Array.isArray(axis.knownCouplings) ? axis.knownCouplings : [];
  return {
    schema: SIDE_EFFECT_SCHEMA,
    kind: 'declaration',
    axis: {
      id: typeof axis.id === 'string' ? axis.id : null,
      dim: typeof axis.dim === 'string' ? axis.dim : null,
      label: typeof axis.label === 'string' ? axis.label : null,
      kind: typeof axis.kind === 'string' ? axis.kind : 'unknown',
    },
    placeholder,
    property,
    expectedProperty,
    invariants,
    knownCouplings,
    violations,
    ok: violations.length === 0,
    note:
      violations.length === 0
        ? '占位符落在声明的属性上；其余声明在模板模式下逐字节不变。已知感知耦合已记录，但未测量（不是证明）'
        : '声明位不成立：这组变体不能当单轴证据',
  };
}

/** 按轴类型分派：颜色轴走色度度量，字号/间距轴走声明位检查。 */
export function analyzeAxisSideEffects({ axis, values, templateHtml }) {
  if (axis.sideEffectKind === 'declaration') {
    return analyzeDeclarationSideEffects({ axis, templateHtml });
  }
  try {
    return analyzeColorSideEffects({ axis, values, templateHtml });
  } catch {
    return null;
  }
}

/** 从运行清单里取副作用摘要（给 review / verify 用，避免重复打印全量变体）。 */
export function sideEffectsSummary(sideEffects) {
  if (sideEffects === null || typeof sideEffects !== 'object') return null;
  if (sideEffects.kind === 'declaration') {
    return {
      kind: 'declaration',
      ok: sideEffects.ok === true,
      placeholder: sideEffects.placeholder ?? null,
      property: sideEffects.property ?? null,
      expectedProperty: sideEffects.expectedProperty ?? null,
      invariants: Array.isArray(sideEffects.invariants) ? sideEffects.invariants : [],
      knownCouplings: Array.isArray(sideEffects.knownCouplings) ? sideEffects.knownCouplings : [],
      violations: Array.isArray(sideEffects.violations) ? sideEffects.violations : [],
    };
  }
  return {
    kind: 'color',
    ok: sideEffects.ok === true,
    background: sideEffects.background ?? null,
    deltas: sideEffects.deltas ?? null,
    monotonicChroma: sideEffects.monotonicChroma === true,
    violations: Array.isArray(sideEffects.violations) ? sideEffects.violations : [],
  };
}

/** 比较两次副作用结果是否一致（verify 防篡改用）。 */
export function sameSideEffects(left, right) {
  if (left === null || right === null) return false;
  const pick = (value) => {
    if (value.kind === 'declaration') {
      return JSON.stringify({
        kind: value.kind,
        placeholder: value.placeholder,
        property: value.property,
        expectedProperty: value.expectedProperty,
        violations: value.violations,
      });
    }
    return JSON.stringify({
      kind: value.kind ?? 'color',
      background: value.background,
      deltas: value.deltas,
      monotonicChroma: value.monotonicChroma,
      violations: value.violations,
    });
  };
  return pick(left) === pick(right);
}

