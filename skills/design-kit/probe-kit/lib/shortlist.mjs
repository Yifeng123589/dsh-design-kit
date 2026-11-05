// shortlist 领域逻辑：理由 chips、候选关系校验、上限、归因、能力缺口。
// 无 DOM、无第三方依赖；CLI 与测试共用。

export const DEFAULT_CAP = Object.freeze({ maxRounds: 4, perRound: 3, maxPending: 3 });
export const WORLD_AXES = Object.freeze(['material', 'type', 'layout', 'color']);
export const RELATION_TYPES = Object.freeze(['lineage', 'contrast']);
export const CONTRAST_LEVELS = Object.freeze(['low', 'mid', 'high']);

/** 删除理由 chips：tag 决定归因分类，最多 4 类。 */
export const REASON_CHIPS = Object.freeze([
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

export const ROUTES = Object.freeze({
  capability: '换能力（弱先验）：先看 capability-gap.evidence 是否 corroborated；只有页面事实核查支持时才加载/安装缺失能力，再重跑粗选',
  brief: '回提问：补 project_type / target_audience / 约束这三类情境问题，不要换工具',
  taste: '扩大世界候选：下一轮换材料家族，候选间距要比 JND 更粗',
  'no-preference': '接受默认值：记录「无强偏好」的负结论，不要继续生成',
});

const CAPABILITY_LABELS = Object.freeze({
  'missing-asset': '真实素材（照片/插画）',
  'missing-motion': '动效与交互原型',
  'missing-data': '数据图表',
  'missing-3d': '3D / 特殊渲染',
});

/** 能力理由 → 候选 HTML 里「该能力是否真的出现」的特征；用于给 chip 归因加事实核查。 */
const CAPABILITY_REASON_FEATURES = Object.freeze({
  'missing-asset': 'image',
  'missing-motion': 'motion',
  'missing-data': 'data',
  'missing-3d': 'threeD',
});

const FEATURE_PATTERNS = Object.freeze({
  // 只认「真实素材」：位图/图版/背景图 url；单独的 <svg> 算矢量装饰，不算素材
  image: [/<img\b/i, /<picture\b/i, /<figure\b/i, /background-image\s*:\s*url\(/i, /data:image\//i],
  motion: [/@keyframes/i, /\banimation\s*:/i, /\btransition\s*:/i],
  data: [/<canvas\b/i, /<table\b/i, /\bchart\b/i, /\bgraph\b/i, /role\s*=\s*["']?(?:img|figure)/i],
  threeD: [/preserve-3d/i, /\bperspective\s*:/i, /<canvas\b/i, /webgl/i, /\bthree\./i],
});

/** 扫描一份候选 HTML，返回出现了哪些能力特征。 */
export function detectCandidateFeatures(html) {
  const text = typeof html === 'string' ? html : '';
  const features = {};
  for (const [feature, patterns] of Object.entries(FEATURE_PATTERNS)) {
    features[feature] = patterns.some((pattern) => pattern.test(text));
  }
  return features;
}

/**
 * 能力归因的事实核查：用户说「缺 X」时，候选里到底有没有 X 的痕迹。
 * 只核查**实际用到的能力理由**（reasonIds）；如果所有候选都完全没有该特征 → 支持（corroborated），
 * 否则说明「有但用户仍说缺」→ 弱化。
 *
 * @param {{htmls?: string[], reasonIds?: string[]}} options 候选 HTML 与本次归因用到的理由
 */
export function analyzeCapabilityEvidence({ htmls = [], reasonIds = null } = {}) {
  const htmlList = Array.isArray(htmls) ? htmls.filter((html) => typeof html === 'string' && html !== '') : [];
  const candidates = htmlList.length;
  const featurePresence = {};
  for (const feature of Object.keys(FEATURE_PATTERNS)) {
    const count = htmlList.filter((html) => detectCandidateFeatures(html)[feature]).length;
    featurePresence[feature] = { present: count > 0, candidateCount: count };
  }
  const requested = Array.isArray(reasonIds)
    ? [...new Set(reasonIds)].filter((reasonId) => CAPABILITY_REASON_FEATURES[reasonId] !== undefined)
    : Object.keys(CAPABILITY_REASON_FEATURES);
  const perReason = {};
  let supported = 0;
  for (const reasonId of requested) {
    const feature = CAPABILITY_REASON_FEATURES[reasonId];
    const present = featurePresence[feature]?.present === true;
    perReason[reasonId] = { feature, featurePresent: present, corroborated: candidates > 0 && !present };
    if (perReason[reasonId].corroborated) supported += 1;
  }
  const total = requested.length;
  const confidence = total === 0 ? 'not-applicable' : supported / total >= 0.75 ? 'supported' : 'weak';
  return {
    schema: 'capability-evidence/1',
    candidates,
    checkedReasons: requested,
    featurePresence,
    perReason,
    supportedReasons: supported,
    capabilityReasons: total,
    confidence,
    note:
      total === 0
        ? '本次归因没有用到能力类理由，不做页面事实核查'
        : candidates === 0
          ? '没有候选 HTML 可核查，能力归因只能按 chip 处理'
          : confidence === 'supported'
            ? '能力理由对应的特征在候选里确实完全缺失：chip 与页面事实一致'
            : '部分能力理由对应的特征在候选里出现过：chip 是自我报告，归因只作弱先验',
  };
}

export function chipById(id) {
  return REASON_CHIPS.find((chip) => chip.id === id) ?? null;
}

export function normalizeCap(input) {
  const cap = { ...DEFAULT_CAP, ...(input ?? {}) };
  for (const key of ['maxRounds', 'perRound', 'maxPending']) {
    if (!Number.isInteger(cap[key]) || cap[key] < 1) throw new RangeError(`cap.${key} 必须是正整数`);
  }
  if (cap.maxPending > cap.maxRounds * cap.perRound) throw new RangeError('cap.maxPending 不能超过总候选数');
  return cap;
}

/**
 * 校验一轮候选的「关系」：候选之间必须有可比较的关系，不能是盲目比较。
 * - lineage（同族不同派）：同一 family 下的不同 variant。
 * - contrast（对比轴三档）：同一命名轴上的 low / mid / high 各一个，且跨 ≥2 个 family。
 * 返回中文错误数组；空数组表示通过。
 */
export function validateRelation(relation, worlds) {
  const errors = [];
  if (!relation || typeof relation !== 'object') return ['缺少 relation 元信息（lineage 或 contrast）'];
  if (!RELATION_TYPES.includes(relation.relation)) return [`relation 只能是 ${RELATION_TYPES.join('/')}，收到 ${JSON.stringify(relation.relation)}`];
  if (!Array.isArray(worlds) || worlds.length < 2) return ['候选世界不足 2 个'];

  if (relation.relation === 'lineage') {
    const family = typeof relation.family === 'string' && relation.family !== '' ? relation.family : null;
    if (family === null) return ['lineage 轮必须声明同一个 family（大传统）'];
    const variants = new Set();
    for (const [index, world] of worlds.entries()) {
      if (!world || typeof world !== 'object') {
        errors.push(`worlds[${index}] 不是对象`);
        continue;
      }
      if (world.family !== family) errors.push(`worlds[${index}] 的 family（${world.family}）与声明的 ${family} 不同：同一轮必须是同族不同派`);
      if (typeof world.variant !== 'string' || world.variant === '') errors.push(`worlds[${index}].variant 必须是非空字符串`);
      else if (variants.has(world.variant)) errors.push(`variant 重复：${world.variant}（同族内的派别必须不同）`);
      else variants.add(world.variant);
    }
    if (variants.size !== worlds.length) errors.push(`应出现 ${worlds.length} 个不同 variant，实际 ${variants.size} 个`);
    return errors;
  }

  // contrast
  const axis = typeof relation.axis === 'string' && relation.axis !== '' ? relation.axis : null;
  if (axis === null) return ['contrast 轮必须声明对比轴 axis'];
  const levels = [];
  const families = new Set();
  for (const [index, world] of worlds.entries()) {
    if (!world || typeof world !== 'object') {
      errors.push(`worlds[${index}] 不是对象`);
      continue;
    }
    const level = world.contrast?.[axis];
    if (!CONTRAST_LEVELS.includes(level)) {
      errors.push(`worlds[${index}] 缺少对比轴 ${axis} 的档位（low/mid/high）`);
    } else {
      levels.push(level);
    }
    if (typeof world.family === 'string' && world.family !== '') families.add(world.family);
  }
  if (levels.length === worlds.length) {
    const sorted = levels.slice().sort();
    if (sorted.join(',') !== CONTRAST_LEVELS.slice().sort().join(',')) {
      errors.push(`对比轴 ${axis} 的档位应恰好覆盖 low/mid/high 各一次，实际：${levels.join('/')}`);
    }
  }
  if (families.size < 2) errors.push(`contrast 轮至少要跨 2 个 family（当前 ${families.size} 个）：对照要真的跨传统，不是同族换皮`);
  return errors;
}
export function axisDistance(a, b) {
  if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') {
    throw new TypeError('axisDistance 需要两个 world 对象');
  }
  let same = 0;
  for (const axis of WORLD_AXES) {
    const left = a[axis];
    const right = b[axis];
    if (typeof left !== 'string' || left === '' || typeof right !== 'string' || right === '') {
      throw new TypeError(`world.${axis} 必须是非空字符串`);
    }
    if (left === right) same += 1;
  }
  return same;
}

/** 一轮候选：两两至少 3 轴不同（axisDistance ≤ 1）。 */
/** 旧的四轴差异辅助：只用于 demo 世界卡的质量检查，不参与候选校验（候选校验走 validateRelation）。 */
export function assertRoundDiversity(worlds) {
  if (!Array.isArray(worlds) || worlds.length < 2) throw new TypeError('一轮至少 2 个世界');
  for (let i = 0; i < worlds.length; i += 1) {
    for (let j = i + 1; j < worlds.length; j += 1) {
      const same = axisDistance(worlds[i], worlds[j]);
      if (same > 1) {
        throw new Error(
          `世界 ${worlds[i].id ?? i + 1} 与 ${worlds[j].id ?? j + 1} 在 ${same} 个轴上相同，` +
            `要求两两至少 3 轴不同（四轴：${WORLD_AXES.join('/')}）`,
        );
      }
    }
  }
  return true;
}

export const EXTERNAL_PATTERNS = Object.freeze([
  /https?:\/\//i,
  /@import/i,
  /\bfetch\s*\(/i,
  /localStorage/i,
  // 协议相对外链 //cdn.example.com、file: 协议、CSS url(//…) 也要挡
  /(?:src|href)\s*=\s*["']?\s*\/\//i,
  /url\s*\(\s*["']?\s*\/\//i,
  /\bfile:/i,
]);

/** 校验候选输入：数量、id、world 四轴 + 关系（lineage/contrast）、html 基本卫生。 */
export function validateCandidates(candidates, cap, relation) {
  const errors = [];
  if (!Array.isArray(candidates)) return { ok: false, errors: ['candidates 必须是数组'] };
  if (candidates.length !== cap.perRound) errors.push(`候选数量应为 ${cap.perRound}，收到 ${candidates.length}`);
  const ids = new Set();
  for (const [index, candidate] of candidates.entries()) {
    if (candidate === null || typeof candidate !== 'object') {
      errors.push(`candidates[${index}] 必须是对象`);
      continue;
    }
    if (typeof candidate.id !== 'string' || candidate.id === '') errors.push(`candidates[${index}].id 必须是非空字符串`);
    else if (ids.has(candidate.id)) errors.push(`候选 id 重复：${candidate.id}`);
    else ids.add(candidate.id);
    if (candidate.world === null || typeof candidate.world !== 'object') {
      errors.push(`candidates[${index}].world 必须是对象`);
    } else {
      for (const axis of WORLD_AXES) {
        if (typeof candidate.world[axis] !== 'string' || candidate.world[axis] === '') {
          errors.push(`candidates[${index}].world.${axis} 必须是非空字符串`);
        }
      }
    }
    if (typeof candidate.html !== 'string' || candidate.html.length < 200) {
      errors.push(`candidates[${index}].html 必须是完整 HTML 字符串`);
      continue;
    }
    if (candidate.html.length > 200 * 1024) errors.push(`candidates[${index}].html 超过 200KB`);
    for (const pattern of EXTERNAL_PATTERNS) {
      if (pattern.test(candidate.html)) errors.push(`candidates[${index}].html 含外部依赖（${pattern}）`);
    }
  }
  if (errors.length === 0) {
    // 候选之间必须有可比较的关系（同族不同派 / 对比轴三档），不能是盲目比较
    errors.push(...validateRelation(relation, candidates.map((candidate) => candidate.world)));
    // 轴标签是调用方自报的，工具至少保证页面本体互不相同：完全相同 HTML 不能当三个候选。
    const htmlSet = new Set();
    for (const [index, candidate] of candidates.entries()) {
      if (htmlSet.has(candidate.html)) errors.push(`candidates[${index}].html 与本轮另一个候选完全相同（不能用标签差异冒充风格差异）`);
      htmlSet.add(candidate.html);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 统计删除理由（按 chip tag 汇总）。 */
export function summarizeReasons(eliminations) {
  const counts = { capability: 0, brief: 0, taste: 0, 'no-preference': 0 };
  const byChip = {};
  let total = 0;
  for (const item of eliminations ?? []) {
    const chip = chipById(item.reasonId);
    if (chip === null) continue;
    counts[chip.tag] += 1;
    byChip[item.reasonId] = (byChip[item.reasonId] ?? 0) + 1;
    total += 1;
  }
  const ratios = {};
  for (const tag of Object.keys(counts)) ratios[tag] = total === 0 ? 0 : counts[tag] / total;
  return { total, counts, ratio: ratios, byChip };
}

/** 四轴覆盖：每个轴出现过多少种不同取值。 */
export function axisCoverage(worlds) {
  const coverage = {};
  for (const axis of WORLD_AXES) {
    const values = new Set();
    for (const world of worlds ?? []) {
      if (world && typeof world[axis] === 'string') values.add(world[axis]);
    }
    coverage[axis] = values.size;
  }
  return coverage;
}

/**
 * 失败归因：capability / brief / taste / no-preference。
 * 阈值保守：capability ≥ 0.4 优先；其次 brief ≥ 0.4；再次 no-preference ≥ 0.4；否则 taste。
 */
export function attributeFailure({ eliminations, finalRejectReasonIds = [], generated, rounds }) {
  const all = [
    ...(eliminations ?? []).map((item) => ({ reasonId: item.reasonId })),
    ...finalRejectReasonIds.map((reasonId) => ({ reasonId })),
  ];
  const summary = summarizeReasons(all);
  const ratios = summary.ratio;
  let attribution = 'taste';
  if (ratios.capability >= 0.4) attribution = 'capability';
  else if (ratios.brief >= 0.4) attribution = 'brief';
  else if (ratios['no-preference'] >= 0.4) attribution = 'no-preference';

  const missingCapabilities = [];
  for (const item of all) {
    const label = CAPABILITY_LABELS[item.reasonId];
    if (label && !missingCapabilities.includes(label)) missingCapabilities.push(label);
  }

  return {
    attribution,
    route: ROUTES[attribution],
    generated: generated ?? 0,
    rounds: rounds ?? 0,
    reasons: summary,
    missingCapabilities,
    note:
      attribution === 'capability'
        ? '候选反复指向当前 skill 不具备的能力；继续生成不会解决问题。'
        : attribution === 'brief'
          ? '删除理由发散或集中在方向判断，说明需求信息不足，先补情境。'
          : attribution === 'no-preference'
            ? '评审者明确表示没有强偏好；按默认值收口，不要继续烧候选。'
            : '删除理由集中在品味判断；扩大世界候选的材料跨度，而不是换工具。',
  };
}

/** 组装可落盘的 capability-gap.json。 */
export function buildCapabilityGap({
  runId,
  brief,
  rounds,
  generated,
  eliminations,
  finalRejectReasonIds,
  evidence = null,
  now = new Date(),
}) {
  const result = attributeFailure({ eliminations, finalRejectReasonIds, generated, rounds });
  const worlds = (eliminations ?? []).map((item) => item.world).filter(Boolean);
  const expiresHard = new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString();
  const capabilityReasonIds = [
    ...(eliminations ?? []).map((item) => item.reasonId),
    ...(finalRejectReasonIds ?? []),
  ].filter((reasonId) => CAPABILITY_LABELS[reasonId] !== undefined);
  return {
    schema: 'capability-gap/1',
    runId,
    brief: brief ? { title: brief.title, prompt: brief.prompt, context: brief.context } : null,
    rounds,
    candidates: generated,
    attribution: result.attribution,
    route: result.route,
    missingCapabilities: result.missingCapabilities,
    reasonCounts: result.reasons.counts,
    reasonRatio: result.reasons.ratio,
    axisCoverage: axisCoverage(worlds),
    // 删除/否决理由 chip 是用户自我报告：只能当弱先验，不是证明。
    reasonSignal: 'self-report',
    evidenceStrength:
      evidence === null ? 'weak-prior' : evidence.confidence === 'supported' ? 'page-fact-corroborated' : 'weak-prior',
    // chip 是自我报告；evidence 是页面事实核查（候选里到底有没有对应能力特征）。
    ...(evidence === null
      ? {}
      : {
          evidence,
          attributionConfidence:
            capabilityReasonIds.length === 0
              ? 'not-applicable'
              : evidence.confidence === 'supported'
                ? 'supported'
                : 'weak',
        }),
    note: result.note,
    expiresHard,
    createdAt: now.toISOString(),
  };
}

/** 判断是否已经用满候选预算。未决策的轮次不计入「用尽」（先 decide 再判）。 */
export function capExhausted({ cap, generated, rounds, undecidedRounds = 0 }) {
  if (undecidedRounds > 0) return false;
  return rounds >= cap.maxRounds || generated >= cap.maxRounds * cap.perRound;
}
