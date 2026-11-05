#!/usr/bin/env node
// probe-kit CLI：生成盲测回合、收指认记录、落账、复审、应用校准值。
// 零依赖，Node >= 18。协议依据见 SPEC.md 与《Skill 探针协议（泛化版）V0.1》。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSession, inlineSource, validateAnswer, RECORDER_VERSION } from './lib/recorder.mjs';
import { axisById, formatValue, interpolate, intervalOf } from './lib/axis.mjs';
import { analyzeAxisSideEffects, sameSideEffects, sideEffectsSummary } from './lib/side-effects.mjs';
import * as ledger from './lib/ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESENTER_VERSION = '1';
const DEFAULT_LEDGER = join(HERE, 'ledger', 'ledger.jsonl');
const DEFAULT_CONTEXT = { projectType: 'demo', audience: 'owner', device: 'desktop' };
const CONFIDENCE_LABELS = ['猜的', '一般', '比较确定', '非常确定'];

class CliError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.exitCode = code;
  }
}

// ---------- 小工具 ----------
function sha256Short(text, length = 12) {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(path, label) {
  if (!existsSync(path)) throw new CliError(`找不到${label}：${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CliError(`${label}不是合法 JSON：${path}\n${error.message}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** 读台账；坏行等错误统一转成中文 CliError，不把堆栈抛给用户。 */
function readLedger(ledgerPath) {
  try {
    return ledger.readEvents(ledgerPath);
  } catch (error) {
    throw new CliError(`台账读取失败：${error && error.message ? error.message : String(error)}`, 1);
  }
}

function stripVisibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=');
    if (inlineValue !== undefined) {
      args.flags[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args.flags[rawKey] = next;
      i += 1;
    } else {
      args.flags[rawKey] = true;
    }
  }
  return args;
}

function requireFlag(flags, key, usage) {
  const value = flags[key];
  if (typeof value !== 'string' || value === '') throw new CliError(`缺少 --${key} 参数。${usage}`);
  return value;
}

function describeAnswer(manifest, answer) {
  const { resolveVariantValues } = ledger;
  const derived = resolveVariantValues({ runManifest: manifest, answer });
  return derived;
}

// ---------- 构建回合 ----------
function loadAssets() {
  const presenterPath = join(HERE, 'templates', 'presenter.html');
  const recorderPath = join(HERE, 'lib', 'recorder.mjs');
  if (!existsSync(presenterPath)) throw new CliError(`找不到呈现器模板：${presenterPath}`);
  if (!existsSync(recorderPath)) throw new CliError(`找不到指认记录模块：${recorderPath}`);
  return {
    presenterTemplate: readFileSync(presenterPath, 'utf8'),
    recorderSource: inlineSource(readFileSync(recorderPath, 'utf8')),
    presenterPath,
    recorderPath,
  };
}

function assertPresenterTemplate(template) {
  for (const token of ['__PRESENTER_VERSION__', '__RECORDER_JS__', '__RUN_DATA_JSON__']) {
    const count = template.split(token).length - 1;
    if (count !== 1) throw new CliError(`呈现器模板里占位符 ${token} 出现 ${count} 次，应恰好 1 次`);
  }
}

/**
 * 生成一个回合：同一模板 + 单参数替换，只扰动一个维度。
 * 生成前校验骨架一致（把替换值还原后必须与模板逐字节相同）。
 */
function buildRun(options) {
  const {
    axis,
    values,
    runId,
    round,
    seed,
    outRoot,
    title,
    prompt,
    skill = 'ui-craft',
    templateRel = 'fixtures/r4/base.html',
    templatePath = join(HERE, 'fixtures', 'r4', 'base.html'),
  } = options;

  if (!existsSync(templatePath)) throw new CliError(`找不到受控内容模板：${templatePath}`);
  const template = readFileSync(templatePath, 'utf8');
  const placeholderCount = template.split(axis.placeholder).length - 1;
  if (placeholderCount !== 1) {
    throw new CliError(`受控内容模板里占位符 ${axis.placeholder} 出现 ${placeholderCount} 次，应恰好 1 次`);
  }

  const assets = loadAssets();
  assertPresenterTemplate(assets.presenterTemplate);

  const rendered = values.map((value, index) => {
    const color = axis.render(value);
    // 用下标拼接，避免「渲染值恰好也是模板里已有的字面量」（如 17px）污染骨架还原。
    const placeholderIndex = template.indexOf(axis.placeholder);
    const html = template.slice(0, placeholderIndex) + color + template.slice(placeholderIndex + axis.placeholder.length);
    const restored =
      html.slice(0, placeholderIndex) + axis.placeholder + html.slice(placeholderIndex + color.length);
    if (restored !== template) {
      throw new CliError(`变体 ${index + 1} 的骨架与模板不一致：除 ${axis.placeholder} 外还有差异`);
    }
    return { id: `v${index + 1}`, value, html };
  });

  const order = shuffled(rendered, seed);
  const variants = order.map((variant, index) => ({ pos: index + 1, id: variant.id, value: variant.value }));
  const positions = order.map((variant, index) => ({ pos: index + 1, html: variant.html }));
  const createdAt = nowIso();

  // 轴纯度代理：颜色轴算色度漂移；字号/间距轴核对声明位。越界都拒绝发准。
  let sideEffects = null;
  let sideEffectAnalysis = null;
  try {
    sideEffectAnalysis = analyzeAxisSideEffects({ axis, values, templateHtml: template });
  } catch {
    // 该轴还没有副作用代理定义，退回旧行为（仍会在 verify 里提示未验证）。
    sideEffectAnalysis = null;
  }
  if (sideEffectAnalysis !== null) {
    if (!sideEffectAnalysis.ok) {
      throw new CliError(
        `轴副作用越界，拒绝生成这组变体：\n  - ${sideEffectAnalysis.violations.join('\n  - ')}`,
      );
    }
    sideEffects = sideEffectsSummary(sideEffectAnalysis);
  }

  // 目录名与 runId 一起避让重名，避免出现「目录带 -2 但 runId 没变」的错位
  let finalRunId = runId;
  let runDir = join(outRoot, finalRunId);
  let suffix = 2;
  while (existsSync(runDir)) {
    finalRunId = `${runId}-${suffix}`;
    suffix += 1;
    runDir = join(outRoot, finalRunId);
  }

  const runData = {
    schema: 'probe-run/1',
    runId: finalRunId,
    skill,
    title,
    prompt,
    dimLabel: axis.label,
    confidenceLabels: CONFIDENCE_LABELS,
    positions,
    createdAt,
  };

  const runHtml = assets.presenterTemplate
    .split('__PRESENTER_VERSION__').join(PRESENTER_VERSION)
    .split('__RECORDER_JS__').join(assets.recorderSource)
    .split('__RUN_DATA_JSON__').join(JSON.stringify(runData).replace(/<\/script/gi, '<\\/script'));

  for (const token of ['__PRESENTER_VERSION__', '__RECORDER_JS__', '__RUN_DATA_JSON__']) {
    if (runHtml.includes(token)) throw new CliError(`生成的 run.html 里仍残留占位符 ${token}`);
  }

  const manifest = {
    schema: 'probe-run/1',
    runId: finalRunId,
    skill,
    round,
    title,
    prompt,
    dimLabel: axis.label,
    createdAt,
    seed,
    axis: {
      id: axis.id,
      dim: axis.dim,
      label: axis.label,
      kind: axis.kind,
      unit: axis.unit,
      min: axis.min,
      max: axis.max,
      ...(typeof axis.jnd === 'number' ? { jnd: axis.jnd } : {}),
      ...(typeof axis.placeholder === 'string' ? { placeholder: axis.placeholder } : {}),
      ...(typeof axis.sideEffectKind === 'string' ? { sideEffectKind: axis.sideEffectKind } : {}),
    },
    template: { path: templateRel, sha256: sha256Short(template, 16) },
    input: { values },
    variants,
    ...(sideEffects === null ? {} : { sideEffects }),
    files: { run: 'run.html' },
    presenter: { version: PRESENTER_VERSION, recorder: RECORDER_VERSION },
  };

  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'run.html'), runHtml, 'utf8');
  writeJson(join(runDir, 'run.json'), manifest);

  // 盲性自检：页面可见文本里不能出现轴数值
  const visible = stripVisibleText(runHtml);
  for (const variant of rendered) {
    const label = formatValue(axis, variant.value);
    if (visible.includes(label)) throw new CliError(`盲性检查失败：可见文本里出现了数值 ${label}`);
  }

  return { runDir, manifest, rendered };
}

