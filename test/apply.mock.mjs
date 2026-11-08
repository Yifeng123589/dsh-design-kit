// 用假的 ctx 验证统一插件的注册逻辑：技能解析、10 个工具、参数校验、发现逻辑、资源完整性、异常隔离。
// 运行：node test/apply.mock.mjs（不要用 node --test：沙箱下子进程管道会被拒）
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apply, getRegistrationHealth, resetRegistrationHealth } from '../lib/index.js';
import { createCwdResolver } from '../lib/cwd.js';
import { guardProbeArgs, guardWorkspacePath, isWithinRoot } from '../lib/path-guard.js';
import {
  buildDeckTools,
  isPptMasterDir,
  pythonCandidates,
  resolvePptMasterDir,
  resolveRenderer,
  summarizeCheckerReport,
} from '../lib/deck.js';
import { parseSkillFile } from '../lib/skill.js';
import { buildProbeMeasureArgv, hasInlineOption, parseJsonOutput, resolveTimeoutSettings, TOOL_NAMES } from '../lib/tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..', 'skills', 'design-kit');
const skillReady = existsSync(join(skillDir, 'SKILL.md'));

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error && error.message ? error.message : String(error) });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function makeCtx() {
  const registered = { skills: [], tools: [], warns: [], infos: [], errors: [], disposers: 0, disposeHandlers: [] };
  const ctx = {
    skills: {
      register(definition) {
        registered.skills.push(definition);
        return () => (registered.disposers += 1);
      },
    },
    tools: {
      register(definition) {
        // 复刻 DSH 0.2.x ToolRuntime.register() 的输出契约：缺 output { schema, render }
        // 时真实宿主抛 TypeError，旧 mock 会静默放过（真实宿主曾因此吞掉全部 8 个工具）。
        if (
          !definition ||
          typeof definition !== 'object' ||
          typeof definition.output !== 'object' ||
          definition.output === null ||
          typeof definition.output.render !== 'function'
        ) {
          throw new TypeError(
            'tool "' + (definition && definition.name) + '" must declare output { schema, render }',
          );
        }
        registered.tools.push(definition);
        return () => (registered.disposers += 1);
      },
    },
    logger: {
      warn: (message) => registered.warns.push(message),
      info: (message) => registered.infos.push(message),
      error: (message) => registered.errors.push(message),
    },
    on(event, handler) {
      if (event === 'dispose') registered.disposeHandlers.push(handler);
    },
  };
  return { ctx, registered };
}

function walkFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.tmp')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs));
    else out.push(abs);
  }
  return out;
}

function walkMarkdown(dir) {
  return walkFiles(dir).filter((file) => file.endsWith('.md'));
}

await check('统一技能与两份实现已同步', async () => {
  assert(skillReady, '缺少 skills/design-kit/SKILL.md');
  const required = [
    'ui-craft/METHOD.md',
    'ui-craft/scripts/design-tokens.mjs',
    'ui-craft/scripts/design-lint.mjs',
    'ui-craft/scripts/capture.mjs',
    'ui-craft/references/world.md',
    'ui-craft/templates/DESIGN.md',
    'references/probe-kit-method.md',
    'references/deck-handoff.md',
    'deck/export_shim.py',
    'probe-kit/shortlist.mjs',
    'probe-kit/probe.mjs',
    'probe-kit/lib/shortlist.mjs',
    'probe-kit/lib/worlds.mjs',
    'probe-kit/lib/side-effects.mjs',
    'probe-kit/templates/shortlist.html',
    'probe-kit/PROTOCOL-V0.2.md',
    'probe-kit/test/regression.test.mjs',
    'probe-kit/test/smoke.mjs',
    'probe-kit/test/axis-lock.test.mjs',
    'probe-kit/test/fixtures/real-runs/ledger-real.jsonl',
    'probe-kit/REAL-RUN.md',
    'probe-kit/REVIEW-SUGGESTIONS.md',
  ];
  for (const file of required) {
    assert(existsSync(join(skillDir, file)), '缺少同步文件：' + file);
  }
});

await check('同步清单存在且计数与磁盘一致', async () => {
  const manifestPath = join(skillDir, '.sync-manifest.json');
  assert(existsSync(manifestPath), '缺少 .sync-manifest.json，请重装插件或由维护者运行 node sync-kit.mjs 重新生成');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert(manifest.skill === 'design-kit', 'manifest.skill 应为 design-kit');
  assert(manifest.uiCraft === walkFiles(join(skillDir, 'ui-craft')).length, 'uiCraft 计数与磁盘不一致');
  assert(manifest.probeKit === walkFiles(join(skillDir, 'probe-kit')).length, 'probeKit 计数与磁盘不一致');
  assert(manifest.references === walkFiles(join(skillDir, 'references')).length, 'references 计数与磁盘不一致');
});

