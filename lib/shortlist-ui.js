import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { runProcessAsync } from './process.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCwdResolver } from './cwd.js';
import { guardWorkspacePath, isWithinRoot } from './path-guard.js';
import { jsonOutput } from './tool-output.js';

const KIT_DIR = fileURLToPath(new URL('../skills/design-kit/probe-kit/', import.meta.url));
const DEFAULT_TIMEOUT_MS = 120_000;
const UI_TOKEN_SCHEMA = 'shortlist-ui-token/1';
const UI_TOKEN_DIR = '.ui-tokens';
const LEGACY_UI_TOKEN_FILE = '.ui-token.json';
const UI_TOKEN_RE = /^[a-f0-9]{48}$/;
const UI_TOKEN_MAX_PER_RUN = 32;
const UI_TOKEN_TTL_MS = 30 * 60 * 1000;

export const SHORTLIST_UI_REASON_CHIPS = Object.freeze([
  { id: 'too-loud', label: '太吵 / 太花', tag: 'taste' },
  { id: 'too-quiet', label: '太素 / 太平', tag: 'taste' },
  { id: 'template-like', label: '太像模板', tag: 'taste' },
  { id: 'not-product', label: '不像我们的产品', tag: 'brief' },
  { id: 'wrong-direction', label: '方向不对', tag: 'brief' },
  { id: 'cant-say', label: '说不上来', tag: 'brief' },
  { id: 'missing-asset', label: '缺真实素材（照片/插画）', tag: 'capability' },
  { id: 'missing-motion', label: '需要动效 / 交互', tag: 'capability' },
  { id: 'missing-data', label: '需要数据图表', tag: 'capability' },
  { id: 'missing-3d', label: '需要 3D / 特殊渲染', tag: 'capability' },
  { id: 'no-preference', label: '其实没有强偏好', tag: 'no-preference' },
]);

const AXIS_LABELS = { ornament: '装饰密度', image: '影像参与度' };

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function resolveRun(value, cwd) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const dir = isAbsolute(value) ? value : resolve(cwd, value);
  return existsSync(join(dir, 'rounds.json')) && existsSync(join(dir, 'state.json')) ? dir : null;
}

function relationLabel(relation = {}) {
  if (relation.relation === 'lineage') return '同族不同派 · ' + String(relation.family ?? '未命名家族');
  if (relation.relation === 'contrast') return '同一对比轴 · ' + (AXIS_LABELS[relation.axis] ?? String(relation.axis ?? '未命名轴'));
  return '有关系的候选';
}

function candidateHtml(runDir, candidate) {
  const path = resolve(runDir, String(candidate.htmlPath ?? ''));
  if (!isWithinRoot(runDir, path)) throw new Error('候选路径越界：' + candidate.htmlPath);
  if (!existsSync(path)) throw new Error('候选 HTML 不存在：' + candidate.htmlPath);
  return readText(path);
}

/**
 * B5：工具结果里不再塞原始 HTML（三份约 24KB），改成 gzip+base64；
 * 客户端拿到后解压再投 iframe。模型/对话只看到压缩串。
 */
function encodeCandidateHtml(html, htmlPath) {
  const raw = Buffer.from(html, 'utf8');
  return {
    htmlPath,
    htmlEncoding: 'gzip+base64',
    htmlGzip: gzipSync(raw, { level: 9 }).toString('base64'),
    htmlBytes: raw.byteLength,
  };
}

function parsePayload(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('缺少 payload（JSON 字符串）');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('payload 不是合法 JSON');
  }
  if (value?.schema !== 'shortlist-ui-action/1') throw new Error('payload.schema 应为 shortlist-ui-action/1');
  return value;
}

function normalizeNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('note 必须是字符串');
  return value.trim().slice(0, 200);
}

function tokenDir(runDir) {
  return join(runDir, UI_TOKEN_DIR);
}

function tokenPath(runDir, token) {
  return join(tokenDir(runDir), token + '.json');
}