// ---------- 校验 ----------
const AXIS_LOCK_FIELDS = ['dim', 'kind', 'unit', 'min', 'max', 'jnd', 'placeholder', 'sideEffectKind'];

/**
 * A4 锁验证：清单里的轴声明必须与当前已登记轴定义一致，变体值必须在轴范围内。
 * 只比较清单里实际存在的字段，兼容旧清单；不启动 AST（当前是模板填充架构）。
 */
export function axisLockProblems(manifest) {
  const problems = [];
  const declaration = manifest?.axis;
  if (!declaration || typeof declaration.id !== 'string' || declaration.id === '') {
    return ['清单缺少轴声明（axis.id）'];
  }
  let axis;
  try {
    axis = axisById(declaration.id);
  } catch {
    return [`未知轴：${declaration.id}；只接受已登记轴（r4/r5/r6），未知/伪造轴拒收`];
  }
  for (const field of AXIS_LOCK_FIELDS) {
    if (declaration[field] === undefined) continue;
    if (JSON.stringify(declaration[field]) !== JSON.stringify(axis[field])) {
      problems.push(`轴锁不一致：${field} 清单=${JSON.stringify(declaration[field])} 定义=${JSON.stringify(axis[field])}`);
    }
  }
  const values = (manifest.variants ?? []).map((variant) => variant.value);
  if (values.length === 0) problems.push('轴锁失败：清单没有变体值');
  for (const value of values) {
    if (!Number.isFinite(value) || value < axis.min || value > axis.max) {
      problems.push(`轴锁失败：变体值 ${JSON.stringify(value)} 超出 ${axis.id} 范围 [${axis.min}, ${axis.max}]`);
    }
  }
  return problems;
}

