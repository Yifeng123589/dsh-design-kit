import { runProcessAsync } from './process.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCwdResolver } from './cwd.js';
import { guardOptionalWorkspacePath, guardWorkspacePath } from './path-guard.js';
import { jsonOutput } from './tool-output.js';

const DEFAULT_DECK_TIMEOUT_MS = 180_000;

function deckDir() {
  return fileURLToPath(new URL('../skills/design-kit/deck/', import.meta.url));
}

function clampTimeout(value) {
  if (!Number.isFinite(value)) return DEFAULT_DECK_TIMEOUT_MS;
  return Math.min(600_000, Math.max(5_000, Math.trunc(value)));
}

function resolvePath(value, cwd) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** ppt-master 技能根：必须同时有 checker 与 exporter。 */
export function isPptMasterDir(dir) {
  return (
    typeof dir === 'string' &&
    dir !== '' &&
    existsSync(join(dir, 'scripts', 'svg_quality_checker.py')) &&
    existsSync(join(dir, 'scripts', 'svg_to_pptx.py'))
  );
}

/** 在 base 下按常见布局枚举 ppt-master，不写死某一个解压目录名。 */
function addPptMasterCandidates(out, base) {
  const push = (dir) => {
    if (typeof dir === 'string' && dir !== '') out.push(dir);
  };
  push(join(base, 'skills', 'ppt-master'));
  push(join(base, 'ppt-master'));
  const sources = join(base, '_sources');
  let entries = [];
  try {
    entries = readdirSync(sources, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return;
  }
  for (const entry of entries) {
    push(join(sources, entry, 'skills', 'ppt-master'));
    push(join(sources, entry, 'ppt-master'));
    let nested = [];
    try {
      nested = readdirSync(join(sources, entry), { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name);
    } catch {
      continue;
    }
    for (const inner of nested) {
      push(join(sources, entry, inner, 'skills', 'ppt-master'));
    }
  }
}

/** 找 ppt-master：显式配置 / 环境变量优先（配错就返回 null，不偷偷换目录）→ 工作区常见布局。 */
export function resolvePptMasterDir(config = {}, env = process.env, cwd = process.cwd()) {
  const explicit = [
    config.pptMasterDir,
    env.PPT_MASTER_DIR,
    env.PPT_MASTER_SKILL_DIR,
    env.DSH_PPT_MASTER_DIR,
  ].filter((value) => typeof value === 'string' && value.trim() !== '');
  if (explicit.length > 0) {
    const dir = resolvePath(explicit[0], cwd);
    return dir && isPptMasterDir(dir) ? dir : null;
  }

  const candidates = [];
  const bases = [cwd, resolve(cwd, '..'), resolve(cwd, '..', '..')];
  if (env.DSH_SKILLS_DIR) bases.push(env.DSH_SKILLS_DIR);
  if (env.DSH_HOME) bases.push(join(env.DSH_HOME, 'skills'));
  for (const base of bases) addPptMasterCandidates(candidates, base);
  for (const dir of candidates) {
    if (isPptMasterDir(dir)) return dir;
  }
  return null;
}

/** Python 候选：显式 → 环境变量 → DSH bundled runtime → PATH。 */
export function pythonCandidates(config = {}, env = process.env, platform = process.platform) {
  const out = [];
  const seen = new Set();
  const add = (command, source, prefixArgs = []) => {
    if (typeof command !== 'string' || command.trim() === '') return;
    const key = command + ' ' + prefixArgs.join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ command, prefixArgs, source });
  };

  add(config.pythonPath, 'config.pythonPath');
  add(env.DSH_PYTHON, 'env.DSH_PYTHON');
  add(env.PPT_MASTER_PYTHON, 'env.PPT_MASTER_PYTHON');
  add(env.PYTHON, 'env.PYTHON');

  const dshHome = env.DSH_HOME || join(homedir(), '.dsh');
  const runtimeRoots = [join(dshHome, 'dsh-runtimes'), join(dshHome, 'runtimes')];
  for (const runtimes of runtimeRoots) {
    try {
      for (const id of readdirSync(runtimes)) {
        const py = join(
          runtimes,
          id,
          'dependencies',
          'python',
          platform === 'win32' ? 'python.exe' : join('bin', 'python3'),
        );
        if (existsSync(py)) add(py, 'dsh-runtime:' + id);
      }
    } catch {
      // 没有该 runtime 目录就继续下一个
    }
  }

  add('python3', 'PATH');
  add('python', 'PATH');
  if (platform === 'win32') add('py', 'PATH', ['-3']);
  return out;
}

