import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const DESIGN_STATE_SCHEMA = 'design-kit-state/1';
export const DESIGN_STATE_FILE = '.design-kit-state.json';

export function designStatePath(cwd) {
  return join(cwd, DESIGN_STATE_FILE);
}

/** 读取会话级阶段文件；不存在/损坏都返回 null（不阻塞老项目）。 */
export function readDesignState(cwd) {
  const path = designStatePath(cwd);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value?.schema !== DESIGN_STATE_SCHEMA) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeDesignState(cwd, patch = {}) {
  const previous = readDesignState(cwd) ?? { schema: DESIGN_STATE_SCHEMA, phase: 'idle' };
  const next = {
    ...previous,
    ...patch,
    schema: DESIGN_STATE_SCHEMA,
    updatedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(designStatePath(cwd), JSON.stringify(next) + '\n', 'utf8');
  } catch {
    // 状态文件写不进去不阻断工具主流程；下次调用会重新尝试
  }
  return next;
}

/** 粗选回合还没 final 时返回状态对象，供 measure 前置拦截。 */
export function unfinishedShortlist(cwd) {
  const state = readDesignState(cwd);
  if (state === null) return null;
  if (state.phase !== 'shortlist') return null;
  if (state.shortlistFinished === true) return null;
  // 兼容 0.1.10 及更早版本：UI 终选可能只写了回合 state.json，没有回写会话状态。
  // 以回合自身的 finished 为准，并顺手修正会话状态，避免 measure 被永久拦住。
  if (typeof state.shortlistRun === 'string' && state.shortlistRun !== '') {
    try {
      const runDir = isAbsolute(state.shortlistRun) ? state.shortlistRun : join(cwd, state.shortlistRun);
      const runState = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'));
      if (runState?.finished === true) {
        writeDesignState(cwd, { shortlistFinished: true });
        return null;
      }
    } catch {
      // 回合目录不可读时保持原状，避免把状态门误判为已结束。
    }
  }
  return state;
}

export function markShortlist(cwd, { run = null, finished = false } = {}) {
  return writeDesignState(cwd, {
    phase: 'shortlist',
    shortlistRun: run,
    shortlistFinished: finished === true,
  });
}

export function markMeasure(cwd, { run = null } = {}) {
  return writeDesignState(cwd, {
    phase: 'measure',
    measureRun: run,
  });
}
