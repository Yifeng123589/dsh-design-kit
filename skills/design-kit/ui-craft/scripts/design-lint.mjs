#!/usr/bin/env node
/**
 * design-lint.mjs
 * Zero-dependency static design audit for the ui-craft skill.
 * Node >= 18, ESM, no external packages, works on Windows / macOS / Linux.
 *
 * Scans .html .htm .css .jsx .tsx .vue .svelte for:
 *   - "AI sameness" tells (gradient text, glass cards, uniform card grids, ...)
 *   - typography problems (flat type scale, tiny body text, tight tracking, ...)
 *   - color problems (WCAG contrast, hardcoded colors, invisible focus, ...)
 *   - accessibility / structure problems (img alt, heading order, labels, ...)
 *   - Chinese typography problems (justify, break-all, punctuation, font stack)
 *
 * Source comments are English. All CLI output is Chinese.
 * Exit codes: 0 = no error findings, 1 = at least one error finding, 2 = bad arguments.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 1500000;
const MAX_FINDINGS_PER_RULE = { error: 30, warn: 15, info: 10 };

const SEV_RANK = { error: 3, warn: 2, info: 1 };
const SEV_LABEL = { error: '错误', warn: '警告', info: '提示' };
const SUPPORTED_EXTS = new Set(['.html', '.htm', '.css', '.jsx', '.tsx', '.vue', '.svelte']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.nuxt', '.output']);

/** Rule registry: stable ids, default severity, category. */
const RULES = {
  // AI sameness
  'gradient-text': { severity: 'warn', category: 'ai' },
  'glass-decoration': { severity: 'warn', category: 'ai' },
  'accent-border-bar': { severity: 'info', category: 'ai' },
  'hard-offset-shadow': { severity: 'warn', category: 'ai' },
  'kicker-eyebrow': { severity: 'warn', category: 'ai' },
  'nested-card': { severity: 'info', category: 'ai' },
  'emoji-icon': { severity: 'warn', category: 'ai' },
  'transition-all': { severity: 'warn', category: 'ai' },
  'card-grid-uniform': { severity: 'info', category: 'ai' },
  // Typography
  'type-scale-flat': { severity: 'warn', category: 'typography' },
  'font-family-overload': { severity: 'warn', category: 'typography' },
  'body-line-height': { severity: 'warn', category: 'typography' },
  'tracking-tight': { severity: 'warn', category: 'typography' },
  'body-too-small': { severity: 'warn', category: 'typography' },
  // Color
  'contrast-fail': { severity: 'error', category: 'color' },
  'hardcoded-color': { severity: 'info', category: 'color' },
  'dark-mode-missing': { severity: 'info', category: 'color' },
  'focus-invisible': { severity: 'warn', category: 'color' },
  'focus-removed': { severity: 'error', category: 'color' },
  // A11y / structure
  'img-alt': { severity: 'error', category: 'a11y' },
  'heading-order': { severity: 'warn', category: 'a11y' },
  'form-label': { severity: 'warn', category: 'a11y' },
  'html-lang': { severity: 'error', category: 'a11y' },
  'reduced-motion': { severity: 'warn', category: 'a11y' },
  'touch-target': { severity: 'warn', category: 'a11y' },
  // CJK typography
  'cjk-justify': { severity: 'warn', category: 'cjk' },
  'cjk-break-all': { severity: 'warn', category: 'cjk' },
  'cjk-mixed-spacing': { severity: 'info', category: 'cjk' },
  'cjk-double-punct': { severity: 'warn', category: 'cjk' },
  'cjk-font-stack': { severity: 'warn', category: 'cjk' },
};

const USAGE = `用法:
  node scripts/design-lint.mjs <文件或目录> [更多路径...] [--json] [--min-severity info|warn|error] [--quiet]

参数:
  <文件或目录>            支持 .html .htm .css .jsx .tsx .vue .svelte；目录会递归扫描
  --json                  输出稳定 JSON（version / scanned / findings / counts / score）
  --min-severity <级别>   只输出不低于该级别的问题（info|warn|error，默认 info）
  --quiet                 只输出计数行
  -h, --help              显示本帮助

退出码: 0 = 没有 error；1 = 存在 error；2 = 参数错误。`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

class CliError extends Error {}

function parseArgs(argv) {
  const opts = { json: false, quiet: false, minSeverity: 'info', help: false, targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--min-severity') {
      const value = argv[++i];
      if (!value) throw new CliError('--min-severity 缺少取值（info|warn|error）');
      if (!Object.prototype.hasOwnProperty.call(SEV_RANK, value)) {
        throw new CliError(`--min-severity 取值无效：${value}（可选 info|warn|error）`);
      }
      opts.minSeverity = value;
    } else if (arg.startsWith('--min-severity=')) {
      const value = arg.slice('--min-severity='.length);
      if (!Object.prototype.hasOwnProperty.call(SEV_RANK, value)) {
        throw new CliError(`--min-severity 取值无效：${value}（可选 info|warn|error）`);
      }
      opts.minSeverity = value;
    } else if (arg.startsWith('-')) {
      throw new CliError(`未知参数：${arg}`);
    } else {
      opts.targets.push(arg);
    }
  }
  if (!opts.help && opts.targets.length === 0) {
    throw new CliError('缺少要扫描的文件或目录');
  }
  return opts;
}

function displayPath(absPath) {
  const rel = path.relative(process.cwd(), absPath);
  const value = rel === '' ? path.basename(absPath) : rel;
  return value.split(path.sep).join('/');
}

function walkDir(absDir, out, notes) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (err) {
    notes.push(`[design-lint] 跳过无法读取的目录 ${displayPath(absDir)}：${err.message}`);
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkDir(abs, out, notes);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) continue;
      if (entry.name.includes('.min.')) {
        notes.push(`[design-lint] 跳过压缩产物 ${displayPath(abs)}`);
        continue;
      }
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { continue; }
      if (size > MAX_FILE_BYTES) {
        notes.push(`[design-lint] 跳过超过 ${(MAX_FILE_BYTES / 1000000).toFixed(1)}MB 的大文件 ${displayPath(abs)}`);
        continue;
      }
      out.push(abs);
    }
  }
}

function collectTargets(targets) {
  const files = [];
  const notes = [];
  const seen = new Set();
  const addFile = (abs) => {
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seen.has(key)) return;
    seen.add(key);
    files.push({ abs, rel: displayPath(abs) });
  };
  for (const target of targets) {
    const abs = path.resolve(process.cwd(), target);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      throw new CliError(`路径不存在：${target}`);
    }
    if (st.isDirectory()) {
      const found = [];
      walkDir(abs, found, notes);
      if (found.length === 0) {
        notes.push(`[design-lint] 目录中没有可扫描文件：${target}（支持 ${[...SUPPORTED_EXTS].join(' ')}）`);
      }
      for (const f of found) addFile(f);
    } else if (st.isFile()) {
      const ext = path.extname(abs).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) {
        throw new CliError(`不支持的文件类型：${target}（支持 ${[...SUPPORTED_EXTS].join(' ')}）`);
      }
      addFile(abs);
    } else {
      throw new CliError(`路径不是普通文件或目录：${target}`);
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, notes };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Build an index -> {line, column} mapper (1-based). */
function makePositions(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (index) => {
    const idx = Math.max(0, Math.min(index, text.length));
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: idx - starts[lo] + 1 };
  };
}

/** Blank out [start, end) ranges while preserving newlines (keeps all indices stable). */
function blankRanges(text, ranges) {
  if (!ranges.length) return text;
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (end <= cursor) continue;
    const s = Math.max(start, cursor);
    out += text.slice(cursor, s);
    out += text.slice(s, end).replace(/[^\n]/g, ' ');
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
}

function maskCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function maskHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function blankBlocks(text, tagName) {
  const ranges = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi');
  let m;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  return { text: blankRanges(text, ranges), ranges };
}

