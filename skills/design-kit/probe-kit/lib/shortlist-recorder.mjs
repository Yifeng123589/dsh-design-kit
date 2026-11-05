// shortlist 状态机：轮次「删除/待定」与终选「三选一/都不行」。无 DOM、无依赖，页面与 Node 共用。
// 页面侧由 CLI 内联源码（去掉 export 前缀），Node 侧直接 import 测试。

export const SHORTLIST_VERSION = '1';

function assertPos(pos, candidateCount) {
  if (!Number.isInteger(pos) || pos < 1 || pos > candidateCount) {
    throw new RangeError(`位置编号必须是 1..${candidateCount} 的整数，收到 ${JSON.stringify(pos)}`);
  }
}

function iso(at) {
  return new Date(at).toISOString();
}

function normalizeReasons(reasons) {
  if (!Array.isArray(reasons)) throw new TypeError('reasons 必须是数组');
  return reasons.map((reason) => {
    if (reason === null || typeof reason !== 'object') throw new TypeError('reason 必须是对象');
    if (typeof reason.id !== 'string' || reason.id === '') throw new TypeError('reason.id 必须是非空字符串');
    if (typeof reason.label !== 'string' || reason.label === '') throw new TypeError('reason.label 必须是非空字符串');
    if (!['capability', 'brief', 'taste', 'no-preference'].includes(reason.tag)) {
      throw new RangeError(`reason.tag 非法：${reason.tag}`);
    }
    return { id: reason.id, label: reason.label, tag: reason.tag };
  });
}

/** 轮次会话：每个候选恰好一个动作；每轮最多 defer 一个；删除必须带理由。 */
export function createRoundSession(options) {
  const {
    runId,
    round,
    candidateCount,
    maxDeferPerRound = 1,
    reasons = [],
    clock = Date.now,
    startedAt = Date.now(),
  } = options ?? {};
  if (typeof runId !== 'string' || runId === '') throw new TypeError('createRoundSession 需要 runId');
  if (!Number.isInteger(round) || round < 1) throw new TypeError('round 必须是正整数');
  if (!Number.isInteger(candidateCount) || candidateCount < 2) throw new TypeError('candidateCount 至少为 2');
  if (!Number.isInteger(maxDeferPerRound) || maxDeferPerRound < 0) throw new TypeError('maxDeferPerRound 必须是非负整数');
  const chips = normalizeReasons(reasons);
  const chipIds = new Set(chips.map((chip) => chip.id));

  const actions = new Map();
  let locked = false;

  const deferCount = () => [...actions.values()].filter((action) => action.action === 'defer').length;

  const session = {
    runId,
    round,
    candidateCount,
    maxDeferPerRound,

    canDefer(pos) {
      if (locked) return false;
      const current = actions.get(pos);
      if (current && current.action === 'defer') return true; // 幂等
      return deferCount() < maxDeferPerRound;
    },

    setAction(pos, action, options2 = {}) {
      if (locked) throw new Error('LOCKED');
      assertPos(pos, candidateCount);
      if (action !== 'eliminate' && action !== 'defer') throw new RangeError(`action 只能是 eliminate/defer，收到 ${action}`);
      if (action === 'defer' && !session.canDefer(pos)) {
        throw new RangeError(`每轮最多待定 ${maxDeferPerRound} 个`);
      }
      if (action === 'eliminate') {
        const reasonId = options2.reasonId;
        if (typeof reasonId !== 'string' || !chipIds.has(reasonId)) {
          throw new RangeError(`删除必须带合法理由 chip，收到 ${JSON.stringify(reasonId)}`);
        }
        const note = options2.note === undefined ? '' : options2.note;
        if (typeof note !== 'string') throw new TypeError('note 必须是字符串');
        actions.set(pos, { action, reasonId, note });
        return;
      }
      actions.set(pos, { action });
    },

    clear(pos) {
      if (locked) throw new Error('LOCKED');
      assertPos(pos, candidateCount);
      actions.delete(pos);
    },

    peek() {
      const list = [...actions.entries()].map(([pos, action]) => ({ pos, ...action }));
      const errors = [];
      for (let pos = 1; pos <= candidateCount; pos += 1) {
        if (!actions.has(pos)) errors.push(`位置 ${pos} 还没有动作`);
      }
      if (deferCount() > maxDeferPerRound) errors.push(`待定数量 ${deferCount()} 超过上限 ${maxDeferPerRound}`);
      for (const action of list) {
        if (action.action === 'eliminate' && !chipIds.has(action.reasonId)) errors.push(`位置 ${action.pos} 的删除理由非法`);
      }
      return {
        runId,
        round,
        actions: list,
        deferCount: deferCount(),
        complete: errors.length === 0,
        errors,
      };
    },

    finalize() {
      if (locked) throw new Error('LOCKED');
      const snapshot = session.peek();
      if (!snapshot.complete) throw new Error(`本轮未完成：${snapshot.errors.join('；')}`);
      locked = true;
      const endedAt = clock();
      const decisions = [...actions.entries()]
        .map(([pos, action]) => ({ pos, ...action }))
        .sort((a, b) => a.pos - b.pos);
      return {
        schema: 'shortlist-decisions/1',
        runId,
        round,
        startedAt: iso(startedAt),
        endedAt: iso(endedAt),
        durationMs: Math.max(0, endedAt - startedAt),
        decisions,
      };
    },
  };

  return session;
}

