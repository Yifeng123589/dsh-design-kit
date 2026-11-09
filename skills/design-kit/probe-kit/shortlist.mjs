#!/usr/bin/env node
// shortlist CLI：粗选（世界级候选）→ generate 内容槽 → 删/待定 → 待定到 3 个 → 三选一 → 归因/精调交接。
// 零依赖，Node >= 18。规范见 SHORTLIST-SPEC.md。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ledger from './lib/ledger.mjs';
import {
  DEFAULT_CAP,
  EXTERNAL_PATTERNS,
  REASON_CHIPS,
  ROUTES,
  attributeFailure,
  axisCoverage,
  buildCapabilityGap,
  capExhausted,
  chipById,
  normalizeCap,
  summarizeReasons,
  validateCandidates,
  validateRelation,
  analyzeCapabilityEvidence,
} from './lib/shortlist.mjs';
import { createRoundSession, createFinalSession, inlineSource, SHORTLIST_VERSION } from './lib/shortlist-recorder.mjs';
import { assertWriterPayload, auditStoredRound, buildArchetypePoolPlan, generateArchetypeRound, loadPool, selectWriter } from './lib/archetypes.mjs';
import {
  LIKES_SCHEMA,
  POOL_CAP,
  POOL_SCHEMA,
  WINDOW_SIZE,
  finalGate,
  normalizeLikesRecord,
  traitSummary,
} from './lib/pipeline.mjs';
import { contentFromBrief, contentHash, normalizeContent, readContentSlots } from './lib/worlds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// 默认产物写调用者 cwd，不写安装目录，避免只读安装或污染插件包。
const DEFAULT_LEDGER = join(process.cwd(), 'probe-kit-ledger', 'ledger.jsonl');
const DEFAULT_OUT = join(process.cwd(), 'shortlist-runs');
const ROUND_TEMPLATE = join(HERE, 'templates', 'shortlist.html');
const FINAL_TEMPLATE = join(HERE, 'templates', 'shortlist-final.html');
const RECORDER_PATH = join(HERE, 'lib', 'shortlist-recorder.mjs');

// 硬上限写死：4 轮 × 3 个 = 12 个候选、待定满 3 个。这是协议层的规则，不允许用 brief.cap 放宽。
const FIXED_CAP = Object.freeze({ maxRounds: 4, perRound: 3, maxPending: 3 });

class CliError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.exitCode = code;
  }
}

/** 读取并强制固定上限；任何自定义 cap 都按参数错误拒绝。 */
function capOrThrow(input) {
  let cap;
  try {
    cap = normalizeCap(input ?? {});
  } catch (error) {
    throw new CliError(error.message, 2);
  }
  if (cap.maxRounds !== FIXED_CAP.maxRounds || cap.perRound !== FIXED_CAP.perRound || cap.maxPending !== FIXED_CAP.maxPending) {
    throw new CliError(
      `粗选上限固定为 ${FIXED_CAP.maxRounds} 轮 × ${FIXED_CAP.perRound} = ${FIXED_CAP.maxRounds * FIXED_CAP.perRound} 个候选、待定满 ${FIXED_CAP.maxPending} 个；不支持自定义 cap`,
      2,
    );
  }
  return cap;
}

// ---------- 小工具 ----------
function nowIso() {
  return new Date().toISOString();
}