/** Parse CSS length values to px. Returns null for clamp()/calc()/var()/%. */
function lengthToPx(value, base = 16) {
  const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(String(value == null ? '' : value).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'px' ? n : n * base;
}

function splitSelectorParts(selector) {
  return String(selector || '').split(',');
}

// ---------------------------------------------------------------------------
// Color math (hex / rgb / hsl / oklch -> sRGB, WCAG contrast)
// ---------------------------------------------------------------------------

const NAMED_COLORS = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], lime: [0, 255, 0],
  blue: [0, 0, 255], yellow: [255, 255, 0], aqua: [0, 255, 255], cyan: [0, 255, 255],
  fuchsia: [255, 0, 255], magenta: [255, 0, 255], silver: [192, 192, 192], gray: [128, 128, 128],
  grey: [128, 128, 128], maroon: [128, 0, 0], olive: [128, 128, 0], green: [0, 128, 0],
  purple: [128, 0, 128], teal: [0, 128, 128], navy: [0, 0, 128], orange: [255, 165, 0],
  pink: [255, 192, 203], brown: [165, 42, 42], gold: [255, 215, 0], indigo: [75, 0, 130],
  violet: [238, 130, 238], plum: [221, 160, 221], beige: [245, 245, 220], ivory: [255, 255, 240],
  khaki: [240, 230, 140], coral: [255, 127, 80], salmon: [250, 128, 114], tomato: [255, 99, 71],
  crimson: [220, 20, 60], orchid: [218, 112, 214], lavender: [230, 230, 250],
  whitesmoke: [245, 245, 245], gainsboro: [220, 220, 220], lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211], darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  dimgray: [105, 105, 105], dimgrey: [105, 105, 105], slategray: [112, 128, 144],
  slategrey: [112, 128, 144], steelblue: [70, 130, 180], royalblue: [65, 105, 225],
  midnightblue: [25, 25, 112], forestgreen: [34, 139, 34], seagreen: [46, 139, 87],
  goldenrod: [218, 165, 32], firebrick: [178, 34, 34], rebeccapurple: [102, 51, 153],
};
const NAMED_KEYS = Object.keys(NAMED_COLORS);

function clampChannel(value) {
  return Math.max(0, Math.min(255, value));
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function oklabToRgbRaw(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
  return [toSrgb(lr), toSrgb(lg), toSrgb(lb)];
}

function oklchToRgb(L, C, h) {
  const rad = (h * Math.PI) / 180;
  return oklabToRgbRaw(L, C * Math.cos(rad), C * Math.sin(rad)).map(clampChannel);
}

function parseAngle(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (trimmed.endsWith('turn')) return parseFloat(trimmed) * 360;
  if (trimmed.endsWith('rad')) return (parseFloat(trimmed) * 180) / Math.PI;
  if (trimmed.endsWith('grad')) return parseFloat(trimmed) * 0.9;
  return parseFloat(trimmed);
}

function parseAlpha(value) {
  if (value == null || value === '') return 1;
  const s = String(value).trim();
  if (s.endsWith('%')) return Math.max(0, Math.min(1, parseFloat(s) / 100));
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/**
 * Parse one CSS color token into { rgb:[r,g,b], alpha } or null.
 * Supports #hex, rgb()/rgba(), hsl()/hsla(), oklch(), named colors.
 * Returns null for gradients, var(), currentColor and anything unresolved.
 */
function parseColor(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw || raw.length > 120) return null;
  const low = raw.toLowerCase();
  if (NAMED_COLORS[low]) return { rgb: NAMED_COLORS[low].slice(), alpha: 1 };
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) {
    const hex = raw.slice(1);
    const expand = (h) => h.split('').map((c) => parseInt(c + c, 16));
    let rgb;
    if (hex.length === 3) rgb = expand(hex);
    else if (hex.length === 4) rgb = expand(hex.slice(0, 3));
    else if (hex.length === 6) rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    else if (hex.length === 8) rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    else return null;
    const alpha = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { rgb: rgb.map(clampChannel), alpha };
  }
  const fn = /^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/i.exec(raw);
  if (!fn) return null;
  const name = fn[1].toLowerCase();
  const inner = fn[2].trim();
  if (!inner) return null;
  const parts = inner.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (name === 'rgb' || name === 'rgba') {
    const channel = (token) => (token.endsWith('%') ? (parseFloat(token) / 100) * 255 : parseFloat(token));
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if (![r, g, b].every(Number.isFinite)) return null;
    return { rgb: [r, g, b].map(clampChannel), alpha: parseAlpha(parts[3]) };
  }
  if (name === 'hsl' || name === 'hsla') {
    const h = parseAngle(parts[0]);
    const s = parts[1].endsWith('%') ? parseFloat(parts[1]) / 100 : parseFloat(parts[1]);
    const l = parts[2].endsWith('%') ? parseFloat(parts[2]) / 100 : parseFloat(parts[2]);
    if (![h, s, l].every(Number.isFinite)) return null;
    return { rgb: hslToRgb(h, s, l).map(clampChannel), alpha: parseAlpha(parts[3]) };
  }
  if (name === 'oklch') {
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    let C = parts[1].endsWith('%') ? (parseFloat(parts[1]) / 100) * 0.4 : parseFloat(parts[1]);
    const h = parseAngle(parts[2]);
    if (![L, C, h].every(Number.isFinite)) return null;
    C = Math.max(0, C);
    return { rgb: oklchToRgb(L, C, h), alpha: parseAlpha(parts[3]) };
  }
  if (name === 'oklab') {
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const a = parseFloat(parts[1]);
    const b = parseFloat(parts[2]);
    if (![L, a, b].every(Number.isFinite)) return null;
    return { rgb: oklabToRgbRaw(L, a, b).map(clampChannel), alpha: parseAlpha(parts[3]) };
  }
  return null;
}

