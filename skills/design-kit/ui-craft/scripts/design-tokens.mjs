#!/usr/bin/env node
/**
 * design-tokens.mjs
 * Zero-dependency OKLCH design token generator for the ui-craft skill.
 * Node >= 18, ESM, no external packages, works on Windows / macOS / Linux.
 *
 * Generates:
 *   <out>/tokens.css          semantic colors + fluid type scale + spacing + radius + shadow + motion
 *   <out>/tokens.json         structured token tree + WCAG contrast report
 *   <out>/tokens-preview.html offline preview page (swatches, type scale, spacing, contrast table)
 *
 * After generation every foreground/background pair is checked against WCAG AA.
 * Failing text tokens are nudged along OKLCH lightness (hue/chroma kept) until they pass,
 * and every adjustment is explained on stderr in Chinese.
 *
 * Source comments are English. All CLI output is Chinese.
 * Exit codes: 0 = generated, 2 = bad arguments.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const GENERATOR = 'design-tokens.mjs';
const SCHEMA_VERSION = 1;
const DEFAULT_OUT = 'tokens-out';
const DEFAULT_CHROMA = 0.14;
const MAX_CHROMA = 0.37;
const TYPE_BASE_PX = 16;
const FLUID_MIN_PX = 320;
const FLUID_MAX_PX = 1440;

const USAGE = `用法:
  node scripts/design-tokens.mjs --name <slug> --hue <0-360> [--chroma <0-0.37>]
    [--mode light|dark|both] [--mood calm|bold|warm|cool|editorial|tech]
    [--from <#hex>] [--out <dir>]

示例:
  node scripts/design-tokens.mjs --name demo --hue 255 --mood calm --mode both --out tokens
  node scripts/design-tokens.mjs --name warm --from '#c2410c' --mood warm --out tokens

参数:
  --name <slug>      token 集名称（只做记录与预览页标题，不会作为 CSS 变量前缀）
  --hue <0-360>      种子色相；或用 --from <#hex> 从现有颜色反推
  --chroma <0-0.37>  种子色度，默认 ${DEFAULT_CHROMA}
  --mood <name>      calm|bold|warm|cool|editorial|tech，默认 calm
  --mode <name>      light|dark|both，默认 both
  --from <#hex>      从 #rgb / #rrggbb 反推 hue 与 chroma（不能与 --hue/--chroma 同时使用）
  --out <dir>        输出目录，默认 ./${DEFAULT_OUT}
  -h, --help         显示本帮助

产出: <out>/tokens.css、<out>/tokens.json、<out>/tokens-preview.html
退出码: 0 = 成功；2 = 参数错误。`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

class CliError extends Error {}

function usageError(message) {
  throw new CliError(message);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith('--')) usageError(`${flag} 缺少取值`);
  return value;
}

function parseArgs(argv) {
  const opts = {
    name: 'design',
    hue: null,
    chroma: null,
    mode: 'both',
    mood: 'calm',
    from: null,
    out: DEFAULT_OUT,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inlineValue = null;
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      inlineValue = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const next = () => {
      if (inlineValue != null) return inlineValue;
      const value = takeValue(argv, i, arg);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--name': opts.name = next(); break;
      case '--hue': opts.hue = next(); break;
      case '--chroma': opts.chroma = next(); break;
      case '--mode': opts.mode = next(); break;
      case '--mood': opts.mood = next(); break;
      case '--from': opts.from = next(); break;
      case '--out': opts.out = next(); break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        usageError(`未知参数：${arg}`);
    }
  }
  if (opts.help) return opts;

  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(opts.name)) {
    usageError(`--name 只能包含字母、数字、连字符与下划线（当前：${opts.name}）`);
  }
  if (!opts.out || !String(opts.out).trim()) usageError('--out 不能为空');
  if (!['light', 'dark', 'both'].includes(opts.mode)) {
    usageError(`--mode 只能是 light、dark 或 both（当前：${opts.mode}）`);
  }
  if (!MOODS[opts.mood]) {
    usageError(`--mood 只能是 ${Object.keys(MOODS).join('、')}（当前：${opts.mood}）`);
  }
  if (opts.from != null && (opts.hue != null || opts.chroma != null)) {
    usageError('--from 与 --hue/--chroma 不能同时使用：--from 会自动反推 hue 与 chroma');
  }
  if (opts.from != null) {
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(opts.from)) {
      usageError(`--from 需要 #rgb 或 #rrggbb 格式（当前：${opts.from}）`);
    }
  } else if (opts.hue == null) {
    usageError('缺少种子色相：请提供 --hue <0-360> 或 --from <#hex>');
  } else {
    const hue = Number(opts.hue);
    if (!Number.isFinite(hue) || hue < 0 || hue > 360) {
      usageError(`--hue 需要 0–360 之间的数字（当前：${opts.hue}）`);
    }
  }
  if (opts.chroma != null) {
    const chroma = Number(opts.chroma);
    if (!Number.isFinite(chroma) || chroma < 0 || chroma > MAX_CHROMA) {
      usageError(`--chroma 需要 0–${MAX_CHROMA} 之间的数字（当前：${opts.chroma}）`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function formatNumber(value, digits = 4) {
  const fixed = Number(value).toFixed(digits);
  return fixed.replace(/\.?0+$/, '') || '0';
}

function formatRatio(value) {
  return Number(value).toFixed(2);
}

// ---------------------------------------------------------------------------
// sRGB <-> OKLab / OKLCH
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  let value = String(hex).replace('#', '').trim();
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

function srgbToLinear(channel) {
  const v = clamp(channel, 0, 255) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  const v = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return clamp(v * 255, 0, 255);
}

function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearSrgbToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const [L, a, B] = linearSrgbToOklab(r, g, b);
  const C = Math.sqrt(a * a + B * B);
  let h = (Math.atan2(B, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: C, h };
}

function linearToHex(linearRgb) {
  const [r, g, b] = linearRgb.map(linearToSrgb);
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function oklchToRgbRaw(L, C, h) {
  const rad = (h * Math.PI) / 180;
  return oklabToLinearSrgb(L, C * Math.cos(rad), C * Math.sin(rad));
}

function inSrgbGamut(linearRgb, epsilon = 0.00005) {
  return linearRgb.every((v) => v >= -epsilon && v <= 1 + epsilon);
}

/** Map an OKLCH color into sRGB: keep L/h, reduce C with a binary search when needed. */
function oklchToSrgb(L, C, h) {
  const lightness = clamp(L, 0, 1);
  let chroma = Math.max(0, C);
  let linear = oklchToRgbRaw(lightness, chroma, h);
  let gamutMapped = false;
  if (chroma > 0 && !inSrgbGamut(linear)) {
    gamutMapped = true;
    let lo = 0;
    let hi = chroma;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inSrgbGamut(oklchToRgbRaw(lightness, mid, h))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
    linear = oklchToRgbRaw(lightness, chroma, h);
  }
  return {
    rgb: linear.map(linearToSrgb),
    hex: linearToHex(linear),
    oklch: { l: lightness, c: chroma, h },
    gamutMapped,
  };
}