function verifyRun(runDir) {
  const manifest = readJson(join(runDir, 'run.json'), '运行清单');
  const runHtmlPath = join(runDir, manifest.files?.run ?? 'run.html');
  if (!existsSync(runHtmlPath)) throw new CliError(`找不到 run.html：${runHtmlPath}`);
  const runHtml = readFileSync(runHtmlPath, 'utf8');
  const problems = [];

  if (manifest.schema !== 'probe-run/1') problems.push(`清单 schema 异常：${manifest.schema}`);
  if (!Array.isArray(manifest.variants) || manifest.variants.length < 2) problems.push('变体数量少于 2');
  const positions = (manifest.variants ?? []).map((v) => v.pos).sort((a, b) => a - b);
  const expectedPositions = Array.from({ length: positions.length }, (_, i) => i + 1);
  if (positions.join(',') !== expectedPositions.join(',')) problems.push(`位置编号不连续：${positions.join(',')}`);

  // ---------- 骨架一致性 + 值 ↔ 页面绑定 ----------
  const axis = axisById(manifest.axis?.id ?? 'r4');
  problems.push(...axisLockProblems(manifest));
  const templatePath = join(HERE, manifest.template?.path ?? 'fixtures/r4/base.html');
  let template = null;
  if (!existsSync(templatePath)) {
    problems.push(`找不到受控内容模板：${templatePath}`);
  } else {
    template = readFileSync(templatePath, 'utf8');
    if (sha256Short(template, 16) !== manifest.template?.sha256) {
      problems.push('受控内容模板已变化，与清单里的 sha256 不一致');
    }
  }

  // 用清单里的 input.values + seed 重放生成顺序，防止清单被改法后仍「通过」
  const inputValues = Array.isArray(manifest.input?.values) ? manifest.input.values : null;
  if (inputValues === null) {
    problems.push('清单缺少 input.values（旧版本生成或已被篡改）；旧回合请用当前版本重新 build 后再落账');
  } else if (template !== null) {
    const rendered = inputValues.map((value, index) => ({
      id: `v${index + 1}`,
      value,
      html: template.replace(axis.placeholder, axis.render(value)),
    }));
    const replay = shuffled(rendered, manifest.seed);
    const expected = replay.map((variant, index) => ({ pos: index + 1, id: variant.id, value: variant.value }));
    const actual = [...(manifest.variants ?? [])]
      .sort((a, b) => a.pos - b.pos)
      .map((variant) => ({ pos: variant.pos, id: variant.id, value: variant.value }));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push('清单里的顺序/数值与 seed 重放结果不一致（疑似被篡改）');
    }
  }

  // 数值或变体 id 不应出现在页面可见文本与常见属性里（盲性）
  const visible = stripVisibleText(runHtml);
  const attributeText = [...runHtml.matchAll(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? '')
    .join(' ');
  const scanText = `${visible} ${attributeText}`;
  const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const containsToken = (token) => new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(token)}([^A-Za-z0-9_-]|$)`).test(scanText);
  for (const variant of manifest.variants ?? []) {
    const label = formatValue(axis, variant.value);
    if (containsToken(label)) problems.push(`可见文本或属性里出现数值 ${label}`);
    if (containsToken(variant.id)) problems.push(`可见文本或属性里出现变体 id ${variant.id}`);
  }
  // 通用百分数/小数泄露（防止把其它轴的数值注入页面绕过逐值检查）
  for (const match of scanText.matchAll(/\d{1,3}(?:\.\d+)?\s*%/g)) {
    problems.push(`可见文本或属性里出现百分数 ${match[0].trim()}，可能泄露轴值`);
  }
  for (const match of scanText.matchAll(/(?:^|[^\d.])(0\.\d{2,})(?![\d.])/g)) {
    problems.push(`可见文本或属性里出现小数 ${match[1]}`);
  }

  // 轴副作用：重算并比对。旧清单没有该字段就跳过（向后兼容）。
  if (manifest.sideEffects !== undefined && manifest.sideEffects !== null) {
    if (template === null) {
      problems.push('清单有轴副作用记录，但受控模板缺失，无法重算');
    } else if (inputValues !== null) {
      try {
        const fresh = sideEffectsSummary(analyzeAxisSideEffects({ axis, values: inputValues, templateHtml: template }));
        if (!sameSideEffects(manifest.sideEffects, fresh)) {
          problems.push('轴副作用记录与重算结果不一致（清单可能被篡改）');
        }
        if (!fresh.ok) problems.push(`轴副作用越界：${fresh.violations.join('；')}`);
      } catch (error) {
        problems.push(`轴副作用重算失败：${error.message}`);
      }
    }
  }

  // 占位符与内联脚本
  if (runHtml.includes('__PRESENTER_VERSION__') || runHtml.includes('__RECORDER_JS__') || runHtml.includes('__RUN_DATA_JSON__')) {
    problems.push('run.html 仍残留占位符');
  }
  const jsonBlock = /<script[^>]*id="run-data"[^>]*>([\s\S]*?)<\/script>/i.exec(runHtml);
  if (!jsonBlock) problems.push('run.html 里找不到 run-data JSON');
  else {
    try {
      const parsed = JSON.parse(jsonBlock[1]);
      if (parsed.positions?.length !== manifest.variants?.length) problems.push('run-data 的位置数量与清单不一致');
      for (const position of parsed.positions ?? []) {
        const variant = (manifest.variants ?? []).find((item) => item.pos === position.pos);
        if (!variant) {
          problems.push(`run-data 里有清单中不存在的 位置 ${position.pos}`);
          continue;
        }
        if (template !== null) {
          const expectedHtml = template.replace(axis.placeholder, axis.render(variant.value));
          if (position.html !== expectedHtml) {
            problems.push(`位置 ${position.pos} 的页面内容与清单数值不一致（疑似被篡改）`);
          }
        }
      }
    } catch (error) {
      problems.push(`run-data JSON 解析失败：${error.message}`);
    }
  }

  const checklist = [
    ['骨架一致（单占位符替换）', !problems.some((p) => p.includes('骨架') || p.includes('sha256'))],
    ['列表顺序可用 seed 重放', !problems.some((p) => p.includes('seed 重放') || p.includes('input.values'))],
    ['数值与页内容绑定', !problems.some((p) => p.includes('页面内容与清单数值不一致'))],
    ['盲性（无数值 / 变体 id / 百分数泄露）', !problems.some((p) => p.includes('可见文本') || p.includes('百分数') || p.includes('小数'))],
    ['清单与页面占位符干净', !problems.some((p) => p.includes('占位符'))],
    ['run-data 可解析且与清单一致', !problems.some((p) => p.includes('run-data'))],
  ];
  // 只有新版回合记录了副作用才展示这一项，避免旧回合出现误导性的「通过」
  if (manifest.sideEffects !== undefined && manifest.sideEffects !== null) {
    const sideEffectLabel =
      manifest.sideEffects.kind === 'declaration'
        ? '轴副作用在界内（声明位正确，已知耦合已登记）'
        : '轴副作用在界内（色相/明度/对比度未串维）';
    checklist.push([sideEffectLabel, !problems.some((p) => p.includes('副作用'))]);
  }

  return { ok: problems.length === 0, problems, checklist, manifest, runDir };
}

// ---------- 命令 ----------
const DEMO_PRESETS = {
  r4: {
    runId: 'r4-demo-1',
    values: [0.25, 0.5, 0.75],
    title: '偏好校准 · 强调色的蓝饱和度',
    prompt: '同一张卡片，只有强调色的饱和度不同。凭直觉选一个；也可以点两个，表示「在两者之间」。',
  },
  r5: {
    runId: 'r5-demo-1',
    values: [15, 17, 19],
    title: '偏好校准 · 正文基准字号',
    prompt: '同一张卡片，只有正文基准字号不同。凭直觉选一个；也可以点两个，表示「在两者之间」。',
  },
  r6: {
    runId: 'r6-demo-1',
    values: [12, 24, 36],
    title: '偏好校准 · 页面纵向节奏',
    prompt: '同一张卡片，只有纵向节奏（页头留白、内边距、分组间距）不同。凭直觉选一个；也可以点两个，表示「在两者之间」。',
  },
};

function cmdDemo(args) {
  const axisId = typeof args.flags.axis === 'string' ? args.flags.axis : 'r4';
  const axis = axisById(axisId);
  const preset = DEMO_PRESETS[axisId];
  if (preset === undefined) throw new CliError(`demo 暂只支持 r4/r5/r6 三条轴，收到 ${axisId}`, 2);
  const seedFlag = args.flags.seed;
  const seed = seedFlag === undefined ? 7 : Number(seedFlag);
  if (!Number.isInteger(seed)) throw new CliError('--seed 需要整数');
  const outRoot = resolve(HERE, typeof args.flags.out === 'string' ? args.flags.out : 'runs');
  if (typeof axis.templateRel !== 'string') throw new CliError(`轴 ${axisId} 缺少 demo 用的受控模板`, 1);
  const { runDir, manifest } = buildRun({
    axis,
    values: preset.values,
    runId: preset.runId,
    round: 1,
    seed,
    outRoot,
    title: preset.title,
    prompt: preset.prompt,
    templateRel: axis.templateRel,
    templatePath: join(HERE, axis.templateRel),
  });
  const rel = relative(process.cwd(), runDir) || runDir;
  console.log(`\n已生成回合 ${manifest.runId}（round ${manifest.round}，轴 ${axis.id} · ${axis.label}）`);
  console.log(`  目录: ${rel}`);
  console.log(`  页面: ${join(rel, 'run.html')}`);
  console.log(`  变体: ${manifest.variants.map((v) => `位置 ${v.pos}`).join(' / ')}（顺序由 seed ${manifest.seed} 随机化并已记录）`);
  console.log('\n下一步：');
  console.log(`  1) 用浏览器打开 ${join(rel, 'run.html')}（本地文件，不联网）`);
  console.log('  2) 盲选或指区间，点「锁定本回合」，下载 answer-*.jsonl');
  console.log(`  3) node probe-kit/probe.mjs append --run ${rel} --answer <下载的文件>`);
  console.log('  4) node probe-kit/probe.mjs review');
  return 0;
}

/**
 * 区间插值前的分辨率闸门。
 *
 * 插值会在端点之间生成 1/4、1/2、3/4 三个内部点，相邻两点只差 width/4。
 * 要让这三个变体彼此可辨，必须有 width/4 ≥ JND，即 width ≥ 4×JND。
 * 早先只要求 2×JND（端点差 2 个 JND），但中间点仍可能互相不可辨，是真实使用暴露的规则漏洞。
 */
function assertInterpolable(axis, va, vb, { force = false } = {}) {
  const width = Math.abs(vb - va);
  if (typeof axis.jnd === 'number' && axis.jnd > 0 && width < axis.jnd * 4 && force !== true) {
    throw new CliError(
      `区间宽 ${formatValue(axis, width)}，低于 4×JND（${formatValue(axis, axis.jnd * 4)}）：` +
        `插值后相邻变体只差 ${formatValue(axis, width / 4)}，低于可辨阈值 ${formatValue(axis, axis.jnd)}，再细分也看不出差别。\n` +
        '按协议应停止细分，把结论写成「该区间内等效/不敏感」；确实要强行跑用 --force。',
      2,
    );
  }
  return width;
}

function cmdBuild(args) {
  const fromRun = requireFlag(args.flags, 'from-run', '用法：probe.mjs build --from-run <dir> --between 1,3');
  const betweenRaw = requireFlag(args.flags, 'between', '例如 --between 1,3 表示在位置 1 与 3 之间插值');
  const runDir = resolve(process.cwd(), fromRun);
  const parent = readJson(join(runDir, 'run.json'), '运行清单');
  const parentIntegrity = verifyRun(runDir);
  if (!parentIntegrity.ok) {
    throw new CliError(
      '父回合锁验证失败，拒绝插值（父回合可能被篡改或过了轴定义）：\n  - ' + parentIntegrity.problems.join('\n  - '),
      1,
    );
  }
  const axis = axisById(parent.axis?.id ?? 'r4');
  const parts = betweenRaw.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 2 || parts.some((p) => !Number.isInteger(p))) throw new CliError('--between 需要两个位置编号，例如 1,3');
  const [a, b] = parts;
  const findValue = (pos) => {
    const variant = parent.variants.find((v) => v.pos === pos);
    if (!variant) throw new CliError(`位置 ${pos} 不在回合 ${parent.runId} 里`);
    return variant.value;
  };
  const va = findValue(a);
  const vb = findValue(b);
  if (va === vb) throw new CliError('两个端点的值相同，无法插值');
  const values = interpolate(axis, va, vb);
  const round = Number(args.flags.round ?? (parent.round ?? 1) + 1);
  if (!Number.isInteger(round) || round < 2) throw new CliError('--round 需要 >= 2 的整数');
  const width = assertInterpolable(axis, va, vb, { force: args.flags.force === true });
  if (typeof axis.jnd === 'number' && axis.jnd > 0) {
    console.log(
      `  JND 提示: 该轴可辨识阈值约 ${formatValue(axis, axis.jnd)}，区间宽 ${formatValue(axis, width)}，` +
        `插值后相邻变体差 ${formatValue(axis, width / 4)}` +
        (args.flags.force === true ? '（--force 已强制细分，结论只能算弱证据）' : ''),
    );
  }
  const outRoot = resolve(HERE, typeof args.flags.out === 'string' ? args.flags.out : 'runs');
  const parentTemplateRel = typeof parent.template?.path === 'string' ? parent.template.path : 'fixtures/r4/base.html';
  const { runDir: newDir, manifest } = buildRun({
    axis,
    values,
    runId: `${parent.runId}-r${round}`,
    round,
    seed: Number(args.flags.seed ?? parent.seed ?? 7),
    outRoot,
    title: parent.title,
    prompt: '这是上一轮指认区间内的微变体。同样凭直觉选一个，或再指一个更窄的区间。',
    templateRel: parentTemplateRel,
    templatePath: join(HERE, parentTemplateRel),
  });
  const rel = relative(process.cwd(), newDir) || newDir;
  console.log(`\n已生成第 ${round} 轮回合 ${manifest.runId}`);
  console.log(`  插值区间: 位置 ${a}（${formatValue(axis, va)}）到位置 ${b}（${formatValue(axis, vb)}）`);
  console.log(`  微变体值: ${values.map((v) => formatValue(axis, v)).join(' / ')}（数值不进入页面，只写台账）`);
  console.log(`  页面: ${join(rel, 'run.html')}`);
  return 0;
}

function resolveLedgerPath(flags) {
  return typeof flags.ledger === 'string' ? resolve(process.cwd(), flags.ledger) : DEFAULT_LEDGER;
}

/** 项目级授权：只回答「这个项目值不值得花采样预算探这个维度」，只开频谱采样，不开放插值。 */
function normalizeAuthorization(input, fallbackAt = nowIso()) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new CliError('authorization 必须是对象，例如 { "question": "这个项目值不值得探间距？", "scope": "spectrum_only" }', 2);
  }
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (question === '') {
    throw new CliError('authorization.question 必须是非空字符串：写清「这个项目值不值得花预算探这个维度」', 2);
  }
  if (input.scope !== undefined && input.scope !== 'spectrum_only') {
    throw new CliError("authorization.scope 只能是 'spectrum_only'（授权不判定轴成立，也不开放插值）", 2);
  }
  const grantedBy = typeof input.grantedBy === 'string' && input.grantedBy.trim() !== '' ? input.grantedBy.trim() : 'user';
  const authorizedAt = typeof input.authorizedAt === 'string' && input.authorizedAt !== '' ? input.authorizedAt : fallbackAt;
  return { question, scope: 'spectrum_only', grantedBy, authorizedAt };
}

function cmdAppend(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：probe.mjs append --run runs/r4-demo-1 --answer answer.jsonl');
  const answerFlag = requireFlag(args.flags, 'answer', '用法：probe.mjs append --run <dir> --answer <file.jsonl>');
  const runDir = resolve(process.cwd(), runFlag);
  const manifest = readJson(join(runDir, 'run.json'), '运行清单');

  // 完整性门：先验证回合未被篡改，再允许落账
  const integrity = verifyRun(runDir);
  if (!integrity.ok) {
    throw new CliError(
      '回合完整性校验失败，拒绝落账（防止台账记录与页面所见不一致）：\n  - ' + integrity.problems.join('\n  - '),
      1,
    );
  }
  const ledgerPath = resolveLedgerPath(args.flags);
  const existing = readLedger(ledgerPath);
  if (existing.some((event) => event.t === 'run.recorded' && event.runId === manifest.runId)) {
    throw new CliError(
      `回合 ${manifest.runId} 已经落账。append-only 台账不允许重复记录同一回合；如要重测请生成新回合。`,
      1,
    );
  }

  const answerPath = resolve(process.cwd(), answerFlag);
  if (!existsSync(answerPath)) throw new CliError(`找不到答案文件：${answerPath}`);
  const raw = readFileSync(answerPath, 'utf8').trim().split('\n').filter(Boolean);
  if (raw.length !== 1) throw new CliError(`答案文件应恰好一行 JSON，实际 ${raw.length} 行`);
  let answer;
  try {
    answer = JSON.parse(raw[0]);
  } catch (error) {
    throw new CliError(`答案不是合法 JSON：${error.message}`, 1);
  }
  if (answer.runId !== manifest.runId) throw new CliError(`答案的 runId（${answer.runId}）与回合（${manifest.runId}）不一致`, 1);
  const check = validateAnswer(answer, manifest.variants.length);
  if (!check.ok) throw new CliError(`答案记录不合法：\n  - ${check.errors.join('\n  - ')}`, 1);

  let context = DEFAULT_CONTEXT;
  if (typeof args.flags['context-file'] === 'string') {
    context = readJson(resolve(process.cwd(), args.flags['context-file']), '情境文件');
  }
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    throw new CliError('情境（context）必须是对象', 2);
  }
  if (context.authorization !== undefined) {
    context = { ...context, authorization: normalizeAuthorization(context.authorization) };
  }
  const env = {
    platform: process.platform,
    node: process.versions.node,
    presenter: manifest.presenter?.version ?? PRESENTER_VERSION,
    recorder: answer.recorder ?? RECORDER_VERSION,
  };
  env.fingerprint = ledger.envFingerprint(env);
  const event = ledger.makeRunEvent({ runManifest: manifest, answer, context, env, round: manifest.round });
  const eventCheck = ledger.validateEvent(event);
  if (!eventCheck.ok) throw new CliError(`事件校验失败：\n  - ${eventCheck.errors.join('\n  - ')}`, 1);
  const appended = ledger.appendEvent(ledgerPath, event);
  if (!appended.ok) throw new CliError(`写入台账失败：${appended.error}`, 1);

  const derived = event.derived ?? {};
  console.log('\n已落账 run.recorded');
  console.log(`  台账: ${relative(process.cwd(), ledgerPath) || ledgerPath}`);
  console.log(`  回合: ${event.runId} · round ${event.round}`);
  console.log(`  指认: ${event.answer.kind === 'between' ? `位置 ${event.answer.betweenPos.join(' 与 ')} 之间` : `位置 ${event.answer.chosenPos}`}`);
  console.log(`  解析值: ${derived.chosenValue === undefined ? '?' : formatValue(axisById(manifest.axis.id), derived.chosenValue)}`);
  console.log(`  翻转: ${event.answer.flips} 次 · 把握: ${event.answer.confidence ?? '未填'} · 用时: ${(event.answer.durationMs / 1000).toFixed(1)}s`);
  console.log('下一步: node probe-kit/probe.mjs attribute ...（归因）然后 node probe-kit/probe.mjs review');
  return 0;
}

function cmdAttribute(args) {
  const runId = requireFlag(args.flags, 'run', '用法：probe.mjs attribute --run <runId> --assumption ... --falsified-by ... --boundary ... --confidence low|medium|high');
  const confidence = requireFlag(args.flags, 'confidence', '--confidence 只能是 low / medium / high');
  if (!['low', 'medium', 'high'].includes(confidence)) throw new CliError('--confidence 只能是 low / medium / high');
  const event = {
    t: 'attribution.recorded',
    schema: ledger.LEDGER_SCHEMA,
    at: nowIso(),
    runId,
    assumption: requireFlag(args.flags, 'assumption', '--assumption 写被检验的隐含假设'),
    falsifiedBy: requireFlag(args.flags, 'falsified-by', '--falsified-by 写什么证据推翻了它'),
    boundary: requireFlag(args.flags, 'boundary', '--boundary 写反推出来的适用边界'),
    confidence,
  };
  if (typeof args.flags.note === 'string') event.note = args.flags.note;
  const check = ledger.validateEvent(event);
  if (!check.ok) throw new CliError(`归因事件不合法：\n  - ${check.errors.join('\n  - ')}`, 1);
  const ledgerPath = resolveLedgerPath(args.flags);
  const appended = ledger.appendEvent(ledgerPath, event);
  if (!appended.ok) throw new CliError(`写入台账失败：${appended.error}`, 1);
  console.log(`\n已落账 attribution.recorded（runId=${runId}，confidence=${confidence}）`);
  return 0;
}

function cmdReview(args) {
  const ledgerPath = resolveLedgerPath(args.flags);
  const events = readLedger(ledgerPath);
  if (events.length === 0) {
    console.log(`台账为空：${ledgerPath}\n先跑 demo 生成回合，再用 append 落账。`);
    return 0;
  }
  const now = typeof args.flags.now === 'string' ? new Date(args.flags.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new CliError('--now 需要合法时间，例如 2026-11-20T00:00:00Z');
  const env = {
    platform: process.platform,
    node: process.versions.node,
    presenter: PRESENTER_VERSION,
    recorder: RECORDER_VERSION,
  };
  env.fingerprint = ledger.envFingerprint(env);
  const state = ledger.reviewState({ events, now: now.toISOString(), envFingerprint: env.fingerprint });

  const runFilter = typeof args.flags.run === 'string' ? args.flags.run : null;
  let dims = state.dims ?? [];
  if (runFilter) {
    const runEvent = [...events].reverse().find((event) => event.t === 'run.recorded' && event.runId === runFilter);
    if (!runEvent) throw new CliError(`台账里找不到 runId=${runFilter} 的 run.recorded`, 1);
    const contextKey = JSON.stringify(runEvent.context ?? null);
    dims = dims.filter((dim) => dim.dim === runEvent.dim && JSON.stringify(dim.context ?? null) === contextKey);
  }

  console.log(`\n台账复审 · ${now.toISOString()}`);
  console.log(`台账: ${ledgerPath}`);
  if (runFilter) console.log(`范围: 只看回合 ${runFilter}`);
  for (const dim of dims) {
    const conv = dim.convergence ?? {};
    console.log(`\n维度 ${dim.dim} · 情境 ${JSON.stringify(dim.context ?? {})}`);
    console.log(`  状态: ${dim.state}  ·  轮次: ${dim.runCount}/${dim.maxRuns}  ·  到期: ${dim.validUntil ?? '—'}`);
    console.log(`  凭证类型: ${dim.kind ?? 'unverified'}${dim.kindReason ? ` · ${dim.kindReason}` : ''}`);
    if (dim.context?.authorization) {
      const authorization = dim.context.authorization;
      console.log(
        `  项目授权: ${authorization.question}（范围 ${authorization.scope}；授权人 ${authorization.grantedBy}；只开频谱采样，不开放插值）`,
      );
    }
    if (dim.reasons?.length) console.log(`  理由: ${dim.reasons.join('；')}`);
    console.log(`  收敛: ${conv.verdict ?? '—'}${conv.note ? ` · ${conv.note}` : ''}`);
    console.log(`  校准版本: ${dim.appliedVersions ?? 0}`);

    const contextKey = JSON.stringify(dim.context ?? null);
    const dimRuns = events
      .filter((event) => event.t === 'run.recorded' && event.dim === dim.dim && JSON.stringify(event.context ?? null) === contextKey)
      .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    const latestRun = dimRuns.at(-1);
    if (latestRun) {
      const axis = axisById(latestRun.axis?.id ?? 'r4');
      let sameBand = null;
      if (typeof axis.jnd === 'number' && axis.jnd > 0 && dimRuns.length >= 2) {
        const previousValue = dimRuns[dimRuns.length - 2].derived?.chosenValue;
        const latestValue = latestRun.derived?.chosenValue;
        if (typeof previousValue === 'number' && typeof latestValue === 'number') {
          const delta = Math.abs(latestValue - previousValue);
          if (delta <= axis.jnd) {
            sameBand = { delta, lo: Math.min(previousValue, latestValue), hi: Math.max(previousValue, latestValue) };
          }
        }
      }

      const interval = latestRun.derived?.interval;
      console.log(
        sameBand
          ? `  边界: 等效带 [${formatNumber(sameBand.lo)}, ${formatNumber(sameBand.hi)}]（与上一轮差 ${formatValue(axis, sameBand.delta)} ≤ JND，不构成偏好移动）`
          : interval
            ? `  边界: 用户指认区间 [${formatNumber(interval.lo)}, ${formatNumber(interval.hi)}]`
            : `  边界: 单点指认 ${formatNumber(latestRun.derived?.chosenValue)}，无区间，边界未知`,
      );
      const attribution = [...events]
        .reverse()
        .find((event) => event.t === 'attribution.recorded' && event.runId === latestRun.runId);
      if (attribution) console.log(`  归因边界: ${attribution.boundary}`);
      if (latestRun.sideEffects !== undefined && latestRun.sideEffects !== null) {
        const effects = latestRun.sideEffects;
        if (effects.kind === 'declaration') {
          console.log(
            `  轴副作用: 声明位 ${effects.property ?? '—'}（期望 ${effects.expectedProperty ?? '—'}）· ` +
              (effects.ok ? '在界内' : '越界'),
          );
          if (Array.isArray(effects.knownCouplings) && effects.knownCouplings.length > 0) {
            console.log(`  已知耦合（已声明、未测量）: ${effects.knownCouplings.join('；')}`);
          }
          if (!effects.ok) console.log(`  副作用告警: ${(effects.violations ?? []).join('；')}`);
        } else {
          const deltas = effects.deltas ?? {};
          const lightnessPt = typeof deltas.lightness === 'number' ? (deltas.lightness * 100).toFixed(2) : '—';
          console.log(
            `  轴副作用: 色相Δ ${deltas.hueDeg ?? '—'}° · 明度Δ ${lightnessPt}pt · 对比度Δ ${deltas.contrastRatio ?? '—'} · ` +
              (effects.ok ? '在阈值内（饱和度轴没有串维）' : '越界'),
          );
          if (!effects.ok) console.log(`  副作用告警: ${(effects.violations ?? []).join('；')}`);
        }
      }

      const answer = latestRun.answer ?? {};
      const confidence = typeof answer.confidence === 'number' ? answer.confidence : null;
      const flips = Number.isInteger(answer.flips) ? answer.flips : 0;
      const seconds = Math.round((answer.durationMs ?? 0) / 1000);
      const lowConfidence = (confidence !== null && confidence <= 2) || flips >= 10;
      console.log(
        `  指认质量: 翻转 ${flips} · 把握 ${confidence ?? '未填'} · 用时 ${seconds}s` +
          (lowConfidence ? ' → 低置信度：按协议应转 human-review，不作强证据' : ''),
      );
      const viewportWidth = latestRun.answer?.env?.viewport?.w;
      if (typeof viewportWidth === 'number' && viewportWidth < 1100) {
        console.log(
          `  视口提示: 宽度 ${viewportWidth}px，3 列呈现器约需 1120px；可能只看到部分变体，结论按「未完整查看」处理`,
        );
      }

      if (typeof axis.jnd === 'number' && axis.jnd > 0) {
        console.log(`  轴分辨率: JND ≈ ${formatValue(axis, axis.jnd)}（低于此差异视为同一档，再细分没有意义）`);
        if (sameBand) {
          console.log(
            `  同档提示: 最近两轮差 ${formatValue(axis, sameBand.delta)} ≤ JND，判定为「同一档」，不构成偏好移动证据`,
          );
        }
      }
    }
  }
  console.log('\n协议诚实警告（不改数据，只提示解释边界）：');
  for (const warning of state.warnings ?? []) console.log(`  - ${warning}`);
  const needsReview = dims.filter((dim) => dim.state !== 'fresh');
  console.log(
    needsReview.length === 0
      ? '\n结论: 所选维度都在有效期内。'
      : `\n结论: ${needsReview.length} 个维度需要复审（${needsReview.map((dim) => dim.dim).join('、')}）。到期复审是回归测试，不是重开探索。`,
  );
  return 0;
}

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return String(Math.round(value * 10000) / 10000);
}

function cmdRevoke(args) {
  const ledgerPath = resolveLedgerPath(args.flags);
  const reason = requireFlag(args.flags, 'reason', '用法：probe.mjs revoke --run <runId> 或 --dim <dim> --reason <原因>');
  const events = readLedger(ledgerPath);
  const runId = typeof args.flags.run === 'string' ? args.flags.run : null;
  let dim = typeof args.flags.dim === 'string' ? args.flags.dim : null;
  let context;
  if (runId) {
    const runEvent = [...events].reverse().find((event) => event.t === 'run.recorded' && event.runId === runId);
    if (!runEvent) throw new CliError(`台账里找不到 runId=${runId} 的 run.recorded`, 1);
    dim = dim ?? runEvent.dim;
    context = runEvent.context;
  }
  if (!dim) throw new CliError('需要 --run <runId> 或 --dim <dim> 指定要吊销的维度', 2);
  const event = { t: 'credential.revoked', schema: ledger.LEDGER_SCHEMA, at: nowIso(), dims: [dim], reason };
  if (context !== undefined) event.context = context;
  const check = ledger.validateEvent(event);
  if (!check.ok) throw new CliError(`吊销事件不合法：\n  - ${check.errors.join('\n  - ')}`, 1);
  const appended = ledger.appendEvent(ledgerPath, event);
  if (!appended.ok) throw new CliError(`写入台账失败：${appended.error}`, 1);
  console.log(`\n已落账 credential.revoked：维度 ${dim}${context ? ` · 情境 ${JSON.stringify(context)}` : ''}`);
  console.log(`  原因: ${reason}`);
  console.log('  该维度接下来会被复审判为 expired，apply 会拒绝写校准值。');
  return 0;
}

/**
 * 凭证三态的写入门槛（V0.2）。
 * 默认只告警：unverified / exploration 仍可写「未验证默认值」，保持旧流程可用。
 * --strict：只有 axis 凭证允许写校准值，其余直接拒绝。
 */
function checkApplyCredential(cred, { strict = false } = {}) {
  const kind = cred && typeof cred.kind === 'string' ? cred.kind : 'unverified';
  if (kind === 'axis') return kind;
  const reason = cred && typeof cred.kindReason === 'string' ? cred.kindReason : '';
  if (strict) {
    throw new CliError(
      `--strict：凭证类型 ${kind}（${reason || '未知原因'}），不允许写校准值。\n` +
        '继续取样到 axis（副作用在界内 + 收敛 evidence），或去掉 --strict 只写弱默认值。',
      1,
    );
  }
  return kind;
}

function cmdApply(args) {
  const runId = requireFlag(args.flags, 'run', '用法：probe.mjs apply --run <runId> --out calibration.json');
  const outPath = resolve(process.cwd(), requireFlag(args.flags, 'out', '--out 指定校准文件路径'));
  const ledgerPath = resolveLedgerPath(args.flags);
  const events = readLedger(ledgerPath);
  const runEvent = [...events].reverse().find((e) => e.t === 'run.recorded' && e.runId === runId);
  if (!runEvent) throw new CliError(`台账里找不到 runId=${runId} 的 run.recorded`, 1);
  const applyAt = typeof args.flags.now === 'string' ? new Date(args.flags.now) : new Date();
  if (Number.isNaN(applyAt.getTime())) throw new CliError('--now 需要合法时间，例如 2026-11-20T00:00:00Z');
  const env = {
    platform: process.platform,
    node: process.versions.node,
    presenter: PRESENTER_VERSION,
    recorder: RECORDER_VERSION,
  };
  env.fingerprint = ledger.envFingerprint(env);
  const cred = ledger.credentialState({
    events,
    dim: runEvent.dim,
    context: runEvent.context,
    now: applyAt.toISOString(),
    envFingerprint: env.fingerprint,
  });
  if (cred.state === 'expired') {
    throw new CliError(
      `凭证已过期，拒绝写校准值。理由：${(cred.reasons ?? []).join('；') || '未知'}。先复审或用新回合重测。`,
      1,
    );
  }
  if (cred.state === 'due') {
    console.warn(`注意：凭证状态为 due（${(cred.reasons ?? []).join('；') || '临期'}），写入后请尽快安排到期复审。`);
  }
  const kind = checkApplyCredential(cred, { strict: args.flags.strict === true });
  if (kind === 'unverified') {
    console.warn(`注意：凭证类型 unverified（${cred.kindReason}）——本次写入只作为未验证默认值，不能当单轴证据。`);
  } else if (kind === 'exploration') {
    console.warn(`注意：凭证类型 exploration（${cred.kindReason}）——插值只作探索性默认值。`);
  } else {
    console.log(`凭证类型: axis（${cred.kindReason}）`);
  }
  const axisId = runEvent.axis?.id ?? 'r4';
  const axis = axisById(axisId);
  const value = runEvent.derived?.chosenValue;
  if (typeof value !== 'number') throw new CliError('run.recorded 里缺少 derived.chosenValue', 1);
  const attribution = [...events].reverse().find((e) => e.t === 'attribution.recorded' && e.runId === runId);
  const convergenceResult = ledger.convergence({ events, dim: runEvent.dim, context: runEvent.context });
  let jndBand = Array.isArray(convergenceResult?.jndBand) ? convergenceResult.jndBand : null;
  if (!jndBand && typeof axis.jnd === 'number' && axis.jnd > 0 && (convergenceResult?.rounds?.length ?? 0) >= 2) {
    const rounds = convergenceResult.rounds;
    const previousValue = rounds[rounds.length - 2].chosenValue;
    const latestValue = rounds[rounds.length - 1].chosenValue;
    if (Math.abs(latestValue - previousValue) <= axis.jnd) {
      jndBand = [Math.min(previousValue, latestValue), Math.max(previousValue, latestValue)];
    }
  }
  const boundary = jndBand
    ? {
        kind: 'jnd-band',
        lo: jndBand[0],
        hi: jndBand[1],
        note: `最近两轮差低于可辨识阈值 JND（${formatValue(axis, axis.jnd)}），两者等效；默认值取最近一次指认，不主张区间内更细的差异`,
      }
    : runEvent.derived?.interval
      ? {
          kind: 'interval',
          lo: runEvent.derived.interval.lo,
          hi: runEvent.derived.interval.hi,
          note: `用户指认区间 ${formatValue(axis, runEvent.derived.interval.lo)}..${formatValue(axis, runEvent.derived.interval.hi)}`,
        }
      : { kind: 'point', value, note: '单点指认，无区间，边界未知' };
  const calibration = {
    schema: 'calibration/1',
    dim: runEvent.dim,
    value,
    formatted: formatValue(axis, value),
    source: { runId, round: runEvent.round, recordedAt: runEvent.at },
    context: runEvent.context,
    boundary,
    convergence: {
      verdict: convergenceResult?.verdict ?? null,
      note: convergenceResult?.note ?? null,
    },
    attribution: attribution
      ? { assumption: attribution.assumption, boundary: attribution.boundary, confidence: attribution.confidence }
      : null,
    expires: {
      validUntil: cred.validUntil,
      maxRuns: cred.maxRuns,
      runCount: cred.runCount,
      envFingerprint: cred.fingerprint,
    },
    appliedAt: nowIso(),
  };
  writeJson(outPath, calibration);
  ledger.appendEvent(ledgerPath, {
    t: 'calibration.applied',
    schema: ledger.LEDGER_SCHEMA,
    at: nowIso(),
    runId,
    dim: runEvent.dim,
    value,
    out: relative(process.cwd(), outPath) || outPath,
  });
  console.log(`\n已写校准值: ${outPath}`);
  console.log(`  ${runEvent.dim} = ${formatValue(axis, value)}（来源 ${runId} · round ${runEvent.round}）`);
  console.log(`  到期: ${cred.validUntil} · 轮次 ${cred.runCount}/${cred.maxRuns}`);
  console.log('  消费规则：只允许作为默认值使用，不参与评分与排序。');
  return 0;
}

function cmdStatus(args) {
  const ledgerPath = resolveLedgerPath(args.flags);
  const events = readLedger(ledgerPath);
  const counts = {};
  for (const event of events) counts[event.t] = (counts[event.t] ?? 0) + 1;
  console.log(`\n台账: ${ledgerPath}`);
  console.log(`事件数: ${events.length}`);
  for (const [type, count] of Object.entries(counts)) console.log(`  ${type}: ${count}`);
  const runs = events.filter((e) => e.t === 'run.recorded');
  if (runs.length === 0) {
    console.log('\n还没有回合记录。');
    return 0;
  }
  const last = runs[runs.length - 1];
  const lastEvent = events[events.length - 1];
  console.log(`\n最近回合: ${last.runId} · round ${last.round} · ${last.dim} = ${formatValue(axisById(last.axis?.id ?? 'r4'), last.derived?.chosenValue ?? NaN)}`);
  console.log(`最近回合落账: ${last.at}`);
  console.log(`台账最后事件: ${lastEvent.t} · ${lastEvent.at}`);
  return 0;
}

function cmdVerify(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：probe.mjs verify --run runs/r4-demo-1');
  const runDir = resolve(process.cwd(), runFlag);
  const result = verifyRun(runDir);
  console.log(`\n校验回合: ${relative(process.cwd(), runDir) || runDir}`);
  for (const [label, ok] of result.checklist) console.log(`  ${ok ? '✔' : '✖'} ${label}`);
  if (!result.ok) {
    console.log('\n问题:');
    for (const problem of result.problems) console.log(`  - ${problem}`);
    return 1;
  }
  console.log('\n结论: 通过');
  return 0;
}

async function cmdSelftest() {
  const { runSelfTests } = await import('./test/selftest.mjs');
  const result = await runSelfTests({ quiet: false });
  return result.failed === 0 ? 0 : 1;
}

function usage() {
  console.log(`probe-kit · 偏好探针仪器