/** 清理过期令牌，并把同回合的令牌数量控制在 UI_TOKEN_MAX_PER_RUN 以内。 */
function pruneUiTokens(runDir) {
  const dir = tokenDir(runDir);
  if (!existsSync(dir)) return;
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return;
  }
  const now = Date.now();
  const live = [];
  for (const name of names) {
    const path = join(dir, name);
    let record;
    try {
      record = readJson(path);
    } catch {
      rmSync(path, { force: true });
      continue;
    }
    const issued = Date.parse(record?.issuedAt);
    if (!Number.isFinite(issued) || now - issued > UI_TOKEN_TTL_MS || now - issued < -5 * 60 * 1000) {
      rmSync(path, { force: true });
      continue;
    }
    live.push({ path, issued });
  }
  // 先写新令牌，所以只保留 MAX-1 个旧令牌，避免刚发的被清掉。
  const keep = Math.max(0, UI_TOKEN_MAX_PER_RUN - 1);
  if (live.length > keep) {
    live.sort((a, b) => a.issued - b.issued);
    for (const item of live.slice(0, live.length - keep)) rmSync(item.path, { force: true });
  }
}

/** 发一张一次性预览令牌：绑定 run / mode / round / 候选 id，30 分钟过期。 */
function issueUiToken(runDir, { runId, mode, round, candidates }) {
  const dir = tokenDir(runDir);
  mkdirSync(dir, { recursive: true });
  // 0.1.5 的单文件令牌不再参与校验；清掉避免旧卡片误用。
  rmSync(join(runDir, LEGACY_UI_TOKEN_FILE), { force: true });
  pruneUiTokens(runDir);
  const token = randomBytes(24).toString('hex');
  const issuedAt = new Date();
  const record = {
    schema: UI_TOKEN_SCHEMA,
    token,
    runId,
    mode,
    round: round ?? null,
    candidates: candidates.map((candidate) => ({ pos: candidate.pos, id: candidate.id })),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + UI_TOKEN_TTL_MS).toISOString(),
  };
  writeFileSync(tokenPath(runDir, token), JSON.stringify(record) + '\n', 'utf8');
  return { token, expiresAt: record.expiresAt };
}

/**
 * A3 硬门：校验卡片回传令牌。伪造、过期、不匹配、已使用都拒绝。
 * 不在这里消费令牌；调用方在验证完 payload 后再删，避免无效 payload 把令牌烧掉。
 */
function requireUiToken(runDir, payload, brief) {
  if (typeof payload.uiToken !== 'string' || payload.uiToken.trim() === '') {
    throw new Error('缺少预览令牌：不要手写 UI 动作；请先 probe_shortlist_preview，再点卡片。');
  }
  const token = payload.uiToken.trim();
  if (!UI_TOKEN_RE.test(token)) {
    throw new Error('预览令牌不匹配（格式或来源不合法，可能被伪造），请重新预览。');
  }
  const path = tokenPath(runDir, token);
  if (!existsSync(path)) {
    throw new Error('预览令牌不存在或已被使用：请重新调用 probe_shortlist_preview 再操作。');
  }
  let record;
  try {
    record = readJson(path);
  } catch {
    throw new Error('预览令牌损坏：请重新调用 probe_shortlist_preview。');
  }
  if (record?.schema !== UI_TOKEN_SCHEMA) throw new Error('预览令牌格式不合法，请重新预览。');
  if (record.token !== token) throw new Error('预览令牌不匹配（可能被伪造或来自旧卡片），请重新预览。');
  if (record.runId !== brief.runId) throw new Error('预览令牌与回合不匹配，请重新预览。');
  const issued = Date.parse(record.issuedAt);
  if (!Number.isFinite(issued) || Date.now() - issued > UI_TOKEN_TTL_MS) {
    throw new Error('预览令牌已过期（30 分钟），请重新调用 probe_shortlist_preview。');
  }
  if (Date.now() - issued < -5 * 60 * 1000) throw new Error('预览令牌时间异常，请重新预览。');
  return { record, path };
}

function sameCandidates(recordCandidates, stateCandidates) {
  if (!Array.isArray(recordCandidates) || !Array.isArray(stateCandidates)) return false;
  if (recordCandidates.length !== stateCandidates.length) return false;
  return recordCandidates.every((item, index) => {
    const current = stateCandidates[index];
    return current && Number(item.pos) === Number(current.pos) && item.id === current.id;
  });
}

