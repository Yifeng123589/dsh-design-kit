// 事件台账、有效期与收敛判定。
//
// 设计约束（与 SPEC.md 第三节对齐）：
// - JSONL append-only：一行一个事件，只追加、不覆盖、不回滚。
// - 纯函数优先：时间一律由调用方注入 now；只有 appendEvent 在缺省 at 时兜底取当前时间。
// - 零依赖：只用 node:fs / node:path / node:crypto。
//
// 导出（签名以 SPEC.md 第三节为准）：
//   LEDGER_SCHEMA、PREFERENCE_TIER、appendEvent、readEvents、validateEvent、
//   envFingerprint、makeRunEvent、credentialState、reviewState、convergence、
//   resolveVariantValues
//
// 文档没写死、由本模块自行决定的细则见各函数注释与 README/汇报里的「取舍」清单。

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const LEDGER_SCHEMA = 'probe-ledger/1';

// 偏好档位：最多 3 次运行、14 天硬上限。禁止把多个到期条件加权求和，
// 任何一个条件触发即按对应理由判到期（见 credentialState）。
export const PREFERENCE_TIER = Object.freeze({
  maxRuns: 3,
  hardDays: 14,
  tier: 'preference-short',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_WINDOW_DAYS = 2;
const CONVERGENCE_RATIO = 0.05;

const EVENT_TYPES = Object.freeze([
  'run.recorded',
  'attribution.recorded',
  'credential.revoked',
  'review.done',
  'calibration.applied',
  // 粗选（shortlist）交互：世界级候选的删/待定/三选一/能力缺口
  'shortlist.initiated',
  'shortlist.round',
  'shortlist.decisions',
  'shortlist.chosen',
  'capability.gap',
]);

const DIM_KINDS = Object.freeze(['continuous', 'discrete', 'none']);

// reviewState.warnings：协议自带的诚实警告，固定三条，措辞写死方便 CLI 原样展示。
const REVIEW_WARNINGS = Object.freeze([
  'coverage 未度量：不知道呈现器实际覆盖了轴的哪些区间，结论只对已呈现的点有效（协议 P8）',
  '单评审人：所有记录来自同一位评审者，无法排除个人偏好偏差（协议 P5）',
  '轴纯度只有代理：颜色轴看色度/明度/对比度漂移，字号/间距轴看声明位；没有感知层事实核查，需人工复核（协议 P1）',
]);

// 只接受带时区/毫秒的完整 ISO 时间串；不把「2026-01-01」这类日期串当合法事件时间。
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------
// 小工具（不导出；纯函数、无副作用）
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/** 数字展示：最多 4 位小数、去掉多余 0，用于 reasons / note 里的中文短句。 */
function formatNumber(value) {
  if (!isFiniteNumber(value)) return '—';
  const rounded = Math.round(value * 10000) / 10000;
  return String(rounded);
}

/** JSON 稳定序列化（对象键排序），用于比较 context 是否等价。 */
function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** 把 null / undefined / {} 统一成 '{}'，其余按排好键的 JSON 比较。 */
function canonicalContext(context) {
  if (context === null || context === undefined) return '{}';
  if (!Array.isArray(context) && typeof context === 'object' && Object.keys(context).length === 0) return '{}';
  return stableStringify(context);
}

/** 允许 now 传 ISO 串 / Date / 毫秒数；未传时兜底当前时间（仅 CLI 便捷路径）。 */
function toTimeMs(value) {
  if (value === undefined || value === null) return Date.now();
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isFinite(ms)) return ms;
    throw new TypeError(`时间参数非法：${String(value)}`);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  if (Number.isNaN(ms)) throw new TypeError(`时间参数 now 非法，无法解析为时间：${JSON.stringify(value)}`);
  return ms;
}

function pickIso(value) {
  return isIsoTimestamp(value) ? value : null;
}

/** 变体表归一化：pos ≥ 1 的整数、value 有限数字、pos 不重复，失败抛中文错误。 */
function normalizeVariants(variants, label = 'runManifest.variants') {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new TypeError(`${label} 必须是非空数组`);
  }
  const seen = new Set();
  return variants.map((variant, index) => {
    if (!isPlainObject(variant)) throw new TypeError(`${label}[${index}] 必须是对象`);
    const { pos, value } = variant;
    if (!Number.isInteger(pos) || pos < 1) {
      throw new RangeError(`${label}[${index}].pos 必须是 ≥1 的整数，收到 ${JSON.stringify(pos)}`);
    }
    if (seen.has(pos)) throw new RangeError(`${label} 中位置 ${pos} 重复`);
    seen.add(pos);
    if (!isFiniteNumber(value)) {
      throw new TypeError(`${label}[${index}].value 必须是有限数字，收到 ${JSON.stringify(value)}`);
    }
    return {
      pos,
      id: isNonEmptyString(variant.id) ? variant.id : `v${pos}`,
      value,
    };
  });
}

/** 轴归一化；manifest 没给 axis 时退化为「变体值的最小/最大」，保证收敛仍可算跨度。 */
function normalizeRunAxis(axis, dim, variants) {
  if (axis === undefined || axis === null) {
    const values = variants.map((variant) => variant.value);
    return { name: dim, unit: 'fraction', min: Math.min(...values), max: Math.max(...values) };
  }
  if (!isPlainObject(axis)) throw new TypeError('runManifest.axis 必须是对象');
  if (!isFiniteNumber(axis.min)) throw new TypeError(`runManifest.axis.min 必须是有限数字，收到 ${JSON.stringify(axis.min)}`);
  if (!isFiniteNumber(axis.max)) throw new TypeError(`runManifest.axis.max 必须是有限数字，收到 ${JSON.stringify(axis.max)}`);
  if (axis.max < axis.min) throw new RangeError('runManifest.axis.max 不能小于 min');
  return {
    // 透传 run.json 里已有的轴标识，方便 CLI 用 axis.id 回查 axis.mjs；
    // name 按 SPEC 事件示例固定为机器可读的 dim 名。
    ...(isNonEmptyString(axis.id) ? { id: axis.id } : {}),
    ...(isNonEmptyString(axis.dim) ? { dim: axis.dim } : {}),
    ...(isNonEmptyString(axis.label) ? { label: axis.label } : {}),
    ...(DIM_KINDS.includes(axis.kind) ? { kind: axis.kind } : {}),
    ...(isFiniteNumber(axis.jnd) ? { jnd: axis.jnd } : {}),
    name: isNonEmptyString(axis.name) ? axis.name : dim,
    unit: isNonEmptyString(axis.unit) ? axis.unit : 'fraction',
    min: axis.min,
    max: axis.max,
  };
}

