// 指认记录状态机：无 DOM、无依赖，Node 与浏览器共用。
// 浏览器侧由呈现器内联（去掉 export 前缀），Node 侧直接 import 测试。

export const RECORDER_VERSION = '1';

function assertPos(pos, positionCount) {
  if (!Number.isInteger(pos) || pos < 1 || pos > positionCount) {
    throw new RangeError(`位置编号必须是 1..${positionCount} 的整数，收到 ${JSON.stringify(pos)}`);
  }
}

function iso(at) {
  return new Date(at).toISOString();
}

export function createSession(options) {
  const { runId, positionCount, sessionId = null, startedAt = Date.now(), clock = Date.now } = options ?? {};
  if (typeof runId !== 'string' || runId === '') throw new TypeError('createSession 需要 runId');
  if (!Number.isInteger(positionCount) || positionCount < 2) throw new TypeError('positionCount 至少为 2');

  const state = {
    answerKind: null, // 'absolute' | 'between'
    chosenPos: null,
    betweenPos: null,
    confidence: null,
    flips: 0,
    dwell: Object.fromEntries(Array.from({ length: positionCount }, (_, i) => [String(i + 1), 0])),
    openEnter: new Map(),
    env: {},
    locked: false,
    lockRecord: null,
    startedAt,
  };

  const hasAnswer = () => state.answerKind !== null;

  const session = {
    runId,
    positionCount,

    markEnter(pos) {
      assertPos(pos, positionCount);
      if (state.locked) return;
      if (!state.openEnter.has(pos)) state.openEnter.set(pos, clock());
    },

    markLeave(pos) {
      assertPos(pos, positionCount);
      if (state.locked) return;
      const at = state.openEnter.get(pos);
      if (at !== undefined) {
        state.dwell[String(pos)] += Math.max(0, clock() - at);
        state.openEnter.delete(pos);
      }
    },

    choose(pos) {
      assertPos(pos, positionCount);
      if (state.locked) throw new Error('LOCKED');
      const changed = hasAnswer() && !(state.answerKind === 'absolute' && state.chosenPos === pos);
      if (changed) state.flips += 1;
      state.answerKind = 'absolute';
      state.chosenPos = pos;
      state.betweenPos = null;
    },

    chooseBetween(a, b) {
      assertPos(a, positionCount);
      assertPos(b, positionCount);
      if (a === b) throw new RangeError('区间指认需要两个不同的位置');
      if (state.locked) throw new Error('LOCKED');
      const pair = [Math.min(a, b), Math.max(a, b)];
      const changed =
        hasAnswer() && !(state.answerKind === 'between' && state.betweenPos?.[0] === pair[0] && state.betweenPos?.[1] === pair[1]);
      if (changed) state.flips += 1;
      state.answerKind = 'between';
      state.betweenPos = pair;
      state.chosenPos = null;
    },

    clear() {
      if (state.locked) throw new Error('LOCKED');
      if (hasAnswer()) state.flips += 1;
      state.answerKind = null;
      state.chosenPos = null;
      state.betweenPos = null;
    },

    setConfidence(level) {
      if (level !== null && ![1, 2, 3, 4].includes(level)) {
        throw new RangeError('把握程度只能是 1..4 或 null');
      }
      state.confidence = level;
    },

    setEnvironment(env) {
      if (env === null || typeof env !== 'object') throw new TypeError('setEnvironment 需要对象');
      const allow = ['viewport', 'lang', 'reducedMotion', 'userAgentFamily'];
      for (const key of allow) if (env[key] !== undefined) state.env[key] = env[key];
    },

    peek() {
      session.flushDwell();
      return {
        runId,
        locked: state.locked,
        answerKind: state.answerKind,
        chosenPos: state.chosenPos,
        betweenPos: state.betweenPos ? [...state.betweenPos] : null,
        confidence: state.confidence,
        flips: state.flips,
        dwellMs: { ...state.dwell },
        elapsedMs: Math.max(0, clock() - state.startedAt),
        env: { ...state.env },
      };
    },

    answerSummary() {
      if (!hasAnswer()) return null;
      return {
        kind: state.answerKind,
        chosenPos: state.chosenPos,
        betweenPos: state.betweenPos ? [...state.betweenPos] : null,
        flips: state.flips,
        confidence: state.confidence,
      };
    },

    /** 把尚未离开的停留计时结算掉（窗口失焦、页面隐藏、锁定时调用）。 */
    flushDwell() {
      const now = clock();
      for (const [pos, at] of state.openEnter) {
        state.dwell[String(pos)] += Math.max(0, now - at);
        state.openEnter.set(pos, now);
      }
    },

    lock() {
      if (state.locked) throw new Error('LOCKED');
      if (!hasAnswer()) throw new Error('NO_ANSWER');
      session.flushDwell();
      state.openEnter.clear();
      state.locked = true;
      const endedAt = clock();
      state.lockRecord = {
        schema: 'probe-answer/1',
        recorder: RECORDER_VERSION,
        runId,
        sessionId,
        startedAt: iso(state.startedAt),
        endedAt: iso(endedAt),
        durationMs: Math.max(0, endedAt - state.startedAt),
        answer: {
          kind: state.answerKind,
          chosenPos: state.chosenPos,
          betweenPos: state.betweenPos ? [...state.betweenPos] : null,
        },
        flips: state.flips,
        dwellMs: { ...state.dwell },
        confidence: state.confidence,
        env: { ...state.env },
      };
      return state.lockRecord;
    },
  };

  return session;
}