/** 终选会话：三选一，或全部否决并给出理由。 */
export function createFinalSession(options) {
  const { runId, candidateCount, reasons = [], clock = Date.now, startedAt = Date.now() } = options ?? {};
  if (typeof runId !== 'string' || runId === '') throw new TypeError('createFinalSession 需要 runId');
  if (!Number.isInteger(candidateCount) || candidateCount < 2) throw new TypeError('candidateCount 至少为 2');
  const chips = normalizeReasons(reasons);
  const chipIds = new Set(chips.map((chip) => chip.id));

  let chosenPos = null;
  let rejectIds = [];
  let note = '';
  let locked = false;

  const session = {
    runId,
    candidateCount,

    choose(pos) {
      if (locked) throw new Error('LOCKED');
      assertPos(pos, candidateCount);
      chosenPos = pos;
      rejectIds = [];
      note = '';
    },

    clearChoice() {
      if (locked) throw new Error('LOCKED');
      chosenPos = null;
      rejectIds = [];
      note = '';
    },

    setRejectReasons(reasonIds, noteText = '') {
      if (locked) throw new Error('LOCKED');
      if (!Array.isArray(reasonIds) || reasonIds.length < 1) throw new RangeError('「都不行」至少选一个理由');
      for (const id of reasonIds) {
        if (!chipIds.has(id)) throw new RangeError(`理由 chip 非法：${JSON.stringify(id)}`);
      }
      if (typeof noteText !== 'string') throw new TypeError('note 必须是字符串');
      rejectIds = [...new Set(reasonIds)];
      note = noteText;
      chosenPos = null;
    },

    peek() {
      const kind = chosenPos !== null ? 'candidate' : rejectIds.length > 0 ? 'none' : null;
      return { runId, kind, chosenPos, rejectIds: [...rejectIds], note };
    },

    finalize() {
      if (locked) throw new Error('LOCKED');
      if (chosenPos === null && rejectIds.length === 0) throw new Error('尚未做出选择：选一个或都不行');
      locked = true;
      const endedAt = clock();
      const record = {
        schema: 'shortlist-choice/1',
        runId,
        kind: chosenPos !== null ? 'candidate' : 'none',
        pos: chosenPos,
        reasonIds: [...rejectIds],
        note,
        startedAt: iso(startedAt),
        endedAt: iso(endedAt),
        durationMs: Math.max(0, endedAt - startedAt),
      };
      return record;
    },
  };

  return session;
}

/** 生成给页面内联用的源码：去掉 export 前缀。 */
export function inlineSource(source) {
  return source.replace(/^export\s+(function|const|let|class)\s/gm, '$1 ');
}