function relativeLuminance(rgb) {
  const channel = (c) => {
    const v = clampChannel(c) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(rgbA, rgbB) {
  const a = relativeLuminance(rgbA);
  const b = relativeLuminance(rgbB);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(rgb) {
  return `#${rgb.map((c) => Math.round(clampChannel(c)).toString(16).padStart(2, '0')).join('')}`;
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Suggest a foreground hex that reaches `target` contrast on `bg`. Null when impossible. */
function suggestContrastFix(fgRgb, bgRgb, target) {
  // Try both endpoints (black / white): mid-tone backgrounds may need the darker one.
  let endpoint = null;
  let best = 0;
  for (const candidate of [[0, 0, 0], [255, 255, 255]]) {
    const ratio = contrastRatio(candidate, bgRgb);
    if (ratio > best) {
      best = ratio;
      endpoint = candidate;
    }
  }
  if (!endpoint || best < target) return null;
  if (contrastRatio(fgRgb, bgRgb) >= target) return toHex(fgRgb);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixRgb(fgRgb, endpoint, mid), bgRgb) >= target) hi = mid;
    else lo = mid;
  }
  return toHex(mixRgb(fgRgb, endpoint, hi));
}

const LITERAL_COLOR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(/i;

function hasLiteralColor(value) {
  const v = String(value || '');
  if (LITERAL_COLOR_RE.test(v)) return true;
  for (const name of NAMED_KEYS) {
    const re = new RegExp(`(?:^|[\\s,(])${name}(?=$|[\\s,)])`, 'i');
    if (re.test(v)) return true;
  }
  return false;
}

const COLOR_PROP_RE = /^(color|background|background-color|border|border-color|border-(top|right|bottom|left|inline|block)(-(start|end|color|width|style))?|outline|outline-color|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration-color|column-rule|column-rule-color|scrollbar-color|stop-color|flood-color|lighting-color)$/i;

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------

/**
 * Scan a CSS region into rule objects. Handles @media/@supports nesting via recursion
 * and skips @keyframes bodies. Returned declaration indexes are relative to `text`.
 */
function scanCssRules(text, start = 0, end = text.length, chain = []) {
  const rules = [];
  let i = start;
  while (i < end) {
    let brace = -1;
    let quote = null;
    for (let j = i; j < end; j++) {
      const ch = text[j];
      if (quote) {
        if (ch === quote && text[j - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') { brace = j; break; }
      else if (ch === '}' && j === i) { i++; break; }
    }
    if (brace === -1) break;
    let depth = 1;
    let k = brace + 1;
    quote = null;
    while (k < end && depth > 0) {
      const ch = text[k];
      if (quote) {
        if (ch === quote && text[k - 1] !== '\\') quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      k++;
    }
    const bodyStart = brace + 1;
    const bodyEnd = depth === 0 ? k - 1 : end;
    const chunk = text.slice(i, brace);
    const boundary = Math.max(chunk.lastIndexOf(';'), chunk.lastIndexOf('}'));
    const selector = (boundary >= 0 ? chunk.slice(boundary + 1) : chunk).trim();
    const openedAt = i;
    if (selector.startsWith('@')) {
      if (/^@(media|supports|container|layer|scope|starting-style)\b/i.test(selector)) {
        rules.push(...scanCssRules(text, bodyStart, bodyEnd, chain.concat(selector)));
      } else if (/^@font-face\b/i.test(selector)) {
        rules.push({ selector, chain: chain.slice(), decls: parseDeclarations(text, bodyStart, bodyEnd), start: openedAt });
      }
    } else if (selector) {
      rules.push({ selector, chain: chain.slice(), decls: parseDeclarations(text, bodyStart, bodyEnd), start: openedAt });
    }
    i = depth === 0 ? bodyEnd + 1 : end;
  }
  return rules;
}

/** Extract `prop: value` pairs from a declaration block. Nested CSS blocks are skipped. */
function parseDeclarations(text, start, end) {
  const decls = [];
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(text[i])) i++;
    if (i >= end) break;
    if (text[i] === ';') { i++; continue; }
    const segStart = i;
    let j = i;
    let depth = 0;
    let quote = null;
    let nested = false;
    for (; j < end; j++) {
      const ch = text[j];
      if (quote) {
        if (ch === quote && text[j - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === '{' && depth === 0) { nested = true; break; }
      else if (ch === ';' && depth === 0) break;
    }
    if (nested) {
      let d = 1;
      let k = j + 1;
      while (k < end && d > 0) {
        if (text[k] === '{') d++;
        else if (text[k] === '}') d--;
        k++;
      }
      i = k;
      continue;
    }
    const segEnd = j;
    let colon = -1;
    let d2 = 0;
    let q2 = null;
    for (let k = segStart; k < segEnd; k++) {
      const ch = text[k];
      if (q2) {
        if (ch === q2) q2 = null;
        continue;
      }
      if (ch === '"' || ch === "'") q2 = ch;
      else if (ch === '(') d2++;
      else if (ch === ')') d2 = Math.max(0, d2 - 1);
      else if (ch === ':' && d2 === 0) { colon = k; break; }
    }
    if (colon > segStart) {
      const propRaw = text.slice(segStart, colon);
      const prop = propRaw.trim().toLowerCase();
      const value = text.slice(colon + 1, segEnd).trim();
      if (/^-{0,2}[a-z][a-zA-Z0-9_-]*$/.test(prop) && value) {
        const lead = propRaw.length - propRaw.trimStart().length;
        decls.push({ prop, value, index: segStart + lead });
      }
    }
    i = j < end ? j + 1 : end;
  }
  return decls;
}

/** Replace var(--x[, fallback]) recursively using a custom-property map. */
function resolveVars(value, map, depth = 0) {
  if (!value || depth > 6 || !map) return value;
  let changed = false;
  const out = String(value).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (whole, name, fallback) => {
    const found = map.get(name);
    if (found != null) { changed = true; return found; }
    if (fallback != null) { changed = true; return fallback.trim(); }
    return whole;
  });
  return changed ? resolveVars(out, map, depth + 1) : out;
}

function ruleTheme(rule) {
  if (rule.chain.some((c) => /prefers-color-scheme\s*:\s*dark/i.test(c))) return 'dark';
  if (/\[data-theme\s*=\s*["']?dark/i.test(rule.selector)) return 'dark';
  return 'light';
}

function buildVarMaps(rules) {
  const light = new Map();
  const dark = new Map();
  for (const rule of rules) {
    const theme = ruleTheme(rule);
    const map = theme === 'dark' ? dark : light;
    for (const decl of rule.decls) {
      if (decl.prop.startsWith('--') && !map.has(decl.prop)) map.set(decl.prop, decl.value);
    }
  }
  return { light, dark };
}

function pageBackground(rules, varMaps, theme) {
  const map = theme === 'dark' ? varMaps.dark : varMaps.light;
  const candidates = { body: null, html: null, root: null };
  for (const rule of rules) {
    if (ruleTheme(rule) !== theme) continue;
    const parts = splitSelectorParts(rule.selector).map((p) => p.trim().toLowerCase());
    let slot = null;
    if (parts.some((p) => p === 'body')) slot = 'body';
    else if (parts.some((p) => p === 'html')) slot = 'html';
    else if (parts.some((p) => p === ':root')) slot = 'root';
    if (!slot) continue;
    for (const decl of rule.decls) {
      if (decl.prop !== 'background' && decl.prop !== 'background-color') continue;
      const resolved = resolveVars(decl.value, map);
      const color = parseColor(resolved);
      if (color && color.alpha > 0.999) candidates[slot] = color.rgb;
    }
  }
  return candidates.body || candidates.html || candidates.root || null;
}

// ---------------------------------------------------------------------------
// Typography / selector helpers
// ---------------------------------------------------------------------------

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'emoji', 'math', 'fangsong',
]);

// CSS-wide keywords are not font families and must never count towards the limit.
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

// System font keywords for the `font` shorthand.
const SYSTEM_FONT_KEYWORDS = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);

function familyList(value) {
  const out = [];
  let current = '';
  let quote = null;
  for (const ch of String(value || '')) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

function primaryFamily(value) {
  for (const family of familyList(value)) {
    const low = family.toLowerCase();
    if (GENERIC_FAMILIES.has(low)) continue;
    if (CSS_WIDE_KEYWORDS.has(low)) continue;
    if (low === 'none') continue;
    if (low.startsWith('var(')) continue;
    return family;
  }
  return null;
}

/**
 * Extract the family list from a `font` shorthand, e.g.
 * "italic 600 1rem/1.5 'Poppins', sans-serif" -> "\"Poppins\", sans-serif".
 * Returns null for keywords, system fonts and values without a font-size.
 */
function fontShorthandFamilies(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const low = text.toLowerCase();
  if (CSS_WIDE_KEYWORDS.has(low) || SYSTEM_FONT_KEYWORDS.has(low)) return null;
  const match = /(?:^|\s)\d*\.?\d+(?:px|rem|em|%|pt|pc|in|cm|mm|ex|ch|vw|vh|vmin|vmax)\s*(?:\/\s*\S+)?\s+(.+)$/i.exec(text);
  if (!match) return null;
  return match[1].trim() || null;
}

function isHeadingSelectorPart(part) {
  const p = String(part || '').trim();
  if (/(?:^|[\s>+~,])(h[1-6])(?=$|[\s.#:[>+~,])/.test(p)) return true;
  const classes = [...p.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
  return classes.some((c) => /(?:^|[-_])(title|heading|headline|display|hero-title)(?:[-_]|$)/.test(c));
}

function isHeadingSelector(selector) {
  return splitSelectorParts(selector).some(isHeadingSelectorPart);
}

const BODY_HOOK_RE = /(?:^|[-_])(body|copy|prose|content|article|paragraph|reading|text-block|lead)(?:[-_]|$)/;
const TINY_HOOK_RE = /(?:^|[-_])(xs|sm|small|meta|caption|badge|tag|label|note|hint|tooltip|micro|footnote)(?:[-_]|$)/;

function isBodySelectorPart(part) {
  const p = String(part || '').trim();
  if (!p) return false;
  if (/^(body|html|p|li|article|main|:root)(?=$|[\s.#:[>+~,])/.test(p)) return true;
  if (/(?:^|[\s>+~,])(body|p|li)(?=$|[\s.#:[>+~,])/.test(p)) return true;
  const classes = [...p.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
  return classes.some((c) => BODY_HOOK_RE.test(c) && !TINY_HOOK_RE.test(c));
}

function isBodySelector(selector) {
  return splitSelectorParts(selector).some(isBodySelectorPart);
}

function isInteractiveSelector(selector) {
  return splitSelectorParts(selector).some((part) => {
    const p = String(part || '').trim();
    if (/(?:^|[\s>+~,])button(?=$|[\s.#:[>+~,])/.test(p)) return true;
    if (/\[role\s*=\s*["']?button/i.test(p)) return true;
    const classes = [...p.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
    return classes.some((c) => /(?:^|[-_])(btn|button|icon-btn|cta|nav-link|tab|toggle)(?:[-_]|$)/.test(c));
  });
}

/**
 * Match a CSS selector against the interactive identifiers collected from markup.
 * Keeps the literal fallback above; this catches class/id-only selectors such as
 * `.status--conflict` that are applied to a real <button> elsewhere in the page.
 */
function matchesInteractiveSelector(selector, interactive) {
  if (isInteractiveSelector(selector)) return true;
  if (!interactive || (interactive.classes.size === 0 && interactive.ids.size === 0)) return false;
  return splitSelectorParts(selector).some((part) => {
    const p = String(part || '');
    for (const m of p.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
      if (interactive.classes.has(m[1])) return true;
    }
    for (const m of p.matchAll(/#([a-zA-Z_][\w-]*)/g)) {
      if (interactive.ids.has(m[1])) return true;
    }
    for (const m of p.matchAll(/\[\s*class\s*[*^$|~]?=\s*["']?([^"'\]]+)/g)) {
      const value = m[1].trim();
      for (const cls of interactive.classes) {
        if (value === cls || value.includes(cls)) return true;
      }
    }
    return false;
  });
}

function isNoneOutline(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  if (v === 'none' || v === '0' || v === '0px') return true;
  return /^(?:none|0(?:px)?)\b/.test(v) && !/solid|dashed|dotted|double|groove|ridge|inset|outset/.test(v);
}

/** Pull the color token out of an `outline` shorthand value. */
function extractColorFromList(value) {
  const parts = String(value || '').replace(/[(),/]/g, ' ').split(/\s+/).filter(Boolean);
  for (const part of parts) {
    if (/^(solid|dashed|dotted|double|groove|ridge|inset|outset|none|auto|thin|medium|thick)$/i.test(part)) continue;
    if (/^-?\d*\.?\d+(px|rem|em|%)$/i.test(part)) continue;
    const color = parseColor(part);
    if (color) return { color, token: part };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markup parsing
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG_RE = /<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function scanTags(text) {
  const tags = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    const raw = m[0];
    const closing = raw.startsWith('</');
    tags.push({
      name: m[1].toLowerCase(),
      attrsInner: m[2] || '',
      selfClose: m[3] === '/',
      start: m.index,
      isClosing: closing,
      raw,
    });
  }
  return tags;
}

/** Parse attributes from the inner text of an opening tag. */
function parseAttrs(inner, absStart) {
  const map = new Map();
  let spread = false;
  let i = 0;
  const text = String(inner || '');
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === '/') { i++; continue; }
    if (text[i] === '{') {
      spread = true;
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    const nameStart = i;
    while (i < text.length && !/[\s=/>]/.test(text[i])) i++;
    const name = text.slice(nameStart, i).toLowerCase();
    if (!name) { i++; continue; }
    while (i < text.length && /\s/.test(text[i])) i++;
    let value = null;
    let abs = -1;
    if (text[i] === '=') {
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        const end = text.indexOf(quote, i + 1);
        const stop = end === -1 ? text.length : end;
        value = text.slice(i + 1, stop);
        abs = absStart + i + 1;
        i = stop + 1;
      } else if (quote === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === '{') depth++;
          else if (text[j] === '}') depth--;
          j++;
        }
        value = text.slice(i + 1, j - 1);
        abs = absStart + i + 1;
        i = j;
      } else {
        const vs = i;
        while (i < text.length && !/[\s>]/.test(text[i])) i++;
        value = text.slice(vs, i);
        abs = absStart + vs;
      }
    }
    if (name && !map.has(name)) map.set(name, { value, abs });
  }
  return { map, spread };
}

function getAttr(attrs, ...names) {
  for (const name of names) {
    if (attrs.map.has(name)) return attrs.map.get(name);
  }
  return null;
}

function classValue(attrs) {
  const attr = getAttr(attrs, 'class', 'classname');
  return attr && attr.value ? attr.value : '';
}

const INTERACTIVE_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'checkbox', 'radio']);

/**
 * Collect class names and ids of interactive elements from markup. The resulting
 * sets let CSS rules like `.status--conflict { height: 30px }` be recognised as
 * styling a real button even though the selector never mentions `button`.
 */
function collectInteractiveIdentifiers(raw) {
  const commentsMasked = maskHtmlComments(raw);
  const scriptBlanked = blankBlocks(commentsMasked, 'script');
  const styleBlanked = blankBlocks(scriptBlanked.text, 'style');
  const tags = scanTags(styleBlanked.text);
  const classes = new Set();
  const ids = new Set();
  for (const tag of tags) {
    if (tag.isClosing) continue;
    let isInteractive = tag.name === 'button' || tag.name === 'a' || tag.name === 'summary';
    const attrs = parseAttrs(tag.attrsInner, tag.start + 1 + tag.name.length);
    if (!isInteractive) {
      const role = String((getAttr(attrs, 'role') || {}).value || '').trim();
      if (/^button$/i.test(role)) isInteractive = true;
    }
    if (!isInteractive && tag.name === 'input') {
      const type = String((getAttr(attrs, 'type') || {}).value || '').trim().toLowerCase();
      if (INTERACTIVE_INPUT_TYPES.has(type)) isInteractive = true;
    }
    if (!isInteractive) continue;
    const cls = classValue(attrs);
    for (const token of String(cls).split(/\s+/)) {
      if (token) classes.add(token);
    }
    const idAttr = getAttr(attrs, 'id');
    if (idAttr && idAttr.value) ids.add(String(idAttr.value).trim());
  }
  return { classes, ids };
}

const KICKER_CLASS_RE = /(?:^|[\s"'_:-])(kicker|eyebrow|overline|pre[-_]?title|pre[-_]?heading)(?=$|[\s"'_:-])/i;

function isCardToken(token) {
  return /^card$/i.test(token) || /[-_]card$/i.test(token);
}

function isCardClass(value) {
  return String(value || '').split(/\s+/).some((token) => isCardToken(token));
}

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F900}-\u{1F9FF}]/u;

const CJK_TEXT_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/;
const CJK_FONT_RE = /(pingfang|hiragino|yahei|microsoft yahei|noto sans (sc|tc|hk|jp)|noto serif (sc|tc|hk|jp)|source han|songti|simsun|heiti|stheiti|kaiti|fangsong|wenquanyi|sarasa|lxgw|zcool|harmonyos sans|mi sans|droidsansfallback|arial unicode)/i;

function markupTextOnly(blanked) {
  return blanked.replace(/<[^>]*>/g, (m) => m.replace(/[^\n]/g, ' '));
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

function analyzeFile(rel, absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const ext = path.extname(absPath).toLowerCase();
  const positions = makePositions(raw);
  const findings = [];
  const ruleCounts = new Map();
  const add = (rule, index, message, fix) => {
    const meta = RULES[rule];
    if (!meta) throw new Error(`internal: unknown rule ${rule}`);
    const used = ruleCounts.get(rule) || 0;
    const cap = MAX_FINDINGS_PER_RULE[meta.severity] || 15;
    if (used >= cap) return;
    ruleCounts.set(rule, used + 1);
    const pos = positions(index);
    findings.push({
      file: rel,
      line: pos.line,
      column: pos.column,
      rule,
      severity: meta.severity,
      message,
      fix,
    });
  };
  const added = new Set();
  const addOnce = (rule, index, message, fix) => {
    if (added.has(rule)) return;
    added.add(rule);
    add(rule, index, message, fix);
  };

  const agg = {
    hardcodedCount: 0,
    hardcodedFirst: null,
    hardcodedLines: [],
    fontFamilies: [],
    headingSizes: [],
    bodySizes: [],
    lineHeights: [],
    trackings: [],
    hasMotion: false,
    firstMotion: null,
    colorDeclCount: 0,
    firstColorDecl: null,
    hasCjkText: false,
    varMaps: { light: new Map(), dark: new Map() },
  };

  const isCss = ext === '.css';
  const isMarkup = !isCss;
  const interactive = isMarkup
    ? collectInteractiveIdentifiers(raw)
    : { classes: new Set(), ids: new Set() };

  const regions = [];
  if (isCss) {
    regions.push({ text: raw, start: 0 });
  } else {
    const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].indexOf('>') + 1;
      regions.push({ text: m[1], start });
    }
  }

  const regionMaps = [];
  for (const region of regions) {
    const maps = runCssChecks(region.text, region.start, add, addOnce, agg, interactive);
    regionMaps.push(maps);
  }
  for (const maps of regionMaps) {
    for (const [key, value] of maps.light) if (!agg.varMaps.light.has(key)) agg.varMaps.light.set(key, value);
    for (const [key, value] of maps.dark) if (!agg.varMaps.dark.has(key)) agg.varMaps.dark.set(key, value);
  }

  let markupInfo = null;
  if (isMarkup) {
    markupInfo = runMarkupChecks(raw, ext, positions, add, addOnce, agg, agg.varMaps.light);
    agg.hasCjkText = CJK_TEXT_RE.test(markupInfo.textOnly);
  }

  finalizeRules(add, addOnce, agg, raw);
  return { findings, hasCjkText: agg.hasCjkText };
}

function runCssChecks(cssText, regionStart, add, addOnce, agg, interactive) {
  const masked = maskCssComments(cssText);
  const rules = scanCssRules(masked);
  const varMaps = buildVarMaps(rules);
  const touchTargetReported = new Set();
  const abs = (local) => regionStart + local;
  const addCss = (rule, localIndex, message, fix) => add(rule, abs(localIndex), message, fix);
  const addCssOnce = (rule, localIndex, message, fix) => addOnce(rule, abs(localIndex), message, fix);
  const addTouchTarget = (selector, localIndex, message, fix) => {
    if (touchTargetReported.has(selector)) return;
    touchTargetReported.add(selector);
    addCss('touch-target', localIndex, message, fix);
  };

  const focusVisibleFallback = rules.some((rule) => {
    if (!/:focus-visible\b/.test(rule.selector)) return false;
    return rule.decls.some((decl) => {
      if (decl.prop === 'outline') return !isNoneOutline(decl.value);
      if (decl.prop === 'outline-style') return !/none/i.test(decl.value);
      if (decl.prop === 'box-shadow') return !/^\s*none\b/i.test(decl.value);
      return false;
    });
  });

  if (/@(?:-webkit-)?keyframes\b/i.test(masked)) {
    if (!agg.hasMotion) {
      const idx = masked.search(/@(?:-webkit-)?keyframes\b/i);
      agg.hasMotion = true;
      agg.firstMotion = abs(idx);
    }
  }
  if (CJK_TEXT_RE.test(masked)) agg.hasCjkText = true;

  let regionTheme = 'light';

  for (const rule of rules) {
    const theme = ruleTheme(rule);
    regionTheme = theme;
    const map = theme === 'dark' ? varMaps.dark : varMaps.light;
    const pageBg = pageBackground(rules, varMaps, theme);

    for (const decl of rule.decls) {
      const index = abs(decl.index);
      const prop = decl.prop;
      const value = decl.value;

      // --- generic declaration-level checks ---------------------------------
      if ((prop === 'background-clip' || prop === '-webkit-background-clip') && /(^|\s)text(\s|$)/i.test(value)) {
        addCss('gradient-text', decl.index,
          '用 background-clip: text 做渐变文字：这是最常见的「AI 味」标志，正文可读性也依赖浏览器支持。',
          '去掉渐变文字，用字重/字号/留白建立层级；若要强调，改为纯色强调色或下划线。');
      }
      if ((prop === 'backdrop-filter' || prop === '-webkit-backdrop-filter') && /blur\(/i.test(value) && !/none/i.test(value)) {
        addCss('glass-decoration', decl.index,
          '毛玻璃（backdrop-filter: blur）装饰：低对比、性能差，是模板感的重要来源。',
          '用不透明表面色 + 细边框分层；确需模糊只用于一层浮层，并保证文字对比度。');
      }
      if ((prop === 'transition' || prop === 'transition-property') && /(^|[\s,])all(?=$|[\s,])/i.test(value)) {
        addCss('transition-all', decl.index,
          `transition 使用 all（${value}）：会把布局属性一起动画化，导致卡顿和意外位移。`,
          '只写要动的属性，例如 transition: transform 160ms ease-out, background-color 160ms ease-out。');
      }
      if ((prop === 'box-shadow' || prop === '-webkit-box-shadow') && /-?\d*\.?\d+(?:px|rem)\s+-?\d*\.?\d+(?:px|rem)\s+0(?:px)?(?:\s|,|$)/i.test(value)) {
        addCss('hard-offset-shadow', decl.index,
          `硬偏移阴影（${value}）：模糊为 0 的彩色/黑色偏移投影是典型模板装饰。`,
          '改用柔和阴影：0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.08)，或用边框分层。');
      }
      if (prop === 'border-left' || prop === 'border-inline-start') {
        const m = /^(\d*\.?\d+)px\s+(?:solid|dashed)\s+(.+)$/i.exec(value.trim());
        if (m) {
          const width = parseFloat(m[1]);
          const color = parseColor(m[2].trim());
          if (color && width >= 2 && width <= 8 && !isNeutralColor(color.rgb)) {
            addCss('accent-border-bar', decl.index,
              `彩色左侧竖条（${width}px）：callout 卡片常见的模板装饰，容易让所有区块长得一样。`,
              '用标题字重、留白或更淡的背景区分层级；确实要竖条时控制在 1 处并降低饱和度。');
          }
        }
      }
      if (prop === 'border-left-color' || prop === 'border-inline-start-color') {
        const color = parseColor(resolveVars(value, map));
        if (color && !isNeutralColor(color.rgb)) {
          addCss('accent-border-bar', decl.index,
            '单独设置彩色左边框：与「彩色竖条叫出重点」的模板写法高度相关。',
            '删掉彩色竖条，改用标题层级或一处真正的高亮底色。');
        }
      }

      // --- typography collection --------------------------------------------
      if (prop === 'font-family') {
        const resolved = resolveVars(value, map);
        agg.fontFamilies.push({ value: resolved, index });
      } else if (prop === 'font') {
        const families = fontShorthandFamilies(resolveVars(value, map));
        if (families) agg.fontFamilies.push({ value: families, index });
      }
      if (prop === 'font-size') {
        const px = lengthToPx(resolveVars(value, map));
        if (px != null) {
          if (isHeadingSelector(rule.selector)) agg.headingSizes.push({ px, index });
          if (isBodySelector(rule.selector)) agg.bodySizes.push({ px, index });
        }
      }
      if (prop === 'line-height' && isBodySelector(rule.selector)) {
        const unitless = /^-?\d*\.?\d+$/.test(value.trim()) ? parseFloat(value) : null;
        const px = lengthToPx(value);
        if (unitless != null) agg.lineHeights.push({ ratio: unitless, index });
        else if (px != null) {
          const size = rule.decls.find((d) => d.prop === 'font-size');
          const sizePx = size ? lengthToPx(resolveVars(size.value, map)) : null;
          if (sizePx) agg.lineHeights.push({ ratio: px / sizePx, index });
        }
      }
      if (prop === 'letter-spacing' && isBodySelector(rule.selector) && !isHeadingSelector(rule.selector)) {
        const m = /^(-?\d*\.?\d+)(em|rem|px)$/.exec(value.trim());
        if (m) {
          const n = parseFloat(m[1]);
          const em = m[2] === 'px' ? n / 16 : n;
          if (em < -0.02) agg.trackings.push({ em, index });
        }
      }

      // --- motion ------------------------------------------------------------
      if ((prop === 'transition' || prop === 'animation' || prop === 'animation-name') && value && !/^\s*none\b/i.test(value)) {
        if (!agg.hasMotion) {
          agg.hasMotion = true;
          agg.firstMotion = index;
        }
      }

      // --- hardcoded colors / dark-mode bookkeeping --------------------------
      if (!prop.startsWith('--') && COLOR_PROP_RE.test(prop)) {
        const isColorDecl = hasLiteralColor(value) || /var\(/.test(value);
        if (isColorDecl) {
          if (agg.firstColorDecl == null || index < agg.firstColorDecl) agg.firstColorDecl = index;
          agg.colorDeclCount += 1;
        }
        if (hasLiteralColor(value)) {
          agg.hardcodedCount += 1;
          if (agg.hardcodedFirst == null || index < agg.hardcodedFirst) agg.hardcodedFirst = index;
          agg.hardcodedLines.push(index);
        }
      }

      // --- CJK css rules -----------------------------------------------------
      if ((prop === 'text-align' || prop === 'text-justify') && /justify/i.test(value) && isBodySelector(rule.selector)) {
        addCss('cjk-justify', decl.index,
          `正文使用 text-align: justify（${rule.selector}）：中文两端对齐会产生难看的字距空洞。`,
          '中文正文保持左对齐（text-align: left），需要整齐右边缘时用网格而不是 justify。');
      }
      if (prop === 'word-break' && /break-all/i.test(value)) {
        addCss('cjk-break-all', decl.index,
          'word-break: break-all 会拆断英文单词与数字，中文页面应使用 overflow-wrap: anywhere。',
          '改为 overflow-wrap: anywhere 或 word-break: normal；仅在必须截断 URL 时局部使用 break-all。');
      }

      // --- touch targets -----------------------------------------------------
      if (matchesInteractiveSelector(rule.selector, interactive)) {
        if (prop === 'height' || prop === 'min-height') {
          const px = lengthToPx(resolveVars(value, map));
          if (px != null && px < 44) {
            addTouchTarget(rule.selector, decl.index,
              `可点击控件高度 ${px}px，小于 44px 触摸目标基线（${rule.selector}）。`,
              '把按钮/链接的可点击区域做到至少 44×44px：min-height: 44px; padding: 10px 16px。');
          }
        } else if (prop === 'padding') {
          const parts = value.trim().split(/\s+/);
          const vertical = lengthToPx(parts[0]);
          if (vertical != null && vertical < 6) {
            addTouchTarget(rule.selector, decl.index,
              `可点击控件上下内边距仅 ${vertical}px，触摸目标偏小（${rule.selector}）。`,
              '增大到至少 12px 上下内边距，并配合 min-height: 44px。');
          }
        }
      }
    }

    // --- per-rule checks ----------------------------------------------------
    checkContrastRule(rule, map, addCss);
    checkFocusRule(rule, map, pageBg, focusVisibleFallback, addCss);

    // --- type scale flatness is collected then finalized per file ----------
  }

  // Font-family overload (per CSS region is fine; aggregate lives in agg).
  // Contrast in inline styles is handled by the markup pass.

  return varMaps;
}

function isNeutralColor(rgb) {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max - min < 24;
}

function checkContrastRule(rule, map, addCss) {
  let colorDecl = null;
  let bgDecl = null;
  let sizePx = null;
  let weight = 400;
  for (const decl of rule.decls) {
    if (decl.prop === 'color') colorDecl = decl;
    else if (decl.prop === 'background-color') bgDecl = decl;
    else if (decl.prop === 'background' && !bgDecl) {
      const candidate = parseColor(resolveVars(decl.value, map));
      if (candidate) bgDecl = decl;
    } else if (decl.prop === 'font-size') {
      const px = lengthToPx(resolveVars(decl.value, map));
      if (px != null) sizePx = px;
    } else if (decl.prop === 'font-weight') {
      const v = String(decl.value).trim().toLowerCase();
      if (v === 'bold') weight = 700;
      else if (/^\d+$/.test(v)) weight = parseInt(v, 10);
    }
  }
  if (!colorDecl || !bgDecl) return;
  const fg = parseColor(resolveVars(colorDecl.value, map));
  const bg = parseColor(resolveVars(bgDecl.value, map));
  if (!fg || !bg) return;
  if (fg.alpha < 0.999 || bg.alpha < 0.999) return;
  const threshold = sizePx != null && (sizePx >= 24 || (sizePx >= 18.66 && weight >= 700)) ? 3.0 : 4.5;
  const ratio = contrastRatio(fg.rgb, bg.rgb);
  if (ratio + 0.005 >= threshold) return;
  const bgHex = toHex(bg.rgb);
  const suggestion = suggestContrastFix(fg.rgb, bg.rgb, threshold);
  const fixText = suggestion
    ? `把文字颜色改成 ${suggestion}（在 ${bgHex} 上达到 ${threshold}:1），或调整背景明度；不要靠加粗/加大字号掩盖对比度不足。`
    : `背景 ${bgHex} 的明度居中，任何文字颜色都难达到 ${threshold}:1：先把背景调深或调浅，再重新选文字色。`;
  addCss('contrast-fail', colorDecl.index,
    `文字与背景对比度 ${ratio.toFixed(2)}:1，低于 AA 要求 ${threshold}:1（color: ${toHex(fg.rgb)} / background: ${bgHex}）。`,
    fixText);
}

function checkFocusRule(rule, map, pageBg, focusVisibleFallback, addCss) {
  const selector = rule.selector;
  if (!/:focus(?:-visible)?\b/.test(selector)) return;
  const focusVisible = /:focus-visible\b/.test(selector);

  for (const decl of rule.decls) {
    const removesOutline =
      (decl.prop === 'outline' && isNoneOutline(decl.value)) ||
      (decl.prop === 'outline-style' && /^none$/i.test(String(decl.value).trim())) ||
      (decl.prop === 'outline-color' && /^transparent$/i.test(String(decl.value).trim()));
    if (!removesOutline) continue;
    const hasLocalReplacement = rule.decls.some((d) =>
      d !== decl && (
        /^(box-shadow|background|background-color|border|border-color|outline-color)$/i.test(d.prop) ||
        (d.prop === 'outline' && !isNoneOutline(d.value))
      ));
    if (hasLocalReplacement) continue;
    if (!focusVisible && focusVisibleFallback) continue;
    addCss('focus-removed', decl.index,
      `移除了键盘焦点轮廓（${selector}）且没有可见替代：键盘用户会完全失去位置。`,
      '保留轮廓并重设样式，例如 :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }。');
  }

  // Contrast of the custom focus ring against the page background.
  let outlineDecl = null;
  let outlineColor = null;
  for (const decl of rule.decls) {
    if (decl.prop === 'outline-color') {
      outlineColor = parseColor(resolveVars(decl.value, map));
      outlineDecl = decl;
    } else if (decl.prop === 'outline') {
      const extracted = extractColorFromList(resolveVars(decl.value, map));
      if (extracted) {
        outlineColor = extracted.color;
        outlineDecl = decl;
      }
    }
  }
  if (!outlineColor || outlineColor.alpha < 0.999) return;
  if (!pageBg) return;
  const ratio = contrastRatio(outlineColor.rgb, pageBg);
  if (ratio >= 3) return;
  addCss('focus-invisible', outlineDecl.index,
    `焦点轮廓与页面背景对比度只有 ${ratio.toFixed(2)}:1，低于 3:1，实际很难看见。`,
    `把焦点色改深/改亮到与背景至少 3:1（当前背景 ${toHex(pageBg)}），并保持 2px 以上宽度与 2px offset。`);
}

function finalizeRules(add, addOnce, agg, raw) {
  // type-scale-flat
  if (agg.headingSizes.length) {
    const sorted = agg.headingSizes.slice().sort((a, b) => b.px - a.px);
    const unique = [];
    for (const item of sorted) {
      if (!unique.length || Math.abs(unique[unique.length - 1].px - item.px) > 0.25) unique.push(item);
    }
    if (unique.length >= 2) {
      for (let i = 1; i < unique.length; i++) {
        const bigger = unique[i - 1];
        const smaller = unique[i];
        const ratio = bigger.px / smaller.px;
        if (ratio < 1.12) {
          addOnce('type-scale-flat', smaller.index,
            `字号阶梯过平：相邻标题 ${bigger.px}px 与 ${smaller.px}px 只差 ${((ratio - 1) * 100).toFixed(0)}%，用户感知不到层级。`,
            '按 1.25–1.33 的比例重排字阶，例如 16 / 20 / 25 / 31 / 39px；标题与正文至少差 1.5 倍。');
          break;
        }
      }
    } else if (agg.bodySizes.length) {
      const body = agg.bodySizes.slice().sort((a, b) => a.px - b.px)[0];
      const ratio = unique[0].px / body.px;
      if (ratio < 1.5) {
        addOnce('type-scale-flat', unique[0].index,
          `标题最大字号 ${unique[0].px}px 与正文 ${body.px}px 只差 ${ratio.toFixed(2)} 倍，页面缺少层级。`,
          '把主标题做到正文的 2–2.5 倍，或引入 clamp() 的流式字阶，拉开层级差。');
      }
    }
  }

  // font-family-overload
  if (agg.fontFamilies.length) {
    const primaries = [];
    for (const entry of agg.fontFamilies) {
      const primary = primaryFamily(entry.value);
      if (primary && !primaries.some((p) => p.name.toLowerCase() === primary.toLowerCase())) {
        primaries.push({ name: primary, index: entry.index });
      }
    }
    if (primaries.length > 3) {
      const names = primaries.slice(0, 6).map((p) => p.name).join(' / ');
      addOnce('font-family-overload', primaries[0].index,
        `页面使用了 ${primaries.length} 个不同字体族（${names}），加载与视觉都会失控。`,
        '收敛到 1 个正文字体族 + 1 个等宽族（最多 3 个）；西文/中文用同一个 font-family 栈的 fallback 解决。');
    }
  }

  // body-line-height
  for (const entry of agg.lineHeights) {
    if (entry.ratio < 1.5) {
      addOnce('body-line-height', entry.index,
        `正文行高 ${entry.ratio}，低于 1.5；中文正文会显得拥挤。`,
        '把 body / p 的 line-height 设为 1.6–1.75（中文比西文需要更大行距），标题可单独用 1.15–1.3。');
      break;
    }
  }

  // body-too-small
  for (const entry of agg.bodySizes) {
    if (entry.px < 14) {
      addOnce('body-too-small', entry.index,
        `正文字号 ${entry.px}px，小于 14px；中文小字在常规视距下难读。`,
        '正文用 16px（1rem）起步；辅助信息最小 14px，且只用于短标签，不用于段落。');
      break;
    }
  }

  // tracking-tight
  for (const entry of agg.trackings) {
    if (entry.em < -0.02) {
      addOnce('tracking-tight', entry.index,
        `正文字距 ${entry.em}em，小于 -0.02em；汉字会挤在一起。`,
        '正文保持 letter-spacing: 0；只有大号展示标题才允许 -0.01em 至 -0.02em 的收紧。');
      break;
    }
  }

  // reduced-motion
  if (agg.hasMotion && !/prefers-reduced-motion/i.test(raw)) {
    addOnce('reduced-motion', agg.firstMotion == null ? 0 : agg.firstMotion,
      '页面有过渡/动画，但没有 prefers-reduced-motion 降级：部分用户会眩晕。',
      '补 @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }。');
  }

  // hardcoded-color (aggregated, info)
  if (agg.hardcodedCount > 0 && agg.hardcodedFirst != null) {
    addOnce('hardcoded-color', agg.hardcodedFirst,
      `发现 ${agg.hardcodedCount} 处组件内硬编码颜色（首处位置已标注）：颜色散落在组件里，无法统一调整。`,
      '把颜色收进 :root 的 --color-* token，组件里只写 var(--color-*)；颜色决策集中一处才能统一调整明暗模式。');
  }

  // dark-mode-missing (aggregated, info)
  if (agg.colorDeclCount > 0 && agg.firstColorDecl != null && !/prefers-color-scheme|data-theme|color-scheme/i.test(raw)) {
    addOnce('dark-mode-missing', agg.firstColorDecl,
      `页面声明了 ${agg.colorDeclCount} 处颜色，但没有 prefers-color-scheme 或 [data-theme] 深色方案。`,
      '补 @media (prefers-color-scheme: dark) 与 [data-theme="dark"] 两套变量覆写（可用 scripts/design-tokens.mjs 直接生成）。');
  }

  // cjk-font-stack
  if (agg.hasCjkText && agg.fontFamilies.length) {
    const hasCjkFamily = agg.fontFamilies.some((entry) =>
      CJK_FONT_RE.test(entry.value) || /system-ui/i.test(entry.value));
    if (!hasCjkFamily) {
      addOnce('cjk-font-stack', agg.fontFamilies[0].index,
        '页面有中文内容，但 font-family 栈里没有任何中文字体或 system-ui fallback，中文会落到难看的默认字体。',
        '中文字体栈示例：system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif。');
    }
  }
}

// ---------------------------------------------------------------------------
// Markup checks
// ---------------------------------------------------------------------------

function runMarkupChecks(raw, ext, positions, add, addOnce, agg, varMaps) {
  const commentsMasked = maskHtmlComments(raw);
  const scriptBlanked = blankBlocks(commentsMasked, 'script');
  const styleBlanked = blankBlocks(scriptBlanked.text, 'style');
  const blanked = styleBlanked.text;
  const tags = scanTags(blanked);
  const textOnly = markupTextOnly(blanked);

  // --- img-alt -------------------------------------------------------------
  for (const tag of tags) {
    if (tag.isClosing) continue;
    if (tag.name !== 'img') continue;
    const attrs = parseAttrs(tag.attrsInner, tag.start + 1 + tag.name.length);
    if (attrs.spread) continue;
    const alt = getAttr(attrs, 'alt');
    if (alt && alt.value != null && String(alt.value).trim() !== '') continue;
    add('img-alt', tag.start,
      '<img> 缺少 alt 属性：屏幕阅读器不知道这张图是什么。',
      '内容图片写 alt="具体描述"；纯装饰图片写 alt=""（空字符串），不要省略 alt。');
  }

  // --- heading-order -------------------------------------------------------
  let previousHeading = 0;
  for (const tag of tags) {
    if (tag.isClosing) continue;
    const m = /^h([1-6])$/.exec(tag.name);
    if (!m) continue;
    const level = parseInt(m[1], 10);
    if (previousHeading && level - previousHeading > 1) {
      add('heading-order', tag.start,
        `标题层级跳级：上一个是 h${previousHeading}，这里直接用了 h${level}。`,
        `改成 h${previousHeading + 1}（或更上层），保持 h1→h2→h3 的连续结构，不要用字号假装层级。`);
    }
    previousHeading = level;
  }

  // --- html-lang -----------------------------------------------------------
  if (ext === '.html' || ext === '.htm') {
    const htmlTag = tags.find((tag) => !tag.isClosing && tag.name === 'html');
    if (htmlTag) {
      const attrs = parseAttrs(htmlTag.attrsInner, htmlTag.start + 1 + htmlTag.name.length);
      const lang = getAttr(attrs, 'lang');
      if (!lang || !String(lang.value || '').trim()) {
        add('html-lang', htmlTag.start,
          '<html> 缺少 lang 属性：屏幕阅读器会用错误的语言朗读页面。',
          '中文页面写 <html lang="zh-CN">；中英混排主语言仍是中文。');
      }
    }
  }

  // --- kicker-eyebrow ------------------------------------------------------
  let kickerCount = 0;
  for (const tag of tags) {
    if (tag.isClosing) continue;
    const attrs = parseAttrs(tag.attrsInner, tag.start + 1 + tag.name.length);
    const cls = classValue(attrs);
    if (cls && KICKER_CLASS_RE.test(cls) && kickerCount < 5) {
      kickerCount += 1;
      add('kicker-eyebrow', tag.start,
        `检测到 kicker/eyebrow 式小标签（class="${cls}"）：标题上方的小号大写标签是模板封面的常见套路。`,
        '删掉这个标签，把信息并进标题或正文第一句；需要分区时用留白和字号，而不是再加一层小标签。');
    }
  }

  // --- emoji-icon ----------------------------------------------------------
  const emojiBlockRe = /<(h[1-6]|button|a)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1>/gi;
  let emojiMatch;
  let emojiCount = 0;
  while ((emojiMatch = emojiBlockRe.exec(blanked)) && emojiCount < 5) {
    const inner = emojiMatch[3].replace(/<[^>]*>/g, ' ');
    if (!EMOJI_RE.test(inner)) continue;
    emojiCount += 1;
    add('emoji-icon', emojiMatch.index,
      `标题/按钮/链接里直接用 emoji 当图标（${inner.trim().slice(0, 24)}）：跨平台渲染不一致，也很像 AI 生成的营销页。`,
      '换成内联 SVG 图标或纯文字；emoji 只用于用户输入内容，不用于界面图标。');
  }

  // --- form-label ----------------------------------------------------------
  const labelFor = new Set();
  for (const tag of tags) {
    if (tag.isClosing || tag.name !== 'label') continue;
    const attrs = parseAttrs(tag.attrsInner, tag.start + 1 + tag.name.length);
    const forAttr = getAttr(attrs, 'for', 'htmlfor');
    if (forAttr && forAttr.value != null) labelFor.add(String(forAttr.value).trim());
  }
  const stack = [];
  for (const tag of tags) {
    if (tag.isClosing) {
      const lastIndex = stack.map((s) => s.name).lastIndexOf(tag.name);
      if (lastIndex >= 0) stack.length = lastIndex;
      continue;
    }
    const attrs = parseAttrs(tag.attrsInner, tag.start + 1 + tag.name.length);
    if (tag.name === 'input' || tag.name === 'select' || tag.name === 'textarea') {
      const type = (getAttr(attrs, 'type') || {}).value || '';
      const skipTypes = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
      if (!(tag.name === 'input' && skipTypes.has(String(type).toLowerCase()))) {
        const id = (getAttr(attrs, 'id') || {}).value || '';
        const ariaLabel = getAttr(attrs, 'aria-label', 'aria-labelledby');
        const wrapped = stack.some((s) => s.name === 'label');
        const labelled = wrapped || (id && labelFor.has(String(id).trim())) || (ariaLabel && String(ariaLabel.value || '').trim() !== '') || attrs.spread;
        if (!labelled) {
          add('form-label', tag.start,
            `<${tag.name}> 没有关联的 <label>（只有 placeholder 不算）：屏幕阅读器读不出这个字段要填什么。`,
            `给控件一个 id，并写 <label for="该 id">字段名</label>；或用 aria-label 提供可访问名称，placeholder 只作为示例。`);
        }
      }
    }
    if (!VOID_TAGS.has(tag.name) && !tag.selfClose) stack.push({ name: tag.name });
  }

  // --- nested-card / card-grid-uniform ------------------------------------
  const cardElements = [];
  const domStack = [];
  let nestedCount = 0;
  for (const tag of tags) {
    if (tag.isClosing) {
      const lastIndex = domStack.map((s) => s.name).lastIndexOf(tag.name);
      if (lastIndex >= 0) domStack.length = lastIndex;
      continue;
    }
    const attrs = parseAttrs(tag.attrsInner, tag.start + 1 + tag.name.length);
    const cls = classValue(attrs);
    const card = isCardClass(cls);
    if (card) {
      const ancestor = [...domStack].reverse().find((s) => s.card);
      if (ancestor && nestedCount < 5) {
        nestedCount += 1;
        const ancestorLine = positions(ancestor.start).line;
        add('nested-card', tag.start,
          `.card 内部又套了一个 .card（外层是第 ${ancestorLine} 行的 <${ancestor.name}>）：卡片套卡片让层级和留白都失控。`,
          '把内层卡片降级为普通分组（去掉边框/阴影，只留标题前缀），或拆成两个并列区块。');
      }
      cardElements.push({ classValue: normalizeClassList(cls), start: tag.start });
    }
    if (!VOID_TAGS.has(tag.name) && !tag.selfClose) domStack.push({ name: tag.name, card, start: tag.start });
  }
  const cardGroups = new Map();
  for (const el of cardElements) {
    if (!el.classValue) continue;
    const key = el.classValue;
    if (!cardGroups.has(key)) cardGroups.set(key, []);
    cardGroups.get(key).push(el);
  }
  for (const [key, group] of cardGroups) {
    if (group.length >= 4) {
      addOnce('card-grid-uniform', group[0].start,
        `同一页面出现了 ${group.length} 张 class 与结构完全相同的卡片（class="${key}"）：等大等距卡片堆砌是典型模板感。`,
        '让卡片承担不同的内容形态：至少一张横排、一张大图/大数字、一张引用，或直接取消卡片边框用留白分组。');
      break;
    }
  }

  // --- inline styles: contrast + transition-all + hardcoded colors ----------
  for (const tag of tags) {
    if (tag.isClosing) continue;
    const attrs = parseAttrs(tag.attrsInner, tag.start + 1 + tag.name.length);
    const styleAttr = getAttr(attrs, 'style');
    if (!styleAttr || styleAttr.value == null) continue;
    const decls = parseDeclarations(String(styleAttr.value), 0, String(styleAttr.value).length);
    if (!decls.length) continue;
    const absBase = styleAttr.abs;
    for (const decl of decls) {
      if (decl.prop === 'transition' || decl.prop === 'transition-property') {
        if (/(^|[\s,])all(?=$|[\s,])/i.test(decl.value)) {
          add('transition-all', absBase + decl.index,
            `内联 transition 使用 all（${decl.value}）：会把布局属性一起动画化。`,
            '只写需要动画的属性，例如 transition: transform 160ms ease-out。');
        }
      }
      if (!decl.prop.startsWith('--') && COLOR_PROP_RE.test(decl.prop) && hasLiteralColor(decl.value)) {
        agg.hardcodedCount += 1;
        if (agg.hardcodedFirst == null || absBase + decl.index < agg.hardcodedFirst) agg.hardcodedFirst = absBase + decl.index;
        if (agg.firstColorDecl == null || absBase + decl.index < agg.firstColorDecl) agg.firstColorDecl = absBase + decl.index;
        agg.colorDeclCount += 1;
      }
    }
    // contrast pairs inside one inline style
    const getDecl = (prop) => decls.find((d) => d.prop === prop) || null;
    const colorDecl = getDecl('color');
    const bgDecl = getDecl('background-color') || getDecl('background');
    if (colorDecl && bgDecl) {
      const fg = parseColor(resolveVars(colorDecl.value, varMaps));
      const bg = parseColor(resolveVars(bgDecl.value, varMaps));
      if (fg && bg && fg.alpha > 0.999 && bg.alpha > 0.999) {
        const sizeValue = getDecl('font-size');
        const sizePx = sizeValue ? lengthToPx(sizeValue.value) : null;
        const weightValue = getDecl('font-weight');
        const weight = weightValue ? (/(bold|^[6-9]\d{2}$)/.test(weightValue.value) ? 700 : 400) : 400;
        const threshold = sizePx != null && (sizePx >= 24 || (sizePx >= 18.66 && weight >= 700)) ? 3.0 : 4.5;
        const ratio = contrastRatio(fg.rgb, bg.rgb);
        if (ratio + 0.005 < threshold) {
          const bgHex = toHex(bg.rgb);
          const suggestion = suggestContrastFix(fg.rgb, bg.rgb, threshold);
          const fixText = suggestion
            ? `把内联文字颜色改成 ${suggestion}，或把背景调整到与文字至少 ${threshold}:1。`
            : `背景 ${bgHex} 的明度居中，任何文字颜色都难达到 ${threshold}:1：先调整背景明度。`;
          add('contrast-fail', absBase + colorDecl.index,
            `内联样式文字与背景对比度 ${ratio.toFixed(2)}:1，低于 AA 要求 ${threshold}:1（${toHex(fg.rgb)} / ${bgHex}）。`,
            fixText);
        }
      }
    }
  }

  // --- CJK text rules ------------------------------------------------------
  const cjkExt = ext === '.html' || ext === '.htm' || ext === '.vue' || ext === '.svelte';
  if (cjkExt) {
    // Missing space between CJK and Latin letters (info, aggregated).
    const mixedRe = /([\u3400-\u4DBF\u4E00-\u9FFF])([A-Za-z])|([A-Za-z])([\u3400-\u4DBF\u4E00-\u9FFF])/g;
    const mixedMatches = [];
    let mixed;
    while ((mixed = mixedRe.exec(textOnly)) && mixedMatches.length < 3) {
      const at = mixed.index;
      const snippet = textOnly.slice(Math.max(0, at - 8), Math.min(textOnly.length, at + 10)).replace(/\s+/g, ' ').trim();
      mixedMatches.push({ index: at, snippet });
    }
    if (mixedMatches.length) {
      addOnce('cjk-mixed-spacing', mixedMatches[0].index,
        `中文与西文之间缺少空格（例：${mixedMatches.slice(0, 3).map((m) => `「${m.snippet}」`).join('、')}）：混排节奏会变差。`,
        '在中英文之间加一个空格（「用 CSS 做布局」而不是「用CSS做布局」）；数字与汉字之间通常不加。');
    }

    // Doubled CJK punctuation.
    const doubleRe = /([。，、；：？！])\1+/g;
    let doubleMatch;
    let doubleCount = 0;
    while ((doubleMatch = doubleRe.exec(textOnly)) && doubleCount < 10) {
      doubleCount += 1;
      add('cjk-double-punct', doubleMatch.index,
        `连续重复的中文标点「${doubleMatch[0]}」是常见笔误/AI 生成痕迹。`,
        '保留一个标点；需要停顿用句号或分号，不要靠重复标点表达语气。');
    }
  }

  return { textOnly };
}

function normalizeClassList(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => isCardToken(token))
    .sort()
    .join(' ') || String(value || '').split(/\s+/).filter(Boolean).sort().join(' ');
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function countSeverities(findings) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function computeScore(counts) {
  const penalty = counts.error * 12 + counts.warn * 4 + counts.info * 1;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function sortFindings(findings) {
  return findings.slice().sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column ||
    a.rule.localeCompare(b.rule));
}

function formatText(findings, counts, score, scanned) {
  const lines = [];
  lines.push(`ui-craft lint · 扫描 ${scanned.length} 个文件`);
  const empty = findings.length === 0;
  if (empty) lines.push('没有发现问题。');
  for (const severity of ['error', 'warn', 'info']) {
    const group = findings.filter((f) => f.severity === severity);
    if (!group.length) continue;
    lines.push('');
    lines.push(`── ${SEV_LABEL[severity]} (${group.length}) ──`);
    for (const finding of group) {
      lines.push(`${finding.file}:${finding.line}:${finding.column}  [${finding.rule}]  ${finding.message}`);
      lines.push(`    修复：${finding.fix}`);
    }
  }
  lines.push('');
  lines.push(`汇总：error ${counts.error} · warn ${counts.warn} · info ${counts.info} · score ${score}/100`);
  if (findings.length) {
    const priority = findings.find((f) => f.severity === 'error')
      || findings.find((f) => f.severity === 'warn')
      || findings[0];
    lines.push(`最高优先级修复：${priority.file}:${priority.line}:${priority.column} [${priority.rule}] ${priority.fix}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { files, notes } = collectTargets(opts.targets);
  for (const note of notes) process.stderr.write(`${note}\n`);

  const scanned = [];
  const findings = [];
  for (const file of files) {
    try {
      const result = analyzeFile(file.rel, file.abs);
      findings.push(...result.findings);
      scanned.push(file.rel);
    } catch (err) {
      process.stderr.write(`[design-lint] 跳过 ${file.rel}：${err && err.message ? err.message : String(err)}\n`);
    }
  }

  const threshold = SEV_RANK[opts.minSeverity];
  const filtered = sortFindings(findings.filter((f) => SEV_RANK[f.severity] >= threshold));
  const counts = countSeverities(filtered);
  const score = computeScore(counts);

  if (opts.json) {
    const payload = { version: SCHEMA_VERSION, scanned, findings: filtered, counts, score };
    process.stdout.write(`__DESIGN_KIT_JSON__${JSON.stringify(payload)}\n`);
  } else if (opts.quiet) {
    process.stdout.write(`error ${counts.error} · warn ${counts.warn} · info ${counts.info} · score ${score}/100\n`);
  } else {
    process.stdout.write(`${formatText(filtered, counts, score, scanned)}\n`);
  }
  return counts.error > 0 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliError) {
    process.stderr.write(`[design-lint] 错误：${err.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`[design-lint] 内部错误：${err && err.stack ? err.stack : String(err)}\n`);
    process.exitCode = 2;
  }
}