await check('技能内所有 markdown 相对链接可解析', async () => {
  const broken = [];
  for (const file of walkMarkdown(skillDir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const pathPart = target.split('#')[0];
      if (pathPart === '') continue;
      const resolved = resolve(dirname(file), pathPart);
      if (!existsSync(resolved)) broken.push(file + ' -> ' + target);
    }
  }
  assert(broken.length === 0, '坏链接 ' + broken.length + ' 条：' + broken.slice(0, 5).join(' | '));
});

await check('frontmatter 解析出统一入口与足够长的 description', async () => {
  const text = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const parsed = parseSkillFile(text);
  assert(parsed.name === 'design-kit', 'name 应为 design-kit，实际 ' + parsed.name);
  assert(parsed.description.length > 160, 'description 应足够长以支持自动路由');
  for (const keyword of ['造页面', '粗选', '精调', 'PPT']) {
    assert(parsed.description.includes(keyword), 'description 缺少路由关键词：' + keyword);
  }
  assert(parsed.content.startsWith('# Design Kit'), '正文应从统一入口标题开始');
  assert(!parsed.content.includes('http://') && !parsed.content.includes('https://'), '技能正文不应有外链');
});

await check('apply 注册 1 个技能与 10 个工具，且名字唯一', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  assert(registered.skills.length === 1, '应注册 1 个技能');
  assert(registered.skills[0].name === 'design-kit', '技能名');
  assert(registered.skills[0].resourceBase.kind === 'directory', '资源目录类型');
  assert(registered.skills[0].source === 'runtime', 'source 应为 runtime');
  const names = registered.tools.map((tool) => tool.name);
  assert(names.sort().join(',') === TOOL_NAMES.slice().sort().join(','), '工具清单应为 10 个工具');
  assert(TOOL_NAMES.length === 10 && new Set(names).size === 10, '工具名应为 10 个且不重复');
  for (const tool of registered.tools) {
    assert(typeof tool.execute === 'function', tool.name + ' 缺少 execute');
    assert(tool.parameters.type === 'object', tool.name + ' parameters 应为 object');
    assert(tool.description.length > 80, tool.name + ' description 太短');
  }
  assert(registered.warns.length === 0, '注册不应告警：' + registered.warns.join(' | '));
});

await check('10 个工具都带 DSH 0.2.x 的 output 契约（schema + render）', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  for (const tool of registered.tools) {
    assert(typeof tool.output === 'object' && tool.output !== null, tool.name + ' 缺 output');
    assert(typeof tool.output.render === 'function', tool.name + ' output.render 应为函数');
    assert(tool.output.schema !== undefined, tool.name + ' output.schema 缺失');
    const rendered = tool.output.render({}, { ok: true, error: null });
    assert(Array.isArray(rendered) && rendered.length > 0, tool.name + ' output.render 应返回内容数组');
    assert(
      rendered.every((part) => part && part.type === 'text' && typeof part.text === 'string'),
      tool.name + ' output.render 应返回 text 内容块',
    );
  }
});

await check('会话工作目录优先于宿主进程 cwd（workingDirectory 服务）', async () => {
  const session = { id: 'session-cwd-test' };
  const resolver = createCwdResolver({
    workingDirectory: { get: (candidate) => (candidate === session ? 'C:/session-dir' : '') },
  });
  assert(resolver({ agent: { session }, cwd: 'C:/host-process-dir' }) === 'C:/session-dir', '应优先使用会话工作目录');
  assert(resolver({ cwd: 'C:/host-process-dir' }) === 'C:/host-process-dir', '无 agent 时退回 exec.cwd');
  assert(createCwdResolver(null)({ cwd: 'C:/legacy' }) === 'C:/legacy', '无 ctx 时兼容旧调用');
});

await check('deck_export 相对路径按会话工作目录解析（不再落到宿主进程 cwd）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'deck-cwd-'));
  try {
    const project = join(tmp, 'project');
    mkdirSync(join(project, 'svg_output'), { recursive: true });
    const sentinel = join(tmp, 'existing.pptx');
    writeFileSync(sentinel, 'SENTINEL', 'utf8');
    const session = { id: 's-cwd' };
    const tools = buildDeckTools({}, { workingDirectory: { get: () => tmp } });
    const exportTool = tools.find((item) => item.name === 'deck_export');
    const result = await exportTool.execute(
      { project: 'project', out: 'existing.pptx' },
      { agent: { session }, cwd: 'C:/definitely/not/here' },
    );
    assert(result.ok === false, '已存在 out 应返回 ok:false');
    assert(result.error.includes(sentinel), '错误应指向会话工作目录下的文件：' + result.error);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await check('新配置字段被接受，不发生注册告警', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {
    designTimeoutMs: 5000,
    probeTimeoutMs: 60000,
    ledgerPath: join(process.cwd(), '.tmp-ledger', 'ledger.jsonl'),
    timeoutMs: 7000,
    deckTimeoutMs: 240000,
    pptMasterDir: 'X:/tmp/ppt-master',
    pythonPath: 'X:/tmp/python.exe',
    rendererCli: 'X:/tmp/dsoffice.js',
  });
  assert(registered.warns.length === 0, '配置不应触发告警：' + registered.warns.join(' | '));
});