function sha256Short(text, length = 16) {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
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

function readLedger(ledgerPath) {
  try {
    return ledger.readEvents(ledgerPath);
  } catch (error) {
    throw new CliError(`台账读取失败：${error && error.message ? error.message : String(error)}`, 1);
  }
}

function appendLedger(ledgerPath, event, label) {
  const check = ledger.validateEvent(event);
  if (!check.ok) throw new CliError(`${label}事件校验失败：\n  - ${check.errors.join('\n  - ')}`, 1);
  const result = ledger.appendEvent(ledgerPath, event);
  if (!result.ok) throw new CliError(`写入台账失败：${result.error}`, 1);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
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

function resolveLedgerPath(flags) {
  return typeof flags.ledger === 'string' ? resolve(process.cwd(), flags.ledger) : DEFAULT_LEDGER;
}

function seedFrom(text) {
  return Number.parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16);
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
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function loadRun(runDir) {
  const brief = readJson(join(runDir, 'brief.json'), 'brief.json');
  const rounds = readJson(join(runDir, 'rounds.json'), 'rounds.json');
  const state = readJson(join(runDir, 'state.json'), 'state.json');
  return { brief, rounds, state };
}

function saveState(runDir, state) {
  writeJson(join(runDir, 'state.json'), state);
}

function generatedCount(rounds) {
  return (rounds.rounds ?? []).reduce((sum, round) => sum + (round.candidates?.length ?? 0), 0);
}

function poolPath(runDir) {
  return join(runDir, 'pool.json');
}

function likesPath(runDir) {
  return join(runDir, 'likes.json');
}

function readPoolFile(runDir) {
  const path = poolPath(runDir);
  if (!existsSync(path)) return null;
  const pool = readJson(path, 'pool.json');
  if (pool?.schema !== POOL_SCHEMA) throw new CliError(`pool.json schema 应为 ${POOL_SCHEMA}`, 1);
  return pool;
}

function poolByIdMap(pool) {
  return new Map((pool?.candidates ?? []).map((candidate) => [candidate.id, candidate]));
}

/** 有 sidecar 时按池校验；没有文件则返回 null。不写台账。 */
function loadLikes(runDir, runId) {
  const path = likesPath(runDir);
  if (!existsSync(path)) return null;
  const pool = readPoolFile(runDir);
  if (pool === null) throw new CliError('有 likes.json 但没有 pool.json', 1);
  const raw = readJson(path, 'likes.json');
  const poolById = poolByIdMap(pool);
  try {
    return normalizeLikesRecord(raw, {
      runId,
      poolIds: [...poolById.keys()],
      reasonIds: REASON_CHIPS.map((chip) => chip.id),
      poolById,
    });
  } catch (error) {
    throw new CliError(`likes.json 不合格：${error.message}`, 1);
  }
}

function readTraitBag(runDir) {
  const path = likesPath(runDir);
  if (!existsSync(path)) return [];
  const raw = readJson(path, 'likes.json');
  if (raw?.schema !== LIKES_SCHEMA) throw new CliError(`likes.json schema 应为 ${LIKES_SCHEMA}`, 1);
  return traitSummary(raw);
}

function candidateHtml(runDir, candidate) {
  const path = join(runDir, candidate.htmlPath);
  if (!existsSync(path)) throw new CliError(`候选 HTML 缺失：${candidate.htmlPath}`, 1);
  return readFileSync(path, 'utf8');
}

// ---------- 页面渲染 ----------
function renderRoundPage({ runDir, brief, state, rounds, round, cap }) {
  if (!existsSync(ROUND_TEMPLATE)) throw new CliError(`缺少轮次页模板：${ROUND_TEMPLATE}（等 shortlist-ui 交付）`, 1);
  const template = readFileSync(ROUND_TEMPLATE, 'utf8');
  for (const token of ['__SHORTLIST_VERSION__', '__ROUND_RECORDER_JS__', '__ROUND_DATA_JSON__']) {
    if (template.split(token).length - 1 !== 1) throw new CliError(`轮次页模板占位符 ${token} 次数不为 1`, 1);
  }
  const recorderSource = inlineSource(readFileSync(RECORDER_PATH, 'utf8'));
  const roundEntry = (rounds.rounds ?? []).find((item) => item.round === round);
  if (!roundEntry) throw new CliError(`rounds.json 里没有第 ${round} 轮`, 1);
  const candidates = [...roundEntry.candidates]
    .sort((a, b) => a.pos - b.pos)
    .map((candidate) => ({ pos: candidate.pos, html: candidateHtml(runDir, candidate) }));
  const pending = state.pending.map((item, index) => ({ pos: index + 1, html: candidateHtml(runDir, item) }));
  const relationHint =
    roundEntry.relation?.relation === 'lineage'
      ? '本轮是同一风格传统下的三种具体处理（顺序已打乱），只能删除或待定。'
      : roundEntry.relation?.relation === 'contrast'
        ? '本轮是同一内容在一个对比维度上的三档处理（顺序已打乱），只能删除或待定。'
        : '只看关系、不做盲比：只能删除或待定。';
  const data = {
    schema: 'shortlist-round/1',
    runId: brief.runId,
    title: brief.title,
    prompt: `${brief.prompt}\n\n${relationHint}`,
    relationHint,
    round,
    totalRounds: cap.maxRounds,
    generatedCount: generatedCount(rounds),
    maxPending: cap.maxPending,
    pendingCount: pending.length,
    maxDeferPerRound: 1,
    reasonChips: REASON_CHIPS,
    candidates,
    pending,
  };
  const html = template
    .split('__SHORTLIST_VERSION__').join(SHORTLIST_VERSION)
    .split('__ROUND_RECORDER_JS__').join(recorderSource)
    .split('__ROUND_DATA_JSON__').join(JSON.stringify(data).replace(/<\/script/gi, '<\\/script'));
  const pagePath = join(runDir, `round-${round}.html`);
  writeFileSync(pagePath, html, 'utf8');
  return { path: pagePath, sha: sha256Short(html) };
}

function renderFinalPage({ runDir, brief, state, rounds, cap }) {
  if (!existsSync(FINAL_TEMPLATE)) throw new CliError(`缺少终选页模板：${FINAL_TEMPLATE}（等 shortlist-ui 交付）`, 1);
  const template = readFileSync(FINAL_TEMPLATE, 'utf8');
  for (const token of ['__SHORTLIST_VERSION__', '__FINAL_RECORDER_JS__', '__FINAL_DATA_JSON__']) {
    if (template.split(token).length - 1 !== 1) throw new CliError(`终选页模板占位符 ${token} 次数不为 1`, 1);
  }
  const recorderSource = inlineSource(readFileSync(RECORDER_PATH, 'utf8'));
  const pending = state.pending.map((item, index) => ({ pos: index + 1, html: candidateHtml(runDir, item) }));
  const data = {
    schema: 'shortlist-final/1',
    runId: brief.runId,
    title: brief.title,
    prompt: brief.prompt,
    rounds: (rounds.rounds ?? []).length,
    reasonChips: REASON_CHIPS,
    pending,
  };
  const html = template
    .split('__SHORTLIST_VERSION__').join(SHORTLIST_VERSION)
    .split('__FINAL_RECORDER_JS__').join(recorderSource)
    .split('__FINAL_DATA_JSON__').join(JSON.stringify(data).replace(/<\/script/gi, '<\\/script'));
  const pagePath = join(runDir, 'final.html');
  writeFileSync(pagePath, html, 'utf8');
  return { path: pagePath, sha: sha256Short(html) };
}

// ---------- 归因收口 ----------
/** 收集整个回合所有候选 HTML，供能力归因做事实核查（chip 是自我报告，页面才是事实）。 */
function collectCandidateHtmls(runDir, rounds) {
  const htmls = [];
  for (const roundEntry of rounds.rounds ?? []) {
    for (const candidate of roundEntry.candidates ?? []) {
      const abs = join(runDir, candidate.htmlPath);
      if (existsSync(abs)) htmls.push(readFileSync(abs, 'utf8'));
    }
  }
  return htmls;
}

function finishWithCapabilityGap({ runDir, brief, rounds, state, extraRejectReasons, ledgerPath, now = new Date() }) {
  const reasonIds = [...state.eliminated.map((item) => item.reasonId), ...(extraRejectReasons ?? [])];
  const evidence = analyzeCapabilityEvidence({ htmls: collectCandidateHtmls(runDir, rounds), reasonIds });
  const gap = buildCapabilityGap({
    runId: brief.runId,
    brief,
    rounds: (rounds.rounds ?? []).length,
    generated: generatedCount(rounds),
    eliminations: state.eliminated,
    finalRejectReasonIds: extraRejectReasons ?? [],
    evidence,
    now,
  });
  writeJson(join(runDir, 'capability-gap.json'), gap);
  appendLedger(
    ledgerPath,
    {
      t: 'capability.gap',
      schema: ledger.LEDGER_SCHEMA,
      at: nowIso(),
      runId: brief.runId,
      candidates: gap.candidates,
      rounds: gap.rounds,
      attribution: gap.attribution,
      route: gap.route,
      missingCapabilities: gap.missingCapabilities,
      expiresHard: gap.expiresHard,
      ...(gap.evidence ? { evidenceConfidence: gap.evidence.confidence } : {}),
    },
    'capability.gap',
  );
  state.finished = true;
  state.outcome = 'capability-gap';
  saveState(runDir, state);
  return gap;
}

// ---------- 命令 ----------
async function cmdInit(args) {
  const briefPath = requireFlag(args.flags, 'brief', '用法：node shortlist.mjs init --brief <brief.json>');
  const raw = readJson(resolve(process.cwd(), briefPath), 'brief');
  if (typeof raw.title !== 'string' || raw.title === '') throw new CliError('brief.title 必须是非空字符串');
  if (typeof raw.prompt !== 'string' || raw.prompt === '') throw new CliError('brief.prompt 必须是非空字符串');
  const cap = capOrThrow(raw.cap);
  let content;
  // 先校验内容槽，再创建回合目录；否则校验失败会在 shortlist-runs 留下空壳回合。
  if (raw.content !== undefined) {
    const worlds = await import('./lib/worlds.mjs');
    try {
      content = worlds.normalizeContent(raw.content);
    } catch (error) {
      throw new CliError(`brief.content 不合格：${error.message}`, 1);
    }
  }
  const outRoot = resolve(process.cwd(), typeof args.flags.out === 'string' ? args.flags.out : DEFAULT_OUT);
  const baseId =
    typeof args.flags['run-id'] === 'string' && args.flags['run-id'] !== ''
      ? args.flags['run-id']
      : `sl-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sha256Short(raw.title, 6)}`;
  let runId = baseId;
  let runDir = join(outRoot, runId);
  let suffix = 2;
  while (existsSync(runDir)) {
    runId = `${baseId}-${suffix}`;
    suffix += 1;
    runDir = join(outRoot, runId);
  }
  const now = nowIso();
  let brief;
  try {
    mkdirSync(runDir, { recursive: true });
    brief = {
      schema: 'shortlist-brief/1',
      runId,
      title: raw.title,
      prompt: raw.prompt,
      context: raw.context ?? {},
      ...(content ? { content } : {}),
      cap,
      createdAt: now,
    };
    writeJson(join(runDir, 'brief.json'), brief);
    writeJson(join(runDir, 'rounds.json'), { schema: 'shortlist-rounds/1', runId, rounds: [] });
    writeJson(join(runDir, 'state.json'), {
      schema: 'shortlist-state/1',
      runId,
      pending: [],
      eliminated: [],
      decisionsByRound: {},
      nextRound: 1,
      generationContexts: [],
      finished: false,
      outcome: null,
    });
  } catch (error) {
    // 初始化写到一半失败时不要留下半成品回合；台账追加在 try 之外，失败也不回滚已建好的回合。
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch {
      // 清理失败不覆盖原始错误
    }
    throw error;
  }
  const ledgerPath = resolveLedgerPath(args.flags);
  appendLedger(
    ledgerPath,
    {
      t: 'shortlist.initiated',
      schema: ledger.LEDGER_SCHEMA,
      at: now,
      runId,
      brief: { title: brief.title, prompt: brief.prompt, context: brief.context },
      cap,
    },
    'shortlist.initiated',
  );
  const rel = relative(process.cwd(), runDir) || runDir;
  console.log(`\n已创建粗选回合 ${runId}`);
  console.log(`  目录: ${rel}`);
  console.log(`  上限: ${cap.maxRounds} 轮 × ${cap.perRound} 个 = ${cap.maxRounds * cap.perRound} 个候选，待定满 ${cap.maxPending} 个进入终选`);
  console.log('\n下一步：默认先 pool 预生成 12 张（按 runId 从扩展库抽；同 seed 可复现），再 preview。只有经典三轮才走 generate → add → decide。');
  console.log(`  node shortlist.mjs pool --run ${rel} [--seed <id>]`);
  return 0;
}

function cmdAdd(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs add --run <dir> --candidates <file>');
  const candidatesPath = requireFlag(args.flags, 'candidates', '需要 --candidates <candidates.json>');
  const runDir = resolve(process.cwd(), runFlag);
  const { brief, rounds, state } = loadRun(runDir);
  const cap = capOrThrow(brief.cap);
  if (state.finished === true) throw new CliError('该粗选已结束，不能再加候选', 1);
  if (readPoolFile(runDir) !== null) {
    throw new CliError('这个回合已经有预生成池（最多 12 个）。请在工作台里删除、路过或收藏，不要再 add 一轮。', 1);
  }
  if (state.pending.length >= cap.maxPending) {
    throw new CliError(`待定已满 ${state.pending.length}/${cap.maxPending}，请直接 final 做三选一，不要再生成候选`, 1);
  }
  const decidedRounds = Object.keys(state.decisionsByRound ?? {}).length;
  if (decidedRounds < (rounds.rounds?.length ?? 0)) {
    throw new CliError(`第 ${decidedRounds + 1} 轮还没有 decide，先处理完上一轮再生成下一轮`, 1);
  }
  const expectedRound = (rounds.rounds?.length ?? 0) + 1;
  if (state.nextRound !== expectedRound) {
    console.warn(`注意：state.nextRound=${state.nextRound} 与已生成轮次不一致，按实际轮次修正为 ${expectedRound}。`);
  }
  const round = expectedRound;
  if (round > cap.maxRounds) {
    throw new CliError(`已达 ${cap.maxRounds} 轮上限（最多 ${cap.maxRounds * cap.perRound} 个候选），不能再加候选`, 1);
  }
  if (generatedCount(rounds) >= cap.maxRounds * cap.perRound) {
    throw new CliError(`已达 ${cap.maxRounds * cap.perRound} 个候选上限，不能再加候选`, 1);
  }

  const raw = readJson(resolve(process.cwd(), candidatesPath), '候选文件');
  if (Array.isArray(raw)) {
    throw new CliError('候选文件必须是 { relation, family?/axis?, candidates: [...] } 对象，不能是裸数组：世界之间必须声明关系', 2);
  }
  const relation = {
    relation: raw.relation,
    ...(typeof raw.family === 'string' && raw.family !== '' ? { family: raw.family } : {}),
    ...(typeof raw.axis === 'string' && raw.axis !== '' ? { axis: raw.axis } : {}),
  };
  const candidates = raw.candidates;
  if (!Array.isArray(candidates)) throw new CliError('候选文件缺少 candidates 数组', 1);
  const validation = validateCandidates(candidates, cap, relation);
  if (!validation.ok) throw new CliError(`候选不合格：\n  - ${validation.errors.join('\n  - ')}`, 1);
  try {
    assertWriterPayload(raw);
  } catch (error) {
    throw new CliError(error.message, 1);
  }
  const usedIds = new Set((rounds.rounds ?? []).flatMap((entry) => entry.candidates.map((candidate) => candidate.id)));
  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) throw new CliError(`候选 id 与之前轮次重复：${candidate.id}`, 1);
  }

  const contextToken =
    typeof args.flags['context-token'] === 'string' && args.flags['context-token'] !== ''
      ? args.flags['context-token']
      : `fresh-${sha256Short(`${brief.runId}:${round}:${nowIso()}`, 8)}`;
  const lastToken = state.generationContexts.at(-1);
  if (lastToken === contextToken) {
    console.warn(`警告：第 ${round} 轮与上一轮使用同一个 generationContext（${contextToken}）。协议要求每轮独立生成上下文，否则候选关系会坍缩成同质三胞胎。`);
  }

  const order = shuffled(candidates, seedFrom(`${brief.runId}:${round}:order`));
  const roundEntry = { round, relation, generationContext: contextToken, createdAt: nowIso(), candidates: [] };
  if (typeof raw.writer === 'string' && raw.writer !== '') roundEntry.writer = raw.writer;
  if (typeof raw.skeletonHash === 'string' && raw.skeletonHash !== '') roundEntry.skeletonHash = raw.skeletonHash;
  if (typeof raw.contentHash === 'string' && raw.contentHash !== '') roundEntry.contentHash = raw.contentHash;
  for (const [index, candidate] of order.entries()) {
    const pos = index + 1;
    const relPath = join('candidates', `r${round}-p${pos}.html`);
    const absPath = join(runDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, candidate.html, 'utf8');
    roundEntry.candidates.push({
      id: candidate.id,
      pos,
      world: candidate.world,
      htmlSha: sha256Short(candidate.html),
      htmlPath: relPath,
      ...(typeof candidate.archetypeId === 'string' && candidate.archetypeId !== '' ? { archetypeId: candidate.archetypeId } : {}),
      ...(typeof candidate.skeletonHash === 'string' && candidate.skeletonHash !== '' ? { skeletonHash: candidate.skeletonHash } : {}),
    });
  }
  rounds.rounds.push(roundEntry);
  state.generationContexts.push(contextToken);
  state.nextRound = round + 1;
  const page = renderRoundPage({ runDir, brief, state, rounds, round, cap });
  roundEntry.pageSha = page.sha;
  writeJson(join(runDir, 'rounds.json'), rounds);
  saveState(runDir, state);

  const ledgerPath = resolveLedgerPath(args.flags);
  appendLedger(
    ledgerPath,
    {
      t: 'shortlist.round',
      schema: ledger.LEDGER_SCHEMA,
      at: nowIso(),
      runId: brief.runId,
      round,
      generationContext: contextToken,
      relation,
      candidates: roundEntry.candidates.map((candidate) => ({
        pos: candidate.pos,
        id: candidate.id,
        world: candidate.world,
        htmlSha: candidate.htmlSha,
      })),
    },
    'shortlist.round',
  );

  const rel = relative(process.cwd(), page.path) || page.path;
  console.log(`\n已加入第 ${round} 轮（${order.length} 个候选，位置已随机化并记录）`);
  console.log(`  页面: ${rel}`);
  console.log('\n下一步：浏览器打开页面，删除/待定后下载 decisions 文件，然后：');
  console.log(`  node shortlist.mjs decide --run ${relative(process.cwd(), runDir) || runDir} --round ${round} --decisions <下载的文件>`);
  return 0;
}

