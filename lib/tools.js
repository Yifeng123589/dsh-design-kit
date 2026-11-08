import { runProcessAsync } from './process.js';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';

import { buildDeckTools, DECK_TOOL_NAMES } from './deck.js';
import { createCwdResolver } from './cwd.js';
import { jsonOutput } from './tool-output.js';
import { buildShortlistUiTools, SHORTLIST_UI_TOOL_NAMES } from './shortlist-ui.js';
import { guardOptionalWorkspacePath, guardProbeArgs, guardWorkspacePath } from './path-guard.js';
import { markMeasure, markShortlist, unfinishedShortlist } from './state.js';

const DEFAULT_DESIGN_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 120_000;
export const JSON_OUTPUT_MARKER = '__DESIGN_KIT_JSON__';

/** 随包分发的统一技能目录。 */
function skillDir() {
  return fileURLToPath(new URL('../skills/design-kit/', import.meta.url));
}

/** ui-craft 的零依赖脚本。 */
function scriptsDir() {
  return join(skillDir(), 'ui-craft', 'scripts');
}

/** 随包分发的 probe-kit 实现。 */
function kitDir() {
  return join(skillDir(), 'probe-kit');
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function designTimeout(config) {
  const raw = Number(config.designTimeoutMs ?? config.timeoutMs);
  return clamp(raw, 1_000, 120_000, DEFAULT_DESIGN_TIMEOUT_MS);
}

function probeTimeout(config) {
  const raw = Number(config.probeTimeoutMs ?? config.timeoutMs);
  return clamp(raw, 1_000, 300_000, DEFAULT_PROBE_TIMEOUT_MS);
}

/** 以当前 Node 可执行文件运行技能脚本，捕获 stdout/stderr，绝不抛异常。 */
async function runNode(scriptPath, args, { cwd, timeoutMs } = {}) {
  return runProcessAsync(process.execPath, [scriptPath, ...args], {
    cwd: cwd ?? process.cwd(),
    timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function runDesignScript(scriptName, args, options) {
  return runNode(join(scriptsDir(), scriptName), args, options);
}

function runProbeScript(scriptName, args, options) {
  return runNode(join(kitDir(), scriptName), args, options);
}

function parseJsonOutput(stdout) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // A7：只认显式标记行或「最后一行纯 JSON」；不再用首个 { 到末尾 } 硬切。
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const candidate = line.startsWith(JSON_OUTPUT_MARKER)
      ? line.slice(JSON_OUTPUT_MARKER.length).trim()
      : index === lines.length - 1
        ? line
        : null;
    if (candidate === null || !candidate.startsWith('{')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // 标记行/最后一行不是合法 JSON 就返回 null，避免把日志片段误当报告
      return null;
    }
  }
  return null;
}

function resolveTarget(value, cwd) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return isAbsolute(value) ? value : resolve(cwd ?? process.cwd(), value);
}

function packProbe(command, run, hint) {
  const stdout = run.stdout.trim();
  const stderr = run.stderr.trim();
  const ok = run.exitCode === 0 && run.spawnError === null;
  const out = {
    ok,
    command,
    exitCode: run.exitCode,
    stdout: stdout.length > 12_000 ? stdout.slice(-12_000) : stdout,
    stderr: stderr.length > 4_000 ? stderr.slice(-4_000) : stderr,
    timedOut: run.timedOut === true,
  };
  if (run.spawnError) out.error = '脚本启动失败：' + run.spawnError;
  else if (!ok) out.hint = hint;
  return out;
}

function need(value, name, command) {
  if (typeof value !== 'string' || value.trim() === '') {
    return `probe_shortlist ${command} 需要参数 ${name}（路径或值）。`;
  }
  return null;
}

function buildDesignTools(config, ctx = null) {
  const timeoutMs = designTimeout(config);
  const getCwd = createCwdResolver(ctx);

  const tools = [
    {
      name: 'design_lint',
      description:
        '静态审查前端代码的界面质量：AI 味（渐变文字、玻璃装饰、等大卡片堆砌、kicker 行、嵌套卡片、emoji 当图标等）、对比度、字号与排版、可访问性、中文排版。零依赖，扫描 html/css/jsx/tsx/vue/svelte。返回 findings、计数与分数；有 error 时退出码为 1，属正常结果不是工具失败。中文：跑设计审查，拿可执行的修复清单。',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: '要检查的文件或目录，相对会话工作目录或绝对路径。',
          },
          minSeverity: {
            type: 'string',
            enum: ['info', 'warn', 'error'],
            description: '最低报告级别，默认 info（全报）。',
          },
        },
        required: ['target'],
      },
      output: jsonOutput(),
      async execute(args, exec) {
        const cwd = getCwd(exec);
        const guarded = guardWorkspacePath(cwd, args?.target, { label: 'target' });
        if (!guarded.ok) return guarded;
        const target = guarded.path;
        const cliArgs = [target, '--json'];
        if (args?.minSeverity) cliArgs.push('--min-severity', String(args.minSeverity));
        const run = await runDesignScript('design-lint.mjs', cliArgs, { cwd, timeoutMs });
        const report = parseJsonOutput(run.stdout);
        if (report === null) {
          return {
            ok: false,
            error: 'design-lint 没有返回可解析的 JSON。',
            exitCode: run.exitCode,
            stderr: run.stderr.slice(0, 4000),
            stdoutTail: run.stdout.slice(-4000),
          };
        }
        return {
          ok: run.exitCode === 0 || run.exitCode === 1,
          exitCode: run.exitCode,
          target,
          timedOut: run.timedOut === true,
          counts: report.counts ?? null,
          score: report.score ?? null,
          findings: Array.isArray(report.findings) ? report.findings : [],
          scanned: Array.isArray(report.scanned) ? report.scanned : [],
        };
      },
    },
    {
      name: 'design_tokens',
      description:
        '从色相、彩度与情绪生成一整套设计 token：OKLCH 语义色板（含暗色）、clamp 字阶、4px 间距、圆角、阴影、动效变量，输出 tokens.css / tokens.json / tokens-preview.html，并自动做 WCAG AA 对比度自检与明度修正。用于把设计决定变成可测量的单一来源。中文：生成设计 token 与对比度自检。',
      parameters: {
        type: 'object',
        properties: {
          outDir: {
            type: 'string',
            description: '输出目录，相对会话工作目录或绝对路径。',
          },
          name: { type: 'string', description: '项目 slug，用于 HTML 预览标题，可选。' },
          hue: { type: 'integer', description: '强调色色相 0-360。' },
          chroma: { type: 'number', description: '强调色彩度 0-0.37，默认按情绪取值。' },
          mood: {
            type: 'string',
            enum: ['calm', 'bold', 'warm', 'cool', 'editorial', 'tech'],
            description: '情绪预设，影响中性色色相偏移、圆角与字阶锐度。',
          },
          mode: {
            type: 'string',
            enum: ['light', 'dark', 'both'],
            description: '明暗模式，默认 both。',
          },
          from: { type: 'string', description: '从品牌色 #hex 反推色相与彩度，给出时覆盖 hue/chroma。' },
        },
        required: ['outDir'],
      },
      output: jsonOutput(),
      async execute(args, exec) {
        const cwd = getCwd(exec);
        const guarded = guardWorkspacePath(cwd, args?.outDir, { label: 'outDir' });
        if (!guarded.ok) return guarded;
        const outDir = guarded.path;
        const cliArgs = ['--out', outDir];
        if (args?.name) cliArgs.push('--name', String(args.name));
        if (Number.isFinite(args?.hue)) cliArgs.push('--hue', String(Math.trunc(args.hue)));
        if (Number.isFinite(args?.chroma)) cliArgs.push('--chroma', String(args.chroma));
        if (args?.mood) cliArgs.push('--mood', String(args.mood));
        if (args?.mode) cliArgs.push('--mode', String(args.mode));
        if (args?.from) cliArgs.push('--from', String(args.from));
        const run = await runDesignScript('design-tokens.mjs', cliArgs, { cwd, timeoutMs });
        const out = {
          ok: run.exitCode === 0,
          exitCode: run.exitCode,
          outDir,
          timedOut: run.timedOut === true,
          files: ['tokens.css', 'tokens.json', 'tokens-preview.html'].map((file) => join(outDir, file)),
          stdoutTail: run.stdout.slice(-4000),
          stderrTail: run.stderr.slice(-4000),
        };
        if (run.exitCode !== 0) out.error = 'design-tokens 退出码 ' + run.exitCode + '，见 stderr。';
        return out;
      },
    },
    {
      name: 'design_capture',
      description:
        '对本地 HTML 或 URL 做多宽度截图（默认 390/768/1440），用于界面视觉审阅。本机没有可用浏览器或浏览器无法启动时不会失败，会生成 contact-sheet.html 审阅页并返回 unavailable=true（退出码 3），绝不假装截图成功。中文：多宽度截图或生成审阅页。',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'HTML 文件路径或 http(s) URL，相对会话工作目录或绝对路径。',
          },
          outDir: { type: 'string', description: '截图与报告输出目录。' },
          widths: { type: 'string', description: '逗号分隔宽度，默认 390,768,1440。' },
          full: { type: 'boolean', description: '是否整页截图，默认仅视口。' },
        },
        required: ['target', 'outDir'],
      },
      output: jsonOutput(),
      async execute(args, exec) {
        const cwd = getCwd(exec);
        const targetGuard = guardWorkspacePath(cwd, args?.target, { label: 'target', allowUrl: true });
        if (!targetGuard.ok) return targetGuard;
        const outGuard = guardWorkspacePath(cwd, args?.outDir, { label: 'outDir' });
        if (!outGuard.ok) return outGuard;
        const target = targetGuard.path;
        const outDir = outGuard.path;
        const cliArgs = [target, '--out', outDir];
        if (args?.widths) cliArgs.push('--widths', String(args.widths));
        if (args?.full === true) cliArgs.push('--full');
        const run = await runDesignScript('capture.mjs', cliArgs, { cwd, timeoutMs });
        const unavailable = /CAPTURE_UNAVAILABLE/.test(run.stdout + run.stderr);
        return {
          ok: run.exitCode === 0,
          exitCode: run.exitCode,
          unavailable,
          timedOut: run.timedOut === true,
          target,
          outDir,
          stdoutTail: run.stdout.slice(-4000),
          stderrTail: run.stderr.slice(-4000),
          note: unavailable
            ? '当前环境无法截图。用 outDir 里的 contact-sheet.html 请用户确认，并明确说明未查看渲染结果。'
            : undefined,
        };
      },
    },
  ];

  return tools;
}