function tokenColor({ l, c, h, requestedChroma }) {
  const result = oklchToSrgb(l, c, h);
  return {
    hex: result.hex,
    rgb: result.rgb,
    oklch: result.oklch,
    gamutMapped: result.gamutMapped,
    requestedChroma: requestedChroma != null ? requestedChroma : c,
  };
}

function setLightness(color, l) {
  const next = oklchToSrgb(clamp(l, 0, 1), color.oklch.c, color.oklch.h);
  color.hex = next.hex;
  color.rgb = next.rgb;
  color.oklch = next.oklch;
  return color;
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(rgbA, rgbB) {
  const a = relativeLuminance(rgbA);
  const b = relativeLuminance(rgbB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function oklchString(color) {
  return `oklch(${formatNumber(color.oklch.l)} ${formatNumber(color.oklch.c)} ${formatNumber(color.oklch.h, 1)})`;
}

// ---------------------------------------------------------------------------
// Mood presets (shape the neutral tint, radii, type ratio, motion and shadows)
// ---------------------------------------------------------------------------

const MOODS = {
  calm: {
    label: '沉静',
    neutralHue: 'seed',
    neutralChroma: 0.006,
    accentChromaFactor: 0.9,
    lightAccentL: 0.55,
    darkAccentL: 0.74,
    ratio: 1.25,
    radii: { sm: 0.25, md: 0.5, lg: 0.75, xl: 1 },
    shadowAlpha: 0.07,
    durations: { fast: 140, base: 200, slow: 320 },
    display: 'sans',
    displayWeight: 600,
  },
  bold: {
    label: '大胆',
    neutralHue: 'seed',
    neutralChroma: 0.008,
    accentChromaFactor: 1.15,
    lightAccentL: 0.54,
    darkAccentL: 0.76,
    ratio: 1.333,
    radii: { sm: 0.125, md: 0.25, lg: 0.5, xl: 0.75 },
    shadowAlpha: 0.12,
    durations: { fast: 120, base: 160, slow: 240 },
    display: 'sans',
    displayWeight: 800,
  },
  warm: {
    label: '温暖',
    neutralHue: 55,
    neutralChroma: 0.012,
    accentChromaFactor: 1,
    lightAccentL: 0.53,
    darkAccentL: 0.75,
    ratio: 1.25,
    radii: { sm: 0.25, md: 0.5, lg: 1, xl: 1.5 },
    shadowAlpha: 0.08,
    durations: { fast: 180, base: 240, slow: 360 },
    display: 'serif',
    displayWeight: 600,
  },
  cool: {
    label: '冷峻',
    neutralHue: 250,
    neutralChroma: 0.008,
    accentChromaFactor: 1,
    lightAccentL: 0.53,
    darkAccentL: 0.74,
    ratio: 1.25,
    radii: { sm: 0.25, md: 0.5, lg: 0.75, xl: 1 },
    shadowAlpha: 0.06,
    durations: { fast: 160, base: 220, slow: 320 },
    display: 'sans',
    displayWeight: 600,
  },
  editorial: {
    label: '编辑',
    neutralHue: 70,
    neutralChroma: 0.004,
    accentChromaFactor: 0.85,
    lightAccentL: 0.54,
    darkAccentL: 0.76,
    ratio: 1.333,
    radii: { sm: 0, md: 0.125, lg: 0.25, xl: 0.375 },
    shadowAlpha: 0.04,
    durations: { fast: 180, base: 240, slow: 360 },
    display: 'serif',
    displayWeight: 700,
  },
  tech: {
    label: '科技',
    neutralHue: 255,
    neutralChroma: 0.01,
    accentChromaFactor: 1.2,
    lightAccentL: 0.53,
    darkAccentL: 0.72,
    ratio: 1.25,
    radii: { sm: 0, md: 0.125, lg: 0.25, xl: 0.375 },
    shadowAlpha: 0.05,
    durations: { fast: 120, base: 180, slow: 240 },
    display: 'mono',
    displayWeight: 700,
  },
};

const EASING = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

const FONT_STACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  serif: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

const TYPE_NAMES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];

// Spacing follows references/layout.md: 10 steps on a 4px base (plus --space-0).
const SPACE_STEPS_PX = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128];

const SEMANTIC_COLORS = [
  'bg',
  'surface',
  'surface-raised',
  'text',
  'text-muted',
  'text-faint',
  'border',
  'accent',
  'accent-hover',
  'accent-contrast',
  'success',
  'warning',
  'danger',
  'focus',
];

const CONTRAST_CHECKS = [
  { fg: 'text', bg: 'bg', min: 4.5 },
  { fg: 'text', bg: 'surface', min: 4.5 },
  { fg: 'text', bg: 'surface-raised', min: 4.5 },
  { fg: 'text-muted', bg: 'bg', min: 4.5 },
  { fg: 'text-muted', bg: 'surface', min: 4.5 },
  { fg: 'text-muted', bg: 'surface-raised', min: 4.5 },
  { fg: 'text-faint', bg: 'bg', min: 4.5 },
  { fg: 'text-faint', bg: 'surface', min: 4.5 },
  { fg: 'accent', bg: 'bg', min: 4.5 },
  { fg: 'success', bg: 'bg', min: 4.5 },
  { fg: 'warning', bg: 'bg', min: 4.5 },
  { fg: 'danger', bg: 'bg', min: 4.5 },
  { fg: 'focus', bg: 'bg', min: 3.0 },
];

// ---------------------------------------------------------------------------
// Palette construction
// ---------------------------------------------------------------------------

function buildTheme(themeName, seed, moodKey) {
  const mood = MOODS[moodKey];
  const neutralHue = mood.neutralHue === 'seed' ? seed.hue : mood.neutralHue;
  const nc = mood.neutralChroma;
  const isLight = themeName === 'light';
  const accentChroma = clamp(seed.chroma * mood.accentChromaFactor, 0, MAX_CHROMA);
  const accentL = isLight ? mood.lightAccentL : mood.darkAccentL;
  const colors = {};
  const notes = [];

  const put = (name, l, c, h, requestedChroma) => {
    const color = tokenColor({ l, c, h, requestedChroma });
    colors[name] = color;
    // Only surface gamut notes for seed-driven tokens, not for fixed semantic hues.
    const seedDriven = name === 'accent' || name === 'focus';
    const requested = requestedChroma != null ? requestedChroma : c;
    if (seedDriven && color.gamutMapped && requested - color.oklch.c > 0.008) {
      notes.push({ theme: themeName, token: `--color-${name}`, from: requested, to: color.oklch.c });
    }
    return color;
  };

  if (isLight) {
    put('bg', 0.985, nc * 0.5, neutralHue);
    put('surface', 0.955, nc, neutralHue);
    put('surface-raised', 0.995, nc * 0.25, neutralHue);
    put('text', 0.2, nc * 1.6, neutralHue);
    put('text-muted', 0.38, nc * 1.4, neutralHue);
    put('text-faint', 0.46, nc * 1.2, neutralHue);
    put('border', 0.88, nc * 1.2, neutralHue);
    put('accent', accentL, accentChroma, seed.hue, accentChroma);
    put('success', 0.4, 0.11, 150, 0.11);
    put('warning', 0.38, 0.12, 70, 0.12);
    put('danger', 0.42, 0.15, 27, 0.15);
    put('focus', clamp(accentL + 0.04, 0, 1), Math.min(accentChroma * 1.1, MAX_CHROMA), seed.hue, accentChroma * 1.1);
  } else {
    put('bg', 0.16, nc * 0.8, neutralHue);
    put('surface', 0.2, nc, neutralHue);
    put('surface-raised', 0.245, nc * 1.1, neutralHue);
    put('text', 0.95, nc * 1.2, neutralHue);
    put('text-muted', 0.78, nc * 1.2, neutralHue);
    put('text-faint', 0.7, nc * 1.1, neutralHue);
    put('border', 0.32, nc * 1.2, neutralHue);
    put('accent', accentL, accentChroma * 0.9, seed.hue, accentChroma * 0.9);
    put('success', 0.74, 0.12, 150, 0.12);
    put('warning', 0.8, 0.13, 75, 0.13);
    put('danger', 0.72, 0.15, 27, 0.15);
    put('focus', clamp(accentL + 0.03, 0, 1), Math.min(accentChroma, MAX_CHROMA), seed.hue, accentChroma);
  }

  const adjustments = [];
  applyContrastChecks(themeName, colors, adjustments);
  const button = fixButtonContrast(themeName, colors, adjustments);
  const accentContrast = chooseAccentContrast(colors);
  colors['accent-contrast'] = accentContrast.color;
  const finalButtonRatio = contrastRatio(colors['accent-contrast'].rgb, colors.accent.rgb);
  // Hover color derives from the final accent lightness.
  const hoverL = isLight ? clamp(colors.accent.oklch.l - 0.07, 0, 1) : clamp(colors.accent.oklch.l + 0.05, 0, 1);
  colors['accent-hover'] = tokenColor({
    l: hoverL,
    c: colors.accent.oklch.c,
    h: colors.accent.oklch.h,
    requestedChroma: colors.accent.oklch.c,
  });

  const checks = buildCheckReport(themeName, colors, finalButtonRatio);
  return { colors, notes, adjustments, checks, button };
}

function applyContrastChecks(themeName, colors, adjustments) {
  for (const check of CONTRAST_CHECKS) {
    const fg = colors[check.fg];
    const bg = colors[check.bg];
    if (!fg || !bg) continue;
    let ratio = contrastRatio(fg.rgb, bg.rgb);
    if (ratio >= check.min) continue;
    const before = { l: fg.oklch.l, hex: fg.hex, ratio };
    const fgIsDarker = relativeLuminance(fg.rgb) < relativeLuminance(bg.rgb);
    const direction = fgIsDarker ? -1 : 1;
    let l = fg.oklch.l;
    for (let i = 0; i < 200; i++) {
      l = clamp(l + direction * 0.006, 0, 1);
      setLightness(fg, l);
      ratio = contrastRatio(fg.rgb, bg.rgb);
      if (ratio >= check.min) break;
      if ((direction < 0 && l <= 0.02) || (direction > 0 && l >= 0.995)) break;
    }
    adjustments.push({
      theme: themeName,
      token: `--color-${check.fg}`,
      against: `--color-${check.bg}`,
      min: check.min,
      before,
      after: { l: fg.oklch.l, hex: fg.hex, ratio },
    });
  }
}

function chooseAccentContrast(colors) {
  const accent = colors.accent;
  const candidates = [
    tokenColor({ l: 0.99, c: 0, h: 0 }),
    tokenColor({ l: 0.15, c: 0, h: 0 }),
  ];
  let best = candidates[0];
  let bestRatio = contrastRatio(best.rgb, accent.rgb);
  for (const candidate of candidates.slice(1)) {
    const ratio = contrastRatio(candidate.rgb, accent.rgb);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return { color: best, ratio: bestRatio };
}

function fixButtonContrast(themeName, colors, adjustments) {
  const accent = colors.accent;
  const before = { l: accent.oklch.l, hex: accent.hex };
  let picked = chooseAccentContrast(colors);
  let guard = 0;
  while (picked.ratio < 4.5 && guard < 80) {
    const usesWhite = picked.color.oklch.l > 0.5;
    const direction = usesWhite ? -1 : 1;
    setLightness(accent, clamp(accent.oklch.l + direction * 0.005, 0, 1));
    picked = chooseAccentContrast(colors);
    guard += 1;
    if ((direction < 0 && accent.oklch.l <= 0.02) || (direction > 0 && accent.oklch.l >= 0.995)) break;
  }
  if (Math.abs(accent.oklch.l - before.l) > 1e-6) {
    adjustments.push({
      theme: themeName,
      token: '--color-accent',
      against: '--color-accent-contrast',
      min: 4.5,
      special: 'button',
      before,
      after: { l: accent.oklch.l, hex: accent.hex, ratio: picked.ratio },
    });
  }
  return picked;
}

function buildCheckReport(themeName, colors, buttonRatio) {
  const checks = [];
  for (const check of CONTRAST_CHECKS) {
    const fg = colors[check.fg];
    const bg = colors[check.bg];
    const ratio = contrastRatio(fg.rgb, bg.rgb);
    checks.push({
      theme: themeName,
      foreground: `--color-${check.fg}`,
      background: `--color-${check.bg}`,
      foregroundHex: fg.hex,
      backgroundHex: bg.hex,
      ratio: Number(ratio.toFixed(2)),
      min: check.min,
      pass: ratio >= check.min,
    });
  }
  checks.push({
    theme: themeName,
    foreground: '--color-accent-contrast',
    background: '--color-accent',
    foregroundHex: colors['accent-contrast'].hex,
    backgroundHex: colors.accent.hex,
    ratio: Number(buttonRatio.toFixed(2)),
    min: 4.5,
    pass: buttonRatio >= 4.5,
  });
  return checks;
}

// ---------------------------------------------------------------------------
// Type / spacing / radius / shadow / motion model
// ---------------------------------------------------------------------------

function buildTypeScale(ratio) {
  const scale = {};
  for (let i = 0; i < TYPE_NAMES.length; i++) {
    let min;
    let max;
    if (i === 0) {
      // The smallest step is pinned to 12–13px: CJK text below 12px is unreadable.
      min = 0.75;
      max = 0.8125;
    } else {
      const t = Math.pow(ratio, i - 2);
      const grow = 0.04 + 0.035 * i;
      min = t;
      max = t * (1 + grow);
    }
    const d = max - min;
    const preferredRem = min - 0.2857 * d;
    const preferredVw = 1.4286 * d;
    const value = `clamp(${formatNumber(min, 4)}rem, calc(${formatNumber(preferredRem, 4)}rem + ${formatNumber(preferredVw, 4)}vw), ${formatNumber(max, 4)}rem)`;
    scale[`--text-${TYPE_NAMES[i]}`] = {
      value,
      px: Number((TYPE_BASE_PX * min).toFixed(2)),
    };
  }
  return scale;
}

function buildSpacing() {
  return SPACE_STEPS_PX.map((px, index) => ({
    name: `--space-${index}`,
    px,
    rem: px === 0 ? '0' : `${formatNumber(px / 16, 4)}rem`,
  }));
}

function shadowTokens(themeName, alpha) {
  const factor = themeName === 'dark' ? 2.4 : 1;
  const a = (value) => Number((alpha * factor * value).toFixed(3));
  return {
    '--shadow-xs': `0 1px 2px rgb(0 0 0 / ${a(0.6)})`,
    '--shadow-sm': `0 1px 2px rgb(0 0 0 / ${a(0.5)}), 0 1px 3px rgb(0 0 0 / ${a(1)})`,
    '--shadow-md': `0 2px 4px rgb(0 0 0 / ${a(0.5)}), 0 8px 24px rgb(0 0 0 / ${a(1)})`,
    '--shadow-lg': `0 4px 8px rgb(0 0 0 / ${a(0.55)}), 0 16px 48px rgb(0 0 0 / ${a(1.4)})`,
  };
}

function buildModel(opts, seed) {
  const mood = MOODS[opts.mood];
  const themes = opts.mode === 'both' ? ['light', 'dark'] : [opts.mode];
  const built = {};
  for (const theme of themes) built[theme] = buildTheme(theme, seed, opts.mood);

  const typography = {
    base: `${TYPE_BASE_PX}px`,
    ratio: mood.ratio,
    fluid: `${FLUID_MIN_PX}px–${FLUID_MAX_PX}px`,
    scale: buildTypeScale(mood.ratio),
    leading: {
      '--leading-tight': '1.15',
      '--leading-snug': '1.35',
      '--leading-normal': '1.6',
      '--leading-relaxed': '1.75',
    },
    tracking: {
      '--tracking-tight': '-0.01em',
      '--tracking-normal': '0',
      '--tracking-wide': '0.02em',
    },
  };

  const space = buildSpacing();
  const radius = {
    '--radius-sm': `${formatNumber(mood.radii.sm, 4)}rem`,
    '--radius-md': `${formatNumber(mood.radii.md, 4)}rem`,
    '--radius-lg': `${formatNumber(mood.radii.lg, 4)}rem`,
    '--radius-xl': `${formatNumber(mood.radii.xl, 4)}rem`,
    '--radius-full': '9999px',
  };

  const fonts = {
    '--font-sans': FONT_STACKS.sans,
    '--font-serif': FONT_STACKS.serif,
    '--font-mono': FONT_STACKS.mono,
    '--font-display': FONT_STACKS[mood.display],
    '--font-weight-normal': '400',
    '--font-weight-medium': '500',
    '--font-weight-semibold': '600',
    '--font-weight-bold': '700',
    '--font-weight-display': String(mood.displayWeight),
  };

  const motion = {
    '--duration-fast': `${mood.durations.fast}ms`,
    '--duration-base': `${mood.durations.base}ms`,
    '--duration-slow': `${mood.durations.slow}ms`,
    '--ease-standard': EASING.standard,
    '--ease-out': EASING.out,
    '--ease-in-out': EASING.inOut,
  };

  const layout = {
    '--measure': '38em',
    '--container-narrow': '46rem',
    '--container': '68rem',
    '--container-wide': '80rem',
    '--focus-ring-width': '2px',
    '--focus-ring-offset': '2px',
    '--border-width': '1px',
  };

  const adjustments = [];
  const notes = [];
  const checks = [];
  for (const theme of themes) {
    adjustments.push(...built[theme].adjustments);
    notes.push(...built[theme].notes);
    checks.push(...built[theme].checks);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    generatedAt: new Date().toISOString(),
    name: opts.name,
    seed: {
      source: seed.source,
      hue: Number(seed.hue.toFixed(1)),
      chroma: Number(seed.chroma.toFixed(4)),
      chromaRequested: seed.chromaRequested != null ? Number(seed.chromaRequested.toFixed(4)) : null,
      hex: seed.hex || null,
      mood: opts.mood,
      moodLabel: mood.label,
      mode: opts.mode,
    },
    themes,
    fonts,
    typography,
    space: { base: '4px', steps: SPACE_STEPS_PX.length, scale: space },
    radius,
    shadow: {
      alpha: mood.shadowAlpha,
      values: Object.fromEntries(themes.map((theme) => [theme, shadowTokens(theme, mood.shadowAlpha)])),
    },
    motion,
    layout,
    colors: Object.fromEntries(themes.map((theme) => [theme, built[theme].colors])),
    contrast: {
      thresholds: { normalText: 4.5, largeText: 3.0, nonText: 3.0 },
      checks,
      adjustments,
      summary: {
        checks: checks.length,
        passed: checks.filter((check) => check.pass).length,
        adjusted: adjustments.length,
        failed: checks.filter((check) => !check.pass).length,
      },
    },
    gamut: { notes },
  };
}

// ---------------------------------------------------------------------------
// CSS output
// ---------------------------------------------------------------------------

function cssColorLines(colors, indent = '  ') {
  return SEMANTIC_COLORS.map((name) => `${indent}--color-${name}: ${colors[name].hex};`);
}

function cssShadowLines(shadows, indent = '  ') {
  return Object.entries(shadows).map(([name, value]) => `${indent}${name}: ${value};`);
}

function cssDeclLines(map, indent = '  ') {
  return Object.entries(map).map(([name, value]) => `${indent}${name}: ${value};`);
}

function buildCss(model) {
  const lines = [];
  const mode = model.seed.mode;
  const hasLight = model.themes.includes('light');
  const hasDark = model.themes.includes('dark');
  const summary = model.contrast.summary;
  lines.push('/* ==========================================================================');
  lines.push(`   design tokens · ${model.name}`);
  lines.push(`   seed: hue ${model.seed.hue} / chroma ${model.seed.chroma} / mood ${model.seed.moodLabel} / mode ${mode}`);
  lines.push(`   generated: ${model.generatedAt} by ${GENERATOR} (zero dependency)`);
  lines.push(`   contrast: ${summary.passed}/${summary.checks} pairs pass WCAG AA` + (summary.adjusted ? `, ${summary.adjusted} token(s) auto-adjusted` : ''));
  lines.push('   ========================================================================== */');
  lines.push('');
  lines.push(':root {');
  lines.push(`  color-scheme: ${hasLight ? 'light' : 'dark'};`);
  lines.push('');
  lines.push('  /* Font families: Latin + CJK fallbacks live in one stack */');
  lines.push(...cssDeclLines(model.fonts));
  lines.push('');
  lines.push(`  /* Fluid type scale (${model.typography.base} base, ratio ${model.typography.ratio}, ${model.typography.fluid}) */`);
  lines.push(...Object.entries(model.typography.scale).map(([name, token]) => `  ${name}: ${token.value};`));
  lines.push(...cssDeclLines(model.typography.leading));
  lines.push(...cssDeclLines(model.typography.tracking));
  lines.push('');
  lines.push('  /* Spacing: 4px base, 10 steps (matches references/layout.md) */');
  lines.push(...model.space.scale.map((step) => `  ${step.name}: ${step.rem};`));
  lines.push('');
  lines.push('  /* Radius */');
  lines.push(...cssDeclLines(model.radius));
  lines.push('');
  lines.push('  /* Motion */');
  lines.push(...cssDeclLines(model.motion));
  lines.push('');
  lines.push('  /* Layout helpers */');
  lines.push(...cssDeclLines(model.layout));
  lines.push('');
  const rootTheme = hasLight ? 'light' : 'dark';
  lines.push(`  /* Color · ${rootTheme} */`);
  lines.push(...cssColorLines(model.colors[rootTheme]));
  lines.push(...cssShadowLines(model.shadow.values[rootTheme]));
  lines.push('}');

  if (hasDark) {
    const darkIndent = '    ';
    lines.push('');
    if (hasLight) {
      lines.push('/* Dark mode: follow the operating system, but let [data-theme="light"] opt out. */');
      lines.push('@media (prefers-color-scheme: dark) {');
      lines.push('  :root:not([data-theme="light"]) {');
      lines.push('    color-scheme: dark;');
      lines.push(...cssColorLines(model.colors.dark, darkIndent));
      lines.push(...cssShadowLines(model.shadow.values.dark, darkIndent));
      lines.push('  }');
      lines.push('}');
    }
    lines.push('');
    lines.push('/* Explicit dark theme (overrides the media query). */');
    lines.push('[data-theme="dark"] {');
    lines.push('  color-scheme: dark;');
    lines.push(...cssColorLines(model.colors.dark));
    lines.push(...cssShadowLines(model.shadow.values.dark));
    lines.push('}');
    if (hasLight) {
      lines.push('');
      lines.push('/* Explicit light theme (useful when the OS is dark). */');
      lines.push('[data-theme="light"] {');
      lines.push('  color-scheme: light;');
      lines.push(...cssColorLines(model.colors.light));
      lines.push(...cssShadowLines(model.shadow.values.light));
      lines.push('}');
    }
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

function serializeColor(color) {
  return {
    hex: color.hex,
    oklch: oklchString(color),
    rgb: color.rgb.map((c) => Math.round(c)),
  };
}

function buildJson(model) {
  const colors = {};
  for (const theme of model.themes) {
    colors[theme] = Object.fromEntries(SEMANTIC_COLORS.map((name) => [name, serializeColor(model.colors[theme][name])]));
  }
  return {
    version: SCHEMA_VERSION,
    generator: model.generator,
    generatedAt: model.generatedAt,
    name: model.name,
    seed: model.seed,
    themes: model.themes,
    fonts: model.fonts,
    typography: {
      base: model.typography.base,
      ratio: model.typography.ratio,
      fluid: model.typography.fluid,
      scale: model.typography.scale,
      leading: model.typography.leading,
      tracking: model.typography.tracking,
    },
    space: model.space,
    radius: model.radius,
    shadow: {
      alpha: model.shadow.alpha,
      values: Object.fromEntries(model.themes.map((theme) => [theme, model.shadow.values[theme]])),
    },
    motion: model.motion,
    layout: model.layout,
    colors,
    contrast: {
      thresholds: model.contrast.thresholds,
      summary: model.contrast.summary,
      checks: model.contrast.checks,
      adjustments: model.contrast.adjustments.map((adjustment) => ({
        theme: adjustment.theme,
        token: adjustment.token,
        against: adjustment.against,
        min: adjustment.min,
        before: {
          l: Number(adjustment.before.l.toFixed(4)),
          hex: adjustment.before.hex,
          ratio: Number(adjustment.before.ratio.toFixed(2)),
        },
        after: {
          l: Number(adjustment.after.l.toFixed(4)),
          hex: adjustment.after.hex,
          ratio: Number(adjustment.after.ratio.toFixed(2)),
        },
      })),
    },
    gamut: model.gamut,
  };
}

// ---------------------------------------------------------------------------
// Preview page
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPreview(model, cssText) {
  const rootTheme = model.themes.includes('light') ? 'light' : 'dark';
  const summary = model.contrast.summary;
  const parts = [];
  parts.push('<!doctype html>');
  parts.push(`<html lang="zh-CN" data-theme="${rootTheme}">`);
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push(`<title>${escapeHtml(model.name)} · design tokens 预览</title>`);
  parts.push('<style>');
  parts.push(cssText);
  parts.push(PREVIEW_CSS);
  parts.push('</style>');
  parts.push('</head>');
  parts.push('<body>');
  parts.push('<main class="sheet">');
  parts.push('<header class="preview-header">');
  parts.push('<p class="preview-label">design tokens · 可离线打开的预览页</p>');
  parts.push(`<h1>${escapeHtml(model.name)}</h1>`);
  parts.push(`<p class="meta">种子 hue ${model.seed.hue} · chroma ${model.seed.chroma} · ${escapeHtml(model.seed.moodLabel)} · ${model.seed.mode} · ${escapeHtml(model.generatedAt)}</p>`);
  parts.push('<div class="meta-chips">');
  parts.push(`<span class="chip">语义色 ${SEMANTIC_COLORS.length}</span>`);
  parts.push(`<span class="chip">字号 ${TYPE_NAMES.length} 档</span>`);
  parts.push(`<span class="chip">间距 ${SPACE_STEPS_PX.length} 档（含 --space-0）</span>`);
  parts.push(`<span class="chip">对比度 ${summary.passed}/${summary.checks} 通过</span>`);
  parts.push(`<span class="chip">自动修正 ${summary.adjusted} 处</span>`);
  parts.push('</div>');
  parts.push('</header>');

  for (const theme of model.themes) {
    const themeLabel = theme === 'light' ? '浅色' : '深色';
    parts.push(`<section class="theme-block" data-theme="${theme}">`);
    parts.push(`<h2>${themeLabel}主题 · 语义色</h2>`);
    parts.push('<div class="swatches">');
    for (const name of SEMANTIC_COLORS) {
      const color = model.colors[theme][name];
      parts.push(`<div class="swatch">
  <span class="swatch-chip" style="background: var(--color-${name});"></span>
  <span class="swatch-name">--color-${name}</span>
  <span class="swatch-hex">${color.hex} · ${escapeHtml(oklchString(color))}</span>
</div>`);
    }
    parts.push('</div>');

    if (theme === 'light') {
      parts.push(`<h2>应用示例</h2>
<div class="demo">
  <div class="demo-panel">
    <p class="demo-label">--color-surface 上的 --color-text-muted</p>
    <h3>把界面做成一个世界</h3>
    <p>正文使用 --color-text 与 --color-bg，辅文使用 --color-text-muted。焦点用 --color-focus 描边。</p>
    <p><button class="demo-btn" type="button">主按钮</button> <a href="#tokens">强调文字链接</a></p>
  </div>
</div>`);
    }
    parts.push('</section>');
  }

  parts.push(`<section class="theme-block" data-theme="${rootTheme}">`);
  parts.push('<h2>字阶 · clamp() 流式缩放</h2>');
  parts.push('<div class="type-list">');
  for (const name of TYPE_NAMES) {
    const token = model.typography.scale[`--text-${name}`];
    parts.push(`<div class="type-row">
  <code>--text-${name}</code>
  <span class="type-sample" style="font-size: var(--text-${name}); font-family: var(--font-display);">汉字排版 Handgloves 0123</span>
  <em>${token.px}px · ${escapeHtml(token.value)}</em>
</div>`);
  }
  parts.push('</div>');

  parts.push('<h2>间距 · 4px 基准</h2>');
  parts.push('<div class="space-list">');
  for (const step of model.space.scale) {
    parts.push(`<div class="space-row">
  <code>${step.name}</code>
  <span class="space-bar" style="width: ${step.px}px;"></span>
  <em>${step.px}px · ${step.rem}</em>
</div>`);
  }
  parts.push('</div>');

  parts.push('<h2>圆角 · 阴影 · 动效</h2>');
  parts.push('<div class="radius-row">');
  for (const [name, value] of Object.entries(model.radius)) {
    if (name === '--radius-full') continue;
    parts.push(`<div class="radius-tile" style="border-radius: var(${name});"><code>${name}</code><em>${escapeHtml(value)}</em></div>`);
  }
  parts.push('</div>');
  parts.push('<div class="shadow-row">');
  for (const [name] of Object.entries(model.shadow.values[rootTheme])) {
    parts.push(`<div class="shadow-tile" style="box-shadow: var(${name});"><code>${name}</code></div>`);
  }
  parts.push('</div>');
  parts.push(`<p class="meta">动效：${escapeHtml(Object.entries(model.motion).map(([key, value]) => `${key}: ${value}`).join(' · '))}</p>`);

  parts.push('<h2>对比度自检</h2>');
  parts.push('<table class="contrast-table"><thead><tr><th>主题</th><th>前景</th><th>背景</th><th>对比度</th><th>门槛</th><th>结果</th></tr></thead><tbody>');
  for (const check of model.contrast.checks) {
    const adjusted = model.contrast.adjustments.some((adjustment) =>
      adjustment.theme === check.theme &&
      (adjustment.token === check.foreground || adjustment.token === check.background));
    parts.push(`<tr class="${check.pass ? 'pass' : 'fail'}">
  <td>${check.theme === 'light' ? '浅色' : '深色'}</td>
  <td>${escapeHtml(check.foreground)} <span class="dot" style="background:${check.foregroundHex};"></span></td>
  <td>${escapeHtml(check.background)} <span class="dot" style="background:${check.backgroundHex};"></span></td>
  <td>${check.ratio}:1</td>
  <td>${check.min}:1</td>
  <td>${check.pass ? '通过' : '未通过'}${adjusted ? ' · 已修正' : ''}</td>
</tr>`);
  }
  parts.push('</tbody></table>');

  if (model.contrast.adjustments.length) {
    parts.push('<h3>自动修正记录</h3><ul class="adjust-list">');
    for (const adjustment of model.contrast.adjustments) {
      parts.push(`<li>${escapeHtml(adjustment.theme === 'light' ? '浅色' : '深色')} · ${escapeHtml(adjustment.token)} 对 ${escapeHtml(adjustment.against)}：L ${adjustment.before.l.toFixed(3)} → ${adjustment.after.l.toFixed(3)}，对比度 ${adjustment.before.ratio.toFixed(2)}:1 → ${adjustment.after.ratio.toFixed(2)}:1（要求 ${adjustment.min}:1）</li>`);
    }
    parts.push('</ul>');
  }

  parts.push('<h2 id="tokens">怎么用</h2>');
  parts.push(`<pre class="snippet">&lt;link rel="stylesheet" href="tokens.css"&gt;

&lt;html lang="zh-CN"&gt;            &lt;!-- 跟随系统深色 --&gt;
&lt;html lang="zh-CN" data-theme="dark"&gt;   &lt;!-- 强制深色 --&gt;

&lt;button class="btn"&gt;确认&lt;/button&gt;

.btn {
  min-height: 44px;
  padding: 12px 20px;
  color: var(--color-accent-contrast);
  background: var(--color-accent);
  border-radius: var(--radius-md);
  transition: background-color var(--duration-fast) var(--ease-standard);
}
.btn:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}</pre>`);
  parts.push('<p class="meta">本页不加载任何外部资源，可直接双击离线打开。变量定义与 tokens.css 完全一致。</p>');
  parts.push('</section>');
  parts.push('</main>');
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n');
}

// Preview-only layout styles (colors all come from the generated tokens).
const PREVIEW_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--font-sans);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    color: var(--color-text);
    background: var(--color-bg);
  }
  .sheet { max-width: 76rem; margin: 0 auto; padding: var(--space-9) var(--space-6) var(--space-10); }
  .preview-header { padding-bottom: var(--space-6); border-bottom: var(--border-width) solid var(--color-border); }
  .preview-label { margin: 0 0 var(--space-2); font-size: var(--text-sm); letter-spacing: var(--tracking-wide); color: var(--color-text-muted); }
  h1 { margin: 0 0 var(--space-3); font-family: var(--font-display); font-size: var(--text-4xl); line-height: var(--leading-tight); letter-spacing: var(--tracking-tight); }
  h2 { margin: var(--space-9) 0 var(--space-4); font-family: var(--font-display); font-size: var(--text-2xl); line-height: var(--leading-snug); }
  h3 { margin: var(--space-4) 0 var(--space-2); font-size: var(--text-lg); }
  .meta { margin: var(--space-2) 0 0; color: var(--color-text-muted); font-size: var(--text-sm); }
  .meta-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
  .chip { padding: var(--space-1) var(--space-3); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-full); font-size: var(--text-xs); color: var(--color-text-muted); }
  .theme-block { padding: var(--space-4) var(--space-5); margin-top: var(--space-6); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg); color: var(--color-text); }
  .theme-block h2:first-child { margin-top: var(--space-2); }
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: var(--space-3); }
  .swatch { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); }
  .swatch-chip { height: 4.5rem; border-radius: var(--radius-sm); }
  .swatch-name { font-family: var(--font-mono); font-size: var(--text-xs); font-weight: var(--font-weight-semibold); color: var(--color-text); }
  .swatch-hex { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-muted); word-break: break-word; }
  .demo { margin-top: var(--space-4); }
  .demo-panel { max-width: 34rem; padding: var(--space-6); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-sm); }
  .demo-label { margin: 0 0 var(--space-2); font-size: var(--text-xs); color: var(--color-text-muted); }
  .demo-panel h3 { margin-top: 0; }
  .demo-panel p { color: var(--color-text-muted); }
  .demo-btn { min-height: 44px; padding: 12px 20px; border: 0; border-radius: var(--radius-md); font: inherit; font-weight: var(--font-weight-semibold); color: var(--color-accent-contrast); background: var(--color-accent); cursor: pointer; transition: background-color var(--duration-fast) var(--ease-standard); }
  .demo-btn:focus-visible { outline: var(--focus-ring-width) solid var(--color-focus); outline-offset: var(--focus-ring-offset); }
  .theme-block a { color: var(--color-accent); }
  .type-list, .space-list { display: flex; flex-direction: column; gap: var(--space-2); }
  .type-row { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: var(--space-3); align-items: baseline; padding: var(--space-2) 0; border-bottom: var(--border-width) solid var(--color-border); }
  .type-row code, .space-row code, .radius-tile code, .shadow-tile code { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-muted); }
  .type-row em, .space-row em { grid-column: 2; font-style: normal; font-size: var(--text-xs); color: var(--color-text-muted); }
  .type-sample { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .space-row { display: grid; grid-template-columns: 7rem minmax(0, 1fr) 9rem; gap: var(--space-3); align-items: center; }
  .space-bar { height: 0.75rem; max-width: 100%; border-radius: var(--radius-sm); background: var(--color-accent); }
  .radius-row, .shadow-row { display: flex; flex-wrap: wrap; gap: var(--space-4); }
  .radius-tile { display: flex; flex-direction: column; justify-content: space-between; width: 9rem; height: 6rem; padding: var(--space-3); border: var(--border-width) solid var(--color-border); background: var(--color-surface); }
  .shadow-tile { display: flex; align-items: flex-end; width: 9rem; height: 6rem; padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-raised); }
  .contrast-table { width: 100%; border-collapse: collapse; margin-top: var(--space-3); font-size: var(--text-sm); }
  .contrast-table th, .contrast-table td { padding: var(--space-2) var(--space-3); border-bottom: var(--border-width) solid var(--color-border); text-align: left; }
  .contrast-table th { font-size: var(--text-xs); letter-spacing: var(--tracking-wide); color: var(--color-text-muted); }
  .contrast-table tr.fail td { color: var(--color-danger); }
  .dot { display: inline-block; width: 0.75rem; height: 0.75rem; margin-left: var(--space-1); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-full); vertical-align: middle; }
  .adjust-list { padding-left: 1.25rem; color: var(--color-text-muted); font-size: var(--text-sm); }
  .snippet { overflow: auto; padding: var(--space-4); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); font-family: var(--font-mono); font-size: var(--text-sm); line-height: var(--leading-normal); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