await check('超时配置：默认值、旧 timeoutMs 兜底与钳制', async () => {
  const defaults = resolveTimeoutSettings({});
  assert(defaults.designMs === 30000 && defaults.probeMs === 120000, '默认超时应为 30s / 120s');
  const legacy = resolveTimeoutSettings({ timeoutMs: 5000 });
  assert(legacy.designMs === 5000 && legacy.probeMs === 5000, 'timeoutMs 应同时兜底');
  const clamped = resolveTimeoutSettings({ designTimeoutMs: 999999, probeTimeoutMs: 1 });
  assert(clamped.designMs === 120000, 'design 超时应钳到 120s，实际 ' + clamped.designMs);
  assert(clamped.probeMs === 1000, 'probe 超时应钳到 1s，实际 ' + clamped.probeMs);
});

await check('deck 发现逻辑：ppt-master / python / 渲染器', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'deck-discovery-'));
  try {
    const master = join(tmp, 'ppt-master');
    mkdirSync(join(master, 'scripts'), { recursive: true });
    writeFileSync(join(master, 'scripts', 'svg_quality_checker.py'), '');
    writeFileSync(join(master, 'scripts', 'svg_to_pptx.py'), '');
    assert(isPptMasterDir(master) === true, '假 ppt-master 应被识别');
    assert(resolvePptMasterDir({ pptMasterDir: master }, {}, tmp) === master, '显式 pptMasterDir 应命中');
    const emptyWorkspace = mkdtempSync(join(tmpdir(), 'deck-empty-'));
    try {
      assert(resolvePptMasterDir({}, {}, emptyWorkspace) === null, '空工作区不应误报');
    } finally {
      rmSync(emptyWorkspace, { recursive: true, force: true });
    }
    assert(resolvePptMasterDir({ pptMasterDir: join(tmp, 'missing-master') }, {}, tmp) === null, '显式配置无效应返回 null，不偷偷换目录');
    assert(resolvePptMasterDir({}, {}, tmp) === master, '工作区一级目录应被发现');

    // B4：任意 _sources/<fork>/... 布局，不再写死 ppt-master-main
    const fork = join(tmp, 'fork-workspace');
    const nestedMaster = join(fork, '_sources', 'someone-fork', 'nested-dir', 'skills', 'ppt-master');
    mkdirSync(join(nestedMaster, 'scripts'), { recursive: true });
    writeFileSync(join(nestedMaster, 'scripts', 'svg_quality_checker.py'), '');
    writeFileSync(join(nestedMaster, 'scripts', 'svg_to_pptx.py'), '');
    assert(resolvePptMasterDir({}, {}, fork) === nestedMaster, '应发现任意 _sources 布局下的 ppt-master');

    const home = join(tmp, 'dsh-home');
    const py = join(home, 'dsh-runtimes', 'rt1', 'dependencies', 'python', 'python.exe');
    mkdirSync(dirname(py), { recursive: true });
    writeFileSync(py, '');
    const candidates = pythonCandidates({}, { DSH_HOME: home }, 'win32');
    assert(candidates.some((item) => item.command === py), '应发现 DSH bundled python');
    assert(pythonCandidates({ pythonPath: 'X:/py/python.exe' }, {}, 'win32')[0].command === 'X:/py/python.exe', '显式 pythonPath 应排第一');

    const cli = join(tmp, 'cli.js');
    writeFileSync(cli, '');
    const renderer = resolveRenderer({ rendererCli: cli }, {}, process.execPath);
    assert(renderer.command === process.execPath && renderer.prefixArgs[0] === cli, '显式 rendererCli 应通过 node 调用');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await check('checker report 收敛：summary 与逐文件错误', async () => {
  const report = {
    summary: { total: 2, passed: 1, warnings: 0, errors: 1 },
    files: [
      { file: 'a.svg', errors: [], warnings: [] },
      { file: 'b.svg', errors: [{ code: 'E1' }], warnings: [] },
    ],
  };
  const summarized = summarizeCheckerReport(report);
  assert(summarized.summary.errors === 1, 'summary.errors 应保留');
  assert(summarized.errors.length === 1 && summarized.errors[0].file === 'b.svg', '应收集逐文件错误');
  assert(summarizeCheckerReport(null).summary === null, '空报告应返回 null summary');
});

await check('probe_measure argv：默认落 cwd，且不覆盖内联 --out= / --ledger=', async () => {
  const cwd = join(process.cwd(), 'tmp-cwd');
  const demo = buildProbeMeasureArgv('demo', [], cwd, null);
  assert(demo.includes('--out') && demo[demo.indexOf('--out') + 1] === join(cwd, 'runs'), 'demo 默认 out 应落 cwd/runs');
  assert(demo.includes('--ledger'), 'demo 应补默认 ledger');
  const inlineOut = buildProbeMeasureArgv('build', ['--out=custom', '--ledger=x'], cwd, null);
  assert(!inlineOut.includes('--out'), '--out=custom 存在时不应再追加 --out');
  assert(!inlineOut.includes('--ledger'), '--ledger=x 存在时不应再追加 --ledger');
  assert(hasInlineOption(['--out=x'], '--out') === true, '应识别 --out=x');
  assert(hasInlineOption(['--out', 'x'], '--out') === true, '应识别 --out x');
  assert(hasInlineOption(['x'], '--out') === false, '不应误判普通参数');
});

await check('deck 工具参数校验：缺 project / pptx 返回中文错误', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  const byName = (name) => registered.tools.find((item) => item.name === name);
  const checkTool = byName('deck_check');
  const exportTool = byName('deck_export');
  const renderTool = byName('deck_render');
  for (const tool of [checkTool, exportTool]) {
    const result = await tool.execute({}, { cwd: process.cwd() });
    assert(result.ok === false && result.error.includes('project'), tool.name + ' 缺 project 应返回中文错误');
  }
  const renderResult = await renderTool.execute({}, { cwd: process.cwd() });
  assert(renderResult.ok === false && renderResult.error.includes('.pptx'), 'deck_render 缺 pptx 应返回中文错误');
});