function cmdDecide(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs decide --run <dir> --round <n> --decisions <file>');
  const round = Number(requireFlag(args.flags, 'round', '需要 --round <n>'));
  const decisionsPath = requireFlag(args.flags, 'decisions', '需要 --decisions <file.jsonl>');
  if (!Number.isInteger(round) || round < 1) throw new CliError('--round 需要正整数');
  const runDir = resolve(process.cwd(), runFlag);
  const { brief, rounds, state } = loadRun(runDir);
  const cap = capOrThrow(brief.cap);
  if (state.finished === true) throw new CliError(`该粗选已结束（${state.outcome ?? 'finished'}），不能再处理轮次`, 1);
  if (state.pending.length >= cap.maxPending) {
    throw new CliError(`待定已满 ${state.pending.length}/${cap.maxPending}，请直接 final 做三选一，不要再处理新轮次`, 1);
  }
  const expectedRound = Object.keys(state.decisionsByRound ?? {}).length + 1;
  if (round !== expectedRound) {
    throw new CliError(`轮次顺序不符：应处理第 ${expectedRound} 轮，收到第 ${round} 轮`, 1);
  }
  const roundEntry = (rounds.rounds ?? []).find((item) => item.round === round);
  if (!roundEntry) throw new CliError(`rounds.json 里没有第 ${round} 轮`, 1);
  if (state.decisionsByRound?.[round]) throw new CliError(`第 ${round} 轮已处理过，append-only 不允许重复决策`, 1);

  const raw = readJson(resolve(process.cwd(), decisionsPath), '决策文件');
  if (Array.isArray(raw)) throw new CliError('决策文件应是 shortlist-decisions/1 记录对象，不是数组', 2);
  const decisions = raw.decisions;
  if (!Array.isArray(decisions)) throw new CliError('决策文件缺少 decisions 数组', 1);
  const errors = [];
  if (raw.schema !== 'shortlist-decisions/1') errors.push(`schema 应为 shortlist-decisions/1，收到 ${JSON.stringify(raw.schema)}`);
  if (raw.runId !== brief.runId) errors.push(`runId 不匹配：${raw.runId}`);
  if (raw.round !== undefined && Number(raw.round) !== round) errors.push(`record.round（${raw.round}）与 --round（${round}）不一致`);
  const byPos = new Map();
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') {
      errors.push('decision 必须是对象');
      continue;
    }
    const pos = Number(decision.pos);
    if (!Number.isInteger(pos) || pos < 1 || pos > roundEntry.candidates.length) errors.push(`位置非法：${JSON.stringify(decision.pos)}`);
    else if (byPos.has(pos)) errors.push(`位置 ${pos} 重复决策`);
    byPos.set(pos, decision);
    if (!['eliminate', 'defer'].includes(decision.action)) errors.push(`位置 ${pos} 的 action 非法`);
    if (decision.action === 'eliminate' && chipById(decision.reasonId) === null) {
      errors.push(`位置 ${pos} 的删除理由非法：${JSON.stringify(decision.reasonId)}`);
    }
  }
  for (const candidate of roundEntry.candidates) {
    if (!byPos.has(candidate.pos)) errors.push(`位置 ${candidate.pos} 没有决策`);
  }
  const deferCount = decisions.filter((decision) => decision.action === 'defer').length;
  if (deferCount > 1) errors.push(`每轮最多待定 1 个，收到 ${deferCount} 个`);
  if (errors.length > 0) throw new CliError(`决策不合格：\n  - ${errors.join('\n  - ')}`, 1);

  const ledgerPath = resolveLedgerPath(args.flags);
  // 更新 state
  for (const candidate of roundEntry.candidates) {
    const decision = byPos.get(candidate.pos);
    if (decision.action === 'eliminate') {
      state.eliminated.push({
        id: candidate.id,
        world: candidate.world,
        reasonId: decision.reasonId,
        note: typeof decision.note === 'string' ? decision.note : '',
        round,
      });
    } else {
      state.pending.push({ id: candidate.id, world: candidate.world, htmlPath: candidate.htmlPath, fromRound: round });
    }
  }
  state.decisionsByRound[round] = decisions.map((decision) => ({
    pos: Number(decision.pos),
    action: decision.action,
    ...(decision.action === 'eliminate' ? { reasonId: decision.reasonId } : {}),
    ...(typeof decision.note === 'string' && decision.note !== '' ? { note: decision.note } : {}),
  }));
  appendLedger(
    ledgerPath,
    {
      t: 'shortlist.decisions',
      schema: ledger.LEDGER_SCHEMA,
      at: nowIso(),
      runId: brief.runId,
      round,
      decisions: state.decisionsByRound[round],
      pendingAfter: state.pending.map((_, index) => index + 1),
    },
    'shortlist.decisions',
  );

  const generated = generatedCount(rounds);
  const undecidedRounds = (rounds.rounds ?? []).filter((entry) => !state.decisionsByRound?.[entry.round]).length;
  // 关键：decide 后必须推进到下一轮；否则下一次 add 会把新轮次又写成旧轮号，覆盖原候选。
  state.nextRound = (rounds.rounds ?? []).length + 1;
  if (state.pending.length >= cap.maxPending) {
    const page = renderFinalPage({ runDir, brief, state, rounds, cap });
    state.finalPageSha = page.sha;
    saveState(runDir, state);
    const rel = relative(process.cwd(), page.path) || page.path;
    console.log(`\n第 ${round} 轮已处理：待定 ${state.pending.length}/${cap.maxPending} → 可以终选`);
    console.log(`  页面: ${rel}`);
    console.log('\n下一步：浏览器打开终选页，三选一或「都不行」，下载 choice 文件，然后：');
    console.log(`  node shortlist.mjs final --run ${relative(process.cwd(), runDir) || runDir} --choice <下载的文件>`);
    return 0;
  }

  saveState(runDir, state);
  if (undecidedRounds > 0) {
    console.log(`\n第 ${round} 轮已处理：待定 ${state.pending.length}/${cap.maxPending}，已生成 ${generated} 个`);
    console.log(`\n还有 ${undecidedRounds} 轮已经生成但没处理，先处理它们（不能跳过）：`);
    const next = Object.keys(state.decisionsByRound ?? {}).length + 1;
    console.log(`  node shortlist.mjs decide --run ${relative(process.cwd(), runDir) || runDir} --round ${next} --decisions <下载的文件>`);
    return 0;
  }

  if (capExhausted({ cap, generated, rounds: rounds.rounds.length, undecidedRounds })) {
    const gap = finishWithCapabilityGap({ runDir, brief, rounds, state, extraRejectReasons: [], ledgerPath });
    console.log(`\n第 ${round} 轮已处理，候选预算用尽（${generated}/${cap.maxRounds * cap.perRound}），没有凑到 ${cap.maxPending} 个待定 → 停止生成`);
    console.log(`\n归因: ${gap.attribution}`);
    console.log(`路由: ${gap.route}`);
    if (gap.missingCapabilities.length > 0) console.log(`缺失能力: ${gap.missingCapabilities.join('、')}`);
    console.log(`\n报告: ${relative(process.cwd(), join(runDir, 'capability-gap.json'))}`);
    return 0;
  }

  console.log(`\n第 ${round} 轮已处理：待定 ${state.pending.length}/${cap.maxPending}，已生成 ${generated} 个`);
  console.log(`\n下一步：generate 第 ${round + 1} 轮（换独立上下文；不要手写三页），然后 preview：`);
  console.log(`  node shortlist.mjs generate --run ${relative(process.cwd(), runDir) || runDir} --round ${round + 1} --add --context-token <fresh-token>`);
  return 0;
}

function cmdFinal(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs final --run <dir> --choice <file>');
  const choicePath = requireFlag(args.flags, 'choice', '需要 --choice <file.jsonl>');
  const runDir = resolve(process.cwd(), runFlag);
  const { brief, rounds, state } = loadRun(runDir);
  const cap = capOrThrow(brief.cap);
  if (state.finished === true) throw new CliError(`该粗选已结束（${state.outcome ?? 'finished'}），不能重复终选`, 1);
  // final 是收口动作，先过一遍完整性闸门；verify 失败不允许终选。
  const integrity = verifyRunDir(runDir);
  if (!integrity.ok) {
    throw new CliError('终选前完整性校验失败，先修好再 final：\n  - ' + integrity.problems.join('\n  - '), 1);
  }
  const raw = readJson(resolve(process.cwd(), choicePath), '终选文件');
  const likes = loadLikes(runDir, brief.runId);
  const draftText = (typeof raw.draft === 'string' ? raw.draft : likes?.draft ?? '').trim().slice(0, 200);
  const gate = finalGate({
    shortlistCount: Math.max(state.pending.length, likes?.shortlist.length ?? 0),
    traitCount: likes?.traits.length ?? 0,
    draft: draftText,
  });
  if (!gate.ok) throw new CliError(gate.error, 1);
  const errors = [];
  if (raw.schema !== 'shortlist-choice/1') errors.push(`schema 应为 shortlist-choice/1，收到 ${JSON.stringify(raw.schema)}`);
  if (raw.runId !== brief.runId) errors.push(`runId 不匹配：${raw.runId}`);
  if (!['candidate', 'none', 'shortlist', 'draft'].includes(raw.kind)) errors.push('kind 只能是 candidate/none/shortlist/draft');
  if (raw.kind === 'candidate' && (state.pending.length < 1 || state.pending.length > cap.maxPending)) {
    errors.push(`待定 ${state.pending.length} 个，不能按待定位置终选`);
  }
  if (raw.kind === 'candidate' && (!Number.isInteger(raw.pos) || raw.pos < 1 || raw.pos > state.pending.length)) {
    errors.push(`终选位置非法：${JSON.stringify(raw.pos)}`);
  }
  if (gate.via === 'draft' && raw.kind !== 'draft') errors.push('没有整页短名单时，终选 kind 应为 draft');
  if (raw.kind === 'none' && (rounds.rounds ?? []).length < 1) {
    errors.push('还没有已入账的轮次，不能走「都不行」归因；请用短名单或声明底稿终选');
  }
  if (raw.note !== undefined && typeof raw.note !== 'string') errors.push('note 必须是字符串');
  const finalNote = raw.kind === 'none' && typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : '';
  if (raw.kind === 'none' && (!Array.isArray(raw.reasonIds) || raw.reasonIds.length < 1)) {
    errors.push('「都不行」至少需要一个理由');
  }
  for (const reasonId of raw.reasonIds ?? []) {
    if (chipById(reasonId) === null) errors.push(`理由 chip 非法：${JSON.stringify(reasonId)}`);
  }
  if (errors.length > 0) throw new CliError(`终选不合格：\n  - ${errors.join('\n  - ')}`, 1);

  const ledgerPath = resolveLedgerPath(args.flags);
  const roundsCount = (rounds.rounds ?? []).length;
  if (raw.kind === 'draft') {
    if (draftText === '' || (likes?.traits.length ?? 0) < 1) {
      throw new CliError('没有整页短名单时，需要声明底稿并且特征袋至少 1 条', 1);
    }
    const traits = traitSummary(likes);
    const result = {
      schema: 'shortlist-result/1',
      runId: brief.runId,
      kind: 'draft',
      draft: draftText,
      chosen: null,
      likedTraits: traits,
      rounds: roundsCount,
      generated: generatedCount(rounds),
      pending: state.pending.map((item) => item.id),
      nextStep: { mode: 'draft', note: '按声明的底稿和特征袋继续，不再生成第 13 个候选' },
      createdAt: nowIso(),
    };
    writeJson(join(runDir, 'result.json'), result);
    appendLedger(
      ledgerPath,
      {
        t: 'shortlist.chosen',
        schema: ledger.LEDGER_SCHEMA,
        at: nowIso(),
        runId: brief.runId,
        kind: 'draft',
        draft: draftText,
        rounds: roundsCount,
      },
      'shortlist.chosen',
    );
    state.finished = true;
    state.outcome = 'draft';
    saveState(runDir, state);
    console.log(`\n终选完成：声明底稿，特征 ${traits.length} 条`);
    console.log(`  底稿: ${draftText}`);
    console.log(`  结果文件: ${relative(process.cwd(), join(runDir, 'result.json'))}`);
    return 0;
  }
  if (raw.kind === 'shortlist') {
    const kept = likes?.shortlist ?? [];
    const pos = Number(raw.pos);
    if (!Number.isInteger(pos) || pos < 1 || pos > kept.length) throw new CliError(`短名单位置非法：${JSON.stringify(raw.pos)}`, 1);
    const source = poolByIdMap(readPoolFile(runDir)).get(kept[pos - 1].candidateId);
    if (!source) throw new CliError('短名单候选不在池里', 1);
    const result = {
      schema: 'shortlist-result/1',
      runId: brief.runId,
      kind: 'shortlist',
      chosen: { id: source.id, world: source.world, fromRound: source.round },
      likedTraits: traitSummary(likes),
      rounds: roundsCount,
      generated: generatedCount(rounds),
      pending: state.pending.map((item) => item.id),
      shortlist: kept.map((item) => item.candidateId),
      nextStep: { mode: 'axis', note: '进入精调：用 probe.mjs 的单轴 + JND 流程，不要再用 shortlist 做微调' },
      createdAt: nowIso(),
    };
    writeJson(join(runDir, 'result.json'), result);
    appendLedger(
      ledgerPath,
      {
        t: 'shortlist.chosen',
        schema: ledger.LEDGER_SCHEMA,
        at: nowIso(),
        runId: brief.runId,
        kind: 'candidate',
        pos,
        rounds: roundsCount,
      },
      'shortlist.chosen',
    );
    state.finished = true;
    state.outcome = 'chosen';
    state.finalVia = 'shortlist-likes';
    saveState(runDir, state);
    console.log(`\n终选完成：${source.id}（池内第 ${source.poolIndex} 张，整页短名单）`);
    console.log(`  结果文件: ${relative(process.cwd(), join(runDir, 'result.json'))}`);
    return 0;
  }
  if (raw.kind === 'candidate') {
    if (!state.finalPageSha) {
      const page = renderFinalPage({ runDir, brief, state, rounds, cap });
      state.finalPageSha = page.sha;
    }
    const chosen = state.pending[raw.pos - 1];
    const result = {
      schema: 'shortlist-result/1',
      runId: brief.runId,
      chosen: { id: chosen.id, world: chosen.world, fromRound: chosen.fromRound },
      rounds: roundsCount,
      generated: generatedCount(rounds),
      pending: state.pending.map((item) => item.id),
      nextStep: { mode: 'axis', note: '进入精调：用 probe.mjs 的单轴 + JND 流程，不要再用 shortlist 做微调' },
      createdAt: nowIso(),
    };
    writeJson(join(runDir, 'result.json'), result);
    appendLedger(
      ledgerPath,
      {
        t: 'shortlist.chosen',
        schema: ledger.LEDGER_SCHEMA,
        at: nowIso(),
        runId: brief.runId,
        kind: 'candidate',
        pos: raw.pos,
        rounds: roundsCount,
      },
      'shortlist.chosen',
    );
    state.finished = true;
    state.outcome = 'chosen';
    saveState(runDir, state);
    console.log(`\n终选完成：${chosen.id}（来自第 ${chosen.fromRound} 轮）`);
    console.log(`  世界: ${JSON.stringify(chosen.world)}`);
    console.log(`\n下一步进入精调（不要再跑 shortlist 微调）：`);
    console.log('  node probe.mjs build --from-run <精调回合> --between <posA>,<posB>');
    console.log(`  结果文件: ${relative(process.cwd(), join(runDir, 'result.json'))}`);
    return 0;
  }

  state.finalRejectReasonIds = [...(raw.reasonIds ?? [])];
  if (finalNote !== '') state.finalRejectNote = finalNote;
  appendLedger(
    ledgerPath,
    {
      t: 'shortlist.chosen',
      schema: ledger.LEDGER_SCHEMA,
      at: nowIso(),
      runId: brief.runId,
      kind: 'none',
      reasonIds: raw.reasonIds ?? [],
      ...(finalNote !== '' ? { note: finalNote } : {}),
      rounds: roundsCount,
    },
    'shortlist.chosen',
  );
  const gap = finishWithCapabilityGap({ runDir, brief, rounds, state, extraRejectReasons: raw.reasonIds ?? [], ledgerPath });
  console.log('\n终选结果：都不行 → 停止生成，进入归因');
  if (finalNote !== '') console.log(`  补充理由: ${finalNote}`);
  console.log(`  归因: ${gap.attribution}`);
  console.log(`  路由: ${gap.route}`);
  if (gap.missingCapabilities.length > 0) console.log(`  缺失能力: ${gap.missingCapabilities.join('、')}`);
  console.log(`  报告: ${relative(process.cwd(), join(runDir, 'capability-gap.json'))}`);
  return 0;
}

