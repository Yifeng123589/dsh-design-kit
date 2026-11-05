import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