await check('deck_export 显式 out 已存在时拒绝覆盖', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'deck-out-'));
  try {
    const project = join(tmp, 'project');
    mkdirSync(join(project, 'svg_output'), { recursive: true });
    const sentinel = join(tmp, 'existing.pptx');
    writeFileSync(sentinel, 'SENTINEL-USER-FILE', 'utf8');
    const { ctx, registered } = makeCtx();
    apply(ctx, {});
    const exportTool = registered.tools.find((item) => item.name === 'deck_export');
    const result = await exportTool.execute({ project, out: sentinel }, { cwd: tmp });
    assert(result.ok === false, '已存在 out 应返回 ok:false');
    assert(result.error.includes('已存在') && result.error.includes('拒绝覆盖'), '错误应说明拒绝覆盖');
    assert(readFileSync(sentinel, 'utf8') === 'SENTINEL-USER-FILE', '用户文件不应被修改');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await check('design_lint 缺 target 返回中文错误，不抛异常', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  const tool = registered.tools.find((item) => item.name === 'design_lint');
  const result = await tool.execute({}, { cwd: process.cwd() });
  assert(result.ok === false, '缺 target 应返回 ok:false');
  assert(typeof result.error === 'string' && result.error.includes('target'), '错误应说明缺 target');
});

await check('design_tokens / design_capture 缺参数返回中文错误', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  const tokens = registered.tools.find((item) => item.name === 'design_tokens');
  const capture = registered.tools.find((item) => item.name === 'design_capture');
  assert((await tokens.execute({}, { cwd: process.cwd() })).ok === false, 'design_tokens 缺 outDir 应失败');
  assert((await capture.execute({ target: 'x.html' }, { cwd: process.cwd() })).ok === false, 'design_capture 缺 outDir 应失败');
});

await check('probe 工具参数校验与未知命令被拒', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  const shortlist = registered.tools.find((item) => item.name === 'probe_shortlist');
  const measure = registered.tools.find((item) => item.name === 'probe_measure');
  const missing = await shortlist.execute({ command: 'report' }, { cwd: process.cwd() });
  assert(missing.ok === false && missing.error.includes('run'), 'probe_shortlist 缺 run 应失败');
  assert((await shortlist.execute({ command: 'explode' }, { cwd: process.cwd() })).error.includes('未知 command'), '粗选未知命令');
  assert((await measure.execute({ command: 'explode' }, { cwd: process.cwd() })).error.includes('未知 command'), '精调未知命令');
});