function cmdReport(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs report --run <dir>');
  const runDir = resolve(process.cwd(), runFlag);
  let reportNow = new Date();
  if (typeof args.flags.now === 'string') {
    reportNow = new Date(args.flags.now);
    if (Number.isNaN(reportNow.getTime())) throw new CliError('--now 需要合法时间，例如 2026-11-20T00:00:00Z', 2);
  }
  const { brief, rounds, state } = loadRun(runDir);
  const cap = capOrThrow(brief.cap);
  const generated = generatedCount(rounds);
  console.log(`\n粗选报告 · ${brief.runId}`);
  console.log(`  报告时间: ${reportNow.toISOString()}`);
  console.log(`  标题: ${brief.title}`);
  console.log(`  进度: ${(rounds.rounds ?? []).length}/${cap.maxRounds} 轮 · ${generated}/${cap.maxRounds * cap.perRound} 个候选 · 待定 ${state.pending.length}/${cap.maxPending}`);
  console.log(`  状态: ${state.finished ? state.outcome : '进行中'}`);

  const summary = summarizeReasons(state.eliminated);
  console.log('\n删除理由:');
  if (summary.total === 0) console.log('  （还没有删除）');
  else {
    for (const [reasonId, count] of Object.entries(summary.byChip)) {
      const chip = chipById(reasonId);
      console.log(`  ${chip ? chip.label : reasonId} × ${count}`);
    }
    console.log(`  分类占比: capability ${(summary.ratio.capability * 100).toFixed(0)}% · brief ${(summary.ratio.brief * 100).toFixed(0)}% · taste ${(summary.ratio.taste * 100).toFixed(0)}% · no-preference ${(summary.ratio['no-preference'] * 100).toFixed(0)}%`);
  }

  const allWorlds = [...state.eliminated.map((item) => item.world), ...state.pending.map((item) => item.world)].filter(Boolean);
  const coverage = axisCoverage(allWorlds);
  console.log(`\n世界描述覆盖: material ${coverage.material} · type ${coverage.type} · layout ${coverage.layout} · color ${coverage.color}`);

  const gapPath = join(runDir, 'capability-gap.json');
  if (existsSync(gapPath)) {
    const gap = readJson(gapPath, 'capability-gap.json');
    console.log(`\n能力缺口归因: ${gap.attribution}`);
    console.log(`  路由: ${gap.route}`);
    if (gap.missingCapabilities.length > 0) console.log(`  缺失能力: ${gap.missingCapabilities.join('、')}`);
    if (gap.evidence) {
      const features = Object.entries(gap.evidence.featurePresence ?? {})
        .map(([feature, info]) => `${feature}:${info.present ? '有' : '无'}`)
        .join(' · ');
      console.log(`  证据核查: ${gap.evidence.confidence === 'supported' ? '支持' : '弱'}（候选里 ${features}）`);
      console.log(`  核查说明: ${gap.evidence.note}`);
    }
    console.log(`  负结论有效期: ${gap.expiresHard}${new Date(gap.expiresHard) > reportNow ? '（有效）' : '（已过期，需重跑粗选）'}`);
  } else if (!state.finished) {
    const attribution = attributeFailure({ eliminations: state.eliminated, generated, rounds: (rounds.rounds ?? []).length });
    console.log(`\n若现在收口，初步归因: ${attribution.attribution}（${attribution.route}）`);
  }
  const resultPath = join(runDir, 'result.json');
  if (existsSync(resultPath)) {
    const result = readJson(resultPath, 'result.json');
    console.log(`\n终选结果: ${result.chosen?.id ?? '(none)'} · 世界 ${JSON.stringify(result.chosen?.world ?? null)}`);
  }
  return 0;
}

/** 校验一个粗选回合的完整性；返回 { ok, problems, checklist }，不打印、不改文件。 */
function auditExternalPool(runDir, pool, brief) {
  const problems = [];
  if (pool.runId !== brief.runId) problems.push('pool.json 的 runId 与 brief 不一致');
  if (!pool.skill || typeof pool.skill.id !== 'string' || typeof pool.skill.source !== 'string' || typeof pool.skill.license !== 'string') {
    problems.push('外部池缺少 skill.id / skill.source / skill.license');
  }
  if (!Array.isArray(pool.candidates) || pool.candidates.length !== FIXED_CAP.maxRounds * FIXED_CAP.perRound) {
    problems.push(`外部池应有 ${FIXED_CAP.maxRounds * FIXED_CAP.perRound} 个候选，实际 ${(pool.candidates ?? []).length}`);
  }
  const ids = new Set();
  const htmlSet = new Set();
  const byRound = new Map();
  let slots = null;
  for (const [index, candidate] of (pool.candidates ?? []).entries()) {
    if (!candidate || typeof candidate !== 'object') {
      problems.push(`外部池 candidates[${index}] 不是对象`);
      continue;
    }
    if (typeof candidate.id !== 'string' || candidate.id === '') {
      problems.push(`外部池 candidates[${index}].id 非法`);
      continue;
    }
    if (ids.has(candidate.id)) problems.push(`外部池候选 id 重复：${candidate.id}`);
    ids.add(candidate.id);
    if (typeof candidate.htmlPath !== 'string' || candidate.htmlPath === '') {
      problems.push(`外部池候选 ${candidate.id} 缺少 htmlPath`);
      continue;
    }
    const abs = join(runDir, candidate.htmlPath);
    if (!existsSync(abs)) {
      problems.push(`外部池候选 HTML 缺失：${candidate.htmlPath}`);
      continue;
    }
    const html = readFileSync(abs, 'utf8');
    if (sha256Short(html) !== candidate.htmlSha) {
      problems.push(`外部池候选 HTML 与 sha 不一致：${candidate.id}`);
    }
    if (htmlSet.has(html)) problems.push(`外部池候选 HTML 重复：${candidate.id}`);
    htmlSet.add(html);
    const candidateSlots = readContentSlots(html);
    if (candidateSlots === null) {
      problems.push(`外部池候选 ${candidate.id} 缺少内容槽`);
    } else if (slots === null) {
      slots = candidateSlots;
    } else if (JSON.stringify(candidateSlots) !== JSON.stringify(slots)) {
      problems.push(`外部池候选 ${candidate.id} 的内容槽与其他候选不一致`);
    }
    const round = Number(candidate.round);
    if (!Number.isInteger(round) || round < 1 || round > FIXED_CAP.maxRounds) {
      problems.push(`外部池候选 ${candidate.id} 的 round 非法`);
      continue;
    }
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push({ ...candidate, html });
  }
  if (ids.size !== 12) problems.push(`外部池 id 数应为 12，实际 ${ids.size}`);
  if (slots !== null && pool.contentHash !== contentHash(slots)) {
    problems.push('外部池 contentHash 与页面内容槽不一致');
  }
  for (const [round, list] of byRound) {
    if (list.length !== FIXED_CAP.perRound) {
      problems.push(`外部池第 ${round} 轮应有 ${FIXED_CAP.perRound} 个候选，实际 ${list.length}`);
      continue;
    }
    const relation = list[0].relation;
    if (!relation || typeof relation !== 'object') {
      problems.push(`外部池第 ${round} 轮缺少 relation`);
      continue;
    }
    for (const candidate of list) {
      if (JSON.stringify(candidate.relation) !== JSON.stringify(relation)) {
        problems.push(`外部池第 ${round} 轮的 relation 不一致`);
        break;
      }
    }
    const validation = validateCandidates(list, FIXED_CAP, relation);
    for (const error of validation.errors) problems.push(`外部池第 ${round} 轮：${error}`);
  }
  if (byRound.size !== FIXED_CAP.maxRounds) problems.push(`外部池轮数应为 ${FIXED_CAP.maxRounds}，实际 ${byRound.size}`);
  return problems;
}