/** 判断 args 是否已经带了某个 CLI flag（支持 `--flag value` 与 `--flag=value` 两种写法）。 */
export function hasInlineOption(options, flag) {
  return options.some((item) => item === flag || item.startsWith(flag + '='));
}

/** probe_measure 的 argv 组装：补默认 out/ledger，但不覆盖调用方显式传入的值。 */
export function buildProbeMeasureArgv(command, extra, cwd, configuredLedger) {
  const cli = [command, ...extra];
  if ((command === 'demo' || command === 'build') && !hasInlineOption(extra, '--out')) {
    cli.push('--out', join(cwd, 'runs'));
  }
  if (!hasInlineOption(extra, '--ledger')) {
    cli.push('--ledger', configuredLedger ?? join(cwd, 'probe-kit-ledger', 'ledger.jsonl'));
  }
  return cli;
}

function buildProbeTools(config, ctx = null) {
  const timeoutMs = probeTimeout(config);
  const getCwd = createCwdResolver(ctx);
  const configuredLedger =
    typeof config.ledgerPath === 'string' && config.ledgerPath !== '' ? config.ledgerPath : null;

  return [
    {
      name: 'probe_shortlist',
      description:
        '粗选（方向选择）：先 generate 把 brief 收成三页共用的内容槽，再按 lineage（同族不同派）或 contrast（同一对比轴三档）渲染 3 个世界；禁止没生成就声称已有三个方向。只允许删除（必须带理由）或待定；每轮最多待定 1 个；待定满 3 个进入三选一；最多 4 轮 × 3 = 12 个，用尽或「都不行」→ 按理由归因 capability/brief/taste/no-preference 并给出路由。命令：init/generate/add/decide/final/report/verify/demo/status。中文：多方向选型、删/待定、封顶后归因换能力。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['init', 'generate', 'add', 'decide', 'final', 'report', 'verify', 'demo', 'status'],
            description: '子命令。init 建回合；generate 按内容槽写出一轮候选 JSON（不写 decide / 台账）；add 加一轮候选；decide 提交本轮删除/待定；final 三选一或都不行；report/verify 查看与校验；demo 生成两条模拟链路；status 统计台账。',
          },
          brief: { type: 'string', description: 'init/generate：brief JSON 文件路径（{ title, prompt, context?, content? }；cap 固定不需填）。content 为三页共用的 title/subtitle/bullets[3]/cta/foot。' },
          run: { type: 'string', description: 'generate/add/decide/final/report/verify：粗选回合目录。generate 可只读其中的 brief.json。' },
          candidates: { type: 'string', description: 'add：候选 JSON 路径 { relation, family?/axis?, candidates:[{id,world,html}] }。' },
          contextToken: { type: 'string', description: 'add，或 generate 且 add=true：本轮生成上下文 token，每轮应换独立 token（连续相同会告警）。' },
          round: { type: 'integer', description: 'decide：轮次编号。generate：世界计划轮次 1–4，默认 1；与 --add 合用时必须等于回合的下一轮。' },
          relation: { type: 'string', enum: ['lineage', 'contrast'], description: 'generate：关系形态。省略时由 round 决定（第 1 轮是 lineage）。' },
          family: { type: 'string', description: 'generate：lineage 的 family id，例如 print-tradition。' },
          axis: { type: 'string', description: 'generate：contrast 的对比轴 id，例如 ornament 或 image。' },
          content: { type: 'string', description: 'generate：可选内容槽 JSON，覆盖 brief 里的 content 或自动推导。' },
          add: { type: 'boolean', description: 'generate：写出候选后立刻 add 进 run。不加则只写 JSON，不写台账。' },
          decisions: { type: 'string', description: 'decide：页面下载的 decisions-*.jsonl 路径。' },
          choice: { type: 'string', description: 'final：页面下载的 choice-*.jsonl 路径。' },
          scenario: { type: 'string', enum: ['success', 'gap', 'both'], description: 'demo：生成哪条模拟链路，默认 both。' },
          runId: { type: 'string', description: 'init：自定义 runId（默认按标题哈希生成）。' },
          out: { type: 'string', description: 'init/demo：输出根目录，默认 <会话 cwd>/shortlist-runs。generate：候选 JSON 路径，默认 <run|cwd>/candidates/rN.json。' },
          ledger: { type: 'string', description: '可选：台账 jsonl 路径。' },
          cwd: { type: 'string', description: '可选：工作目录，默认会话工作目录。' },
        },
        required: ['command'],
      },
      output: jsonOutput(),
      async execute(args, exec) {
        const command = args?.command;
        const cwd = getCwd(exec);
        const cli = [];
        const known = ['init', 'generate', 'add', 'decide', 'final', 'report', 'verify', 'demo', 'status'];
        if (!known.includes(command)) {
          return { ok: false, error: `未知 command：${JSON.stringify(command)}（允许：${known.join('/')}）` };
        }
        const ledgerArg = typeof args?.ledger === 'string' && args.ledger !== '' ? args.ledger : null;
        for (const [value, label] of [
          [args?.brief, 'brief'],
          [args?.run, 'run'],
          [args?.candidates, 'candidates'],
          [args?.decisions, 'decisions'],
          [args?.choice, 'choice'],
          [args?.out, 'out'],
          [args?.content, 'content'],
          [ledgerArg, 'ledger'],
        ]) {
          const guarded = guardOptionalWorkspacePath(cwd, value, { label });
          if (!guarded.ok) return guarded;
        }
        const fallbackLedger = configuredLedger ?? join(cwd, 'probe-kit-ledger', 'ledger.jsonl');
        const addLedger = () => {
          cli.push('--ledger', ledgerArg ?? fallbackLedger);
        };
        const outRoot = typeof args?.out === 'string' && args.out !== '' ? args.out : join(cwd, 'shortlist-runs');
        if (command === 'init') {
          const missing = need(args?.brief, 'brief', command);
          if (missing) return { ok: false, error: missing };
          cli.push('init', '--brief', args.brief);
          if (typeof args?.runId === 'string' && args.runId !== '') cli.push('--run-id', args.runId);
          cli.push('--out', outRoot);
          addLedger();
        } else if (command === 'generate') {
          const hasBrief = typeof args?.brief === 'string' && args.brief !== '';
          const hasRun = typeof args?.run === 'string' && args.run !== '';
          if (!hasBrief && !hasRun) return { ok: false, error: 'probe_shortlist generate 需要 brief 或 run。' };
          if (args?.add === true && !hasRun) return { ok: false, error: 'probe_shortlist generate 在 add=true 时需要 run。' };
          cli.push('generate');
          if (hasBrief) cli.push('--brief', args.brief);
          if (hasRun) cli.push('--run', args.run);
          if (Number.isInteger(args?.round)) cli.push('--round', String(args.round));
          if (typeof args?.relation === 'string' && args.relation !== '') cli.push('--relation', args.relation);
          if (typeof args?.family === 'string' && args.family !== '') cli.push('--family', args.family);
          if (typeof args?.axis === 'string' && args.axis !== '') cli.push('--axis', args.axis);
          if (typeof args?.content === 'string' && args.content !== '') cli.push('--content', args.content);
          if (typeof args?.out === 'string' && args.out !== '') cli.push('--out', args.out);
          if (args?.add === true) {
            cli.push('--add');
            if (typeof args?.contextToken === 'string' && args.contextToken !== '') cli.push('--context-token', args.contextToken);
            addLedger();
          }
        } else if (command === 'add') {
          const missing = need(args?.run, 'run', command) ?? need(args?.candidates, 'candidates', command);
          if (missing) return { ok: false, error: missing };
          cli.push('add', '--run', args.run, '--candidates', args.candidates);
          if (typeof args?.contextToken === 'string' && args.contextToken !== '') cli.push('--context-token', args.contextToken);
          addLedger();
        } else if (command === 'decide') {
          const missing =
            need(args?.run, 'run', command) ??
            need(args?.decisions, 'decisions', command) ??
            (Number.isInteger(args?.round) ? null : 'probe_shortlist decide 需要整数参数 round。');
          if (missing) return { ok: false, error: missing };
          cli.push('decide', '--run', args.run, '--round', String(args.round), '--decisions', args.decisions);
          addLedger();
        } else if (command === 'final') {
          const missing = need(args?.run, 'run', command) ?? need(args?.choice, 'choice', command);
          if (missing) return { ok: false, error: missing };
          cli.push('final', '--run', args.run, '--choice', args.choice);
          addLedger();
        } else if (command === 'report' || command === 'verify') {
          const missing = need(args?.run, 'run', command);
          if (missing) return { ok: false, error: missing };
          cli.push(command, '--run', args.run);
        } else if (command === 'demo') {
          cli.push('demo');
          if (typeof args?.scenario === 'string' && args.scenario !== '') cli.push('--scenario', args.scenario);
          cli.push('--out', outRoot);
          addLedger();
        } else {
          cli.push('status');
          addLedger();
        }
        const run = await runProbeScript('shortlist.mjs', cli, { cwd, timeoutMs });
        if (run.exitCode === 0 && ['init', 'add', 'decide', 'final', 'generate'].includes(command)) {
          if (command !== 'generate' || args?.add === true) {
            markShortlist(cwd, {
              run: typeof args?.run === 'string' && args.run !== '' ? resolve(cwd, args.run) : null,
              finished: command === 'final',
            });
          }
        }
        return packProbe(
          command,
          run,
          '退出码 1 = 校验/规则拒绝（看 stdout 的中文原因），2 = 参数错误。不要把 exit 1 当成工具崩溃。',
        );
      },
    },
    {
      name: 'probe_measure',
      description:
        '精调（参数级盲测）：单轴变体盲呈现、指认、置信度、台账、JND 等效区间与校准。命令：demo/build/append/attribute/revoke/review/apply/status/verify；其余参数放在 args 数组里原样透传。中文：两档细粒度比较、单轴调参、可辨识阈值。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['demo', 'build', 'append', 'attribute', 'revoke', 'review', 'apply', 'status', 'verify'],
            description: 'probe.mjs 子命令。',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '透传给 probe.mjs 的附加参数，例如 ["--from-run","runs/x","--between","1,2"] 或 ["--run","runs/x"]。',
          },
          ledger: { type: 'string', description: '可选：台账 jsonl 路径（会追加 --ledger）。' },
          cwd: { type: 'string', description: '可选：工作目录，默认会话工作目录。' },
        },
        required: ['command'],
      },
      output: jsonOutput(),
      async execute(args, exec) {
        const known = ['demo', 'build', 'append', 'attribute', 'revoke', 'review', 'apply', 'status', 'verify'];
        const command = args?.command;
        if (!known.includes(command)) {
          return { ok: false, error: `未知 command：${JSON.stringify(command)}（允许：${known.join('/')}）` };
        }
        const cwd = getCwd(exec);
        const extra = Array.isArray(args?.args) ? args.args.map((item) => String(item)) : [];
        // B2 薄状态机：粗选没 final 不允许进精调（查看类命令放行）。
        const unfinished = unfinishedShortlist(cwd);
        if (unfinished !== null && !['status', 'review', 'verify'].includes(command)) {
          return {
            ok: false,
            error:
              '粗选回合' +
              (typeof unfinished.shortlistRun === 'string' && unfinished.shortlistRun !== ''
                ? '（' + unfinished.shortlistRun + '）'
                : '') +
              '尚未 final：先 probe_shortlist final（三选一或都不行），再进精调。状态机不跳过；查看类 status/review 仍可用。',
          };
        }
        const extraGuard = guardProbeArgs(cwd, extra);
        if (!extraGuard.ok) return extraGuard;
        const ledgerGuard = guardOptionalWorkspacePath(cwd, args?.ledger, { label: 'ledger' });
        if (!ledgerGuard.ok) return ledgerGuard;
        const cli = buildProbeMeasureArgv(command, extra, cwd, configuredLedger);
        const run = await runProbeScript('probe.mjs', cli, { cwd, timeoutMs });
        if (run.exitCode === 0 && ['demo', 'build'].includes(command)) {
          markMeasure(cwd, { run: typeof args?.run === 'string' && args.run !== '' ? resolve(cwd, args.run) : null });
        }
        return packProbe(command, run, '退出码 1/2 是 probe.mjs 的正常结果（校验失败/参数错误），看 stdout 的中文原因。');
      },
    },
  ];
}

/** 解析 design/probe 两套超时（含旧 timeoutMs 兜底与钳制），供测试与诊断使用。 */
export function resolveTimeoutSettings(config = {}) {
  return { designMs: designTimeout(config), probeMs: probeTimeout(config) };
}

/** 统一技能注册的全部工具（3 design + 2 probe + 3 deck + 2 shortlist UI）。 */
export function buildDesignKitTools(config = {}, ctx = null) {
  return [
    ...buildDesignTools(config, ctx),
    ...buildProbeTools(config, ctx),
    ...buildDeckTools(config, ctx),
    ...buildShortlistUiTools(config, ctx),
  ];
}

export const TOOL_NAMES = [
  'design_lint',
  'design_tokens',
  'design_capture',
  'probe_shortlist',
  'probe_measure',
  ...DECK_TOOL_NAMES,
  ...SHORTLIST_UI_TOOL_NAMES,
];

export { parseJsonOutput };