export function buildPreview(args, cwd) {
  const guarded = guardWorkspacePath(cwd, args?.run, { label: 'run' });
  if (!guarded.ok) return guarded;
  const runDir = resolveRun(guarded.path, cwd);
  if (runDir === null) {
    return { ok: false, error: '找不到粗选回合（需要 rounds.json + state.json）：' + JSON.stringify(args?.run) };
  }
  const brief = readJson(join(runDir, 'brief.json'));
  const rounds = readJson(join(runDir, 'rounds.json'));
  const state = readJson(join(runDir, 'state.json'));
  if (state.finished === true) {
    return { ok: false, error: '该粗选已结束（' + String(state.outcome ?? 'finished') + '），直接看 result.json；不要再用 preview。' };
  }
  const roundList = Array.isArray(rounds.rounds) ? rounds.rounds : [];
  if (roundList.length === 0) {
    return { ok: false, error: '还没有候选轮次：先 probe_shortlist add 一轮。' };
  }

  const pending = Array.isArray(state.pending) ? state.pending : [];
  let mode = 'round';
  let candidates;
  let roundNumber;
  let relation = {};
  if (pending.length >= 3) {
    mode = 'final';
    roundNumber = null;
    candidates = pending.map((item, index) => ({
      pos: index + 1,
      id: item.id,
      fromRound: item.fromRound,
      ...encodeCandidateHtml(candidateHtml(runDir, item), item.htmlPath),
    }));
  } else {
    const latest = roundList[roundList.length - 1];
    roundNumber = Number(latest.round);
    if (args?.round !== undefined && Number(args.round) !== roundNumber) {
      return { ok: false, error: '只能预览当前未决策轮（第 ' + roundNumber + ' 轮），收到第 ' + args.round + ' 轮。' };
    }
    if (state.decisionsByRound?.[roundNumber]) {
      return { ok: false, error: '第 ' + roundNumber + ' 轮已决策；先 probe_shortlist add 下一轮，再 preview。' };
    }
    relation = latest.relation ?? {};
    candidates = (latest.candidates ?? []).map((item) => ({
      pos: Number(item.pos),
      id: item.id,
      fromRound: roundNumber,
      ...encodeCandidateHtml(candidateHtml(runDir, item), item.htmlPath),
    }));
  }

  const generated = roundList.reduce((sum, item) => sum + (item.candidates?.length ?? 0), 0);
  const token = issueUiToken(runDir, {
    runId: brief.runId,
    mode,
    round: roundNumber,
    candidates,
  });
  return {
    ok: true,
    schema: 'shortlist-preview/1',
    run: runDir,
    runId: brief.runId,
    mode,
    round: roundNumber,
    relation,
    relationLabel: mode === 'final' ? '终选 · 三个待定方向' : relationLabel(relation),
    pendingCount: pending.length,
    generated,
    rounds: roundList.length,
    cap: { maxRounds: 4, perRound: 3, maxPending: 3 },
    candidates,
    reasonChips: SHORTLIST_UI_REASON_CHIPS,
    uiToken: token.token,
    uiTokenExpiresAt: token.expiresAt,
    hint:
      mode === 'final'
        ? '三选一，或「都不行」并选至少一个理由。'
        : '给 3 个候选各做一次决策：删除（带理由）或待定（全轮最多 1 个）。',
  };
}