function verifyRunDir(runDir) {
  const problems = [];
  let brief;
  let rounds;
  let state;
  try {
    ({ brief, rounds, state } = loadRun(runDir));
  } catch (error) {
    throw error instanceof CliError ? error : new CliError(String(error), 1);
  }
  try {
    capOrThrow(brief.cap);
  } catch (error) {
    problems.push(`上限不合法：${error.message}`);
  }
  const cap = FIXED_CAP;
  if (brief.schema !== 'shortlist-brief/1') problems.push(`brief schema 异常：${brief.schema}`);
  if (brief.runId !== state.runId) problems.push('brief.runId 与 state.runId 不一致');
  if ((rounds.rounds ?? []).length > cap.maxRounds) problems.push(`轮次 ${rounds.rounds.length} 超过上限 ${cap.maxRounds}`);
  // 轮次编号必须从 1 开始连续，nextRound 必须指向下一轮（防手改 state 造出 1,2,4）
  const roundNumbers = (rounds.rounds ?? []).map((entry) => entry.round).sort((a, b) => a - b);
  if (roundNumbers.join(',') !== Array.from({ length: roundNumbers.length }, (_, i) => i + 1).join(',')) {
    problems.push(`轮次编号不连续：${roundNumbers.join(',')}`);
  }
  if (state.nextRound !== (rounds.rounds ?? []).length + 1) {
    problems.push(`state.nextRound（${state.nextRound}）与已生成轮次（${(rounds.rounds ?? []).length}）不一致`);
  }

  let generated = 0;
  const allIds = new Set();
  for (const roundEntry of rounds.rounds ?? []) {
    const candidates = roundEntry.candidates ?? [];
    generated += candidates.length;
    if (candidates.length !== cap.perRound) problems.push(`第 ${roundEntry.round} 轮候选数 ${candidates.length} ≠ ${cap.perRound}`);
    const positions = candidates.map((candidate) => candidate.pos).sort((a, b) => a - b);
    if (positions.join(',') !== Array.from({ length: candidates.length }, (_, i) => i + 1).join(',')) {
      problems.push(`第 ${roundEntry.round} 轮位置编号不连续：${positions.join(',')}`);
    }
    const relationErrors = validateRelation(roundEntry.relation ?? null, candidates.map((candidate) => candidate.world));
    for (const error of relationErrors) problems.push(`第 ${roundEntry.round} 轮关系不成立：${error}`);
    const roundHtml = new Set();
    for (const candidate of candidates) {
      if (allIds.has(candidate.id)) problems.push(`候选 id 重复：${candidate.id}`);
      allIds.add(candidate.id);
      const abs = join(runDir, candidate.htmlPath);
      if (!existsSync(abs)) problems.push(`第 ${roundEntry.round} 轮 位置 ${candidate.pos} 的 HTML 缺失`);
      else {
        const html = readFileSync(abs, 'utf8');
        if (sha256Short(html) !== candidate.htmlSha) problems.push(`第 ${roundEntry.round} 轮 位置 ${candidate.pos} 的 HTML 与 sha 不一致`);
        for (const pattern of EXTERNAL_PATTERNS) {
          if (pattern.test(html)) {
            problems.push(`第 ${roundEntry.round} 轮 位置 ${candidate.pos} 的 HTML 含外部依赖（${pattern}）`);
            break;
          }
        }
        if (roundHtml.has(candidate.htmlSha)) problems.push(`第 ${roundEntry.round} 轮存在 HTML 完全相同的候选（id=${candidate.id}）`);
        roundHtml.add(candidate.htmlSha);
      }
    }
    problems.push(...auditStoredRound(roundEntry, (candidate) => {
      const abs = join(runDir, candidate.htmlPath);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    }));
    const decisions = state.decisionsByRound?.[roundEntry.round];
    if (decisions) {
      const decisionPositions = decisions.map((decision) => decision.pos).sort((a, b) => a - b);
      if (decisionPositions.join(',') !== positions.join(',')) problems.push(`第 ${roundEntry.round} 轮决策与候选位置不匹配`);
      if (decisions.filter((decision) => decision.action === 'defer').length > 1) {
        problems.push(`第 ${roundEntry.round} 轮待定超过 1 个`);
      }
      for (const decision of decisions) {
        if (decision.action === 'eliminate' && chipById(decision.reasonId) === null) {
          problems.push(`第 ${roundEntry.round} 轮位置 ${decision.pos} 的删除理由非法`);
        }
      }
    }
    // 生成的轮次页也要防篡改：先用 pageSha 绑定，再核对文件。
    const roundPagePath = join(runDir, `round-${roundEntry.round}.html`);
    if (!existsSync(roundPagePath)) {
      problems.push(`第 ${roundEntry.round} 轮的 round-${roundEntry.round}.html 页面缺失`);
    } else if (typeof roundEntry.pageSha !== 'string' || roundEntry.pageSha === '') {
      problems.push(`第 ${roundEntry.round} 轮缺少 pageSha（旧版本生成，请重建回合）`);
    } else if (sha256Short(readFileSync(roundPagePath, 'utf8')) !== roundEntry.pageSha) {
      problems.push(`第 ${roundEntry.round} 轮页面 round-${roundEntry.round}.html 与 pageSha 不一致（可能被篡改）`);
    }
  }
  if (generated > cap.maxRounds * cap.perRound) problems.push(`候选数 ${generated} 超过上限 ${cap.maxRounds * cap.perRound}`);

  // 决策轮次必须是 1 开始的连续前缀，且最多留最后一轮未处理
  const decidedRounds = Object.keys(state.decisionsByRound ?? {}).map(Number).sort((a, b) => a - b);
  const roundsTotal = (rounds.rounds ?? []).length;
  if (decidedRounds.join(',') !== Array.from({ length: decidedRounds.length }, (_, i) => i + 1).join(',')) {
    problems.push(`决策轮次不是从第 1 轮开始的连续前缀：${decidedRounds.join(',')}`);
  }
  if (roundsTotal - decidedRounds.length > 1) problems.push(`有 ${roundsTotal - decidedRounds.length} 轮未处理（一次只允许留最后一轮未处理）`);
  if (state.finished && decidedRounds.length !== roundsTotal) problems.push('已结束但还有未决策轮次');

  const deferredTotal = (rounds.rounds ?? []).reduce(
    (sum, roundEntry) => sum + (state.decisionsByRound?.[roundEntry.round] ?? []).filter((decision) => decision.action === 'defer').length,
    0,
  );
  if (state.pending.length !== deferredTotal) problems.push(`pending 数 ${state.pending.length} 与决策里的 defer 数 ${deferredTotal} 不一致`);
  if (state.pending.length > cap.maxPending) problems.push(`pending 数 ${state.pending.length} 超过上限 ${cap.maxPending}`);
  const pendingIds = new Set();
  for (const item of state.pending) {
    if (pendingIds.has(item.id)) problems.push(`pending 里候选 id 重复：${item.id}`);
    pendingIds.add(item.id);
    if (!existsSync(join(runDir, item.htmlPath))) problems.push(`待定候选 HTML 缺失：${item.htmlPath}`);
  }

  // 收口产物与状态一致性
  if (!state.finished) {
    if (state.outcome !== null && state.outcome !== undefined) problems.push('未结束但 outcome 非空');
  } else if (state.outcome === 'chosen') {
    const resultPath = join(runDir, 'result.json');
    if (!existsSync(resultPath)) problems.push('outcome=chosen 但缺少 result.json');
    else {
      try {
        const result = readJson(resultPath, 'result.json');
        if (result.schema !== 'shortlist-result/1') problems.push(`result schema 异常：${result.schema}`);
        const sidecarHit = existsSync(likesPath(runDir))
          && readJson(likesPath(runDir), 'likes.json').shortlist?.some((item) => item.candidateId === result.chosen?.id) === true;
        if (!result.chosen || (!pendingIds.has(result.chosen.id) && !sidecarHit)) problems.push('result.chosen 不在 pending 里');
      } catch (error) {
        problems.push(`result.json 读取失败：${error.message}`);
      }
    }
  } else if (state.outcome === 'draft') {
    const resultPath = join(runDir, 'result.json');
    if (!existsSync(resultPath)) problems.push('outcome=draft 但缺少 result.json');
    else {
      try {
        const result = readJson(resultPath, 'result.json');
        if (result.schema !== 'shortlist-result/1') problems.push(`result schema 异常：${result.schema}`);
        if (result.kind !== 'draft' || typeof result.draft !== 'string' || result.draft === '') {
          problems.push('底稿终选缺少 draft 声明');
        }
        const traitCount = Array.isArray(result.likedTraits) ? result.likedTraits.length : 0;
        if (traitCount < 1) problems.push('底稿终选缺少特征袋');
      } catch (error) {
        problems.push(`result.json 读取失败：${error.message}`);
      }
    }
  } else if (state.outcome === 'capability-gap') {
    const gapPath = join(runDir, 'capability-gap.json');
    if (!existsSync(gapPath)) problems.push('outcome=capability-gap 但缺少 capability-gap.json');
    else {
      try {
        const gap = readJson(gapPath, 'capability-gap.json');
        if (gap.schema !== 'capability-gap/1') problems.push(`capability-gap schema 异常：${gap.schema}`);
        const recomputed = attributeFailure({
          eliminations: state.eliminated,
          finalRejectReasonIds: state.finalRejectReasonIds ?? [],
          generated,
          rounds: roundsTotal,
        });
        if (gap.attribution !== recomputed.attribution) {
          problems.push(`capability-gap attribution（${gap.attribution}）与重算结果（${recomputed.attribution}）不一致`);
        }
        const expectCounts = JSON.stringify(recomputed.reasons.counts);
        if (JSON.stringify(gap.reasonCounts) !== expectCounts) {
          problems.push('capability-gap reasonCounts 与 state 重算结果不一致');
        }
        if (gap.evidence) {
          const reasonIds = [...state.eliminated.map((item) => item.reasonId), ...(state.finalRejectReasonIds ?? [])];
          const fresh = analyzeCapabilityEvidence({ htmls: collectCandidateHtmls(runDir, rounds), reasonIds });
          if (fresh.confidence !== gap.evidence.confidence || JSON.stringify(fresh.featurePresence) !== JSON.stringify(gap.evidence.featurePresence)) {
            problems.push('capability-gap evidence 与候选页面重算结果不一致（证据可能被篡改）');
          }
        }
      } catch (error) {
        problems.push(`capability-gap.json 读取失败：${error.message}`);
      }
    }
  } else {
    problems.push(`finished 但 outcome 未知：${state.outcome}`);
  }

  // 终选页：待定满 3 或已选中时必须有，且用 state.finalPageSha 防篡改
  if (state.pending.length >= cap.maxPending || (state.outcome === 'chosen' && state.finalVia !== 'shortlist-likes')) {
    const finalPagePath = join(runDir, 'final.html');
    if (!existsSync(finalPagePath)) {
      problems.push('需要终选页但 final.html 缺失');
    } else if (typeof state.finalPageSha !== 'string' || state.finalPageSha === '') {
      problems.push('缺少 state.finalPageSha（旧版本生成，请重建回合）');
    } else if (sha256Short(readFileSync(finalPagePath, 'utf8')) !== state.finalPageSha) {
      problems.push('final.html 与 state.finalPageSha 不一致（可能被篡改）');
    }
  }

  let pool = null;
  try {
    pool = readPoolFile(runDir);
  } catch (error) {
    problems.push(`pool.json 读取失败：${error.message}`);
  }
  if (pool !== null && pool.writer === 'external') {
    problems.push(...auditExternalPool(runDir, pool, brief));
  }

  // checklist 按问题类别归属，避免「待定候选 HTML 缺失」同时点亮 HTML 和 pending 两项
  const classify = (problem) => {
    if (/外部池|pool\.json/.test(problem)) return 'external';
    if (/final\.html|round-\d+\.html|pageSha|页面缺失/.test(problem)) return 'pages';
    if (/outcome|result\.json|capability-gap/.test(problem)) return 'outcome';
    if (/决策|待定超过/.test(problem)) return 'decisions';
    if (/待定|pending/.test(problem)) return 'pending';
    if (/上限|候选数|轮次|nextRound/.test(problem)) return 'limits';
    if (/关系不成立|完全不同|候选 id 重复/.test(problem)) return 'relation';
    if (/HTML|sha|外链|外部依赖/.test(problem)) return 'html';
    return 'other';
  };
  const categories = new Set(problems.map(classify));
  const clean = (...cats) => cats.every((cat) => !categories.has(cat));
  const checklist = [
    ['轮次/候选/上限符合 4×3=12 与待定 3', clean('limits')],
    ['每轮关系成立且 HTML 互不相同', clean('relation')],
    ['候选与页面 HTML 的 sha 一致、无外链且未被篡改', clean('html', 'pages')],
    ['外部池来源、12 页、内容槽与关系一致', clean('external')],
    ['决策与候选一一对应、轮次连续、每轮待定 ≤1', clean('decisions')],
    ['待定数正确且 ≤3', clean('pending')],
    ['收口产物与状态一致', clean('outcome')],
  ];
  if (categories.has('other')) problems.push('（存在未归类问题，见上方明细）');
  return { ok: problems.length === 0, problems, checklist, brief, rounds, state };
}

function cmdVerify(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs verify --run <dir>');
  const runDir = resolve(process.cwd(), runFlag);
  const result = verifyRunDir(runDir);
  console.log(`\n校验粗选回合: ${relative(process.cwd(), runDir) || runDir}`);
  for (const [label, ok] of result.checklist) console.log(`  ${ok ? '✔' : '✖'} ${label}`);
  if (!result.ok) {
    console.log('\n问题:');
    for (const problem of result.problems) console.log(`  - ${problem}`);
    return 1;
  }
  console.log('\n结论: 通过');
  return 0;
}