await check('客户端入口与 dsh.client 清单存在', async () => {
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  assert(pkg.exports && pkg.exports['./client'] === './lib/client.js', 'exports["./client"] 应指向 lib/client.js');
  assert(existsSync(join(here, '..', 'lib', 'client.js')), '缺少 lib/client.js');
  assert(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.platform 应为 web');
  const inject = pkg.dsh.client.inject ?? [];
  assert(inject.includes('@deepseek-ai/dsh-client-ui-tool'), 'dsh.client.inject 应包含 ui-tool（toolview slot 所有者）');
  const client = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');
  assert(client.includes("key: 'probe_shortlist_preview'"), 'client 应注册 probe_shortlist_preview toolview');
  assert(client.includes('uiToken: data.uiToken'), 'client 回传动作应携带一次性 uiToken');
  assert(client.includes('uiTokenExpiresAt') && client.includes('预览已过期'), 'client 应显示令牌过期状态并禁用提交');
  assert(client.includes('DecompressionStream'), 'client 应支持解压 gzip 候选预览');
  assert(client.includes('data-process-activity') && client.includes('scrollIntoView'), 'client 应自动展开过程组并滚动到卡片');
  assert(client.includes('window.__ModuleLoader__.load'), 'client 应通过 ModuleLoader 注册');
});

await check('probe_shortlist_preview 读取未决策轮并返回三栏 payload', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'shortlist-ui-'));
  try {
    mkdirSync(join(tmp, 'candidates'), { recursive: true });
    for (const pos of [1, 2, 3]) {
      writeFileSync(join(tmp, 'candidates', 'p' + pos + '.html'), '<!doctype html><body>candidate ' + pos + '</body>', 'utf8');
    }
    writeFileSync(
      join(tmp, 'brief.json'),
      JSON.stringify({ title: 'ui-test', prompt: '选一个', runId: 'ui-test', cap: 12 }),
      'utf8',
    );
    writeFileSync(
      join(tmp, 'rounds.json'),
      JSON.stringify({
        schema: 'shortlist-rounds/1',
        runId: 'ui-test',
        rounds: [
          {
            round: 1,
            relation: { relation: 'lineage', family: 'print-tradition' },
            candidates: [1, 2, 3].map((pos) => ({
              id: 'c' + pos,
              pos,
              world: { variant: 'v' + pos },
              htmlPath: 'candidates/p' + pos + '.html',
            })),
          },
        ],
      }),
      'utf8',
    );
    writeFileSync(
      join(tmp, 'state.json'),
      JSON.stringify({
        schema: 'shortlist-state/1',
        runId: 'ui-test',
        pending: [],
        eliminated: [],
        decisionsByRound: {},
        nextRound: 1,
        generationContexts: ['fresh-1'],
        finished: false,
        outcome: null,
      }),
      'utf8',
    );
    const { ctx, registered } = makeCtx();
    apply(ctx, {});
    const preview = registered.tools.find((item) => item.name === 'probe_shortlist_preview');
    const result = await preview.execute({ run: tmp }, { cwd: tmp });
    assert(result.ok === true, 'preview 应成功：' + result.error);
    assert(result.mode === 'round' && result.round === 1, '应返回未决策轮模式');
    assert(result.candidates.length === 3, '应返回 3 个候选');
    assert(result.candidates.every((item) => item.htmlEncoding === 'gzip+base64' && typeof item.htmlGzip === 'string'), '候选应携带 gzip 预览');
    assert(result.candidates.every((item) => item.html === undefined), '候选不应再塞原始 HTML');
    assert(
      result.candidates.every((item) => gunzipSync(Buffer.from(item.htmlGzip, 'base64')).toString('utf8').includes('candidate')),
      'gzip 解压后应还原候选 HTML',
    );
    assert(result.reasonChips.length >= 6, '应返回删除理由 chips');
    assert(typeof result.uiToken === 'string' && result.uiToken.length > 20, 'preview 应发一次性令牌');
    const secondPreview = await preview.execute({ run: tmp }, { cwd: tmp });
    assert(secondPreview.ok === true && secondPreview.uiToken !== result.uiToken, '重复预览应发不同令牌，不能覆盖旧卡片');
    const tokenFile = join(tmp, '.ui-tokens', result.uiToken + '.json');
    const secondTokenFile = join(tmp, '.ui-tokens', secondPreview.uiToken + '.json');
    assert(existsSync(tokenFile) && existsSync(secondTokenFile), '两个预览令牌应同时存在');
    assert(existsSync(join(tmp, '.ui-token.json')) === false, '新预览不应再写旧的单文件令牌');
    const action = registered.tools.find((item) => item.name === 'probe_shortlist_ui_action');
    const bad = await action.execute({}, { cwd: tmp });
    assert(bad.ok === false && bad.error.includes('payload'), 'action 缺 payload 应返回中文错误');

    const validDecisions = [
      { pos: 1, action: 'eliminate', reasonId: 'too-loud' },
      { pos: 2, action: 'defer' },
      { pos: 3, action: 'eliminate', reasonId: 'too-quiet' },
    ];
    const basePayload = { schema: 'shortlist-ui-action/1', kind: 'decide', run: tmp, round: 1, decisions: validDecisions };
    const noToken = await action.execute({ payload: JSON.stringify(basePayload) }, { cwd: tmp });
    assert(noToken.ok === false && noToken.error.includes('令牌'), '缺令牌应收紧拒绝：' + noToken.error);
    const wrongToken = await action.execute(
      { payload: JSON.stringify({ ...basePayload, uiToken: 'deadbeef'.repeat(6) }) },
      { cwd: tmp },
    );
    assert(
      wrongToken.ok === false && (wrongToken.error.includes('不匹配') || wrongToken.error.includes('不存在')),
      '伪造令牌应拒绝：' + wrongToken.error,
    );
    const wrongRound = await action.execute(
      { payload: JSON.stringify({ ...basePayload, round: 2, uiToken: result.uiToken }) },
      { cwd: tmp },
    );
    assert(wrongRound.ok === false && wrongRound.error.includes('轮次'), '轮次不匹配应拒绝');

    const originalTokenFile = readFileSync(tokenFile, 'utf8');
    const expiredRecord = { ...JSON.parse(originalTokenFile), issuedAt: '2000-01-01T00:00:00.000Z' };
    writeFileSync(tokenFile, JSON.stringify(expiredRecord) + '\n', 'utf8');
    const expired = await action.execute(
      { payload: JSON.stringify({ ...basePayload, uiToken: result.uiToken }) },
      { cwd: tmp },
    );
    assert(expired.ok === false && expired.error.includes('过期'), '过期令牌应拒绝');
    writeFileSync(tokenFile, originalTokenFile, 'utf8');

    const tooFew = await action.execute(
      { payload: JSON.stringify({ ...basePayload, decisions: validDecisions.slice(0, 2), uiToken: result.uiToken }) },
      { cwd: tmp },
    );
    assert(tooFew.ok === false && tooFew.error.includes('3 个候选'), '决策不完整应拒绝');
    assert(existsSync(tokenFile), '无效 payload 不应消费令牌');

    const accepted = await action.execute(
      { payload: JSON.stringify({ ...basePayload, uiToken: result.uiToken }) },
      { cwd: tmp },
    );
    // N2：普通终端里子进程能正常执行，只有宿主沙箱拦截时才允许 ok=false。
    // 不能把「功能成功」写成失败，否则 npm test 在用户机器上必红。
    const sandboxBlocked =
      accepted.ok === false &&
      accepted.spawnError != null &&
      /EPERM|EACCES/.test(String(accepted.spawnError));
    assert(
      accepted.ok === true || sandboxBlocked,
      'UI action 应成功执行 CLI；仅当宿主沙箱拦截子进程时允许 ok=false 且必须带 spawnError',
    );
    assert(existsSync(tokenFile) === false, '当前卡片的令牌应在调用 CLI 前被消费');
    assert(existsSync(secondTokenFile) === true, '消费一张卡片不能误删同回合其他预览令牌');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await check('会话路径牢笼：越界路径一律拒绝，内部相对路径仍通', async () => {
  const root = join(tmpdir(), 'guard-root');
  assert(isWithinRoot(root, join(root, 'demo', 'index.html')) === true, '根内文件应通过');
  assert(isWithinRoot(root, root) === true, '根本身应通过');
  assert(isWithinRoot(root, join(root, '..', 'outside.html')) === false, '上级路径应拒绝');
  assert(isWithinRoot(root, join(tmpdir(), 'other', 'x.html')) === false, '其它绝对路径应拒绝');
  assert(isWithinRoot(root, 'relative/inside.html') === true, '相对路径按根解析后应在内');
  assert(guardWorkspacePath(root, '../outside.html', { label: 'target' }).ok === false, '相对越界应拒绝');
  assert(guardWorkspacePath(root, join(root, 'a')).ok === true, '绝对根内路径应通过');
  const url = guardWorkspacePath(root, 'https://example.com/a.html', { label: 'target', allowUrl: true });
  assert(url.ok === true && url.url === true, 'capture 的 URL 应允许');
  assert(guardWorkspacePath(root, 'https://example.com', { label: 'target' }).ok === false, '普通工具不应允许 URL');
  const argsGuard = guardProbeArgs(root, ['--run', '../outside', '--between', '1,2']);
  assert(argsGuard.ok === false, 'probe args 的 --run 越界应拒绝');
  assert(guardProbeArgs(root, ['--run', join(root, 'runs', 'x')]).ok === true, '根内 --run 应通过');
});

await check('工具层路径牢笼：target/outDir/run/project/pptx 越界返回中文错误', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  const cwd = join(tmpdir(), 'guard-tools');
  const byName = (name) => registered.tools.find((item) => item.name === name);
  const lint = await byName('design_lint').execute({ target: '../outside.html' }, { cwd });
  assert(lint.ok === false && lint.error.includes('路径越界'), 'design_lint 越界应拒绝：' + lint.error);
  const tokens = await byName('design_tokens').execute({ outDir: join(tmpdir(), 'outside-tokens') }, { cwd });
  assert(tokens.ok === false && tokens.error.includes('路径越界'), 'design_tokens 越界应拒绝');
  const shortlist = await byName('probe_shortlist').execute({ command: 'report', run: '../outside-run' }, { cwd });
  assert(shortlist.ok === false && shortlist.error.includes('路径越界'), 'probe_shortlist 越界应拒绝');
  const measure = await byName('probe_measure').execute({ command: 'review', args: ['--run', '../outside-run'] }, { cwd });
  assert(measure.ok === false && measure.error.includes('路径越界'), 'probe_measure 越界应拒绝');
  const exportDeck = await byName('deck_export').execute({ project: '../outside-project' }, { cwd });
  assert(exportDeck.ok === false && exportDeck.error.includes('路径越界'), 'deck_export 越界应拒绝');
  const render = await byName('deck_render').execute({ pptx: '../outside.pptx' }, { cwd });
  assert(render.ok === false && render.error.includes('路径越界'), 'deck_render 越界应拒绝');
  const preview = await byName('probe_shortlist_preview').execute({ run: '../outside-run' }, { cwd });
  assert(preview.ok === false && preview.error.includes('路径越界'), 'preview 越界应拒绝');
});

