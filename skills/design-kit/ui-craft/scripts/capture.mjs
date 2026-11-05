#!/usr/bin/env node
/**
 * capture.mjs
 * Zero-dependency screenshot helper for the ui-craft skill.
 * Node >= 18, ESM, no external packages, works on Windows / macOS / Linux.
 *
 * Preferred path: locate a local Chrome / Edge / Chromium and take headless
 * screenshots with `--headless=new --screenshot` at several viewport widths.
 *
 * Degraded path (no browser, sandbox refuses named pipes, launch failure):
 *   - never crash and never pretend a screenshot exists
 *   - write <out>/contact-sheet.html (iframe previews per width + review checklist + lint hints)
 *   - write <out>/README.txt (three concrete degraded workflows)
 *   - print a single `CAPTURE_UNAVAILABLE: <reason>` line and exit with code 3
 *
 * Source comments are English. All CLI output is Chinese.
 * Exit codes: 0 = screenshots captured, 2 = bad arguments, 3 = degraded (no screenshots).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const DEFAULT_OUT = 'capture-out';
const DEFAULT_WIDTHS = [390, 768, 1440];
const MAX_WIDTHS = 6;
const LAUNCH_TIMEOUT_MS = 30000;
const DEFAULT_HEIGHT = 900;
const FULL_HEIGHT = 3200;

const USAGE = `用法:
  node scripts/capture.mjs <html文件或URL> --out <dir> [--widths 390,768,1440] [--full]

示例:
  node scripts/capture.mjs page.html --out shots
  node scripts/capture.mjs page.html --out shots --widths 390,768,1440 --full
  node scripts/capture.mjs https://example.com --out shots

参数:
  <html文件或URL>  本地 HTML 文件路径，或 http(s):// 地址
  --out <dir>      输出目录，默认 ./${DEFAULT_OUT}
  --widths <列表>  逗号分隔的视口宽度，默认 ${DEFAULT_WIDTHS.join(',')}（最多 ${MAX_WIDTHS} 个）
  --full           用更高的视口近似整页截图（会在 report.json 里标注 fullApprox）
  -h, --help       显示本帮助

产出:
  成功: <out>/w-<width>.png + <out>/report.json
  降级: <out>/contact-sheet.html + <out>/README.txt + <out>/report.json
退出码: 0 = 截图成功；2 = 参数错误；3 = 降级（未截图，已生成审阅页）。`;

class CliError extends Error {}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usageError(message) {
  throw new CliError(message);
}

function parseArgs(argv) {
  const opts = { target: null, out: DEFAULT_OUT, widths: DEFAULT_WIDTHS.slice(), full: false, help: false };
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
      const value = argv[i + 1];
      if (value == null || value.startsWith('--')) usageError(`${arg} 缺少取值`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--out': opts.out = next(); break;
      case '--widths': opts.widths = parseWidths(next()); break;
      case '--full': opts.full = true; break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        if (arg.startsWith('-')) usageError(`未知参数：${arg}`);
        if (opts.target != null) usageError(`只能指定一个目标（已指定：${opts.target}，又收到：${arg}）`);
        opts.target = arg;
    }
  }
  if (opts.help) return opts;
  if (!opts.target) usageError('缺少目标：请提供本地 HTML 文件路径或 http(s) URL');
  if (!opts.out || !String(opts.out).trim()) usageError('--out 不能为空');
  return opts;
}

function parseWidths(value) {
  const parts = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  if (!parts.length) usageError('--widths 不能为空');
  if (parts.length > MAX_WIDTHS) usageError(`--widths 最多 ${MAX_WIDTHS} 个宽度`);
  const widths = [];
  for (const part of parts) {
    const width = Number(part);
    if (!Number.isInteger(width) || width < 200 || width > 3840) {
      usageError(`--widths 里的宽度需要 200–3840 之间的整数（当前：${part}）`);
    }
    if (!widths.includes(width)) widths.push(width);
  }
  return widths;
}

function resolveTarget(input) {
  if (/^https?:\/\//i.test(input)) {
    return { kind: 'url', input, url: input };
  }
  if (/^[a-zA-Z]+:\/\//.test(input) && !/^https?:\/\//i.test(input)) {
    usageError(`只支持本地文件或 http(s) URL（当前：${input}）`);
  }
  const abs = path.resolve(process.cwd(), input);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new CliError(`目标文件不存在：${input}`);
  }
  if (!stat.isFile()) throw new CliError(`目标不是文件：${input}`);
  return { kind: 'file', input, abs, url: pathToFileURL(abs).href };
}

// ---------------------------------------------------------------------------
// Browser discovery (no shelling out: only fs checks, so it works in sandboxes)
// ---------------------------------------------------------------------------

function isExecutableFile(candidate) {
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

function browserCandidates() {
  const env = process.env;
  const candidates = [];
  const push = (value) => { if (value) candidates.push(value); };
  push(env.CHROME_PATH);
  push(env.CHROMIUM_PATH);
  push(env.CHROME_BIN);
  if (env.BROWSER && !/[\s]/.test(env.BROWSER)) push(env.BROWSER);

  if (process.platform === 'win32') {
    const pf = env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = env.LOCALAPPDATA || '';
    push(local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    push(local && path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    push(local && path.join(local, 'Chromium', 'Application', 'chrome.exe'));
    push(path.join(pf, 'Chromium', 'Application', 'chrome.exe'));
    push(local && path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
    push(path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  } else if (process.platform === 'darwin') {
    push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    push('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary');
    push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    push('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
    push(path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
  } else {
    push('/usr/bin/google-chrome');
    push('/usr/bin/google-chrome-stable');
    push('/usr/bin/chromium');
    push('/usr/bin/chromium-browser');
    push('/usr/bin/microsoft-edge');
    push('/usr/bin/microsoft-edge-stable');
    push('/usr/bin/brave-browser');
    push('/snap/bin/chromium');
    push('/usr/local/bin/chromium');
  }

  const names = process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe', 'chromium.exe', 'brave.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser'];
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) push(path.join(dir, name));
  }

  const seen = new Set();
  const found = [];
  for (const candidate of candidates) {
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isExecutableFile(candidate)) found.push(candidate);
  }
  return found;
}

function findBrowser() {
  const found = browserCandidates();
  return { found, used: found.length ? found[0] : null };
}

// ---------------------------------------------------------------------------
// Screenshot attempt
// ---------------------------------------------------------------------------

function isPngFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  } catch {
    return false;
  }
}

function heightForWidth(width, full) {
  if (full) return FULL_HEIGHT;
  if (width <= 480) return 844;
  if (width <= 900) return 1024;
  return DEFAULT_HEIGHT;
}

function failureReason({ spawnError, signal, status, pngExists, pngOk }) {
  if (spawnError) {
    return `浏览器启动失败：${spawnError.code || spawnError.message || String(spawnError)}（沙箱可能拒绝进程管道）`;
  }
  if (signal) return `浏览器进程被 ${signal} 终止（${LAUNCH_TIMEOUT_MS / 1000}s 超时或系统拒绝启动）`;
  if (!pngExists) return `浏览器退出码 ${status == null ? '未知' : status}，但没有生成截图文件（headless 启动可能被沙箱拒绝）`;
  if (!pngOk) return '浏览器写出的文件不是有效 PNG';
  return null;
}

function attemptScreenshots({ browser, target, outDir, widths, full }) {
  const executable = browser.used;
  const results = [];
  const startedAll = Date.now();
  let profileDir = null;
  try {
    profileDir = fs.mkdtempSync(path.join(outDir, '.chrome-profile-'));
  } catch {
    profileDir = path.join(outDir, `.chrome-profile-${Date.now()}`);
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { profileDir = null; }
  }
  try {
    for (const width of widths) {
      const height = heightForWidth(width, full);
      const pngPath = path.join(outDir, `w-${width}.png`);
      try { fs.rmSync(pngPath, { force: true }); } catch { /* ignore */ }
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--mute-audio',
        `--window-size=${width},${height}`,
        `--screenshot=${pngPath}`,
      ];
      if (profileDir) args.push(`--user-data-dir=${profileDir}`);
      args.push(target.url);

      let status = null;
      let signal = null;
      let spawnError = null;
      const started = Date.now();
      try {
        const result = spawnSync(executable, args, {
          stdio: 'ignore',
          windowsHide: true,
          timeout: LAUNCH_TIMEOUT_MS,
        });
        status = result.status;
        signal = result.signal;
        spawnError = result.error || null;
      } catch (err) {
        spawnError = err;
      }
      const ms = Date.now() - started;
      const pngExists = fs.existsSync(pngPath);
      const bytes = pngExists ? fs.statSync(pngPath).size : 0;
      const pngOk = pngExists && bytes > 100 && isPngFile(pngPath);
      if (pngOk) {
        results.push({
          width,
          height,
          path: pngPath,
          bytes,
          ms,
          ok: true,
          exitCode: status,
        });
        continue;
      }
      const reason = failureReason({ spawnError, signal, status, pngExists, pngOk });
      results.push({ width, height, path: pngPath, bytes, ms, ok: false, exitCode: status, error: reason });
      return { results, failure: reason, durationMs: Date.now() - startedAll };
    }
    return { results, failure: null, durationMs: Date.now() - startedAll };
  } finally {
    if (profileDir) {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Degraded output: contact sheet + README.txt
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function widthLabel(width) {
  if (width <= 480) return '手机';
  if (width <= 900) return '平板';
  return '桌面';
}

function iframeSrc(target, outDir) {
  if (target.kind === 'url') return target.url;
  const relative = path.relative(outDir, target.abs) || path.basename(target.abs);
  return encodeURI(relative.split(path.sep).join('/'));
}

const LINT_HINTS = [
  ['gradient-text / glass-decoration / hard-offset-shadow', '先删掉渐变文字、毛玻璃和硬偏移阴影：这三样是模板感最强的装饰。'],
  ['contrast-fail', '正文与背景至少 4.5:1、大字至少 3:1；用 design-tokens.mjs 生成色板并让它自动修正。'],
  ['type-scale-flat / font-family-overload', '字阶至少拉开 1.25 倍，字体族控制在 3 个以内。'],
  ['kicker-eyebrow / nested-card / card-grid-uniform', '去掉标题上方的小标签，别让卡片里再套卡片，别让所有卡片长得一样。'],
  ['img-alt / form-label / html-lang', '图片有 alt、表单有 label、html 有 lang，这三条是底线。'],
  ['cjk-justify / cjk-break-all / cjk-double-punct', '中文正文不要两端对齐、不要 break-all、不要重复标点。'],
];

const REVIEW_CHECKLIST = [
  '首屏第一眼就能说出这一页的论点，而不是先看到导航和三张卡片。',
  '标题、正文、辅助文字三层字号差异一眼可见。',
  '所有按钮、链接、输入框都有 hover / focus-visible / disabled / loading 状态。',
  '键盘 Tab 走一遍，焦点始终可见，且顺序符合视线。',
  '390px 下没有横向滚动，导航和表单可用，触摸目标不小于 44px。',
  '中文与西文之间有空格，标点使用全角中文标点，没有重复标点。',
  '长文本、长标题、空状态、错误状态都真实渲染过，不是占位符。',
  '图片有 alt，纯装饰图片 alt 为空；表单控件都有可见 label。',
  '动画只服务于一个重点，且 prefers-reduced-motion 下有降级。',
  '把页面里的品牌名换成另一个行业，内容是否仍然成立？如果像通用模板，回到方向重新定。',
];

function buildContactSheet({ target, outDir, reason, widths, full, generatedAt, browser }) {
  const src = iframeSrc(target, outDir);
  const frames = widths.map((width) => {
    const height = full ? FULL_HEIGHT : heightForWidth(width, false);
    return `<figure class="frame">
  <figcaption><strong>${width}px</strong> · ${widthLabel(width)}${full ? ' · 高视口近似整页' : ''}</figcaption>
  <div class="viewport">
    <iframe src="${escapeAttr(src)}" width="${width}" height="${height}" title="${width}px 预览" loading="lazy"></iframe>
  </div>
</figure>`;
  }).join('\n');

  const hintItems = LINT_HINTS.map(([rules, text]) => `<li><code>${escapeHtml(rules)}</code><span>${escapeHtml(text)}</span></li>`).join('\n');
  const checklist = REVIEW_CHECKLIST.map((item) => `<label class="check"><input type="checkbox"> <span>${escapeHtml(item)}</span></label>`).join('\n');
  const browserLine = browser.found.length
    ? `发现 ${browser.found.length} 个浏览器可执行文件，但启动失败`
    : '未找到任何 Chrome / Edge / Chromium 可执行文件';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>截图不可用 · 审阅页 · ${escapeHtml(target.input)}</title>
<style>
  :root {
    color-scheme: light dark;
    --paper: #fbfaf7;
    --ink: #1b1a17;
    --muted: #57534a;
    --line: #d8d2c6;
    --surface: #f2eee6;
    --accent: #2f5d50;
    --warn-bg: #fdf1d8;
    --warn-ink: #5e3900;
    --warn-line: #c98a00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #141613;
      --ink: #f1efe8;
      --muted: #b6b2a6;
      --line: #33372f;
      --surface: #1d201c;
      --accent: #8fcbb9;
      --warn-bg: #2a2110;
      --warn-ink: #f4d18a;
      --warn-line: #a97a00;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif; font-size: 16px; line-height: 1.65; color: var(--ink); background: var(--paper); }
  .sheet { max-width: 110rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
  h1 { margin: 0 0 .5rem; font-size: clamp(1.6rem, 1.2rem + 1.5vw, 2.4rem); line-height: 1.2; }
  h2 { margin: 2.5rem 0 .75rem; font-size: 1.35rem; }
  .meta { margin: 0 0 1.5rem; color: var(--muted); font-size: .875rem; word-break: break-all; }
  .banner { padding: 1rem 1.25rem; border: 1px solid var(--warn-line); border-radius: .5rem; background: var(--warn-bg); color: var(--warn-ink); }
  .banner strong { display: block; margin-bottom: .25rem; }
  .banner code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: .875rem; }
  .frames { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 1.5rem; margin-top: 1.5rem; }
  .frame { margin: 0; }
  .frame figcaption { margin-bottom: .5rem; font-size: .875rem; color: var(--muted); }
  .frame figcaption strong { color: var(--ink); }
  .viewport { overflow: auto; max-width: min(100%, 92vw); max-height: 70vh; border: 1px solid var(--line); border-radius: .5rem; background: var(--surface); }
  .viewport iframe { display: block; border: 0; background: #fff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 1.5rem; margin-top: 1rem; }
  .panel { padding: 1.25rem; border: 1px solid var(--line); border-radius: .5rem; background: var(--surface); }
  .panel h3 { margin: 0 0 .75rem; font-size: 1rem; }
  ul.hints { margin: 0; padding-left: 1.1rem; }
  ul.hints li { margin-bottom: .75rem; font-size: .9rem; color: var(--muted); }
  ul.hints code { display: block; margin-bottom: .15rem; color: var(--ink); font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: .8rem; word-break: break-word; }
  .check { display: flex; gap: .6rem; align-items: flex-start; padding: .45rem 0; border-bottom: 1px dashed var(--line); font-size: .9rem; }
  .check:last-child { border-bottom: 0; }
  .check input { margin-top: .35rem; accent-color: var(--accent); }
  .command { overflow: auto; padding: 1rem; border: 1px solid var(--line); border-radius: .5rem; background: var(--paper); font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: .85rem; line-height: 1.6; }
  a { color: var(--accent); }
  footer { margin-top: 2.5rem; color: var(--muted); font-size: .8rem; border-top: 1px solid var(--line); padding-top: 1rem; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
</style>
</head>
<body>
<main class="sheet">
  <header>
    <h1>截图不可用 · 人工审阅页</h1>
    <p class="meta">目标：<code>${escapeHtml(target.input)}</code> · 生成于 ${escapeHtml(generatedAt)} · 期望宽度 ${widths.map((w) => `${w}px`).join(' / ')}</p>
    <div class="banner">
      <strong>没有生成任何截图，这里也不假装有。</strong>
      原因：<code>CAPTURE_UNAVAILABLE: ${escapeHtml(reason)}</code><br>
      ${escapeHtml(browserLine)}。下面的 iframe 只是把目标页按各宽度并排打开，便于你人工审阅布局与断点。
    </div>
  </header>

  <section aria-labelledby="frames-title">
    <h2 id="frames-title">按宽度审阅</h2>
    <div class="frames">
${frames}
    </div>
  </section>

  <section aria-labelledby="checklist-title">
    <h2 id="checklist-title">审阅清单</h2>
    <div class="grid">
      <div class="panel">
        <h3>逐项打勾</h3>
${checklist}
      </div>
      <div class="panel">
        <h3>lint 提示</h3>
        <ul class="hints">
${hintItems}
        </ul>
      </div>
    </div>
  </section>

  <section aria-labelledby="next-title">
    <h2 id="next-title">下一步命令</h2>
    <pre class="command">node ui-craft/scripts/design-lint.mjs ${escapeHtml(target.input)} --json
node ui-craft/scripts/design-tokens.mjs --name design --hue 255 --mode both --out tokens

# 装好 Chrome / Edge 后重新截图：
node ui-craft/scripts/capture.mjs ${escapeHtml(target.input)} --out ${escapeHtml(path.basename(outDir))} --widths ${widths.join(',')}</pre>
  </section>

  <footer>
    本页由 ui-craft/scripts/capture.mjs 生成，可离线打开，不依赖任何外部资源。
    截图未生成的原因已写入同目录 README.txt 与 report.json。
  </footer>
</main>
</body>
</html>
`;
}

function buildReadme({ target, outDir, reason, widths, generatedAt, browser }) {
  const lines = [];
  lines.push('ui-craft · 截图降级说明');
  lines.push('='.repeat(60));
  lines.push(`目标: ${target.input}`);
  lines.push(`输出目录: ${outDir}`);
  lines.push(`生成时间: ${generatedAt}`);
  lines.push(`期望宽度: ${widths.map((w) => `${w}px`).join(' / ')}`);
  lines.push('');
  lines.push('本目录没有保存任何截图。');
  lines.push(`原因: CAPTURE_UNAVAILABLE: ${reason}`);
  lines.push(`浏览器检查结果: ${browser.found.length ? `发现 ${browser.found.length} 个可执行文件但启动失败` : '未找到 Chrome / Edge / Chromium'}`);
  if (browser.used) lines.push(`尝试使用的浏览器: ${browser.used}`);
  lines.push('');
  lines.push('三种可执行的降级做法');
  lines.push('------------------------------------------------------------');
  lines.push('1. 用 contact-sheet.html 做宽度审阅');
  lines.push('   双击打开本目录的 contact-sheet.html。它会按 390 / 768 / 1440px 把目标页并排展示，');
  lines.push('   并附带审阅清单与 lint 提示。照着清单逐项打勾，把问题记录到 issue 或 DESIGN.md。');
  lines.push('');
  lines.push('2. 在本机浏览器里手动截图');
  lines.push('   打开目标页面，用 DevTools 的设备模拟切换宽度（390 / 768 / 1440），');
  lines.push('   把截图保存到本目录，命名为 w-390.png、w-768.png、w-1440.png。');
  lines.push('   然后把 report.json 的 status 改成 "manual" 并记录截图路径，避免其他人误以为脚本截过图。');
  lines.push('');
  lines.push('3. 用静态检查代替视觉检查');
  lines.push(`   运行: node ui-craft/scripts/design-lint.mjs ${target.input} --json`);
  lines.push('   按 error → warn → info 的顺序修复；对比度、字阶、间距交给');
  lines.push('   design-tokens.mjs 重新生成 token，再从 error 数量确认收敛。');
  lines.push('');
  lines.push('如果之后安装了 Chrome 或 Edge，可以直接重跑：');
  lines.push(`  node ui-craft/scripts/capture.mjs ${target.input} --out ${path.basename(outDir)} --widths ${widths.join(',')}`);
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// report.json
// ---------------------------------------------------------------------------

function buildReport({ target, outDir, status, widths, full, browser, attempt, reason, generatedAt, durationMs, fallback }) {
  const screenshots = (attempt && attempt.results ? attempt.results : []).map((result) => ({
    width: result.width,
    height: result.height,
    path: result.path,
    bytes: result.bytes,
    ms: result.ms,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
  }));
  return {
    version: SCHEMA_VERSION,
    generator: 'capture.mjs',
    generatedAt,
    status,
    target: {
      kind: target.kind,
      input: target.input,
      resolved: target.kind === 'url' ? target.url : target.abs,
      url: target.url,
    },
    out: outDir,
    widths,
    full: Boolean(full),
    fullApprox: Boolean(full),
    browser: {
      used: browser.used,
      found: browser.found,
      launchError: reason || null,
    },
    screenshots,
    durationMs,
    reason: reason || null,
    fallback: fallback || null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function safeRelative(fromDir, targetPath) {
  const relative = path.relative(fromDir, targetPath);
  return relative.split(path.sep).join('/');
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const target = resolveTarget(opts.target);
  const outDir = path.resolve(process.cwd(), opts.out);
  fs.mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const browser = findBrowser();
  const startedAll = Date.now();

  let status = 'unavailable';
  let attempt = { results: [], failure: null, durationMs: 0 };
  let reason = null;

  if (browser.used) {
    attempt = attemptScreenshots({ browser, target, outDir, widths: opts.widths, full: opts.full });
    if (!attempt.failure) {
      status = 'ok';
    } else {
      status = attempt.results.some((result) => result.ok) ? 'partial' : 'unavailable';
      reason = attempt.failure;
    }
  } else {
    reason = '未找到本机 Chrome / Edge / Chromium（已检查常见安装路径与 PATH）';
  }

  const durationMs = Date.now() - startedAll;

  if (status === 'ok') {
    const report = buildReport({
      target,
      outDir,
      status,
      widths: opts.widths,
      full: opts.full,
      browser,
      attempt,
      reason: null,
      generatedAt,
      durationMs,
      fallback: null,
    });
    fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const lines = [];
    lines.push(`✔ 截图完成：${attempt.results.length} 张`);
    for (const result of attempt.results) {
      lines.push(`  ${safeRelative(process.cwd(), result.path)}  ${result.width}×${result.height}px  ${result.ms}ms  ${result.bytes}B`);
    }
    if (opts.full) lines.push('  提示：--full 用高视口近似整页截图，超长页面可能被截断（report.json 里 fullApprox=true）。');
    lines.push(`  ${safeRelative(process.cwd(), path.join(outDir, 'report.json'))}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }

  // Degraded path: always produce the contact sheet, README.txt and report.json.
  const contactSheetPath = path.join(outDir, 'contact-sheet.html');
  const readmePath = path.join(outDir, 'README.txt');
  fs.writeFileSync(contactSheetPath, buildContactSheet({
    target,
    outDir,
    reason,
    widths: opts.widths,
    full: opts.full,
    generatedAt,
    browser,
  }), 'utf8');
  fs.writeFileSync(readmePath, buildReadme({
    target,
    outDir,
    reason,
    widths: opts.widths,
    generatedAt,
    browser,
  }), 'utf8');
  const report = buildReport({
    target,
    outDir,
    status,
    widths: opts.widths,
    full: opts.full,
    browser,
    attempt,
    reason,
    generatedAt,
    durationMs,
    fallback: {
      contactSheet: safeRelative(process.cwd(), contactSheetPath),
      readme: safeRelative(process.cwd(), readmePath),
      screenshots: attempt.results.filter((result) => result.ok).map((result) => safeRelative(process.cwd(), result.path)),
    },
  });
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [];
  lines.push(`CAPTURE_UNAVAILABLE: ${reason}`);
  lines.push(`  审阅页: ${safeRelative(process.cwd(), contactSheetPath)}（${opts.widths.join(' / ')}px 并排 + 审阅清单 + lint 提示）`);
  lines.push(`  说明:   ${safeRelative(process.cwd(), readmePath)}（三条降级做法）`);
  lines.push(`  记录:   ${safeRelative(process.cwd(), path.join(outDir, 'report.json'))}（status: ${status}，没有生成截图）`);
  lines.push('  三条降级做法：');
  lines.push('  1. 打开 contact-sheet.html，按各宽度人工审阅并对照清单打勾。');
  lines.push('  2. 在本机浏览器用 DevTools 设备模式手动截图，保存为 w-<width>.png。');
  lines.push('  3. 用 design-lint.mjs 做静态检查，按 error → warn → info 修复，再用 design-tokens.mjs 重生成 token。');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 3;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliError) {
    process.stderr.write(`[capture] 错误：${err.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`[capture] 内部错误：${err && err.stack ? err.stack : String(err)}\n`);
    process.exitCode = 2;
  }
}