async function cmdDemo(args) {
  let worlds;
  try {
    worlds = await import('./lib/worlds.mjs');
  } catch (error) {
    throw new CliError(`demo 需要 lib/worlds.mjs（shortlist-worlds 交付中）：${error.message}`, 1);
  }
  const scenarioFlag = args.flags.scenario;
  if (scenarioFlag !== undefined && !['success', 'gap', 'both'].includes(String(scenarioFlag))) {
    throw new CliError('--scenario 只能是 success / gap / both', 2);
  }
  const scenarios = scenarioFlag === 'success' || scenarioFlag === 'gap' ? [scenarioFlag] : ['success', 'gap'];
  const outRoot = resolve(process.cwd(), typeof args.flags.out === 'string' ? args.flags.out : DEFAULT_OUT);
  const ledgerPath = resolveLedgerPath(args.flags);
  const briefBase = {
    title: '山径书店 · 首页方向',
    prompt: '为「山径书店」选一个首页方向：删掉不要的，待定想留的；待定满 3 个后三选一。',
    context: { projectType: 'demo', audience: 'owner', device: 'desktop', note: '自动生成的模拟决策，不是真人数据' },
  };
  const summary = [];

  for (const scenario of scenarios) {
    const runId = `sl-demo-${scenario}`;
    let runDir = join(outRoot, runId);
    if (existsSync(runDir)) {
      let suffix = 2;
      while (existsSync(`${runDir}-${suffix}`)) suffix += 1;
      runDir = `${runDir}-${suffix}`;
    }
    mkdirSync(runDir, { recursive: true });
    const actualRunId = runDir.slice(outRoot.length + 1);
    const brief = {
      schema: 'shortlist-brief/1',
      runId: actualRunId,
      title: briefBase.title,
      prompt: briefBase.prompt,
      context: briefBase.context,
      cap: { ...DEFAULT_CAP },
      createdAt: nowIso(),
    };
    const rounds = { schema: 'shortlist-rounds/1', runId: actualRunId, rounds: [] };
    const state = {
      schema: 'shortlist-state/1',
      runId: actualRunId,
      pending: [],
      eliminated: [],
      decisionsByRound: {},
      nextRound: 1,
      generationContexts: [],
      finished: false,
      outcome: null,
    };
    writeJson(join(runDir, 'brief.json'), brief);
    appendLedger(
      ledgerPath,
      {
        t: 'shortlist.initiated',
        schema: ledger.LEDGER_SCHEMA,
        at: nowIso(),
        runId: actualRunId,
        brief: { title: brief.title, prompt: brief.prompt, context: brief.context },
        cap: brief.cap,
      },
      'shortlist.initiated',
    );

    const roundsToRun = scenario === 'success' ? 3 : 4;
    for (let round = 1; round <= roundsToRun; round += 1) {
      const plan = worlds.roundPlan(round);
      if (!plan) throw new CliError(`demo 缺第 ${round} 轮计划`, 1);
      const relation = {
        relation: plan.relation,
        ...(plan.family ? { family: plan.family } : {}),
        ...(plan.axis ? { axis: plan.axis } : {}),
      };
      const candidates = plan.worlds.map((world) => ({
        id: world.id,
        world: {
          material: world.axes.material,
          type: world.axes.type,
          layout: world.axes.layout,
          color: world.axes.color,
          family: world.family,
          variant: world.variant,
          contrast: world.contrast,
        },
        html: worlds.renderCandidate(world),
      }));
      const validation = validateCandidates(candidates, brief.cap, relation);
      if (!validation.ok) throw new CliError(`demo 候选不合格（第 ${round} 轮）：\n  - ${validation.errors.join('\n  - ')}`, 1);
      const order = shuffled(candidates, seedFrom(`${actualRunId}:${round}:order`));
      const roundEntry = { round, relation, generationContext: `fresh-${round}`, createdAt: nowIso(), candidates: [] };
      for (const [index, candidate] of order.entries()) {
        const pos = index + 1;
        const relPath = join('candidates', `r${round}-p${pos}.html`);
        const absPath = join(runDir, relPath);
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, candidate.html, 'utf8');
        roundEntry.candidates.push({ id: candidate.id, pos, world: candidate.world, htmlSha: sha256Short(candidate.html), htmlPath: relPath });
      }
      rounds.rounds.push(roundEntry);
      state.generationContexts.push(`fresh-${round}`);
      writeJson(join(runDir, 'rounds.json'), rounds);
      // 与真实流程一致：每轮都生成可打开的轮次页，并记录页面 sha 供 verify 防篡改
      const roundPage = renderRoundPage({ runDir, brief, state, rounds, round, cap: brief.cap });
      roundEntry.pageSha = roundPage.sha;
      writeJson(join(runDir, 'rounds.json'), rounds);
      appendLedger(
        ledgerPath,
        {
          t: 'shortlist.round',
          schema: ledger.LEDGER_SCHEMA,
          at: nowIso(),
          runId: actualRunId,
          round,
          generationContext: `fresh-${round}`,
          relation,
          candidates: roundEntry.candidates.map((candidate) => ({ pos: candidate.pos, id: candidate.id, world: candidate.world, htmlSha: candidate.htmlSha })),
        },
        'shortlist.round',
      );

      // 模拟决策：success 每轮 defer 一个；gap 全部删除且理由偏 capability
      const session = createRoundSession({ runId: actualRunId, round, candidateCount: roundEntry.candidates.length, maxDeferPerRound: 1, reasons: REASON_CHIPS });
      if (scenario === 'success') {
        const deferPos = ((round - 1) % 3) + 1;
        roundEntry.candidates.forEach((candidate) => {
          if (candidate.pos === deferPos) session.setAction(candidate.pos, 'defer');
          else session.setAction(candidate.pos, 'eliminate', { reasonId: candidate.pos === 1 ? 'template-like' : 'too-quiet' });
        });
      } else {
        const reasonCycle = ['missing-asset', 'template-like', 'missing-motion', 'wrong-direction', 'missing-asset', 'cant-say'];
        roundEntry.candidates.forEach((candidate, index) => {
          session.setAction(candidate.pos, 'eliminate', { reasonId: reasonCycle[index % reasonCycle.length] });
        });
      }
      const record = session.finalize();
      for (const candidate of roundEntry.candidates) {
        const decision = record.decisions.find((item) => item.pos === candidate.pos);
        if (decision.action === 'eliminate') {
          state.eliminated.push({ id: candidate.id, world: candidate.world, reasonId: decision.reasonId, note: '', round });
        } else {
          state.pending.push({ id: candidate.id, world: candidate.world, htmlPath: candidate.htmlPath, fromRound: round });
        }
      }
      state.decisionsByRound[round] = record.decisions;
      state.nextRound = round + 1;
      appendLedger(
        ledgerPath,
        {
          t: 'shortlist.decisions',
          schema: ledger.LEDGER_SCHEMA,
          at: nowIso(),
          runId: actualRunId,
          round,
          decisions: record.decisions,
          pendingAfter: state.pending.map((_, index) => index + 1),
        },
        'shortlist.decisions',
      );
      if (state.pending.length >= brief.cap.maxPending) break;
    }

    if (scenario === 'success') {
      const finalPage = renderFinalPage({ runDir, brief, state, rounds, cap: brief.cap });
      state.finalPageSha = finalPage.sha;
      const finalSession = createFinalSession({ runId: actualRunId, candidateCount: state.pending.length, reasons: REASON_CHIPS });
      finalSession.choose(2);
      const choice = finalSession.finalize();
      writeJson(join(runDir, 'choice.json'), choice);
      const chosen = state.pending[choice.pos - 1];
      writeJson(join(runDir, 'result.json'), {
        schema: 'shortlist-result/1',
        runId: actualRunId,
        chosen: { id: chosen.id, world: chosen.world, fromRound: chosen.fromRound },
        rounds: rounds.rounds.length,
        generated: generatedCount(rounds),
        pending: state.pending.map((item) => item.id),
        nextStep: { mode: 'axis', note: '进入精调：用 probe.mjs 的单轴 + JND 流程' },
        createdAt: nowIso(),
      });
      appendLedger(
        ledgerPath,
        { t: 'shortlist.chosen', schema: ledger.LEDGER_SCHEMA, at: nowIso(), runId: actualRunId, kind: 'candidate', pos: 2, rounds: rounds.rounds.length },
        'shortlist.chosen',
      );
      state.finished = true;
      state.outcome = 'chosen';
      saveState(runDir, state);
      summary.push({ scenario, runId: actualRunId, dir: runDir, outcome: 'chosen', rounds: rounds.rounds.length, generated: generatedCount(rounds) });
    } else {
      state.nextRound = rounds.rounds.length + 1;
      saveState(runDir, state);
      const gap = finishWithCapabilityGap({ runDir, brief, rounds, state, extraRejectReasons: [], ledgerPath });
      summary.push({ scenario, runId: actualRunId, dir: runDir, outcome: gap.attribution, rounds: rounds.rounds.length, generated: generatedCount(rounds), missing: gap.missingCapabilities });
    }
  }

  console.log('\n已生成粗选演示（模拟决策，不是真人数据）：');
  for (const item of summary) {
    console.log(`  ${item.scenario}: ${item.runId} · ${item.rounds} 轮 · ${item.generated} 个候选 → ${item.outcome}`);
    console.log(`    目录: ${relative(process.cwd(), item.dir) || item.dir}`);
  }
  return 0;
}

function readWriterFlag(flags) {
  if (flags.writer === undefined) return undefined;
  if (flags.writer !== 'worlds' && flags.writer !== 'archetype') {
    throw new CliError('--writer 只能是 worlds 或 archetype', 2);
  }
  return flags.writer;
}

async function cmdGenerate(args) {
  let worlds;
  try {
    worlds = await import('./lib/worlds.mjs');
  } catch (error) {
    throw new CliError(`generate 需要 lib/worlds.mjs：${error.message}`, 1);
  }
  const flags = args.flags;
  const requestedWriter = readWriterFlag(flags);
  let pool;
  try {
    pool = loadPool();
  } catch (error) {
    throw new CliError(error.message, 1);
  }
  let writerName;
  try {
    writerName = selectWriter(requestedWriter, pool);
  } catch (error) {
    throw new CliError(error.message, 1);
  }
  let brief;
  if (typeof flags.brief === 'string') {
    brief = readJson(resolve(process.cwd(), flags.brief), 'brief');
  } else if (typeof flags.run === 'string') {
    brief = readJson(join(resolve(process.cwd(), flags.run), 'brief.json'), 'brief.json');
  } else {
    throw new CliError('用法：node shortlist.mjs generate --brief <brief.json> [--round 1] [--out candidates/r1.json]', 2);
  }
  let content;
  if (typeof flags.content === 'string') {
    content = readJson(resolve(process.cwd(), flags.content), '内容槽');
  }
  const hasRound = typeof flags.round === 'string' && flags.round !== '';
  let planRound = hasRound ? Number(flags.round) : null;
  if (hasRound && (!Number.isInteger(planRound) || planRound < 1 || planRound > FIXED_CAP.maxRounds)) {
    throw new CliError(`--round 需要 1 到 ${FIXED_CAP.maxRounds} 的整数`, 2);
  }
  const relationFlag = typeof flags.relation === 'string' ? flags.relation : '';
  const family = typeof flags.family === 'string' ? flags.family : '';
  const axis = typeof flags.axis === 'string' ? flags.axis : '';
  if (relationFlag !== '' && !['lineage', 'contrast'].includes(relationFlag)) {
    throw new CliError('--relation 只能是 lineage 或 contrast', 2);
  }
  if (relationFlag === 'lineage' && axis !== '') throw new CliError('lineage 轮不要传 --axis', 2);
  if (relationFlag === 'contrast' && family !== '') throw new CliError('contrast 轮不要传 --family', 2);
  let relationPlan;
  if (relationFlag !== '' || family !== '' || axis !== '') {
    const relation = relationFlag !== '' ? relationFlag : (family !== '' ? 'lineage' : 'contrast');
    relationPlan = {
      relation,
      ...(family !== '' ? { family } : {}),
      ...(axis !== '' ? { axis } : {}),
    };
  }
  const wantAdd = flags.add === true || flags.add === 'true';
  let expectedRound = null;
  if (wantAdd) {
    if (typeof flags.run !== 'string' || flags.run === '') throw new CliError('generate --add 需要 --run <dir>', 2);
    const runDir = resolve(process.cwd(), flags.run);
    const { rounds, state } = loadRun(runDir);
    if (state.finished === true) throw new CliError('该粗选已结束，不能再生成候选', 1);
    expectedRound = (rounds.rounds?.length ?? 0) + 1;
    if (planRound === null && !relationPlan) planRound = expectedRound;
  }
  let payload;
  try {
    const input = {
      brief,
      ...(content !== undefined ? { content } : {}),
      ...(relationPlan ? { relationPlan } : {}),
      ...(planRound !== null ? { round: planRound } : {}),
    };
    payload = writerName === 'archetype' ? generateArchetypeRound({ ...input, pool }) : worlds.generateRound(input);
  } catch (error) {
    throw new CliError(error.message, error instanceof RangeError ? 2 : 1);
  }
  if (wantAdd && payload.round !== undefined && expectedRound !== null && payload.round !== expectedRound) {
    throw new CliError(`该回合下一轮是第 ${expectedRound} 轮，这份世界计划属于第 ${payload.round} 轮`, 1);
  }
  const relation = {
    relation: payload.relation,
    ...(payload.family ? { family: payload.family } : {}),
    ...(payload.axis ? { axis: payload.axis } : {}),
  };
  const validation = validateCandidates(payload.candidates, FIXED_CAP, relation);
  if (!validation.ok) {
    throw new CliError(`生成结果不能入库：\n  - ${validation.errors.join('\n  - ')}`, 1);
  }
  // 特征袋只作为生成上下文附在 JSON / stdout 上。writer 不读它，HTML 与内容槽保持原样。
  const likedTraits = typeof flags.run === 'string' ? readTraitBag(resolve(process.cwd(), flags.run)) : [];
  if (likedTraits.length > 0) payload.likedTraits = likedTraits;
  const fileRound = payload.round ?? planRound ?? 1;
  const outPath = typeof flags.out === 'string' && flags.out !== ''
    ? resolve(process.cwd(), flags.out)
    : resolve(
      process.cwd(),
      typeof flags.run === 'string' ? flags.run : '.',
      'candidates',
      `r${fileRound}.json`,
    );
  writeJson(outPath, payload);
  const relOut = relative(process.cwd(), outPath) || outPath;
  const relationLabel = `${payload.relation}${payload.family ? ' / ' + payload.family : ''}${payload.axis ? ' / ' + payload.axis : ''}`;
  const sourceLabel = writerName === 'archetype' ? '骨架库' : '世界卡';
  console.log(`\n已生成候选（${sourceLabel} · ${relationLabel}，计划轮次 ${fileRound}）`);
  console.log(`  文件: ${relOut}`);
  console.log(`  来源: ${payload.writer}`);
  console.log(`  内容槽: ${payload.content.title} · ${payload.contentHash}`);
  console.log(`  骨架哈希: ${payload.skeletonHash}`);
  if (likedTraits.length > 0) {
    console.log(`  特征袋: ${likedTraits.length} 条（下一轮生成上下文，不改 HTML，不写 decide，不写台账）`);
    for (const trait of likedTraits) console.log(`    - ${trait.candidateId} · ${trait.kind} · ${trait.text}`);
  }
  if (writerName === 'archetype') {
    console.log(`  骨架: ${payload.candidates.map((item) => item.archetypeId).join('、')}`);
    console.log('  三页文案相同，结构不同，并套用世界的颜色和字体。generate 不写 decide、不写台账。');
  } else {
    console.log(`  世界: ${payload.candidates.map((item) => item.id).join('、')}`);
    console.log('  三页文案相同，只换视觉世界。generate 不写 decide、不写台账。');
  }
  if (!wantAdd) {
    const runHint = typeof flags.run === 'string'
      ? (relative(process.cwd(), resolve(process.cwd(), flags.run)) || flags.run)
      : '<run>';
    console.log('\n下一步：add 入库后再 preview，不要另写一份 HTML：');
    console.log(`  node shortlist.mjs add --run ${runHint} --candidates ${relOut} --context-token <fresh-token>`);
    return 0;
  }
  return cmdAdd({
    _: ['add'],
    flags: {
      run: flags.run,
      candidates: outPath,
      ...(typeof flags['context-token'] === 'string' ? { 'context-token': flags['context-token'] } : {}),
      ...(typeof flags.ledger === 'string' ? { ledger: flags.ledger } : {}),
    },
  });
}