/** 兼容两种入参：完整 probe-answer/1 记录，或记录里的 answer 字段本身。 */
function extractAnswer(value) {
  if (!isPlainObject(value)) return null;
  if (isPlainObject(value.answer) && typeof value.answer.kind === 'string') return value.answer;
  if (typeof value.kind === 'string') return value;
  return null;
}

function msOf(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** 取该 dim（+context）下的 run.recorded；context 用稳定序列化比较。 */
function collectRuns(events, dim, context) {
  if (!Array.isArray(events)) return [];
  const contextKey = context === undefined ? null : canonicalContext(context);
  const runs = [];
  for (const event of events) {
    if (!isPlainObject(event) || event.t !== 'run.recorded') continue;
    if (event.dim !== dim) continue;
    if (contextKey !== null && canonicalContext(event.context) !== contextKey) continue;
    runs.push(event);
  }
  return runs;
}

/** 按记录时间升序（同时间按 round 升序、再按文件顺序），用于「最近一次 run」。 */
function sortRunsByTime(runs) {
  return runs
    .map((event, index) => ({ event, index, atMs: msOf(event.at), round: Number.isInteger(event.round) ? event.round : 0 }))
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0) || a.round - b.round || a.index - b.index)
    .map((entry) => entry.event);
}

/** 从事件取 chosenValue：优先 derived；缺失时用 variants + answer 兜底反推。 */
function chosenValueOf(event) {
  const { derived, variants, answer } = event;
  if (isPlainObject(derived) && isFiniteNumber(derived.chosenValue)) return derived.chosenValue;
  const list = Array.isArray(variants) ? variants : [];
  const valueAt = (pos) => {
    const variant = list.find((item) => isPlainObject(item) && item.pos === pos);
    return isFiniteNumber(variant?.value) ? variant.value : null;
  };
  if (isPlainObject(answer)) {
    if (answer.kind === 'absolute') {
      const value = valueAt(answer.chosenPos);
      if (value !== null) return value;
    }
    if (answer.kind === 'between' && Array.isArray(answer.betweenPos) && answer.betweenPos.length === 2) {
      const first = valueAt(answer.betweenPos[0]);
      const second = valueAt(answer.betweenPos[1]);
      if (first !== null && second !== null) return (first + second) / 2;
    }
  }
  throw new Error(`run.recorded 缺少可用的 chosenValue（runId=${JSON.stringify(event.runId)}），无法判断收敛`);
}

/** 轴跨度：优先用最近一次 run 的 axis，其次用所有变体值的极差。 */
function axisBoundsOf(runs) {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const axis = runs[index].axis;
    if (isPlainObject(axis) && isFiniteNumber(axis.min) && isFiniteNumber(axis.max) && axis.max > axis.min) {
      return { min: axis.min, max: axis.max };
    }
  }
  const values = [];
  for (const run of runs) {
    if (!Array.isArray(run.variants)) continue;
    for (const variant of run.variants) {
      if (isFiniteNumber(variant?.value)) values.push(variant.value);
    }
  }
  if (values.length >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max > min) return { min, max };
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSONL 读写
// ---------------------------------------------------------------------------

/**
 * 追加一条事件到 JSONL 台账。
 * - 目录不存在时递归创建；用 appendFileSync（flag 'a'），绝不覆盖已有内容。
 * - 事件缺 schema 时补 LEDGER_SCHEMA；缺 at 时补当前时间（唯一允许内部取时的位置）。
 * - 写前做 validateEvent 校验，非法事件不落盘（append-only 台账一旦写错无法回滚）。
 *
 * @returns {{ ok: true, line: string } | { ok: false, error: string }}
 *   line 为写入的 JSON 文本（单行、不含末尾换行）。
 */