`;

// ---------------------------------------------------------------------------
// Seed resolution + main
// ---------------------------------------------------------------------------

function resolveSeed(opts) {
  if (opts.from) {
    const oklch = hexToOklch(opts.from);
    let chroma = oklch.c;
    if (chroma > MAX_CHROMA) chroma = MAX_CHROMA;
    return {
      source: 'hex',
      hex: opts.from.toLowerCase(),
      hue: oklch.h,
      chroma,
      chromaRequested: oklch.c,
    };
  }
  const hue = Number(opts.hue);
  const chroma = opts.chroma != null ? Number(opts.chroma) : DEFAULT_CHROMA;
  return { source: 'hue', hue, chroma, chromaRequested: null, hex: null };
}

function ensureDirectory(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
}

function writeOutputs(model, outDir) {
  const cssText = buildCss(model);
  const json = buildJson(model);
  const preview = buildPreview(model, cssText);
  ensureDirectory(outDir);
  const cssPath = path.join(outDir, 'tokens.css');
  const jsonPath = path.join(outDir, 'tokens.json');
  const previewPath = path.join(outDir, 'tokens-preview.html');
  // 不静默丢旧产物：覆盖前先留 .bak，便于回退。
  for (const target of [cssPath, jsonPath, previewPath]) {
    if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  }
  fs.writeFileSync(cssPath, cssText, 'utf8');
  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  fs.writeFileSync(previewPath, preview, 'utf8');
  return { cssPath, jsonPath, previewPath };
}

function reportAdjustments(model) {
  const lines = [];
  for (const note of model.gamut.notes) {
    lines.push(`[色域] ${note.theme === 'light' ? '浅色' : '深色'}主题 ${note.token} 超出 sRGB：色度 ${note.from.toFixed(4)} → ${note.to.toFixed(4)}（明度与色相保持不变）。`);
  }
  for (const adjustment of model.contrast.adjustments) {
    const themeLabel = adjustment.theme === 'light' ? '浅色' : '深色';
    if (adjustment.special === 'button') {
      lines.push(`[对比度] ${themeLabel}主题 ${adjustment.token} 明度微调：L ${adjustment.before.l.toFixed(3)} → ${adjustment.after.l.toFixed(3)}（${adjustment.after.hex}），使按钮文字 ${adjustment.against} 达到 ${formatRatio(adjustment.after.ratio)}:1（AA 要求 ${adjustment.min}:1）。`);
    } else {
      lines.push(`[对比度] ${themeLabel}主题 ${adjustment.token} 对 ${adjustment.against} 只有 ${formatRatio(adjustment.before.ratio)}:1（AA 要求 ${adjustment.min}:1），已调整 L ${adjustment.before.l.toFixed(3)} → ${adjustment.after.l.toFixed(3)}（${adjustment.before.hex} → ${adjustment.after.hex}），现在 ${formatRatio(adjustment.after.ratio)}:1。`);
    }
  }
  if (!model.contrast.adjustments.length) {
    const byTheme = {};
    for (const check of model.contrast.checks) {
      byTheme[check.theme] = (byTheme[check.theme] || 0) + 1;
    }
    const detail = Object.entries(byTheme).map(([theme, count]) => `${theme === 'light' ? '浅色' : '深色'} ${count} 组`).join('、');
    lines.push(`[对比度] 自检通过：${detail}全部达到 AA（正文 4.5:1、非文字 3:1）。`);
  }
  return lines;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const seed = resolveSeed(opts);
  const model = buildModel(opts, seed);
  const outDir = path.resolve(process.cwd(), opts.out);
  writeOutputs(model, outDir);
  const displayOut = path.relative(process.cwd(), outDir) || '.';

  for (const line of reportAdjustments(model)) process.stderr.write(`${line}\n`);

  const summary = model.contrast.summary;
  const out = [];
  out.push(`✔ 已生成 design tokens · ${model.name}`);
  out.push(`  ${path.join(displayOut, 'tokens.css')}`);
  out.push(`  ${path.join(displayOut, 'tokens.json')}`);
  out.push(`  ${path.join(displayOut, 'tokens-preview.html')}`);
  out.push('');
  out.push(`  种子：${seed.source === 'hex' ? `#hex ${seed.hex} → ` : ''}hue ${formatNumber(seed.hue, 1)} · chroma ${formatNumber(seed.chroma, 4)} · mood ${model.seed.moodLabel}（${model.seed.mood}）· mode ${model.seed.mode}`);
  out.push(`  语义色 ${SEMANTIC_COLORS.length} 个 · 字号 ${TYPE_NAMES.length} 档 · 间距 ${SPACE_STEPS_PX.length} 档（4px 基准，含 --space-0）`);
  out.push(`  对比度自检：${summary.passed}/${summary.checks} 组通过${summary.adjusted ? `，自动修正 ${summary.adjusted} 处（见 stderr）` : '，无需调整'}`);
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliError) {
    process.stderr.write(`[design-tokens] 错误：${err.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`[design-tokens] 内部错误：${err && err.stack ? err.stack : String(err)}\n`);
    process.exitCode = 2;
  }
}
