/**
 * dsh-design-kit：统一设计交付技能 + 工具插件。
 *
 * 注册三样东西：
 *   1. 技能 design-kit（统一入口：造页面 / 选方向 / 调参数 / 出 PPT 交接）
 *   2. /dkit 宿主命令（把对话转成 design-kit 流程）
 *   3. 10 个工具（design / probe / shortlist UI / deck）
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

export const COMMAND_NAMES = Object.freeze(['dkit']);

const DKIT_ACTIVATION =
  '请使用 design-kit 技能进入设计交付模式。先加载 design-kit 技能，不要立刻设计或写代码。' +
  '先问清这次要设计、修改或审查什么，目标是网页还是 PPT；' +
  '然后**直接在对话里**问一个路由问题，不要调用 `ask_user_question`：' +
  '1 直接做 / 2 先跑 3 个方向粗选 / 3 做参数精调。' +
  '选项保持中性，不要加“推荐”“Recommended”等倾向标记。' +
  '等用户回答后再按技能流程执行。';

function buildDkitRequest(rawInput) {
  const input = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (input === '') return DKIT_ACTIVATION;
  return (
    '请使用 design-kit 技能处理以下设计需求：\n\n' +
    input +
    '\n\n先加载 design-kit 技能。不要立刻设计或写代码；' +
    '先复述你理解的目标（最多两句），然后**直接在对话里**问一个路由问题，不要调用 `ask_user_question`：' +
    '1 直接做 / 2 先跑 3 个方向粗选 / 3 做参数精调。' +
    '选项保持中性，不要加“推荐”“Recommended”等倾向标记。' +
    '等用户回答后再执行。'
  );
}

function createDkitUserMessage(text) {
  const randomId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : 'dkit-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  return {
    id: randomId,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  };
}

/**
 * 可选注册 `/dkit` 宿主命令：把命令转成一条普通用户消息，让 agent 加载技能进入设计流程。
 * 没有 commands 服务的 profile（如部分 headless 环境）不会因此启动失败。
 */
function registerDkitCommand(ctx, disposers, warn) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['commands'], (commandCtx) => {
    try {
      const dispose = commandCtx.commands.register({
        name: 'dkit',
        description: '启动 design-kit 设计流程',
        input: { hint: '[设计需求，可留空]' },
        handler: ({ agent, rawInput }) => {
          if (!agent || typeof agent.steer !== 'function') {
            return { kind: 'error', text: '当前会话不支持命令转发，请直接说“用 design-kit 做……”。' };
          }
          const request = buildDkitRequest(rawInput);
          try {
            agent.steer(createDkitUserMessage(request));
          } catch (error) {
            return {
              kind: 'error',
              text: 'design-kit 启动失败：' + (error instanceof Error ? error.message : String(error)),
            };
          }
          return {
            kind: 'success',
            text: typeof rawInput === 'string' && rawInput.trim() !== ''
              ? 'design-kit 已启动，正在按你的需求进入设计流程。'
              : 'design-kit 已启动。告诉我要设计、修改或审查什么。',
          };
        },
      });
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      warn('[dsh-design-kit] /dkit 命令注册失败：' + describeError(error));
    }
  });
}

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

  registerDkitCommand(ctx, disposers, warn);

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