async function cmdPool(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs pool --run <dir> [--writer worlds|archetype] [--seed <id>]');
  const runDir = resolve(process.cwd(), runFlag);
  const { brief, rounds, state } = loadRun(runDir);
  capOrThrow(brief.cap);
  if (state.finished === true) throw new CliError('该粗选已结束，不能再铺池', 1);
  if ((rounds.rounds ?? []).length > 0) throw new CliError('已有轮次候选，不能再铺预生成池', 1);
  if (state.pending.length > 0) throw new CliError('已有待定候选，不能再铺预生成池', 1);
  if (existsSync(poolPath(runDir))) throw new CliError('预生成池已存在', 1);
  const requestedWriter = readWriterFlag(args.flags);
  let archetypePool;
  try {
    archetypePool = loadPool();
  } catch (error) {
    throw new CliError(error.message, 1);
  }
  let writerName;
  try {
    writerName = selectWriter(requestedWriter, archetypePool);
  } catch (error) {
    throw new CliError(error.message, 1);
  }
  let worlds = null;
  if (writerName !== 'archetype') {
    try {
      worlds = await import('./lib/worlds.mjs');
    } catch (error) {
      throw new CliError(`pool 需要 lib/worlds.mjs：${error.message}`, 1);
    }
  }
  const seed =
    typeof args.flags.seed === 'string' && args.flags.seed !== ''
      ? args.flags.seed
      : brief.runId;
  let plans;
  try {
    plans = writerName === 'archetype'
      ? buildArchetypePoolPlan({ seed, pool: archetypePool })
      : worlds.buildWorldPoolPlan(seed);
  } catch (error) {
    throw new CliError(`池计划生成失败：${error.message}`, 1);
  }
  if (!Array.isArray(plans) || plans.length !== FIXED_CAP.maxRounds) {
    throw new CliError(`池计划必须是 ${FIXED_CAP.maxRounds} 轮`, 1);
  }
  const poolCandidates = [];
  const seenIds = new Set();
  let contentHash = '';
  for (let round = 1; round <= FIXED_CAP.maxRounds; round += 1) {
    let payload;
    try {
      payload = writerName === 'archetype'
        ? generateArchetypeRound({ brief, plan: plans[round - 1], pool: archetypePool })
        : worlds.generateRound({ brief, relationPlan: plans[round - 1] });
    } catch (error) {
      throw new CliError(error.message, error instanceof RangeError ? 2 : 1);
    }
    const relation = {
      relation: payload.relation,
      ...(payload.family ? { family: payload.family } : {}),
      ...(payload.axis ? { axis: payload.axis } : {}),
    };
    const validation = validateCandidates(payload.candidates, FIXED_CAP, relation);
    if (!validation.ok) throw new CliError(`第 ${round} 轮不能进池：\n  - ${validation.errors.join('\n  - ')}`, 1);
    try {
      assertWriterPayload(payload, archetypePool);
    } catch (error) {
      throw new CliError(error.message, 1);
    }
    if (typeof payload.contentHash === 'string') {
      if (contentHash === '') contentHash = payload.contentHash;
      else if (contentHash !== payload.contentHash) {
        throw new CliError(`第 ${round} 轮内容槽哈希与第 1 轮不一致`, 1);
      }
    }
    for (const [index, candidate] of payload.candidates.entries()) {
      if (seenIds.has(candidate.id)) throw new CliError(`池内候选 id 重复：${candidate.id}`, 1);
      seenIds.add(candidate.id);
      const pos = index + 1;
      const poolIndex = poolCandidates.length + 1;
      if (poolIndex > POOL_CAP) throw new CliError(`池最多 ${POOL_CAP} 个候选`, 1);
      const relPath = join('candidates', `pool-r${round}-p${pos}.html`);
      const absPath = join(runDir, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, candidate.html, 'utf8');
      poolCandidates.push({
        id: candidate.id,
        poolIndex,
        round,
        pos,
        world: candidate.world,
        htmlSha: sha256Short(candidate.html),
        htmlPath: relPath.replaceAll('\\', '/'),
        relation,
        ...(typeof candidate.archetypeId === 'string' && candidate.archetypeId !== '' ? { archetypeId: candidate.archetypeId } : {}),
        ...(typeof candidate.skeletonHash === 'string' && candidate.skeletonHash !== '' ? { skeletonHash: candidate.skeletonHash } : {}),
      });
    }
  }
  const likedTraits = readTraitBag(runDir);
  const pool = {
    schema: POOL_SCHEMA,
    runId: brief.runId,
    cap: POOL_CAP,
    window: WINDOW_SIZE,
    writer: writerName,
    seed,
    contentHash,
    likedTraits,
    candidates: poolCandidates,
  };
  writeJson(poolPath(runDir), pool);
  console.log(`\n已预生成池 ${poolCandidates.length}/${POOL_CAP}，窗口 ${WINDOW_SIZE} 张`);
  console.log(`  文件: ${relative(process.cwd(), poolPath(runDir)) || 'pool.json'}`);
  console.log('  来源与内容槽沿用 generate；pool 不写 decide，不写台账。');
  console.log('  工作台里删除或路过一张，下一张从池顶补进第三栏；整页短名单最多 3 张，不必每轮待定。');
  if (likedTraits.length > 0) {
    console.log(`  特征袋: ${likedTraits.length} 条`);
    for (const trait of likedTraits) console.log(`    - ${trait.candidateId} · ${trait.kind} · ${trait.text}`);
  }
  return 0;
}

async function cmdPlan(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs plan --run <dir> [--seed <id>]');
  const runDir = resolve(process.cwd(), runFlag);
  const { brief, rounds, state } = loadRun(runDir);
  capOrThrow(brief.cap);
  if (state.finished === true) throw new CliError('该粗选已结束，不能再生成 plan', 1);
  if ((rounds.rounds ?? []).length > 0) throw new CliError('已有轮次候选，不能再生成外部 plan', 1);
  if (state.pending.length > 0) throw new CliError('已有待定候选，不能再生成外部 plan', 1);
  if (existsSync(poolPath(runDir))) throw new CliError('预生成池已存在，不能再生成外部 plan', 1);
  const seed =
    typeof args.flags.seed === 'string' && args.flags.seed !== ''
      ? args.flags.seed
      : brief.runId;
  const content = brief.content ? normalizeContent(brief.content) : contentFromBrief(brief);
  const hash = contentHash(content);
  const contract = {
    schema: 'shortlist-html-contract/1',
    slots: ['title', 'subtitle', 'bullet', 'meta', 'cta', 'foot'],
    dataSlotAttribute: 'data-slot',
    rules: [
      '每页 <title> 与标题槽一致',
      '标题 / 副标题 / 3 条要点 / CTA / 页脚使用 data-slot 或现有 class',
      '同一轮三页内容槽必须完全一致，且等于 plan.content',
      '无外链、无脚本、无外部字体/图片',
      '同一轮 HTML 互不相同；整池 12 页互不相同',
    ],
    html: { minBytes: 200, maxBytes: 204800 },
  };
  const plan = {
    schema: 'shortlist-external-plan/1',
    runId: brief.runId,
    writer: 'external',
    seed,
    planId: sha256Short(`${seed}:${hash}:${brief.runId}`),
    content,
    contentHash: hash,
    contract,
    rounds: [
      {
        round: 1,
        relation: 'lineage',
        familyHint: '由 skill 声明同一个 family，并给出三个不同 variant',
        instruction: '三页属于同一设计家族，但派别/结构不同；import 时 relation.family 填同一个 family。',
      },
      {
        round: 2,
        relation: 'lineage',
        familyHint: '由 skill 声明同一个 family，并给出三个不同 variant',
        instruction: '另起一个设计家族，三页同族不同派；import 时 relation.family 填同一个 family。',
      },
      {
        round: 3,
        relation: 'contrast',
        axis: 'ornament',
        axisLabel: '装饰密度',
        instruction: '同一装饰轴上 low / mid / high 各一页，且跨至少 2 个 family；在 candidate.world.contrast.ornament 填档位。',
      },
      {
        round: 4,
        relation: 'contrast',
        axis: 'image',
        axisLabel: '影像参与度',
        instruction: '同一影像轴上 low / mid / high 各一页，且跨至少 2 个 family；在 candidate.world.contrast.image 填档位。',
      },
    ],
    createdAt: nowIso(),
  };
  writeJson(join(runDir, 'plan.json'), plan);
  console.log(`\n已生成外部生成计划 ${plan.planId}`);
  console.log(`  文件: ${relative(process.cwd(), join(runDir, 'plan.json')) || 'plan.json'}`);
  console.log(`  seed: ${seed}`);
  console.log('  下一步：按 plan 生成 4 轮 × 3 个 HTML，写 import bundle，然后：');
  console.log(`  node shortlist.mjs import --run ${relative(process.cwd(), runDir) || runDir} --bundle <bundle.json>`);
  return 0;
}

function normalizeWorldDeclaration(world) {
  if (!world || typeof world !== 'object') return world;
  const axes = world.axes && typeof world.axes === 'object' ? world.axes : world;
  return {
    ...world,
    material: axes.material ?? world.material,
    type: axes.type ?? world.type,
    layout: axes.layout ?? world.layout,
    color: axes.color ?? world.color,
  };
}

function importHtml(cwd, candidate, round, index) {
  if (!candidate || typeof candidate !== 'object') {
    throw new CliError(`第 ${round} 轮 candidates[${index}] 必须是对象`, 1);
  }
  if (typeof candidate.html === 'string' && candidate.html !== '') return candidate.html;
  if (typeof candidate.htmlPath !== 'string' || candidate.htmlPath === '') {
    throw new CliError(`第 ${round} 轮 candidates[${index}] 需要 html 或 htmlPath`, 1);
  }
  const abs = resolve(cwd, candidate.htmlPath);
  const rel = relative(cwd, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new CliError(`第 ${round} 轮 candidates[${index}].htmlPath 必须位于当前工作目录内`, 1);
  }
  if (!existsSync(abs)) throw new CliError(`第 ${round} 轮 candidates[${index}].htmlPath 不存在：${candidate.htmlPath}`, 1);
  return readFileSync(abs, 'utf8');
}