await check('工具 execute 异步化（返回 Promise，不阻塞调用方）', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  const tool = registered.tools.find((item) => item.name === 'design_lint');
  const pending = tool.execute({ target: 'missing-inside.html' }, { cwd: process.cwd() });
  assert(typeof pending.then === 'function', 'execute 应返回 Promise');
  const raced = await Promise.race([
    pending.then(() => 'resolved'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000)),
  ]);
  assert(raced === 'resolved', '异步工具应在超时前返回（沙箱下应为错误路径）');
});

await check('A7 JSON 输出契约：只认标记行/最后一行，日志里的 { 不再误解析', () => {
  const marked = parseJsonOutput('log {not-json}\n__DESIGN_KIT_JSON__{"counts":{"error":1},"score":80}\n');
  assert(marked && marked.counts.error === 1 && marked.score === 80, '标记行应优先解析');
  const plainLast = parseJsonOutput('human log\n{"ok":true}\n');
  assert(plainLast && plainLast.ok === true, '最后一行纯 JSON 应兼容');
  assert(parseJsonOutput('log {broken json}\n') === null, '只有日志里的 { 不应假解析成功');
  assert(parseJsonOutput('step {x}\ndone\n') === null, '末尾不是 JSON 应返回 null');
});

await check('A6 注册健康检查：正常注册汇总 1/1 技能 + 10/10 工具', () => {
  resetRegistrationHealth();
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  const health = getRegistrationHealth();
  assert(health && health.ok === true, '健康状态应 ok');
  assert(health.skill.registered === 1 && health.skill.expected === 1, '技能应 1/1');
  assert(health.tools.registered === 10 && health.tools.expected === 10, '工具应 10/10');
  assert(health.tools.missing.length === 0, '不应有缺失工具');
  assert(health === ctx.designKitHealth, 'ctx.designKitHealth 应可查询');
  assert(registered.infos.some((message) => message.includes('工具 10/10')), '应写 info 汇总日志');
});