/** LibreOffice Kit CLI（dsoffice）：显式 → 环境变量 → DSH 安装目录推导 → PATH。 */
export function resolveRenderer(config = {}, env = process.env, execPath = process.execPath) {
  const explicit = [
    config.rendererCli,
    env.DSO_OFFICE_CLI,
    env.DECK_RENDERER_CLI,
    env.LIBREOFFICE_KIT_CLI,
    env.DSH_LIBREOFFICE_KIT_CLI,
  ].filter((value) => typeof value === 'string' && value.trim() !== '');
  for (const value of explicit) {
    if (existsSync(value)) {
      // 显式值可能是 dsoffice 的 cli.js，也可能是原生可执行文件；只把 JS 交给 node。
      const isNodeScript = /\.(?:c|m)?js$/i.test(value);
      return isNodeScript
        ? { command: process.execPath, prefixArgs: [value], source: 'config' }
        : { command: value, prefixArgs: [], source: 'config' };
    }
    return { command: value, prefixArgs: [], source: 'config' };
  }

  // 先看 App 自带资源目录（可用 DSH_APP_ROOT / DSH_RESOURCES_DIR 覆盖），再退到安装布局与 PATH。
  const appRoots = [env.DSH_APP_ROOT, env.DSH_RESOURCES_DIR, dirname(execPath)].filter(
    (value) => typeof value === 'string' && value !== '',
  );
  const derived = [];
  for (const root of appRoots) {
    derived.push(
      join(root, 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'),
      join(root, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'),
      join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'),
    );
  }
  if (env.LOCALAPPDATA) {
    derived.push(
      join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'),
    );
  }
  if (env.ProgramFiles) {
    derived.push(
      join(env.ProgramFiles, 'DeepSeek Harness', 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'),
    );
  }
  for (const cli of derived) {
    if (existsSync(cli)) return { command: process.execPath, prefixArgs: [cli], source: 'dsh-install' };
  }

  return { command: 'dsoffice', prefixArgs: [], source: 'PATH' };
}

async function runProcess(command, args, { cwd, timeoutMs, env } = {}) {
  return runProcessAsync(command, args, {
    cwd: cwd ?? process.cwd(),
    timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
}

function tail(text, limit) {
  const value = String(text ?? '').trim();
  return value.length > limit ? value.slice(-limit) : value;
}

/** A9：结构化依赖缺口，便于机读 + 中文可读。 */
function missingDependency(kind, hint, extra = {}) {
  return { kind, hint, ...extra };
}

function failMissing(error, missing) {
  return { ok: false, error, missing };
}

function parseLastJson(text) {
  const source = String(text ?? '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

function uniquePath(dir, base, ext) {
  let candidate = join(dir, base + ext);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, base + '-' + index + ext);
    index += 1;
  }
  return candidate;
}

function newestPptx(dir, sinceMs = 0) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.pptx') && !name.startsWith('.tmp'))
      .map((name) => join(dir, name))
      .filter((path) => {
        try {
          return statSync(path).mtimeMs >= sinceMs;
        } catch {
          return false;
        }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
  } catch {
    return null;
  }
}

async function runPython(candidates, scriptPath, scriptArgs, options) {
  const failures = [];
  for (const candidate of candidates) {
    const run = await runProcess(candidate.command, [...candidate.prefixArgs, scriptPath, ...scriptArgs], options);
    if (run.spawnError) {
      failures.push(candidate.source + ': ' + run.spawnError);
      continue;
    }
    return { candidate, run };
  }
  return { failures };
}


/** 把 checker 的 report JSON 收敛成稳定的返回结构（供 deck_check 与测试用）。 */
export function summarizeCheckerReport(report) {
  const summary = report?.summary ?? null;
  const fileErrors = Array.isArray(report?.files)
    ? report.files
        .filter((file) => Array.isArray(file.errors) && file.errors.length > 0)
        .map((file) => ({ file: file.file, errors: file.errors }))
    : [];
  return { summary, errors: fileErrors };
}

function buildDeckCheckTool(config, ctx = null) {
  const baseTimeout = clampTimeout(Number(config.deckTimeoutMs));
  const getCwd = createCwdResolver(ctx);
  return {
    name: 'deck_check',
    description:
      '对 ppt-master 项目做最终质检：跑 svg_quality_checker.py（Quick / canonical / stage final），返回通过数、warning/error 计数、错误清单与报告路径。0 error 才能继续导出。需要 ppt-master 技能目录（config.pptMasterDir 或 env PPT_MASTER_DIR）与可用的 Python；找不到时返回中文原因，不抛异常。中文：SVG deck 质检。',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'ppt-master 项目目录（含 svg_output/），相对会话 cwd 或绝对路径。' },
        pptMasterDir: { type: 'string', description: '可选：ppt-master 技能根目录（含 scripts/），默认按配置/环境/工作区推导。' },
        pythonPath: { type: 'string', description: '可选：python 可执行文件，默认自动发现。' },
        timeoutMs: { type: 'integer', description: '可选：超时毫秒，默认 180000。' },
      },
      required: ['project'],
    },
    output: jsonOutput(),
    async execute(args, exec) {
      const cwd = getCwd(exec);
      const guarded = guardWorkspacePath(cwd, args?.project, { label: 'project' });
      if (!guarded.ok) return guarded;
      const project = guarded.path;
      if (!isDirectory(project)) {
        return { ok: false, error: '缺少有效的 project 目录：' + JSON.stringify(args?.project) };
      }
      if (!isDirectory(join(project, 'svg_output'))) {
        return { ok: false, error: 'project 下没有 svg_output/：' + project };
      }
      const master = resolvePptMasterDir(
        { ...config, pptMasterDir: args?.pptMasterDir ?? config.pptMasterDir },
        process.env,
        cwd,
      );
      if (master === null) {
        return failMissing(
          '找不到 ppt-master 技能目录。设置 config.pptMasterDir 或 env PPT_MASTER_DIR 指向含 scripts/svg_quality_checker.py 的 skills/ppt-master。',
          [
            missingDependency('ppt-master', '配置 config.pptMasterDir 或 env PPT_MASTER_DIR，指向含 scripts/svg_quality_checker.py 的目录', {
              configKey: 'pptMasterDir',
              env: 'PPT_MASTER_DIR',
            }),
          ],
        );
      }
      const candidates = pythonCandidates({ ...config, pythonPath: args?.pythonPath ?? config.pythonPath });
      const checker = join(master, 'scripts', 'svg_quality_checker.py');
      const result = await runPython(
        candidates,
        checker,
        [project, '--quick-generate', '--canonical-authoring', '--stage', 'final', '--json'],
        { cwd, timeoutMs: clampTimeout(Number(args?.timeoutMs) || baseTimeout) },
      );
      if (result.failures) {
        return failMissing(
          'Python 启动失败（可能未安装或被沙箱 EPERM 拒绝；尝试：' + result.failures.join(' | ') + '；若在沙箱中运行，子进程可能被拒绝）',
          [
            missingDependency('python', '配置 pythonPath，或安装能 import pptx 的 Python', {
              attempts: result.failures,
            }),
          ],
        );
      }
      const run = result.run;
      const reportPath = join(project, 'validation', 'svg_quality_report.json');
      let report = null;
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'));
      } catch {
        report = parseLastJson(run.stdout);
      }
      const summary = report?.summary ?? null;
      const fileErrors = summarizeCheckerReport(report).errors;
      return {
        ok: run.exitCode === 0 && (summary === null || (summary.errors ?? 0) === 0),
        exitCode: run.exitCode,
        timedOut: run.timedOut === true,
        project,
        pptMasterDir: master,
        python: result.candidate.source,
        summary,
        errors: fileErrors,
        reportPath: existsSync(reportPath) ? reportPath : null,
        stderr: tail(run.stderr, 4000),
        stdoutTail: tail(run.stdout, 4000),
      };
    },
  };
}

function buildDeckExportTool(config, ctx = null) {
  const baseTimeout = clampTimeout(Number(config.deckTimeoutMs));
  const getCwd = createCwdResolver(ctx);
  return {
    name: 'deck_export',
    description:
      '把 ppt-master 项目的 svg_output/ 导出成可编辑 PPTX（Native DrawingML）：调用随插件的 export_shim.py（替换上游在沙箱下会失败的临时目录创建逻辑，其余保持上游），导出后返回 pptxPath、大小、页数与 postflight 状态。需要 ppt-master 技能目录与 Python。中文：SVG 页面导出 PPTX。',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'ppt-master 项目目录（含 svg_output/）。' },
        out: { type: 'string', description: '可选：导出输出路径（透传 -o），默认项目 exports/。' },
        pptMasterDir: { type: 'string', description: '可选：ppt-master 技能根目录。' },
        pythonPath: { type: 'string', description: '可选：python 可执行文件。' },
        timeoutMs: { type: 'integer', description: '可选：超时毫秒，默认 180000。' },
      },
      required: ['project'],
    },
    output: jsonOutput(),
    async execute(args, exec) {
      const cwd = getCwd(exec);
      const guarded = guardWorkspacePath(cwd, args?.project, { label: 'project' });
      if (!guarded.ok) return guarded;
      const project = guarded.path;
      if (!isDirectory(project)) {
        return { ok: false, error: '缺少有效的 project 目录：' + JSON.stringify(args?.project) };
      }
      if (!isDirectory(join(project, 'svg_output'))) {
        return { ok: false, error: 'project 下没有 svg_output/：' + project };
      }
      const outGuard = guardOptionalWorkspacePath(cwd, args?.out, { label: 'out' });
      if (!outGuard.ok) return outGuard;
      const out = outGuard.path || null;
      if (out !== null && existsSync(out)) {
        return {
          ok: false,
          error: '输出路径已存在，拒绝覆盖：' + out + '。换一个 out，或先移走原文件。',
        };
      }
      const master = resolvePptMasterDir(
        { ...config, pptMasterDir: args?.pptMasterDir ?? config.pptMasterDir },
        process.env,
        cwd,
      );
      if (master === null) {
        return failMissing('找不到 ppt-master 技能目录（config.pptMasterDir / env PPT_MASTER_DIR）。', [
          missingDependency('ppt-master', '配置 config.pptMasterDir 或 env PPT_MASTER_DIR', {
            configKey: 'pptMasterDir',
            env: 'PPT_MASTER_DIR',
          }),
        ]);
      }
      const shim = join(deckDir(), 'export_shim.py');
      if (!existsSync(shim)) {
        return failMissing('插件缺少 deck/export_shim.py，请重新安装。', [
          missingDependency('deck-shim', '重新安装 dsh-design-kit（缺少 deck/export_shim.py）', {
            path: shim,
          }),
        ]);
      }
      const candidates = pythonCandidates({ ...config, pythonPath: args?.pythonPath ?? config.pythonPath });
      const cli = [project, '--quick-generate', '--no-notes'];
      if (out !== null) cli.push('-o', out);
      const startedAt = Date.now() - 2000;
      const result = await runPython(candidates, shim, cli, {
        cwd,
        timeoutMs: clampTimeout(Number(args?.timeoutMs) || baseTimeout),
        env: { PPT_MASTER_DIR: master },
      });
      if (result.failures) {
        return failMissing(
          'Python 启动失败（可能未安装或被沙箱 EPERM 拒绝；尝试：' + result.failures.join(' | ') + '；若在沙箱中运行，子进程可能被拒绝）',
          [
            missingDependency('python', '配置 pythonPath，或安装能 import pptx 的 Python', {
              attempts: result.failures,
            }),
          ],
        );
      }
      const run = result.run;
      const stdout = run.stdout + '\n' + run.stderr;
      const match = /\[PPTX\]\s+(.+\.pptx)\s*$/m.exec(stdout);
      let pptxPath = match ? match[1].trim() : null;
      if (pptxPath === null) pptxPath = newestPptx(join(project, 'exports'), startedAt);
      if (pptxPath === null) pptxPath = newestPptx(join(project, 'exports'));
      const slidesMatch = /Slides:\s*(\d+)/.exec(stdout);
      const postflight = /\[POSTFLIGHT\]\s+status=([^\s]+)\s+quality_gate=([^\s]+)/.exec(stdout);
      return {
        ok: run.exitCode === 0 && pptxPath !== null,
        exitCode: run.exitCode,
        timedOut: run.timedOut === true,
        project,
        pptxPath,
        bytes: pptxPath && existsSync(pptxPath) ? statSync(pptxPath).size : null,
        slides: slidesMatch ? Number(slidesMatch[1]) : null,
        postflight: postflight ? { status: postflight[1], qualityGate: postflight[2] } : null,
        pptMasterDir: master,
        python: result.candidate.source,
        stderr: tail(run.stderr, 5000),
        stdoutTail: tail(run.stdout, 5000),
      };
    },
  };
}