export function appendEvent(ledgerPath, event) {
  try {
    if (!isNonEmptyString(ledgerPath)) return { ok: false, error: '台账路径不能为空' };
    if (!isPlainObject(event)) return { ok: false, error: '事件必须是对象' };

    const record = { ...event };
    if (record.schema === undefined) record.schema = LEDGER_SCHEMA;
    if (record.at === undefined || record.at === null) record.at = new Date().toISOString();

    const check = validateEvent(record);
    if (!check.ok) return { ok: false, error: `事件校验失败：${check.errors.join('；')}` };

    const line = JSON.stringify(record);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${line}\n`, { encoding: 'utf8', flag: 'a' });
    return { ok: true, line };
  } catch (error) {
    return { ok: false, error: `追加台账失败：${error?.message ?? String(error)}` };
  }
}

/**
 * 读取全部事件。
 * - 文件不存在返回 []。
 * - 跳过空行；任何一行不是合法 JSON 对象即抛错，错误里给出行号与该行前 80 字符。
 */
export function readEvents(ledgerPath) {
  if (!isNonEmptyString(ledgerPath)) throw new TypeError('台账路径不能为空');

  let content;
  try {
    content = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw new Error(`读取台账失败：${error?.message ?? String(error)}`);
  }

  const lines = content.split(/\r?\n/);
  const events = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim() === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `台账第 ${index + 1} 行不是合法 JSON：${error.message}；原始内容前 80 字符：${raw.slice(0, 80)}`,
      );
    }
    if (!isPlainObject(parsed)) {
      throw new Error(`台账第 ${index + 1} 行不是事件对象；原始内容前 80 字符：${raw.slice(0, 80)}`);
    }
    events.push(parsed);
  }
  return events;
}

// ---------------------------------------------------------------------------
// 事件校验
// ---------------------------------------------------------------------------

function validateRunRecorded(event, errors) {
  if (!isNonEmptyString(event.runId)) errors.push('run.recorded 缺少 runId（非空字符串）');
  if (!isNonEmptyString(event.dim)) errors.push('run.recorded 缺少 dim（非空字符串）');
  if (event.dimKind !== undefined && !DIM_KINDS.includes(event.dimKind)) {
    errors.push(`run.recorded 的 dimKind 非法：${JSON.stringify(event.dimKind)}（应为 continuous|discrete|none）`);
  }
  if (event.round !== undefined && (!Number.isInteger(event.round) || event.round < 1)) {
    errors.push(`run.recorded 的 round 应为正整数，收到 ${JSON.stringify(event.round)}`);
  }
  if (event.context !== undefined && !isPlainObject(event.context)) errors.push('run.recorded 的 context 应为对象');
  if (event.env !== undefined) {
    if (!isPlainObject(event.env)) errors.push('run.recorded 的 env 应为对象');
    else if (event.env.fingerprint !== undefined && typeof event.env.fingerprint !== 'string') {
      errors.push('run.recorded 的 env.fingerprint 应为字符串');
    }
  }
  if (event.axis !== undefined) {
    if (!isPlainObject(event.axis)) {
      errors.push('run.recorded 的 axis 应为对象');
    } else {
      if (!isFiniteNumber(event.axis.min)) errors.push('run.recorded 的 axis.min 应为有限数字');
      if (!isFiniteNumber(event.axis.max)) errors.push('run.recorded 的 axis.max 应为有限数字');
      if (isFiniteNumber(event.axis.min) && isFiniteNumber(event.axis.max) && event.axis.max < event.axis.min) {
        errors.push('run.recorded 的 axis.max 不能小于 axis.min');
      }
      if (event.axis.name !== undefined && typeof event.axis.name !== 'string') errors.push('run.recorded 的 axis.name 应为字符串');
      if (event.axis.unit !== undefined && typeof event.axis.unit !== 'string') errors.push('run.recorded 的 axis.unit 应为字符串');
    }
  }

  if (event.sideEffects !== undefined) {
    if (!isPlainObject(event.sideEffects)) errors.push('run.recorded 的 sideEffects 应为对象');
    else {
      if (event.sideEffects.ok !== undefined && typeof event.sideEffects.ok !== 'boolean') {
        errors.push('run.recorded 的 sideEffects.ok 应为布尔值');
      }
      if (event.sideEffects.deltas !== undefined && !isPlainObject(event.sideEffects.deltas)) {
        errors.push('run.recorded 的 sideEffects.deltas 应为对象');
      }
      if (event.sideEffects.violations !== undefined && !Array.isArray(event.sideEffects.violations)) {
        errors.push('run.recorded 的 sideEffects.violations 应为数组');
      }
    }
  }

  // variants：非空数组，pos 唯一、value 有限数字
  const positions = new Set();
  if (!Array.isArray(event.variants) || event.variants.length === 0) {
    errors.push('run.recorded 缺少 variants（非空数组）');
  } else {
    event.variants.forEach((variant, index) => {
      if (!isPlainObject(variant)) {
        errors.push(`run.recorded 的 variants[${index}] 应为对象`);
        return;
      }
      if (!Number.isInteger(variant.pos) || variant.pos < 1) {
        errors.push(`run.recorded 的 variants[${index}].pos 应为 ≥1 的整数`);
      } else if (positions.has(variant.pos)) {
        errors.push(`run.recorded 的 variants 中位置 ${variant.pos} 重复`);
      } else {
        positions.add(variant.pos);
      }
      if (!isFiniteNumber(variant.value)) errors.push(`run.recorded 的 variants[${index}].value 应为有限数字`);
    });
  }

  // answer：probe-answer/1 的 answer 字段 + 记录级统计
  const answer = event.answer;
  if (!isPlainObject(answer)) {
    errors.push('run.recorded 缺少 answer（对象）');
  } else {
    if (answer.kind === 'absolute') {
      if (!Number.isInteger(answer.chosenPos) || answer.chosenPos < 1) {
        errors.push('absolute 指认的 answer.chosenPos 应为 ≥1 的整数');
      } else if (positions.size > 0 && !positions.has(answer.chosenPos)) {
        errors.push(`absolute 指认的位置 ${answer.chosenPos} 不在 variants 中`);
      }
    } else if (answer.kind === 'between') {
      const pair = answer.betweenPos;
      if (!Array.isArray(pair) || pair.length !== 2) {
        errors.push('between 指认的 answer.betweenPos 应为两个位置');
      } else {
        const [first, second] = pair;
        if (!Number.isInteger(first) || !Number.isInteger(second) || first < 1 || second < 1) {
          errors.push('between 指认的 answer.betweenPos 应为 ≥1 的整数位置');
        } else if (first === second) {
          errors.push('between 指认的两个位置不能相同');
        } else if (first > second) {
          errors.push('between 指认的 answer.betweenPos 应按升序存储');
        } else if (positions.size > 0 && (!positions.has(first) || !positions.has(second))) {
          errors.push(`between 指认的位置 [${first}, ${second}] 不完全在 variants 中`);
        }
      }
    } else {
      errors.push(`run.recorded 的 answer.kind 非法：${JSON.stringify(answer.kind)}（应为 absolute|between）`);
    }
    if (answer.flips !== undefined && (!Number.isInteger(answer.flips) || answer.flips < 0)) {
      errors.push('run.recorded 的 answer.flips 应为非负整数');
    }
    if (answer.dwellMs !== undefined) {
      if (!isPlainObject(answer.dwellMs)) {
        errors.push('run.recorded 的 answer.dwellMs 应为对象');
      } else {
        for (const [key, value] of Object.entries(answer.dwellMs)) {
          if (!Number.isInteger(Number(key)) || Number(key) < 1) errors.push(`run.recorded 的 dwellMs 位置 ${key} 非法`);
          if (!isFiniteNumber(value) || value < 0) errors.push(`run.recorded 的 dwellMs[${key}] 应为非负数`);
        }
      }
    }
    if (answer.confidence !== undefined && answer.confidence !== null && ![1, 2, 3, 4].includes(answer.confidence)) {
      errors.push(`run.recorded 的 answer.confidence 应为 1..4 或 null，收到 ${JSON.stringify(answer.confidence)}`);
    }
    if (answer.durationMs !== undefined && (!isFiniteNumber(answer.durationMs) || answer.durationMs < 0)) {
      errors.push('run.recorded 的 answer.durationMs 应为非负数');
    }
  }

  // derived：absolute 只需 chosenValue；between 还需 betweenValues 与 interval（lo ≤ hi，mid/half 自洽）
  const derived = event.derived;
  if (!isPlainObject(derived)) {
    errors.push('run.recorded 缺少 derived（对象）');
  } else {
    if (!isFiniteNumber(derived.chosenValue)) errors.push('run.recorded 的 derived.chosenValue 应为有限数字');
    if (isPlainObject(answer) && answer.kind === 'between') {
      const betweenValues = derived.betweenValues;
      if (!Array.isArray(betweenValues) || betweenValues.length !== 2 || !betweenValues.every((value) => isFiniteNumber(value))) {
        errors.push('between 指认的 derived.betweenValues 应为两个有限数字');
      }
      const interval = derived.interval;
      if (!isPlainObject(interval)) {
        errors.push('between 指认的 derived.interval 缺失');
      } else {
        const { lo, hi, mid, half } = interval;
        if (![lo, hi, mid, half].every((value) => isFiniteNumber(value))) {
          errors.push('between 指认的 derived.interval 的 lo/hi/mid/half 应为有限数字');
        } else {
          const tolerance = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi));
          if (lo > hi) errors.push('between 指认的 derived.interval 应满足 lo ≤ hi');
          if (Math.abs(mid - (lo + hi) / 2) > tolerance) errors.push('between 指认的 derived.interval.mid 应等于 (lo+hi)/2');
          if (Math.abs(half - (hi - lo) / 2) > tolerance) errors.push('between 指认的 derived.interval.half 应等于 (hi-lo)/2');
          if (isFiniteNumber(derived.chosenValue) && Math.abs(derived.chosenValue - mid) > tolerance) {
            errors.push('between 指认的 derived.chosenValue 应等于区间中点');
          }
        }
      }
    }
  }
}

function validateAttributionRecorded(event, errors) {
  for (const field of ['assumption', 'falsifiedBy', 'boundary']) {
    if (!isNonEmptyString(event[field])) errors.push(`attribution.recorded 缺少 ${field}（非空字符串）`);
  }
  if (!['low', 'medium', 'high'].includes(event.confidence)) {
    errors.push(`attribution.recorded 的 confidence 必须是 low|medium|high，收到 ${JSON.stringify(event.confidence)}`);
  }
  if (event.note !== undefined && typeof event.note !== 'string') errors.push('attribution.recorded 的 note 应为字符串');
  if (event.runId !== undefined && typeof event.runId !== 'string') errors.push('attribution.recorded 的 runId 应为字符串');
}

function validateCredentialRevoked(event, errors) {
  if (!isNonEmptyString(event.reason)) errors.push('credential.revoked 缺少 reason（非空字符串）');
  if (event.dims !== undefined) {
    if (!Array.isArray(event.dims) || !event.dims.every((dim) => typeof dim === 'string')) {
      errors.push('credential.revoked 的 dims 应为字符串数组');
    }
  }
  if (event.runId !== undefined && typeof event.runId !== 'string') errors.push('credential.revoked 的 runId 应为字符串');
}

function validateReviewDone(event, errors) {
  if (!isIsoTimestamp(event.now)) errors.push(`review.done 的 now 必须是合法 ISO 时间，收到 ${JSON.stringify(event.now)}`);
  if (!Array.isArray(event.dims)) {
    errors.push('review.done 缺少 dims（数组）');
    return;
  }
  event.dims.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`review.done 的 dims[${index}] 应为对象`);
      return;
    }
    if (!isNonEmptyString(item.dim)) errors.push(`review.done 的 dims[${index}].dim 应为非空字符串`);
    if (!['fresh', 'due', 'expired'].includes(item.state)) {
      errors.push(`review.done 的 dims[${index}].state 应为 fresh|due|expired`);
    }
    if (item.reasons !== undefined && (!Array.isArray(item.reasons) || !item.reasons.every((reason) => typeof reason === 'string'))) {
      errors.push(`review.done 的 dims[${index}].reasons 应为字符串数组`);
    }
  });
}

function validateCalibrationApplied(event, errors) {
  if (!isNonEmptyString(event.dim)) errors.push('calibration.applied 缺少 dim（非空字符串）');
  if (!isFiniteNumber(event.value)) errors.push('calibration.applied 缺少 value（有限数字）');
  if (event.out !== undefined && typeof event.out !== 'string') errors.push('calibration.applied 的 out 应为字符串');
  if (event.runId !== undefined && typeof event.runId !== 'string') errors.push('calibration.applied 的 runId 应为字符串');
}

// ---------------------------------------------------------------------------
// 粗选（shortlist）事件校验
// ---------------------------------------------------------------------------

const SHORTLIST_ATTRIBUTIONS = Object.freeze(['capability', 'brief', 'taste', 'no-preference']);

function validateShortlistInitiated(event, errors) {
  if (!isNonEmptyString(event.runId)) errors.push('shortlist.initiated 的 runId 应为非空字符串');
  if (!isPlainObject(event.brief)) {
    errors.push('shortlist.initiated 的 brief 应为对象');
  } else {
    if (!isNonEmptyString(event.brief.title)) errors.push('brief.title 应为非空字符串');
    if (!isNonEmptyString(event.brief.prompt)) errors.push('brief.prompt 应为非空字符串');
  }
  if (!isPlainObject(event.cap)) {
    errors.push('shortlist.initiated 的 cap 应为对象');
  } else {
    for (const key of ['maxRounds', 'perRound', 'maxPending']) {
      if (!Number.isInteger(event.cap[key]) || event.cap[key] < 1) errors.push(`cap.${key} 应为正整数`);
    }
  }
}

function validateShortlistRound(event, errors) {
  if (!isNonEmptyString(event.runId)) errors.push('shortlist.round 的 runId 应为非空字符串');
  if (!Number.isInteger(event.round) || event.round < 1) errors.push('shortlist.round 的 round 应为正整数');
  if (!Array.isArray(event.candidates) || event.candidates.length < 2) {
    errors.push('shortlist.round 的 candidates 至少 2 个');
    return;
  }
  for (const [index, candidate] of event.candidates.entries()) {
    if (!isPlainObject(candidate)) {
      errors.push(`candidates[${index}] 应为对象`);
      continue;
    }
    if (!Number.isInteger(candidate.pos) || candidate.pos < 1) errors.push(`candidates[${index}].pos 应为正整数`);
    if (!isNonEmptyString(candidate.id)) errors.push(`candidates[${index}].id 应为非空字符串`);
    if (!isPlainObject(candidate.world)) errors.push(`candidates[${index}].world 应为对象`);
    if (!isNonEmptyString(candidate.htmlSha)) errors.push(`candidates[${index}].htmlSha 应为非空字符串`);
  }
  if (event.generationContext !== undefined && !isNonEmptyString(event.generationContext)) {
    errors.push('generationContext 应为非空字符串');
  }
}

function validateShortlistDecisions(event, errors) {
  if (!isNonEmptyString(event.runId)) errors.push('shortlist.decisions 的 runId 应为非空字符串');
  if (!Number.isInteger(event.round) || event.round < 1) errors.push('shortlist.decisions 的 round 应为正整数');
  if (!Array.isArray(event.decisions) || event.decisions.length < 1) {
    errors.push('shortlist.decisions 的 decisions 至少 1 条');
    return;
  }
  for (const [index, decision] of event.decisions.entries()) {
    if (!isPlainObject(decision)) {
      errors.push(`decisions[${index}] 应为对象`);
      continue;
    }
    if (!Number.isInteger(decision.pos) || decision.pos < 1) errors.push(`decisions[${index}].pos 应为正整数`);
    if (!['eliminate', 'defer'].includes(decision.action)) errors.push(`decisions[${index}].action 只能是 eliminate/defer`);
    if (decision.action === 'eliminate' && !isNonEmptyString(decision.reasonId)) {
      errors.push(`decisions[${index}] 删除时必须带 reasonId`);
    }
    if (decision.note !== undefined && typeof decision.note !== 'string') errors.push(`decisions[${index}].note 应为字符串`);
  }
  if (!Array.isArray(event.pendingAfter) || !event.pendingAfter.every((pos) => Number.isInteger(pos) && pos >= 1)) {
    errors.push('pendingAfter 应为位置编号数组');
  }
}

function validateShortlistChosen(event, errors) {
  if (!isNonEmptyString(event.runId)) errors.push('shortlist.chosen 的 runId 应为非空字符串');
  if (!['candidate', 'none'].includes(event.kind)) errors.push("shortlist.chosen 的 kind 只能是 candidate/none");
  if (event.kind === 'candidate' && (!Number.isInteger(event.pos) || event.pos < 1)) {
    errors.push('kind=candidate 时 pos 应为正整数');
  }
  if (event.kind === 'none' && (!Array.isArray(event.reasonIds) || event.reasonIds.length < 1)) {
    errors.push('kind=none 时 reasonIds 至少 1 个');
  }
  if (!Number.isInteger(event.rounds) || event.rounds < 1) errors.push('shortlist.chosen 的 rounds 应为正整数');
}

function validateCapabilityGap(event, errors) {
  if (!isNonEmptyString(event.runId)) errors.push('capability.gap 的 runId 应为非空字符串');
  if (!Number.isInteger(event.candidates) || event.candidates < 1) errors.push('capability.gap 的 candidates 应为正整数');
  if (!Number.isInteger(event.rounds) || event.rounds < 1) errors.push('capability.gap 的 rounds 应为正整数');
  if (!SHORTLIST_ATTRIBUTIONS.includes(event.attribution)) {
    errors.push(`attribution 只能是 ${SHORTLIST_ATTRIBUTIONS.join('/')}`);
  }
  if (!isNonEmptyString(event.route)) errors.push('capability.gap 的 route 应为非空字符串');
  if (!Array.isArray(event.missingCapabilities) || !event.missingCapabilities.every((item) => typeof item === 'string')) {
    errors.push('missingCapabilities 应为字符串数组');
  }
  if (event.expiresHard !== undefined && !isIsoTimestamp(event.expiresHard)) {
    errors.push('expiresHard 应为合法 ISO 时间');
  }
}

/**
 * 校验一条台账事件。
 * 所有事件都必须带 t / schema / at；按事件类型追加字段要求。
 *
 * @returns {{ ok: boolean, errors: string[] }} errors 为中文短句。
 */
export function validateEvent(event) {
  const errors = [];
  if (!isPlainObject(event)) return { ok: false, errors: ['事件必须是对象'] };

  if (event.schema !== LEDGER_SCHEMA) {
    errors.push(`schema 应为 ${LEDGER_SCHEMA}，收到 ${JSON.stringify(event.schema)}`);
  }
  if (!isIsoTimestamp(event.at)) {
    errors.push(`at 必须是合法的 ISO 时间字符串，收到 ${JSON.stringify(event.at)}`);
  }
  if (!EVENT_TYPES.includes(event.t)) {
    errors.push(`未知事件类型 t：${JSON.stringify(event.t)}（允许：${EVENT_TYPES.join('、')}）`);
    return { ok: false, errors };
  }

  switch (event.t) {
    case 'run.recorded':
      validateRunRecorded(event, errors);
      break;
    case 'attribution.recorded':
      validateAttributionRecorded(event, errors);
      break;
    case 'credential.revoked':
      validateCredentialRevoked(event, errors);
      break;
    case 'review.done':
      validateReviewDone(event, errors);
      break;
    case 'calibration.applied':
      validateCalibrationApplied(event, errors);
      break;
    case 'shortlist.initiated':
      validateShortlistInitiated(event, errors);
      break;
    case 'shortlist.round':
      validateShortlistRound(event, errors);
      break;
    case 'shortlist.decisions':
      validateShortlistDecisions(event, errors);
      break;
    case 'shortlist.chosen':
      validateShortlistChosen(event, errors);
      break;
    case 'capability.gap':
      validateCapabilityGap(event, errors);
      break;
    default:
      // EVENT_TYPES 已在上面兜住，这里只是防御性分支。
      errors.push(`未处理的事件类型：${event.t}`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 环境指纹
// ---------------------------------------------------------------------------

/**
 * 生成稳定的 12 位十六进制环境短哈希（sha256 前 12 位，非加密用途）。
 * 输入缺失/空值时用 '?' 占位，保证同输入必得同输出。
 */
export function envFingerprint({ platform, node, presenter, recorder } = {}) {
  const pick = (value) => (value === undefined || value === null || value === '' ? '?' : String(value));
  const payload = `platform=${pick(platform)}|node=${pick(node)}|presenter=${pick(presenter)}|recorder=${pick(recorder)}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// derived 值
// ---------------------------------------------------------------------------

/**
 * 由 runManifest + answer 解析出偏好值。
 * - absolute：chosenValue = 该 pos 的 variant value。
 * - between：betweenValues = 两端 value（升序）、interval = {lo, hi, mid, half}、chosenValue = mid。
 * - 位置在变体表里找不到时抛中文 RangeError。
 *
 * @returns {{ chosenValue: number, betweenValues: number[] | null, interval: { lo: number, hi: number, mid: number, half: number } | null }}
 */
export function resolveVariantValues({ runManifest, answer } = {}) {
  if (!isPlainObject(runManifest)) throw new TypeError('resolveVariantValues 需要 runManifest 对象');
  const variants = normalizeVariants(runManifest.variants);
  const byPos = new Map(variants.map((variant) => [variant.pos, variant]));

  const inner = extractAnswer(answer);
  if (inner === null) {
    throw new TypeError('resolveVariantValues 需要 answer（probe-answer/1 记录或其 answer 字段）');
  }

  const valueAt = (pos, field) => {
    if (!Number.isInteger(pos)) throw new RangeError(`${field} 必须是整数位置，收到 ${JSON.stringify(pos)}`);
    const variant = byPos.get(pos);
    if (!variant) {
      const available = variants.map((item) => item.pos).join(', ');
      throw new RangeError(`位置 ${pos} 不在本回合变体表中（可用位置：${available}）`);
    }
    return variant.value;
  };

  if (inner.kind === 'absolute') {
    const chosenValue = valueAt(inner.chosenPos, 'answer.chosenPos');
    return { chosenValue, betweenValues: null, interval: null };
  }
  if (inner.kind === 'between') {
    const pair = inner.betweenPos;
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new RangeError('between 指认的 answer.betweenPos 必须是两个位置组成的数组');
    }
    const firstValue = valueAt(pair[0], 'answer.betweenPos[0]');
    const secondValue = valueAt(pair[1], 'answer.betweenPos[1]');
    const lo = Math.min(firstValue, secondValue);
    const hi = Math.max(firstValue, secondValue);
    const mid = (lo + hi) / 2;
    return {
      chosenValue: mid,
      betweenValues: [lo, hi],
      interval: { lo, hi, mid, half: (hi - lo) / 2 },
    };
  }
  throw new TypeError(`无法识别的指认类型：${JSON.stringify(inner.kind)}（应为 absolute|between）`);
}

// ---------------------------------------------------------------------------
// 组装 run.recorded 事件
// ---------------------------------------------------------------------------

/**
 * 由 run.json（runManifest）+ answer 记录（probe-answer/1）组装 run.recorded 事件。
 * - at 优先取 answer.endedAt（锁定时刻），其次 runManifest.createdAt；都没有才取当前时间。
 * - dim 依次取 runManifest.dim / runManifest.axis.dim / runManifest.axis.name；
 *   event.axis 透传 run.json 里的 id/dim/label/kind，name 固定为机器可读的 dim 名。
 * - env.fingerprint 由四个环境字段重算（若调用方显式给了 fingerprint 则保留）。
 * - round 默认取 runManifest.round；answer 里的 kind/chosenPos/betweenPos 与
 *   flips/dwellMs/confidence/durationMs 摊平进事件 answer 字段。
 */
export function makeRunEvent({ runManifest, answer, context = {}, env = {}, round } = {}) {
  if (!isPlainObject(runManifest)) throw new TypeError('makeRunEvent 需要 runManifest 对象');
  if (!isPlainObject(answer)) throw new TypeError('makeRunEvent 需要 answer 记录（probe-answer/1）');

  const recordAnswer = extractAnswer(answer);
  if (recordAnswer === null) throw new TypeError('answer 记录缺少 answer.kind（应为 probe-answer/1）');

  const variants = normalizeVariants(runManifest.variants);
  const manifestAxis = isPlainObject(runManifest.axis) ? runManifest.axis : null;
  // 机器可读的 dim 名可能有三个来源：事件清单顶层 dim、run.json 的 axis.dim、或旧格式 axis.name。
  const dim = isNonEmptyString(runManifest.dim)
    ? runManifest.dim
    : (isNonEmptyString(manifestAxis?.dim)
      ? manifestAxis.dim
      : (isNonEmptyString(manifestAxis?.name) ? manifestAxis.name : ''));
  if (dim === '') throw new TypeError('runManifest 缺少 dim（或 axis.dim / axis.name），无法组装 run.recorded');

  const axis = normalizeRunAxis(manifestAxis, dim, variants);
  const derived = resolveVariantValues({ runManifest: { ...runManifest, variants }, answer });

  const envSource = isPlainObject(env) ? env : {};
  const envOut = {
    platform: envSource.platform === undefined || envSource.platform === null || envSource.platform === '' ? '?' : String(envSource.platform),
    node: envSource.node === undefined || envSource.node === null || envSource.node === '' ? '?' : String(envSource.node),
    presenter: envSource.presenter === undefined || envSource.presenter === null || envSource.presenter === '' ? '?' : String(envSource.presenter),
    recorder: envSource.recorder === undefined || envSource.recorder === null || envSource.recorder === '' ? '?' : String(envSource.recorder),
  };
  envOut.fingerprint = isNonEmptyString(envSource.fingerprint) ? envSource.fingerprint : envFingerprint(envSource);

  const runId = isNonEmptyString(runManifest.runId)
    ? runManifest.runId
    : (isNonEmptyString(answer.runId) ? answer.runId : '');
  if (runId === '') throw new TypeError('makeRunEvent 缺少 runId（runManifest.runId 与 answer.runId 均为空）');

  const dimKindRaw = runManifest.dimKind ?? manifestAxis?.kind;
  const dimKind = dimKindRaw === undefined || dimKindRaw === null ? 'continuous' : dimKindRaw;
  if (!DIM_KINDS.includes(dimKind)) {
    throw new TypeError(`runManifest.dimKind 非法：${JSON.stringify(dimKindRaw)}（应为 continuous|discrete|none）`);
  }

  const roundValue = Number.isInteger(round) ? round : (Number.isInteger(runManifest.round) ? runManifest.round : 1);
  const at = pickIso(answer.endedAt) ?? pickIso(runManifest.createdAt) ?? new Date().toISOString();

  const event = {
    t: 'run.recorded',
    schema: LEDGER_SCHEMA,
    at,
    runId,
    ...(isNonEmptyString(runManifest.skill) ? { skill: runManifest.skill } : {}),
    dim,
    dimKind,
    round: roundValue,
    context: isPlainObject(context) ? { ...context } : {},
    env: envOut,
    axis,
    variants,
    answer: {
      ...recordAnswer,
      flips: Number.isInteger(answer.flips) ? answer.flips : 0,
      dwellMs: isPlainObject(answer.dwellMs) ? { ...answer.dwellMs } : {},
      confidence: answer.confidence === undefined ? null : answer.confidence,
      durationMs: isFiniteNumber(answer.durationMs) ? answer.durationMs : 0,
      // 记录指认时的页面环境（视口宽度等），用于复审时判断是否可能没看全变体
      ...(isPlainObject(answer.env) ? { env: { ...answer.env } } : {}),
    },
    derived,
    // 轴副作用代理（颜色轴的色相/明度/对比度漂移检查）；旧清单没有该字段就不写。
    ...(isPlainObject(runManifest.sideEffects) ? { sideEffects: { ...runManifest.sideEffects } } : {}),
  };

  const check = validateEvent(event);
  if (!check.ok) throw new Error(`makeRunEvent 组装的事件未通过校验：${check.errors.join('；')}`);
  return event;
}

// ---------------------------------------------------------------------------
// 有效期（credentialState）
// ---------------------------------------------------------------------------

/**
 * 计算某个 dim（+context）的偏好档位状态。
 *
 * 有效期 = min(recordedAt + hardDays, 次数达到 maxRuns, 环境指纹变化)，
 * 三个条件互相独立、任一触发即 expired，不做加权求和。
 *
 * @param {object} options
 * @param {object[]} [options.events] 台账事件
 * @param {string} options.dim
 * @param {object} [options.context] 用稳定序列化比较；不传表示不按 context 过滤
 * @param {string|number|Date} [options.now] 注入时间（缺省取当前时间，仅供 CLI 便捷）
 * @param {string} [options.envFingerprint] 当前环境指纹，与最近一次记录比较
 * @returns {{ tier: string, recordedAt: string|null, validUntil: string|null, runCount: number,
 *            maxRuns: number, fingerprint: string|null, state: 'fresh'|'due'|'expired', reasons: string[] }}
 */
export function credentialState({ events = [], dim, context, now, envFingerprint: currentFingerprint = null } = {}) {
  if (!isNonEmptyString(dim)) throw new TypeError('credentialState 需要 dim（非空字符串）');
  const nowMs = toTimeMs(now);
  const { maxRuns, hardDays, tier } = PREFERENCE_TIER;

  const runs = collectRuns(events, dim, context);
  if (runs.length === 0) {
    // 台账里还没有该 dim 的运行：档位未建立，state 用 fresh 表示「未到期/未使用」。
    return {
      tier,
      recordedAt: null,
      validUntil: null,
      runCount: 0,
      maxRuns,
      fingerprint: null,
      state: 'fresh',
      reasons: ['尚无运行记录，偏好档位未建立'],
      kind: 'unverified',
      kindReason: '尚无运行记录，轴纯度与收敛都未建立',
    };
  }

  const chronological = sortRunsByTime(runs);
  const latest = chronological[chronological.length - 1];
  // 凭证三态（V0.2，先只读展示）：axis 唯一可作插值依据；exploration 只有频谱证据；unverified 没有通过代理。
  const sideEffectsOk = isPlainObject(latest.sideEffects) && latest.sideEffects.ok === true;
  let convergenceVerdict = null;
  if (runs.length >= 2) {
    try {
      convergenceVerdict = convergence({ events, dim, context }).verdict;
    } catch {
      convergenceVerdict = null;
    }
  }
  let kind;
  let kindReason;
  if (!sideEffectsOk) {
    kind = 'unverified';
    kindReason = isPlainObject(latest.sideEffects) ? '副作用代理未通过' : '没有副作用代理记录：轴纯度未验证';
  } else if (convergenceVerdict === 'evidence') {
    kind = 'axis';
    kindReason = '副作用在界内 + 收敛判为 evidence（唯一可作插值依据）';
  } else {
    kind = 'exploration';
    kindReason = '副作用在界内，但收敛尚未成立（只有频谱/探索证据，插值只作探索性默认值）';
  }
  const recordedAt = typeof latest.at === 'string' ? latest.at : null;
  const recordedMs = recordedAt === null ? nowMs : (msOf(recordedAt) ?? nowMs);
  const validUntilMs = recordedMs + hardDays * DAY_MS;
  const validUntil = new Date(validUntilMs).toISOString();
  const fingerprint = isPlainObject(latest.env) && typeof latest.env.fingerprint === 'string' ? latest.env.fingerprint : null;
  const runCount = runs.length;
  const remainingDays = (validUntilMs - nowMs) / DAY_MS;

  const expiredReasons = [];
  const dueReasons = [];

  // 维度级吊销：任一匹配该 dim（context 相同或未限定）的 credential.revoked 事件即失效。
  const revocations = (Array.isArray(events) ? events : []).filter((event) => {
    if (!isPlainObject(event) || event.t !== 'credential.revoked') return false;
    const dims = Array.isArray(event.dims) ? event.dims : isNonEmptyString(event.dim) ? [event.dim] : [];
    if (!dims.includes(dim)) return false;
    if (event.context !== undefined && context !== undefined) return canonicalContext(event.context) === canonicalContext(context);
    return true;
  });
  if (revocations.length > 0) {
    const latestRevoke = revocations
      .map((event, index) => ({ event, index, atMs: msOf(event.at) ?? 0 }))
      .sort((a, b) => a.atMs - b.atMs || a.index - b.index)
      .at(-1).event;
    expiredReasons.push(`偏好档位已被吊销${isNonEmptyString(latestRevoke.reason) ? '：' + latestRevoke.reason : ''}`);
  }

  const fingerprintChanged =
    isNonEmptyString(currentFingerprint) && fingerprint !== null && fingerprint !== currentFingerprint;
  if (fingerprintChanged) {
    expiredReasons.push(`环境指纹变化：最近一次记录为 ${fingerprint}，当前环境为 ${currentFingerprint}`);
  }
  if (nowMs > validUntilMs) {
    expiredReasons.push(`已超过 ${hardDays} 天有效期上限（到期时间 ${validUntil}）`);
  }
  if (runCount > maxRuns) {
    expiredReasons.push(`运行次数超出上限（已 ${runCount} 次，上限 ${maxRuns} 次），需重新建立档位`);
  }

  if (expiredReasons.length === 0) {
    if (remainingDays <= DUE_WINDOW_DAYS) {
      dueReasons.push(`距离到期不足 ${DUE_WINDOW_DAYS} 天（剩余 ${formatNumber(Math.max(0, remainingDays))} 天）`);
    }
    if (runCount >= maxRuns) {
      dueReasons.push(`已用满 ${maxRuns}/${maxRuns} 次运行机会，需复审后再续`);
    } else if (runCount >= maxRuns - 1) {
      dueReasons.push(`已使用 ${runCount}/${maxRuns} 次运行机会，接近上限`);
    }
  }

  let state;
  let reasons;
  if (expiredReasons.length > 0) {
    state = 'expired';
    reasons = expiredReasons;
  } else if (dueReasons.length > 0) {
    state = 'due';
    reasons = dueReasons;
  } else {
    state = 'fresh';
    reasons = [`有效期剩余 ${formatNumber(remainingDays)} 天，已使用 ${runCount}/${maxRuns} 次运行机会`];
  }

  return { tier, recordedAt, validUntil, runCount, maxRuns, fingerprint, state, reasons, kind, kindReason };
}

// ---------------------------------------------------------------------------
// 收敛判定（convergence）
// ---------------------------------------------------------------------------

/**
 * 判断同一 dim + context 的偏好是否收敛。
 *
 * 判定细则（保守优先，宁可说 insufficient 也不制造假 evidence）：
 * - 不足 2 轮 → insufficient。
 * - 恰好 2 轮：只认「两轮差 ≤ 轴跨度 5%」（视为一致）。跨中点或同侧都不再单独算证据：
 *   两轮无法确定方向，差超出容差时返回 insufficient（需要第 3 轮），不返回 evidence。
 * - 3 轮及以上：看最近两段位移（R_{n-2}→R_{n-1}、R_{n-1}→R_n）：
 *   · 两段都超出容差且方向相同 → evidence（同向）；
 *   · 两段都超出容差且方向相反 → wobble（摇摆）；
 *   · 最近一段在容差内 → evidence（停在端点），但 note 注明「停在端点」；
 *   · 其余（只有更早一段在容差内）→ insufficient。
 *
 * 注：协议只给了「同向 ≥2 轮」的原则，以上是保守的可执行细则；n=1 评审人时
 * 任何 evidence 都只是弱证据，note 里必须写明轮数。
 *
 * @returns {{ rounds: Array<{round: number, chosenValue: number, runId: string|null}>,
 *             verdict: 'evidence'|'wobble'|'insufficient', note: string }}
 */
export function convergence({ events = [], dim, context } = {}) {
  if (!isNonEmptyString(dim)) throw new TypeError('convergence 需要 dim（非空字符串）');
  const runs = collectRuns(events, dim, context);

  const ordered = runs
    .map((event, index) => ({
      event,
      index,
      round: Number.isInteger(event.round) ? event.round : index + 1,
      atMs: msOf(event.at),
    }))
    .sort((a, b) => a.round - b.round || (a.atMs ?? 0) - (b.atMs ?? 0) || a.index - b.index);

  const rounds = ordered.map(({ event, round }) => ({
    round,
    chosenValue: chosenValueOf(event),
    runId: isNonEmptyString(event.runId) ? event.runId : null,
  }));

  if (rounds.length < 2) {
    const scope = rounds.length === 0 ? '尚无运行记录' : `仅 ${rounds.length} 轮记录（R${rounds[0].round} ${formatNumber(rounds[0].chosenValue)}）`;
    return {
      rounds,
      verdict: 'insufficient',
      note: `${scope}，至少需要 2 轮才能判断收敛，当前证据不足`,
    };
  }

  const bounds = axisBoundsOf(ordered.map((entry) => entry.event));
  const span = bounds === null ? 0 : bounds.max - bounds.min;
  // 可辨识阈值优先：低于 JND 的差异视为同一档，不构成偏好移动。
  const axisJnd = ordered.map((entry) => entry.event.axis?.jnd).find((value) => isFiniteNumber(value) && value > 0) ?? 0;
  const tolerance = Math.max(span > 0 ? span * CONVERGENCE_RATIO : 0, axisJnd);
  const trendText = rounds.map((round) => `R${round.round} ${formatNumber(round.chosenValue)}`).join(' → ');
  const closeEnough = (delta) => (span > 0 ? Math.abs(delta) <= tolerance : delta === 0);
  const belowJnd = (delta) => axisJnd > 0 && Math.abs(delta) <= axisJnd;

  const previous = rounds[rounds.length - 2];
  const latest = rounds[rounds.length - 1];
  const lastDelta = latest.chosenValue - previous.chosenValue;

  if (rounds.length === 2) {
    if (closeEnough(lastDelta)) {
      const jndNote =
        belowJnd(lastDelta) && axisJnd > span * CONVERGENCE_RATIO
          ? `两轮差 ${formatNumber(Math.abs(lastDelta))} ≤ 可辨识阈值 JND（${formatNumber(axisJnd)}），视为同一档`
          : `两轮差 ${formatNumber(Math.abs(lastDelta))} ≤ 轴跨度 5%（${formatNumber(tolerance)}），视为一致`;
      return {
        rounds,
        verdict: 'evidence',
        note: `${trendText}，${jndNote}；n=2 轮，样本小，仅作弱证据`,
        ...(belowJnd(lastDelta) ? { jndBand: [Math.min(previous.chosenValue, latest.chosenValue), Math.max(previous.chosenValue, latest.chosenValue)] } : {}),
      };
    }
    return {
      rounds,
      verdict: 'insufficient',
      note: `${trendText}，两轮差 ${formatNumber(Math.abs(lastDelta))} 超出容差 ${formatNumber(tolerance)}；两轮无法确定方向，需要第 3 轮，当前不判收敛`,
    };
  }

  const deltas = rounds.slice(1).map((round, index) => round.chosenValue - rounds[index].chosenValue);
  const signOf = (value) => (closeEnough(value) ? 0 : Math.sign(value));
  const lastTwo = deltas.slice(-2).map(signOf);

  if (lastTwo[1] === 0) {
    return {
      rounds,
      verdict: 'evidence',
      note: `${trendText}，最新一轮与上一轮差 ${formatNumber(Math.abs(lastDelta))} 在容差内（停在端点）；n=${rounds.length} 轮，样本小，仅作弱证据`,
      ...(belowJnd(lastDelta) ? { jndBand: [Math.min(previous.chosenValue, latest.chosenValue), Math.max(previous.chosenValue, latest.chosenValue)] } : {}),
    };
  }
  if (lastTwo[0] !== 0 && lastTwo[0] === lastTwo[1]) {
    return {
      rounds,
      verdict: 'evidence',
      note: `${trendText}，连续两段同向（${lastTwo[1] > 0 ? '升' : '降'}），n=${rounds.length} 轮，样本小，仅作弱证据`,
    };
  }
  if (lastTwo[0] !== 0 && lastTwo[0] !== lastTwo[1]) {
    return {
      rounds,
      verdict: 'wobble',
      note: `${trendText}，最近两段方向翻转（${lastTwo[0] > 0 ? '升' : '降'} → ${lastTwo[1] > 0 ? '升' : '降'}），判断不收敛；不强行归纳，标记为不敏感或情境依赖`,
    };
  }
  return {
    rounds,
    verdict: 'insufficient',
    note: `${trendText}，只有更早一段变化，最新一段超出容差但缺少同向前置，暂不判收敛`,
  };
}

// ---------------------------------------------------------------------------
// 复审汇总（reviewState）
// ---------------------------------------------------------------------------

/**
 * 按 dim + context 分组汇总复审状态。
 * - dims 每项 = { dim, context, ...credentialState, convergence, appliedVersions }
 * - appliedVersions：同一 dim 的 calibration.applied 事件条数。calibration.applied 不覆盖，
 *   重复 apply 视为新版本追加，这里只计数供 CLI 提示「已应用 n 个版本」。
 * - warnings 固定三条协议自带的诚实警告（P8 / P5 / P1）。
 *
 * @returns {{ dims: object[], warnings: string[] }}
 */
export function reviewState({ events = [], now, envFingerprint: currentFingerprint = null } = {}) {
  const list = Array.isArray(events) ? events : [];

  const groups = new Map();
  for (const event of list) {
    if (!isPlainObject(event) || event.t !== 'run.recorded') continue;
    if (!isNonEmptyString(event.dim)) continue;
    const key = `${event.dim}\u0000${canonicalContext(event.context)}`;
    if (!groups.has(key)) groups.set(key, { dim: event.dim, context: event.context ?? null });
  }

  const appliedCounts = new Map();
  for (const event of list) {
    if (!isPlainObject(event) || event.t !== 'calibration.applied') continue;
    if (!isNonEmptyString(event.dim)) continue;
    appliedCounts.set(event.dim, (appliedCounts.get(event.dim) ?? 0) + 1);
  }

  const dims = [...groups.values()].map((group) => {
    const credential = credentialState({
      events: list,
      dim: group.dim,
      context: group.context,
      now,
      envFingerprint: currentFingerprint,
    });
    const convergenceResult = convergence({ events: list, dim: group.dim, context: group.context });
    return {
      dim: group.dim,
      context: group.context,
      ...credential,
      convergence: convergenceResult,
      appliedVersions: appliedCounts.get(group.dim) ?? 0,
    };
  });

  return { dims, warnings: [...REVIEW_WARNINGS] };
}