await check('A6/B6 可选能力失败：降级提示，不抛异常', () => {
  resetRegistrationHealth();
  const { ctx, registered } = makeCtx();
  const original = ctx.tools.register;
  ctx.tools.register = (definition) => {
    if (definition.name === 'deck_check') throw new TypeError('模拟可选能力注册失败');
    return original(definition);
  };
  let threw = false;
  try {
    apply(ctx, {});
  } catch {
    threw = true;
  }
  assert(threw === false, '可选能力失败不应抛异常');
  const health = getRegistrationHealth();
  assert(health && health.ok === false && health.level === 'degraded', '健康状态应为 degraded');
  assert(health.tools.registered === 9, '应只有 9 个工具注册成功');
  assert(health.tools.missing.includes('deck_check'), '缺失清单应包含 deck_check');
  assert(registered.warns.some((message) => message.includes('降级')), '应写降级告警');
});

await check('B6 核心能力失败：硬失败（抛错）并标 fatal', () => {
  resetRegistrationHealth();
  const { ctx, registered } = makeCtx();
  const original = ctx.tools.register;
  ctx.tools.register = (definition) => {
    if (definition.name === 'probe_shortlist') throw new TypeError('模拟核心注册失败');
    return original(definition);
  };
  let threw = false;
  try {
    apply(ctx, {});
  } catch (error) {
    threw = true;
    assert(String(error.message).includes('核心注册失败'), '错误应说明核心注册失败');
  }
  assert(threw === true, '核心能力失败应硬失败');
  const health = getRegistrationHealth();
  assert(health && health.level === 'fatal' && health.ok === false, '健康状态应为 fatal');
  assert(health.tools.missingCore.includes('probe_shortlist'), 'missingCore 应包含 probe_shortlist');
  assert(registered.errors.some((message) => message.includes('核心注册失败')), '应写 error 日志');
});