/** 校验一条指认记录与位置数量是否自洽。 */
export function validateAnswer(record, positionCount) {
  const errors = [];
  if (record === null || typeof record !== 'object') return { ok: false, errors: ['记录不是对象'] };
  if (record.schema !== 'probe-answer/1') errors.push(`schema 应为 probe-answer/1，收到 ${record.schema}`);
  if (!Number.isInteger(positionCount) || positionCount < 2) errors.push('positionCount 非法');
  if (record.answer === null || typeof record.answer !== 'object') {
    errors.push('缺少 answer');
    return { ok: false, errors };
  }
  const { kind, chosenPos, betweenPos } = record.answer;
  if (kind === 'absolute') {
    if (!Number.isInteger(chosenPos) || chosenPos < 1 || chosenPos > positionCount) errors.push('absolute 指认的 chosenPos 非法');
    if (betweenPos !== null && betweenPos !== undefined) errors.push('absolute 指认不应带 betweenPos');
  } else if (kind === 'between') {
    if (!Array.isArray(betweenPos) || betweenPos.length !== 2) errors.push('between 指认缺少两个位置');
    else {
      const [a, b] = betweenPos;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a > positionCount || b > positionCount) {
        errors.push('between 指认的位置越界');
      } else if (a === b) errors.push('between 指认的两个位置相同');
      else if (a > b) errors.push('between 指认的位置应升序存储');
    }
    if (chosenPos !== null && chosenPos !== undefined) errors.push('between 指认不应带 chosenPos');
  } else {
    errors.push(`未知的 answer.kind：${kind}`);
  }
  if (!Number.isInteger(record.flips) || record.flips < 0) errors.push('flips 应为非负整数');
  if (record.confidence !== null && ![1, 2, 3, 4].includes(record.confidence)) errors.push('confidence 应为 1..4 或 null');
  if (record.dwellMs !== undefined) {
    if (record.dwellMs === null || typeof record.dwellMs !== 'object') errors.push('dwellMs 应为对象');
    else {
      for (const [key, value] of Object.entries(record.dwellMs)) {
        const pos = Number(key);
        if (!Number.isInteger(pos) || pos < 1 || pos > positionCount) errors.push(`dwellMs 的位置 ${key} 越界`);
        if (typeof value !== 'number' || value < 0) errors.push(`dwellMs[${key}] 应为非负数`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 生成给呈现器内联用的源码：去掉 export 前缀，保留函数体。 */
export function inlineSource(source) {
  return source.replace(/^export\s+(function|const|let|class)\s/gm, '$1 ');
}