用法:
  node probe.mjs demo [--axis r4|r5|r6] [--out runs] [--seed 7]
  node probe.mjs build --from-run <dir> --between <posA>,<posB> [--round 2] [--out runs] [--force]
  node probe.mjs append --run <dir> --answer <file.jsonl> [--context-file <json>] [--ledger <path>]
  node probe.mjs attribute --run <runId> --assumption <s> --falsified-by <s> --boundary <s> --confidence <low|medium|high>
  node probe.mjs revoke --run <runId>|--dim <dim> --reason <s> [--ledger <path>]
  node probe.mjs review [--run <runId>] [--now <ISO>] [--ledger <path>]
  node probe.mjs apply --run <runId> --out <calibration.json> [--now <ISO>] [--strict] [--ledger <path>]
  node probe.mjs status [--ledger <path>]
  node probe.mjs verify --run <dir>
  node probe.mjs selftest

退出码: 0 成功 · 1 校验失败 · 2 参数错误`);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const KNOWN_FLAGS = new Set([
    'out', 'seed', 'from-run', 'between', 'round', 'run', 'answer', 'context-file',
    'ledger', 'assumption', 'falsified-by', 'boundary', 'confidence', 'note',
    'now', 'dim', 'reason', 'help', 'force', 'axis', 'strict',
  ]);
  for (const key of Object.keys(args.flags)) {
    if (!KNOWN_FLAGS.has(key)) throw new CliError(`未知参数 --${key}。用 --help 查看用法。`, 2);
  }

  const command = args._[0];
  const handlers = {
    demo: cmdDemo,
    build: cmdBuild,
    append: cmdAppend,
    attribute: cmdAttribute,
    revoke: cmdRevoke,
    review: cmdReview,
    apply: cmdApply,
    status: cmdStatus,
    verify: cmdVerify,
    selftest: cmdSelftest,
  };
  if (!command || command === 'help' || command === '--help') {
    usage();
    return 0;
  }
  const handler = handlers[command];
  if (!handler) {
    console.error(`未知命令：${command}\n`);
    usage();
    return 2;
  }
  return (await handler(args)) ?? 0;
}

// 供测试与复用：直接 import 时不执行 CLI。
export {
  buildRun,
  verifyRun,
  assertInterpolable,
  normalizeAuthorization,
  checkApplyCredential,
  stripVisibleText,
  parseArgs,
  PRESENTER_VERSION,
  DEFAULT_LEDGER,
  CliError,
};

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
})();

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof CliError) {
        console.error(`\n${error.message}`);
        process.exit(error.exitCode);
      }
      console.error('\n内部错误：' + (error && error.stack ? error.stack : String(error)));
      process.exit(1);
    });
}