async function runShortlistCli(args, cwd, timeoutMs) {
  return runProcessAsync(process.execPath, [join(KIT_DIR, 'shortlist.mjs'), ...args], {
    cwd,
    timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function persistAction(payload, cwd, timeoutMs) {
  const guarded = guardWorkspacePath(cwd, payload.run, { label: 'run' });
  if (!guarded.ok) throw new Error(guarded.error);
  const runDir = resolveRun(guarded.path, cwd);
  if (runDir === null) throw new Error('找不到粗选回合：' + JSON.stringify(payload.run));
  const brief = readJson(join(runDir, 'brief.json'));
  const state = readJson(join(runDir, 'state.json'));
  const rounds = readJson(join(runDir, 'rounds.json'));
  if (state.finished === true) throw new Error('该粗选已结束，不能再次决策。');
  const { record: tokenRecord, path: tokenFilePath } = requireUiToken(runDir, payload, brief);
  const tmp = join(runDir, '.tmp-ui-' + process.pid + '-' + Date.now() + '.jsonl');
  let cli;
  if (payload.kind === 'decide') {
      if (tokenRecord.mode !== 'round') throw new Error('令牌属于终选阶段，不能提交本轮决策。');
      const round = Number(payload.round);
      if (!Number.isInteger(round) || round < 1) throw new Error('decide 需要正整数 round');
      if (round !== Number(tokenRecord.round)) throw new Error('轮次与预览令牌不匹配，请重新预览。');
      if (state.decisionsByRound?.[round]) throw new Error('该轮已经决策过，不能重复提交；请重新预览。');
      const latest = (rounds.rounds ?? [])[rounds.rounds.length - 1];
      if (!latest || Number(latest.round) !== round) throw new Error('回合状态已变化（最新轮次不同），请重新预览。');
      if (!sameCandidates(tokenRecord.candidates, latest.candidates ?? [])) {
        throw new Error('候选与预览令牌不匹配（可能已重新生成），请重新预览。');
      }
      const decisions = Array.isArray(payload.decisions) ? payload.decisions : null;
      if (decisions === null || decisions.length !== 3) throw new Error('decisions 必须恰好覆盖 3 个候选');
      const validReasons = new Set(SHORTLIST_UI_REASON_CHIPS.map((item) => item.id));
      const seen = new Set();
      let defers = 0;
      for (const decision of decisions) {
        const pos = Number(decision?.pos);
        if (!Number.isInteger(pos) || pos < 1 || pos > 3 || seen.has(pos)) throw new Error('decision.pos 非法或重复：' + JSON.stringify(decision?.pos));
        seen.add(pos);
        if (!['eliminate', 'defer'].includes(decision.action)) throw new Error('decision.action 只能是 eliminate/defer');
        if (decision.action === 'defer') defers += 1;
        else if (!validReasons.has(decision.reasonId)) throw new Error('删除理由非法：' + JSON.stringify(decision.reasonId));
      }
      if (defers > 1) throw new Error('每轮最多待定 1 个');
      const record = {
        schema: 'shortlist-decisions/1',
        runId: brief.runId,
        round,
        decisions: decisions.map((decision) => {
          const note = normalizeNote(decision.note);
          return {
            pos: Number(decision.pos),
            action: decision.action,
            ...(decision.action === 'eliminate' ? { reasonId: decision.reasonId } : {}),
            ...(note ? { note } : {}),
          };
        }),
      };
      writeFileSync(tmp, JSON.stringify(record) + '\n', 'utf8');
      cli = ['decide', '--run', runDir, '--round', String(round), '--decisions', tmp];
    } else if (payload.kind === 'final') {
      if (tokenRecord.mode !== 'final') throw new Error('令牌属于轮次阶段，不能提交终选。');
      if (state.pending.length !== 3) throw new Error('待定数不是 3，不能终选；请重新预览。');
      const pendingCandidates = state.pending.map((item, index) => ({ pos: index + 1, id: item.id }));
      if (!sameCandidates(tokenRecord.candidates, pendingCandidates)) {
        throw new Error('终选候选与预览令牌不匹配，请重新预览。');
      }
      const choice = payload.choice ?? {};
      const validReasons = new Set(SHORTLIST_UI_REASON_CHIPS.map((item) => item.id));
      let record;
      if (choice.kind === 'candidate') {
        const pos = Number(choice.pos);
        if (!Number.isInteger(pos) || pos < 1 || pos > 3) throw new Error('choice.pos 必须是 1–3');
        record = { schema: 'shortlist-choice/1', runId: brief.runId, kind: 'candidate', pos };
      } else if (choice.kind === 'none') {
        const reasonIds = Array.isArray(choice.reasonIds) ? choice.reasonIds.filter((id) => validReasons.has(id)) : [];
        if (reasonIds.length < 1) throw new Error('「都不行」至少需要一个合法理由');
        const note = normalizeNote(choice.note);
        record = {
          schema: 'shortlist-choice/1',
          runId: brief.runId,
          kind: 'none',
          reasonIds: [...new Set(reasonIds)],
          ...(note ? { note } : {}),
        };
      } else {
        throw new Error('choice.kind 只能是 candidate/none');
      }
      writeFileSync(tmp, JSON.stringify(record) + '\n', 'utf8');
      cli = ['final', '--run', runDir, '--choice', tmp];
    } else {
      throw new Error('payload.kind 只能是 decide/final');
    }
    // 一次性令牌：只消费当前这张卡片的 token，不影响同回合其他预览。
    rmSync(tokenFilePath, { force: true });
  return { runDir, cli, tmp };
}

export function buildShortlistUiTools(config = {}, ctx = null) {
  const getCwd = createCwdResolver(ctx);
  const timeoutMs = Math.min(300_000, Math.max(5_000, Number(config.uiTimeoutMs ?? config.probeTimeoutMs ?? DEFAULT_TIMEOUT_MS)));
  const configuredLedger =
    typeof config.ledgerPath === 'string' && config.ledgerPath !== '' ? config.ledgerPath : null;

  return [
    {
      name: 'probe_shortlist_preview',
      description:
        '对话内三栏预览：读取已有粗选回合（probe_shortlist add 之后）的候选 HTML，返回三个 360×480 预览与删除/待定/终选动作所需数据；DSH 客户端会把这个结果渲染成可点击的三栏卡片。只读，不改变回合状态。中文：对话内三方向预览。',
      parameters: {
        type: 'object',
        properties: {
          run: { type: 'string', description: '粗选回合目录（含 rounds.json/state.json）。' },
          round: { type: 'integer', description: '可选：要预览的轮次；默认当前未决策轮。' },
          cwd: { type: 'string', description: '可选：工作目录，默认会话工作目录。' },
        },
        required: ['run'],
      },
      output: jsonOutput(),
      async execute(args, exec) {
        try {
          return buildPreview(args, getCwd(exec));
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    {
      name: 'probe_shortlist_ui_action',
      description:
        '执行对话内三栏卡片发回的结构化动作：decide（3 个候选的删除/待定）或 final（三选一 / 都不行）。会写决策/终选文件并调用 shortlist.mjs 落账，返回 CLI 输出。参数 payload 是卡片消息里 [probe-shortlist-ui] 后面的 JSON 字符串。中文：执行对话内粗选选择。',
      parameters: {
        type: 'object',
        properties: {
          payload: { type: 'string', description: '卡片发回的结构化动作 JSON（schema=shortlist-ui-action/1）。' },
          cwd: { type: 'string', description: '可选：工作目录，默认会话工作目录。' },
        },
        required: ['payload'],
      },
      output: jsonOutput(),
      async execute(args, exec) {
        const cwd = getCwd(exec);
        let payload;
        try {
          payload = parsePayload(args?.payload);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        let prepared;
        try {
          prepared = persistAction(payload, cwd, timeoutMs);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        const cli = [...prepared.cli, '--ledger', configuredLedger ?? join(cwd, 'probe-kit-ledger', 'ledger.jsonl')];
        const run = await runShortlistCli(cli, cwd, timeoutMs);
        try {
          rmSync(prepared.tmp, { force: true });
        } catch {
          // 临时文件清理失败不影响结果
        }
        const output = (run.stdout + '\n' + run.stderr).trim();
        return {
          ok: run.exitCode === 0 && run.spawnError === null,
          exitCode: run.exitCode,
          action: payload.kind,
          run: prepared.runDir,
          spawnError: run.spawnError,
          timedOut: run.timedOut === true,
          stdoutTail: output.length > 8000 ? output.slice(-8000) : output,
          ...(run.spawnError ? { error: 'shortlist.mjs 启动失败：' + run.spawnError + '（沙箱可能 EPERM）' } : {}),
          ...(run.exitCode !== 0 && run.spawnError === null
            ? { error: 'shortlist.mjs 退出码 ' + run.exitCode + '，见 stdoutTail。' }
            : {}),
        };
      },
    },
  ];
}

export const SHORTLIST_UI_TOOL_NAMES = ['probe_shortlist_preview', 'probe_shortlist_ui_action'];