function buildDeckRenderTool(config, ctx = null) {
  const baseTimeout = clampTimeout(Number(config.deckTimeoutMs));
  const getCwd = createCwdResolver(ctx);
  return {
    name: 'deck_render',
    description:
      '用 DSH 自带的 LibreOffice Kit（dsoffice）把 PPTX 渲染成 PDF + 逐页 PNG，返回文件路径、页数、图片清单与缺失字体。用于交付前逐页目检；渲染失败/找不到渲染器时返回中文原因，不声称看过。中文：PPTX 渲染 PDF/PNG。',
    parameters: {
      type: 'object',
      properties: {
        pptx: { type: 'string', description: '要渲染的 .pptx 文件，相对会话 cwd 或绝对路径。' },
        outDir: { type: 'string', description: '输出目录，默认 <会话 cwd>/deck-render。' },
        rendererCli: { type: 'string', description: '可选：dsoffice CLI 路径，默认自动发现。' },
        timeoutMs: { type: 'integer', description: '可选：超时毫秒，默认 180000。' },
      },
      required: ['pptx'],
    },
    output: jsonOutput(),
    async execute(args, exec) {
      const cwd = getCwd(exec);
      if (typeof args?.pptx !== 'string' || args.pptx.trim() === '') {
        return { ok: false, error: '缺少有效的 .pptx 文件：需要 pptx 参数。' };
      }
      const guarded = guardWorkspacePath(cwd, args?.pptx, { label: 'pptx' });
      if (!guarded.ok) return guarded;
      const pptx = guarded.path;
      if (!existsSync(pptx) || !pptx.toLowerCase().endsWith('.pptx')) {
        return { ok: false, error: '缺少有效的 .pptx 文件：' + JSON.stringify(args?.pptx) };
      }
      const outGuard = guardOptionalWorkspacePath(cwd, args?.outDir, { label: 'outDir' });
      if (!outGuard.ok) return outGuard;
      const outDir = outGuard.path ?? join(cwd, 'deck-render');
      mkdirSync(outDir, { recursive: true });
      const renderer = resolveRenderer({ ...config, rendererCli: args?.rendererCli ?? config.rendererCli });
      const timeoutMs = clampTimeout(Number(args?.timeoutMs) || baseTimeout);
      const base = basename(pptx, '.pptx');
      const pdfPath = uniquePath(outDir, base, '.pdf');
      const convert = await runProcess(renderer.command, [...renderer.prefixArgs, 'convert', '--input', pptx, '--output', pdfPath], {
        cwd,
        timeoutMs,
      });
      if (convert.spawnError) {
        return {
          ok: false,
          exitCode: convert.exitCode,
          error: 'LibreOffice Kit 渲染器启动失败（' + renderer.command + '）：' + convert.spawnError + '；若在沙箱中运行，子进程可能被拒绝。可用 config.rendererCli / env DSO_OFFICE_CLI 指定 dsoffice。',
          renderer: renderer.source,
          missing: [
            missingDependency('libreoffice', '安装 DSH 自带 LibreOffice Kit，或配置 rendererCli / env DSO_OFFICE_CLI 指向 cli.js', {
              configKey: 'rendererCli',
              env: 'DSO_OFFICE_CLI',
              command: renderer.command,
            }),
          ],
        };
      }
      const convertJson = parseLastJson(convert.stdout + convert.stderr);
      if (convert.exitCode !== 0 || !existsSync(pdfPath)) {
        return {
          ok: false,
          exitCode: convert.exitCode,
          error: 'PDF 渲染失败。',
          renderer: renderer.source,
          stderr: tail(convert.stderr, 5000),
          stdoutTail: tail(convert.stdout, 5000),
        };
      }
      const pagesDir = uniquePath(outDir, base + '-pages', '');
      const render = await runProcess(renderer.command, [...renderer.prefixArgs, 'render', '--input', pptx, '--output-dir', pagesDir], {
        cwd,
        timeoutMs,
      });
      const renderJson = parseLastJson(render.stdout + render.stderr);
      const images = Array.isArray(renderJson?.images) ? renderJson.images : [];
      const missingFonts = [
        ...new Set([...(convertJson?.missingFonts ?? []), ...(renderJson?.missingFonts ?? [])]),
      ];
      if (render.spawnError || render.exitCode !== 0 || images.length === 0) {
        return {
          ok: false,
          exitCode: render.exitCode,
          timedOut: render.timedOut === true,
          error:
            'PNG 渲染失败（PDF 已生成）：' +
            (render.spawnError ? render.spawnError : 'render 退出码 ' + render.exitCode + ' 或没有图片') +
            '；若在沙箱中运行，子进程可能被拒绝。',
          ...(render.spawnError
            ? {
                missing: [
                  missingDependency('libreoffice', '安装 DSH 自带 LibreOffice Kit，或配置 rendererCli / env DSO_OFFICE_CLI 指向 cli.js', {
                    configKey: 'rendererCli',
                    env: 'DSO_OFFICE_CLI',
                    command: renderer.command,
                  }),
                ],
              }
            : {}),
          pptx,
          outDir,
          pdfPath,
          pagesDir,
          missingFonts,
          renderer: renderer.source,
          stderr: tail(render.stderr, 5000),
          stdoutTail: tail(render.stdout, 4000),
        };
      }
      return {
        ok: convert.exitCode === 0 && render.exitCode === 0 && images.length > 0,
        exitCode: render.exitCode,
        timedOut: render.timedOut === true || convert.timedOut === true,
        pptx,
        outDir,
        pdfPath,
        pagesDir,
        pageCount: renderJson?.pageCount ?? images.length,
        images,
        missingFonts,
        renderer: renderer.source,
        backend: renderJson?.backend ?? convertJson?.backend ?? null,
        stderr: tail(render.stderr || convert.stderr, 5000),
        stdoutTail: tail(render.stdout || convert.stdout, 4000),
      };
    },
  };
}

/** deck_check / deck_export / deck_render。 */
export function buildDeckTools(config = {}, ctx = null) {
  return [buildDeckCheckTool(config, ctx), buildDeckExportTool(config, ctx), buildDeckRenderTool(config, ctx)];
}

export const DECK_TOOL_NAMES = ['deck_check', 'deck_export', 'deck_render'];
