/**
 * dsh-design-kit：统一设计交付技能 + 工具插件。
 *
 * 注册两样东西：
 *   1. 技能 design-kit（统一入口：造页面 / 选方向 / 调参数 / 出 PPT 交接）
 *   2. 10 个工具（design / probe / shortlist UI / deck）
 *
 * A6：注册结果汇总为 health（技能、工具成功数、缺失项），写日志并挂在 ctx 上。
 * B6：核心工具（lint / shortlist / measure / preview / action）注册失败 = fatal（抛错）；
 *     deck 等可选能力失败 = degraded（继续加载，明确降级提示）。
 * @module dsh-design-kit
 */

import { registerDesignKitSkill } from './skill.js';
import { buildDesignKitTools, TOOL_NAMES } from './tools.js';

export const inject = ['tools', 'skills', 'workingDirectory'];
export const name = 'dsh-design-kit';

/** B6：核心能力，缺一个就不应声称插件可用。 */
export const CORE_TOOL_NAMES = Object.freeze([
  'design_lint',
  'probe_shortlist',
  'probe_shortlist_preview',
  'probe_shortlist_ui_action',
  'probe_measure',
]);

/** B6：可选能力，失败降级提示，不拖垮整个插件。 */
export const OPTIONAL_TOOL_NAMES = Object.freeze(
  TOOL_NAMES.filter((toolName) => !CORE_TOOL_NAMES.includes(toolName)),
);

let lastRegistrationHealth = null;

/** 查询最近一次 apply 的注册健康状态（同 ctx.designKitHealth）。 */
export function getRegistrationHealth() {
  return lastRegistrationHealth;
}

/** 测试用：清空最近一次 health。 */
export function resetRegistrationHealth() {
  lastRegistrationHealth = null;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function apply(ctx, config = {}) {
  const warnings = [];
  const warn = (message) => {
    warnings.push(message);
    ctx.logger?.warn?.(message);
  };
  const disposers = [];
  const registeredTools = [];
  const failedTools = [];
  let skillRegistered = false;

  try {
    disposers.push(registerDesignKitSkill(ctx));
    skillRegistered = true;
  } catch (error) {
    warn('[dsh-design-kit] 技能加载失败：' + describeError(error));
  }

  let definitions = [];
  try {
    definitions = buildDesignKitTools(config, ctx);
  } catch (error) {
    warn('[dsh-design-kit] 工具清单构建失败：' + describeError(error));
  }

  for (const definition of definitions) {
    try {
      disposers.push(ctx.tools.register(definition));
      registeredTools.push(definition.name);
    } catch (error) {
      failedTools.push({ name: definition.name, error: describeError(error) });
      warn('[dsh-design-kit] 工具 ' + definition.name + ' 注册失败：' + describeError(error));
    }
  }

  const expectedTools = Array.isArray(definitions) && definitions.length > 0 ? definitions.length : TOOL_NAMES.length;
  const missing = [
    ...failedTools.map((item) => item.name),
    ...TOOL_NAMES.filter((toolName) => !definitions.some((definition) => definition.name === toolName)),
  ];
  const uniqueMissing = [...new Set(missing)];
  const missingCore = uniqueMissing.filter((toolName) => CORE_TOOL_NAMES.includes(toolName));
  const missingOptional = uniqueMissing.filter((toolName) => OPTIONAL_TOOL_NAMES.includes(toolName));
  const level = !skillRegistered || missingCore.length > 0 ? 'fatal' : uniqueMissing.length > 0 ? 'degraded' : 'healthy';
  const health = {
    schema: 'design-kit-health/1',
    ok: level === 'healthy',
    level,
    skill: { expected: 1, registered: skillRegistered ? 1 : 0 },
    tools: {
      expected: expectedTools,
      registered: registeredTools.length,
      missing: uniqueMissing,
      missingCore,
      missingOptional,
    },
    warnings: [...warnings],
  };
  lastRegistrationHealth = health;
  try {
    ctx.designKitHealth = health;
  } catch {
    // ctx 可能是只读对象；health 仍可通过 getRegistrationHealth() 查询
  }

  const summary =
    '[dsh-design-kit] 注册完成：技能 ' +
    health.skill.registered +
    '/' +
    health.skill.expected +
    '，工具 ' +
    health.tools.registered +
    '/' +
    health.tools.expected +
    (uniqueMissing.length > 0 ? '；缺失：' + uniqueMissing.join(', ') : '');
  if (level === 'healthy') {
    ctx.logger?.info?.(summary);
  } else if (level === 'degraded') {
    warn(summary + '；可选能力降级，核心工具仍可用。');
  } else {
    const fatalMessage =
      summary +
      '；核心注册失败：' +
      [...(!skillRegistered ? ['design-kit 技能'] : []), ...missingCore].join(', ') +
      '。这是硬失败，不降级。';
    const errorLog = ctx.logger?.error ?? ctx.logger?.warn;
    errorLog?.call(ctx.logger, fatalMessage);
  }

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          // 忽略卸载期错误，避免阻塞宿主退出
        }
      }
    });
  }

  if (level === 'fatal') {
    throw new Error(
      '[dsh-design-kit] 核心注册失败：' + [...(!skillRegistered ? ['design-kit 技能'] : []), ...missingCore].join(', '),
    );
  }
}

export { parseSkillFile, bundledSkillsDir, registerDesignKitSkill, SKILL_NAMES } from './skill.js';
export {
  buildDesignKitTools,
  TOOL_NAMES,
  hasInlineOption,
  buildProbeMeasureArgv,
  resolveTimeoutSettings,
} from './tools.js';
export { buildDeckTools, DECK_TOOL_NAMES, resolvePptMasterDir, pythonCandidates, resolveRenderer, isPptMasterDir, summarizeCheckerReport } from './deck.js';