async function cmdImport(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs import --run <dir> --bundle <bundle.json>');
  const bundleFlag = requireFlag(args.flags, 'bundle', '需要 --bundle <bundle.json>');
  const runDir = resolve(process.cwd(), runFlag);
  const { brief, rounds, state } = loadRun(runDir);
  capOrThrow(brief.cap);
  if (state.finished === true) throw new CliError('该粗选已结束，不能导入外部候选', 1);
  if ((rounds.rounds ?? []).length > 0) throw new CliError('已有轮次候选，不能再导入外部池', 1);
  if (state.pending.length > 0) throw new CliError('已有待定候选，不能再导入外部池', 1);
  if (existsSync(poolPath(runDir))) throw new CliError('预生成池已存在，不能再导入', 1);
  const planPath = join(runDir, 'plan.json');
  if (!existsSync(planPath)) throw new CliError('先运行 plan 生成 plan.json，再 import', 1);
  const plan = readJson(planPath, 'plan');
  if (plan.schema !== 'shortlist-external-plan/1' || plan.runId !== brief.runId) {
    throw new CliError('plan.json 不是当前回合的外部计划', 1);
  }
  const bundle = readJson(resolve(process.cwd(), bundleFlag), 'import bundle');
  if (bundle.schema !== 'shortlist-external-import/1') {
    throw new CliError('bundle.schema 应为 shortlist-external-import/1', 1);
  }
  if (bundle.writer !== 'external') throw new CliError('bundle.writer 应为 external', 1);
  const skill = bundle.skill;
  for (const key of ['id', 'source', 'license']) {
    if (!skill || typeof skill[key] !== 'string' || skill[key] === '') {
      throw new CliError(`bundle.skill.${key} 必须是非空字符串（记录来源与许可证）`, 1);
    }
  }
  if (!Array.isArray(bundle.rounds) || bundle.rounds.length !== FIXED_CAP.maxRounds) {
    throw new CliError(`bundle.rounds 必须恰好 ${FIXED_CAP.maxRounds} 轮`, 1);
  }
  const planRounds = new Map(
    (Array.isArray(plan.rounds) ? plan.rounds : []).map((item) => [Number(item.round), item]),
  );
  if (planRounds.size !== FIXED_CAP.maxRounds) {
    throw new CliError('plan.json 必须包含 4 轮计划', 1);
  }
  const sortedRounds = bundle.rounds.slice().sort((a, b) => Number(a.round) - Number(b.round));
  const seenRounds = new Set();
  const poolCandidates = [];
  const seenIds = new Set();
  const seenHtml = new Set();
  let slots = null;
  for (const roundEntry of sortedRounds) {
    const round = Number(roundEntry.round);
    if (!Number.isInteger(round) || round < 1 || round > FIXED_CAP.maxRounds) {
      throw new CliError(`bundle 轮次非法：${JSON.stringify(roundEntry.round)}`, 1);
    }
    if (seenRounds.has(round)) throw new CliError(`bundle 轮次重复：${round}`, 1);
    seenRounds.add(round);
    const planRound = planRounds.get(round);
    if (!planRound) throw new CliError(`plan 缺少第 ${round} 轮`, 1);
    const relation = {
      relation: roundEntry.relation?.relation,
      ...(typeof roundEntry.relation?.family === 'string' && roundEntry.relation.family !== ''
        ? { family: roundEntry.relation.family }
        : {}),
      ...(typeof roundEntry.relation?.axis === 'string' && roundEntry.relation.axis !== ''
        ? { axis: roundEntry.relation.axis }
        : {}),
    };
    if (relation.relation !== planRound.relation) {
      throw new CliError(
        `第 ${round} 轮关系与 plan 不一致：plan 要求 ${planRound.relation}，bundle 是 ${relation.relation}`,
        1,
      );
    }
    if (planRound.relation === 'contrast' && relation.axis !== planRound.axis) {
      throw new CliError(
        `第 ${round} 轮对比轴与 plan 不一致：plan 要求 ${planRound.axis}，bundle 是 ${relation.axis}`,
        1,
      );
    }
    const entries = roundEntry.candidates;
    if (!Array.isArray(entries) || entries.length !== FIXED_CAP.perRound) {
      throw new CliError(`第 ${round} 轮必须恰好 ${FIXED_CAP.perRound} 个候选`, 1);
    }
    const candidates = entries.map((candidate, index) => ({
      id: candidate?.id,
      world: normalizeWorldDeclaration(candidate?.world),
      html: importHtml(process.cwd(), candidate, round, index),
    }));
    const validation = validateCandidates(candidates, FIXED_CAP, relation);
    if (!validation.ok) {
      throw new CliError(`第 ${round} 轮不能导入：\n  - ${validation.errors.join('\n  - ')}`, 1);
    }
    for (const candidate of candidates) {
      if (seenIds.has(candidate.id)) throw new CliError(`候选 id 跨轮重复：${candidate.id}`, 1);
      seenIds.add(candidate.id);
      if (seenHtml.has(candidate.html)) throw new CliError(`候选 HTML 跨轮重复：${candidate.id}`, 1);
      seenHtml.add(candidate.html);
      const candidateSlots = readContentSlots(candidate.html);
      if (candidateSlots === null) throw new CliError(`候选 ${candidate.id} 缺少内容槽`, 1);
      if (slots === null) slots = candidateSlots;
      else if (JSON.stringify(candidateSlots) !== JSON.stringify(slots)) {
        throw new CliError(`候选 ${candidate.id} 的内容槽与整池其他候选不一致`, 1);
      }
      if (JSON.stringify(candidateSlots) !== JSON.stringify(plan.content)) {
        throw new CliError(`候选 ${candidate.id} 的内容槽与 plan.content 不一致`, 1);
      }
    }
    for (const [index, candidate] of candidates.entries()) {
      const pos = index + 1;
      const poolIndex = poolCandidates.length + 1;
      if (poolIndex > POOL_CAP) throw new CliError(`池最多 ${POOL_CAP} 个候选`, 1);
      const relPath = join('candidates', `pool-r${round}-p${pos}.html`);
      const absPath = join(runDir, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, candidate.html, 'utf8');
      poolCandidates.push({
        id: candidate.id,
        poolIndex,
        round,
        pos,
        world: candidate.world,
        htmlSha: sha256Short(candidate.html),
        htmlPath: relPath.replaceAll('\\', '/'),
        relation,
      });
    }
  }
  if (seenIds.size !== FIXED_CAP.maxRounds * FIXED_CAP.perRound) {
    throw new CliError('外部池必须恰好 12 个不同候选', 1);
  }
  const pool = {
    schema: POOL_SCHEMA,
    runId: brief.runId,
    cap: POOL_CAP,
    window: WINDOW_SIZE,
    writer: 'external',
    seed: typeof bundle.seed === 'string' && bundle.seed !== '' ? bundle.seed : plan.seed,
    planId: plan.planId,
    skill,
    contentHash: plan.contentHash,
    likedTraits: readTraitBag(runDir),
    candidates: poolCandidates,
  };
  writeJson(poolPath(runDir), pool);
  console.log(`\n已导入外部池 ${poolCandidates.length}/${POOL_CAP}`);
  console.log(`  writer: external · skill: ${skill.id}`);
  console.log(`  文件: ${relative(process.cwd(), poolPath(runDir)) || 'pool.json'}`);
  console.log('  下一步：probe_shortlist_preview，然后按工作台流程选择。');
  return 0;
}

function cmdLikes(args) {
  const runFlag = requireFlag(args.flags, 'run', '用法：node shortlist.mjs likes --run <dir> --file <likes.json>');
  const fileFlag = requireFlag(args.flags, 'file', '需要 --file <likes.json>');
  const runDir = resolve(process.cwd(), runFlag);
  const { brief } = loadRun(runDir);
  const raw = readJson(resolve(process.cwd(), fileFlag), 'likes 文件');
  const pool = readPoolFile(runDir);
  if (pool === null) throw new CliError('先 pool 预生成候选，再写 likes sidecar', 1);
  if (pool.runId !== brief.runId) throw new CliError('pool.json 的 runId 与回合不一致', 1);
  const poolById = poolByIdMap(pool);
  let record;
  try {
    record = normalizeLikesRecord(raw, {
      runId: brief.runId,
      poolIds: [...poolById.keys()],
      reasonIds: REASON_CHIPS.map((chip) => chip.id),
      poolById,
    });
  } catch (error) {
    throw new CliError(`likes 不合格：${error.message}`, 1);
  }
  writeJson(likesPath(runDir), record);
  console.log(`\n已写入 sidecar ${LIKES_SCHEMA}`);
  console.log(`  喜欢 ${record.likes.length} · 特征 ${record.traits.length} · 短名单 ${record.shortlist.length}/${3} · 已看 ${record.seen.length}/${POOL_CAP}`);
  console.log('  不写 decide，不写台账。删除理由不会自动变成下一轮约束。');
  if (record.traits.length > 0) {
    console.log('  特征袋:');
    for (const trait of record.traits) console.log(`    - ${trait.candidateId} · ${trait.kind} · ${trait.text}`);
  }
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
  const gaps = events.filter((event) => event.t === 'capability.gap');
  if (gaps.length > 0) {
    console.log('\n能力缺口记录:');
    for (const gap of gaps) console.log(`  ${gap.runId} · ${gap.attribution} · ${gap.route}`);
  }
  return 0;
}

function usage() {
  console.log(`shortlist · 粗选（世界级候选 → 删/待定 → 待定满 3 → 三选一）

用法:
  node shortlist.mjs init --brief <brief.json> [--run-id <id>] [--out shortlist-runs]
  node shortlist.mjs generate --brief <brief.json> | --run <dir> [--writer worlds|archetype] [--round 1] [--relation lineage|contrast] [--family <id>] [--axis <id>] [--content <slots.json>] [--out candidates/rN.json] [--add]
  node shortlist.mjs pool --run <dir> [--writer worlds|archetype] [--seed <id>]
  node shortlist.mjs plan --run <dir> [--seed <id>]              # 外部 skill：生成 4 轮计划
  node shortlist.mjs import --run <dir> --bundle <bundle.json>   # 外部 skill：导入 12 页
  node shortlist.mjs add --run <dir> --candidates <candidates.json> [--context-token <token>]
  node shortlist.mjs likes --run <dir> --file <likes.json>
  node shortlist.mjs decide --run <dir> --round <n> --decisions <file.jsonl>
  node shortlist.mjs final --run <dir> --choice <file.jsonl>
  node shortlist.mjs report --run <dir>
  node shortlist.mjs verify --run <dir>
  node shortlist.mjs status
  node shortlist.mjs demo [--scenario success|gap|both] [--out shortlist-runs]

规则: 每轮 3 个候选，必须声明关系（lineage 同族不同派 / contrast 三档跨族）；三页锁定同一内容槽、HTML 互异、无外链，否则 add 拒收；
      generate 默认：骨架库存在则用 archetype（结构不同的完整页 + 世界 token），否则回落 worlds。--writer=worlds 强制世界卡。
      archetype 轮还会核对 skeletonHash 与结构签名。旧的 decide 仍是每轮最多待定 1 个。
      pool 预生成最多 12 个，工作台窗只亮 3 张；删除或路过就补位，不必每轮待定。整页短名单最多 3 张。
      likes sidecar（shortlist-likes/1）记 likes / traits / shortlist。已删候选仍可 save-trait。
      下一轮 generate 只把特征袋抄进 JSON 和 stdout，不改 HTML。不抬高 12，不做 blend，不做特征 token 化。
      final：短名单 ≥ 1，或声明底稿且特征袋 ≥ 1；特征袋空且无短名单则拒绝。
      用满 12 个或终选「都不行」→ 归因（capability/brief/taste/no-preference）并给出路由，不再生成第 13 个。
      generate / pool / likes 不写 decide，不自己写台账。

退出码: 0 成功 · 1 校验失败 · 2 参数错误`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const KNOWN_FLAGS = new Set(['brief', 'run-id', 'out', 'run', 'candidates', 'context-token', 'round', 'decisions', 'choice', 'scenario', 'ledger', 'now', 'help', 'relation', 'family', 'axis', 'content', 'add', 'writer', 'file', 'seed', 'bundle']);
  for (const key of Object.keys(args.flags)) {
    if (!KNOWN_FLAGS.has(key)) throw new CliError(`未知参数 --${key}。用 --help 查看用法。`, 2);
  }
  const command = args._[0];
  const handlers = {
    init: cmdInit,
    generate: cmdGenerate,
    pool: cmdPool,
    plan: cmdPlan,
    import: cmdImport,
    add: cmdAdd,
    likes: cmdLikes,
    decide: cmdDecide,
    final: cmdFinal,
    report: cmdReport,
    verify: cmdVerify,
    demo: cmdDemo,
    status: cmdStatus,
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
  cmdInit,
  cmdGenerate,
  cmdPool,
  cmdPlan,
  cmdImport,
  cmdAdd,
  cmdDecide,
  cmdFinal,
  cmdReport,
  cmdVerify,
  cmdDemo,
  cmdStatus,
  renderRoundPage,
  renderFinalPage,
  verifyRunDir,
  CliError,
  SHORTLIST_VERSION,
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