await check('A9 deck 依赖缺口：返回结构化 missing[]（缺什么/怎么配）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'deck-missing-'));
  try {
    const pptx = join(tmp, 'fake.pptx');
    writeFileSync(pptx, 'PK\u0003\u0004fake', 'utf8');
    const { ctx, registered } = makeCtx();
    apply(ctx, {});
    const render = registered.tools.find((item) => item.name === 'deck_render');
    const result = await render.execute(
      { pptx, outDir: join(tmp, 'out'), rendererCli: join(tmp, 'no-such-dsoffice-cli') },
      { cwd: tmp },
    );
    assert(result.ok === false, '缺渲染器应失败');
    assert(Array.isArray(result.missing) && result.missing.length === 1, '应返回 missing 数组');
    assert(result.missing[0].kind === 'libreoffice', 'missing.kind 应为 libreoffice');
    assert(typeof result.missing[0].hint === 'string' && result.missing[0].hint.includes('rendererCli'), 'hint 应说明怎么配');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await check('B2 状态机：粗选未 final 禁进精调，final 后放行', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'state-machine-'));
  try {
    const statePath = join(tmp, '.design-kit-state.json');
    writeFileSync(
      statePath,
      JSON.stringify({ schema: 'design-kit-state/1', phase: 'shortlist', shortlistRun: 'runs/sl-1', shortlistFinished: false }),
      'utf8',
    );
    const { ctx, registered } = makeCtx();
    apply(ctx, {});
    const measure = registered.tools.find((item) => item.name === 'probe_measure');
    const blocked = await measure.execute({ command: 'demo' }, { cwd: tmp });
    assert(blocked.ok === false && blocked.error.includes('final'), '未 final 应拒绝 measure：' + blocked.error);
    const review = await measure.execute({ command: 'review' }, { cwd: tmp });
    assert(!(review.error ?? '').includes('尚未 final'), 'review 查看命令不应被状态机拦');
    writeFileSync(
      statePath,
      JSON.stringify({ schema: 'design-kit-state/1', phase: 'shortlist', shortlistRun: 'runs/sl-1', shortlistFinished: true }),
      'utf8',
    );
    const allowed = await measure.execute({ command: 'demo' }, { cwd: tmp });
    assert(!(allowed.error ?? '').includes('尚未 final'), 'final 后不应再被状态机拦');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function schemaProblems(schema, path = 'parameters') {
  const problems = [];
  if (schema === null || typeof schema !== 'object') return problems;
  if (Object.prototype.hasOwnProperty.call(schema, 'required') && !Array.isArray(schema.required)) {
    problems.push(`${path}.required 必须是数组，收到 ${JSON.stringify(schema.required)}`);
  }
  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      problems.push(...schemaProblems(value, `${path}.properties.${key}`));
    }
  }
  if (schema.items) problems.push(...schemaProblems(schema.items, `${path}.items`));
  return problems;
}

await check('工具参数 schema 合法：required 必须是数组（真实宿主曾报 true is not of type array）', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, {});
  for (const tool of registered.tools) {
    const problems = schemaProblems(tool.parameters);
    assert(problems.length === 0, tool.name + '：' + problems.join('；'));
  }
});

await check('shortlist CLI：decide 推进 nextRound，add 按实际轮次编号', () => {
  const cli = readFileSync(join(skillDir, 'probe-kit', 'shortlist.mjs'), 'utf8');
  assert(cli.includes('state.nextRound = (rounds.rounds ?? []).length + 1;'), 'decide 后必须推进 state.nextRound');
  assert(cli.includes('const expectedRound = (rounds.rounds?.length ?? 0) + 1;'), 'add 必须按实际轮次编号，不能依赖旧 nextRound');
});

await check('dispose 调用全部注销器且不抛异常', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx, { timeoutMs: 5000 });
  assert(registered.disposeHandlers.length === 1, '应注册 dispose');
  registered.disposeHandlers[0]();
  assert(registered.disposers === 11, '技能 + 10 工具共 11 个注销器，实际 ' + registered.disposers);
});

await check('B6 技能注册失败：fatal 硬失败（不再只告警）', async () => {
  resetRegistrationHealth();
  const { ctx } = makeCtx();
  const original = ctx.skills.register;
  ctx.skills.register = () => {
    throw new Error('模拟技能注册失败');
  };
  let threw = false;
  try {
    apply(ctx, {});
  } catch {
    threw = true;
  }
  ctx.skills.register = original;
  assert(threw === true, '技能是核心能力，失败应硬失败');
  const health = getRegistrationHealth();
  assert(health && health.level === 'fatal', '技能失败应为 fatal');
  assert(health.skill.registered === 0, '技能计数应为 0');
});

const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log((item.ok ? '✔ ' : '✖ ') + item.name + (item.ok ? '' : '\n    ' + item.error));
}
console.log('\n通过 ' + (results.length - failed.length) + ' / 失败 ' + failed.length);
process.exit(failed.length === 0 ? 0 : 1);
