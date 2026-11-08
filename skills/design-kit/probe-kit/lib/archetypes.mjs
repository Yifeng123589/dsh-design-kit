/**
 * Phase 2 骨架库：五张结构不同的完整页，套进 Phase 1 的内容槽和世界 token。
 *
 * 关系仍是 lineage / contrast。lineage 在同一 family 里取三个 variant；
 * contrast 在一条命名轴上取 low / mid / high，且跨至少两个 family。
 * 选中骨架之后才填内容槽、再换世界的颜色与字体。不写 decide，不写台账。
 *
 * 纪律只做机械拒绝（见 archetypes/DISCIPLINE.md），不做打分。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { EXTERNAL_PATTERNS, validateRelation } from './shortlist.mjs';
import {
  contentFromBrief,
  contentHash,
  getWorld,
  normalizeContent,
  readContentSlots,
  skeletonHash,
} from './worlds.mjs';

export const ARCHETYPE_WRITER_ID = 'phase2-archetype';
export const WORLDS_WRITER_ID = 'phase1-worlds';

export const ARCHETYPE_PLACEHOLDERS = Object.freeze([
  'BG',
  'SURFACE',
  'INK',
  'MUTED',
  'ACCENT',
  'ACCENT_INK',
  'RULE',
  'RADIUS',
  'FONT_HEAD',
  'FONT_BODY',
  'TITLE',
  'SUBTITLE',
  'BULLET_1',
  'BULLET_1_META',
  'BULLET_2',
  'BULLET_2_META',
  'BULLET_3',
  'BULLET_3_META',
  'CTA',
  'FOOT',
]);

const LEVELS = new Set(['low', 'mid', 'high']);
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', 'archetypes');
const poolCache = new Map();

/**
 * 4 轮计划。前两轮里第 1、4 轮是开场舞台的同族不同派；第 2、3 轮各走一条对比轴。
 * 每个格子是一张骨架加一张世界卡：结构来自骨架，颜色和字体来自世界 token。
 * 12 个世界各用一次，候选 id 因此跨轮不重复。
 */
export const ARCHETYPE_ROUNDS = Object.freeze([
  Object.freeze({
    round: 1,
    relation: 'lineage',
    family: 'stage',
    familyLabel: '开场舞台',
    picks: Object.freeze([
      Object.freeze({ archetypeId: 'hero-centered', worldId: 'w-swiss' }),
      Object.freeze({ archetypeId: 'hero-split', worldId: 'w-photomag' }),
      Object.freeze({ archetypeId: 'minimal-band', worldId: 'w-ma' }),
    ]),
  }),
  Object.freeze({
    round: 2,
    relation: 'contrast',
    axis: 'ornament',
    axisLabel: '装饰密度',
    picks: Object.freeze([
      Object.freeze({ archetypeId: 'minimal-band', worldId: 'w-archive' }),
      Object.freeze({ archetypeId: 'editorial', worldId: 'w-newspaper' }),
      Object.freeze({ archetypeId: 'brutal-cards', worldId: 'w-brutal' }),
    ]),
  }),
  Object.freeze({
    round: 3,
    relation: 'contrast',
    axis: 'image',
    axisLabel: '影像参与度',
    picks: Object.freeze([
      Object.freeze({ archetypeId: 'hero-centered', worldId: 'w-blueprint' }),
      Object.freeze({ archetypeId: 'editorial', worldId: 'w-museum' }),
      Object.freeze({ archetypeId: 'hero-split', worldId: 'w-club' }),
    ]),
  }),
  Object.freeze({
    round: 4,
    relation: 'lineage',
    family: 'stage',
    familyLabel: '开场舞台',
    picks: Object.freeze([
      Object.freeze({ archetypeId: 'hero-centered', worldId: 'w-dashboard' }),
      Object.freeze({ archetypeId: 'hero-split', worldId: 'w-kids' }),
      Object.freeze({ archetypeId: 'minimal-band', worldId: 'w-sticky' }),
    ]),
  }),
]);

function sha256Short(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function emptyPool(root, missing) {
  return {
    schema: 'archetype-index/1',
    writer: ARCHETYPE_WRITER_ID,
    root,
    missing,
    archetypes: [],
    byId: new Map(),
  };
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

/** 去掉 style 和注释之后的标签序列。颜色和文案变了，签名不变；骨架变了，签名就变。 */
export function structureSignature(html) {
  const withoutStyle = String(html).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const withoutComments = withoutStyle.replace(/<!--[\s\S]*?-->/g, '');
  const tags = withoutComments.match(/<\/?[a-zA-Z][a-zA-Z0-9:-]*/g) || [];
  return tags.map((tag) => tag.toLowerCase()).join('');
}

export function roundSkeletonHash(entries) {
  const parts = entries.map((item) => `${item.id}:${item.skeletonHash}`).sort();
  return sha256Short(parts.join('|'));
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function contentValues(content) {
  return {
    TITLE: escapeHtml(content.title),
    SUBTITLE: escapeHtml(content.subtitle),
    BULLET_1: escapeHtml(content.bullets[0].text),
    BULLET_1_META: escapeHtml(content.bullets[0].meta),
    BULLET_2: escapeHtml(content.bullets[1].text),
    BULLET_2_META: escapeHtml(content.bullets[1].meta),
    BULLET_3: escapeHtml(content.bullets[2].text),
    BULLET_3_META: escapeHtml(content.bullets[2].meta),
    CTA: escapeHtml(content.cta),
    FOOT: escapeHtml(content.foot),
  };
}

function tokenValues(world) {
  const tokens = world.tokens && typeof world.tokens === 'object' ? world.tokens : {};
  const values = {};
  for (const key of ['BG', 'SURFACE', 'INK', 'MUTED', 'ACCENT', 'ACCENT_INK', 'RULE', 'RADIUS', 'FONT_HEAD', 'FONT_BODY']) {
    if (typeof tokens[key] !== 'string' || tokens[key] === '') {
      throw new Error(`世界 ${world.id ?? '?'} 缺少 ${key}，不能套到骨架上`);
    }
    values[key] = tokens[key];
  }
  return values;
}

function readArchetype(root, meta, seenIds, seenVariants) {
  const id = requireText(meta.id, '骨架 id');
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`骨架 id 不合法：${id}`);
  if (seenIds.has(id)) throw new Error(`骨架 id 重复：${id}`);
  seenIds.add(id);
  const file = requireText(meta.file, `${id}.file`);
  if (file.includes('/') || file.includes('\\') || file.includes('..')) throw new Error(`${id} 的 file 不能是路径`);
  const family = requireText(meta.family, `${id}.family`);
  const variant = requireText(meta.variant, `${id}.variant`);
  const variantKey = `${family}/${variant}`;
  if (seenVariants.has(variantKey)) throw new Error(`family ${family} 里 variant 重复：${variant}`);
  seenVariants.add(variantKey);
  const contrast = meta.contrast;
  if (!contrast || !LEVELS.has(contrast.ornament) || !LEVELS.has(contrast.image)) {
    throw new Error(`${id}.contrast 必须给出 ornament 和 image 的 low/mid/high`);
  }
  if (!Array.isArray(meta.axisTags)) throw new Error(`${id}.axisTags 必须是数组`);
  for (const axis of ['ornament', 'image']) {
    const tag = `${axis}:${contrast[axis]}`;
    if (!meta.axisTags.includes(tag)) throw new Error(`${id}.axisTags 缺少 ${tag}`);
  }
  if (meta.license !== 'MIT') throw new Error(`${id}.license 应为 MIT`);
  requireText(meta.sourceNote, `${id}.sourceNote`);
  requireText(meta.label, `${id}.label`);
  requireText(meta.familyLabel, `${id}.familyLabel`);
  requireText(meta.layout, `${id}.layout`);
  const abs = join(root, file);
  if (!existsSync(abs)) throw new Error(`找不到骨架文件：${file}`);
  const bytes = readFileSync(abs);
  const source = bytes.toString('utf8');
  const hash = sha256Short(bytes);
  if (meta.skeletonHash !== hash) {
    throw new Error(`${id} 的 skeletonHash 应为 ${hash}，索引里是 ${meta.skeletonHash}`);
  }
  for (const pattern of EXTERNAL_PATTERNS) {
    if (pattern.test(source)) throw new Error(`${id} 含外部依赖（${pattern}）`);
  }
  for (const key of ARCHETYPE_PLACEHOLDERS) {
    if (!source.includes(`{{${key}}}`)) throw new Error(`${id} 缺少占位符 {{${key}}}`);
  }
  if (!source.includes(`data-archetype="${id}"`)) throw new Error(`${id} 的 HTML 缺少 data-archetype`);
  if (!/^<!doctype html>/i.test(source)) throw new Error(`${id} 不是完整 HTML 文档`);
  const signature = structureSignature(source);
  return {
    id,
    file,
    label: meta.label,
    family,
    familyLabel: meta.familyLabel,
    variant,
    axisTags: meta.axisTags.slice(),
    contrast: { ornament: contrast.ornament, image: contrast.image },
    layout: meta.layout,
    license: meta.license,
    sourceNote: meta.sourceNote,
    skeletonHash: hash,
    source,
    signature,
  };
}

function assertPoolPlans(byId) {
  const seenPairs = new Set();
  for (const plan of ARCHETYPE_ROUNDS) {
    const archetypes = [];
    for (const pick of plan.picks) {
      const archetype = byId.get(pick.archetypeId);
      if (!archetype) throw new Error(`第 ${plan.round} 轮引用了未知骨架 ${pick.archetypeId}`);
      getWorld(pick.worldId);
      const pair = `${pick.archetypeId}--${pick.worldId}`;
      if (seenPairs.has(pair)) throw new Error(`骨架与世界的组合重复：${pair}`);
      seenPairs.add(pair);
      archetypes.push(archetype);
    }
    const relation = {
      relation: plan.relation,
      ...(plan.family ? { family: plan.family } : {}),
      ...(plan.axis ? { axis: plan.axis } : {}),
    };
    const errors = validateRelation(relation, archetypes);
    if (errors.length > 0) throw new Error(`第 ${plan.round} 轮骨架关系不成立：${errors.join('；')}`);
    const signatures = archetypes.map((item) => item.signature);
    if (new Set(signatures).size !== signatures.length) {
      throw new Error(`第 ${plan.round} 轮的骨架结构不可区分`);
    }
  }
}

function readPool(root) {
  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) return emptyPool(root, true);
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (error) {
    throw new Error(`骨架索引不是合法 JSON：${error.message}`);
  }
  if (!index || index.schema !== 'archetype-index/1') throw new Error('骨架索引 schema 应为 archetype-index/1');
  if (index.writer !== ARCHETYPE_WRITER_ID) throw new Error(`骨架索引 writer 应为 ${ARCHETYPE_WRITER_ID}`);
  for (const name of ['discipline', 'notice']) {
    const rel = requireText(index[name], `索引 ${name}`);
    if (!existsSync(join(root, rel))) throw new Error(`骨架索引指向的 ${name} 不存在：${rel}`);
  }
  if (!Array.isArray(index.archetypes)) throw new Error('骨架索引缺少 archetypes 数组');
  if (index.archetypes.length === 0) return emptyPool(root, false);
  const seenIds = new Set();
  const seenVariants = new Set();
  const archetypes = index.archetypes.map((meta) => readArchetype(root, meta, seenIds, seenVariants));
  const byId = new Map(archetypes.map((item) => [item.id, item]));
  const probe = getWorld('w-swiss');
  const sample = normalizeContent(undefined);
  for (const archetype of archetypes) {
    const html = renderArchetype(archetype, probe, sample);
    if (structureSignature(html) !== archetype.signature) {
      throw new Error(`${archetype.id} 渲染后的结构签名和骨架文件不一致`);
    }
    const slots = readContentSlots(html);
    if (slots === null) throw new Error(`${archetype.id} 渲染后读不出内容槽`);
  }
  assertPoolPlans(byId);
  return { schema: index.schema, writer: index.writer, root, missing: false, archetypes, byId };
}

/** 读取骨架库。目录或索引不存在、或列表为空时返回空池，不抛错。索引损坏才抛错。 */
export function loadPool(root = DEFAULT_ROOT) {
  const key = resolve(root);
  if (poolCache.has(key)) return poolCache.get(key);
  const pool = readPool(key);
  poolCache.set(key, pool);
  return pool;
}

/**
 * 省略 writer 时：池里有骨架就用 archetype，否则用 worlds。
 * 显式 archetype 但池为空则抛错，不假装还能生成。
 */
export function selectWriter(requested, pool) {
  const count = Array.isArray(pool?.archetypes) ? pool.archetypes.length : 0;
  if (requested === undefined || requested === null || requested === '') {
    return count > 0 ? 'archetype' : 'worlds';
  }
  if (requested !== 'worlds' && requested !== 'archetype') {
    throw new Error('--writer 只能是 worlds 或 archetype');
  }
  if (requested === 'archetype' && count === 0) {
    throw new Error('archetype 池为空或不存在，不能使用 --writer=archetype');
  }
  return requested;
}

export function renderArchetype(archetype, world, contentInput) {
  const content = normalizeContent(contentInput);
  const values = { ...tokenValues(world), ...contentValues(content) };
  let html = archetype.source;
  for (const key of ARCHETYPE_PLACEHOLDERS) {
    const value = values[key];
    if (typeof value !== 'string' || value === '') throw new Error(`骨架 ${archetype.id} 缺少 ${key} 的取值`);
    html = html.split(`{{${key}}}`).join(value);
  }
  if (html.includes('{{')) throw new Error(`骨架 ${archetype.id} 渲染后仍有未替换的占位符`);
  return html;
}

function planIdentity(plan) {
  return plan.picks.map((pick) => `${pick.archetypeId}@${pick.worldId}`).join(',');
}

export function resolveArchetypePlan({ relationPlan, round } = {}) {
  const hasPlan = relationPlan !== undefined && relationPlan !== null;
  if (hasPlan && (typeof relationPlan !== 'object' || Array.isArray(relationPlan))) {
    throw new Error('relationPlan 必须是对象');
  }
  if (hasPlan && Array.isArray(relationPlan.worlds)) {
    throw new Error('archetype 轮次不接受自定义世界列表，请用 family 或 axis');
  }
  if (round !== undefined && round !== null) {
    if (!Number.isInteger(round) || round < 1 || round > ARCHETYPE_ROUNDS.length) {
      throw new RangeError(`round 必须是 1 到 ${ARCHETYPE_ROUNDS.length} 的整数，收到 ${String(round)}`);
    }
  }
  if (hasPlan && typeof relationPlan.relation === 'string') {
    if (!['lineage', 'contrast'].includes(relationPlan.relation)) {
      throw new Error(`relation 只能是 lineage 或 contrast，收到 ${relationPlan.relation}`);
    }
    const matches = ARCHETYPE_ROUNDS.filter((plan) => {
      if (plan.relation !== relationPlan.relation) return false;
      if (relationPlan.relation === 'lineage') return relationPlan.family && plan.family === relationPlan.family;
      return relationPlan.axis && plan.axis === relationPlan.axis;
    });
    if (matches.length === 0) {
      throw new Error(
        `骨架库没有这轮计划：${relationPlan.relation} ${relationPlan.family ?? relationPlan.axis ?? ''}。` +
          '骨架族是 stage / press；世界卡的族请加 --writer=worlds',
      );
    }
    if (round !== undefined && round !== null) {
      const found = matches.find((plan) => plan.round === round);
      if (!found) throw new Error(`round ${round} 与 relationPlan 不一致`);
      return found;
    }
    if (matches.length > 1) throw new Error('relationPlan 匹配到多轮，请带上 --round');
    return matches[0];
  }
  const index = round === undefined || round === null ? 1 : round;
  return ARCHETYPE_ROUNDS[index - 1];
}

function candidateWorld(archetype, world) {
  return {
    material: world.axes.material,
    type: world.axes.type,
    layout: archetype.layout,
    color: world.axes.color,
    family: archetype.family,
    variant: archetype.variant,
    contrast: { ...archetype.contrast },
  };
}

export function assertArchetypeCandidates(payload, pool = loadPool()) {
  if (!payload || payload.writer !== ARCHETYPE_WRITER_ID) throw new Error('不是 archetype 候选');
  if (!pool || !Array.isArray(pool.archetypes) || pool.archetypes.length === 0) {
    throw new Error('archetype 池为空，不能核对骨架');
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length !== 3) {
    throw new Error('archetype 一轮必须是 3 个候选');
  }
  const signatures = [];
  const hashEntries = [];
  const slotSignatures = [];
  for (const [index, candidate] of payload.candidates.entries()) {
    const archetype = pool.byId instanceof Map ? pool.byId.get(candidate.archetypeId) : null;
    if (!archetype) throw new Error(`candidates[${index}] 的骨架不在库里：${candidate.archetypeId}`);
    if (candidate.skeletonHash !== archetype.skeletonHash) {
      throw new Error(`candidates[${index}] 的 skeletonHash 与骨架 ${archetype.id} 不一致`);
    }
    if (typeof candidate.html !== 'string' || !candidate.html.includes(`data-archetype="${archetype.id}"`)) {
      throw new Error(`candidates[${index}] 的 HTML 缺少 data-archetype="${archetype.id}"`);
    }
    const signature = structureSignature(candidate.html);
    if (signature !== archetype.signature) {
      throw new Error(`candidates[${index}] 的 HTML 结构与骨架 ${archetype.id} 不一致`);
    }
    for (const pattern of EXTERNAL_PATTERNS) {
      if (pattern.test(candidate.html)) throw new Error(`candidates[${index}] 含外部依赖（${pattern}）`);
    }
    if (candidate.html.includes('{{')) throw new Error(`candidates[${index}] 仍有未替换的占位符`);
    const slots = readContentSlots(candidate.html);
    if (slots === null) throw new Error(`candidates[${index}] 读不出内容槽`);
    signatures.push(signature);
    slotSignatures.push(JSON.stringify(slots));
    hashEntries.push({ id: archetype.id, skeletonHash: archetype.skeletonHash });
  }
  if (new Set(signatures).size !== signatures.length) throw new Error('本轮骨架结构不可区分');
  for (let index = 1; index < slotSignatures.length; index += 1) {
    if (slotSignatures[index] !== slotSignatures[0]) throw new Error('本轮内容槽没有锁住');
  }
  if (payload.skeletonHash !== roundSkeletonHash(hashEntries)) {
    throw new Error('轮次 skeletonHash 与三个骨架不一致');
  }
  const relation = {
    relation: payload.relation,
    ...(payload.family ? { family: payload.family } : {}),
    ...(payload.axis ? { axis: payload.axis } : {}),
  };
  const errors = validateRelation(relation, payload.candidates.map((candidate) => candidate.world));
  if (errors.length > 0) throw new Error(errors.join('；'));
  return true;
}

/** add 之前的 writer 闸门。没有 writer 字段的旧候选保持原样。 */
export function assertWriterPayload(raw, pool = loadPool()) {
  if (!raw || typeof raw !== 'object') return true;
  if (raw.writer === ARCHETYPE_WRITER_ID) return assertArchetypeCandidates(raw, pool);
  if (raw.writer === WORLDS_WRITER_ID && raw.skeletonHash !== skeletonHash()) {
    throw new Error('skeletonHash 与世界卡骨架不一致');
  }
  return true;
}

/**
 * 核对已经落盘的一轮。demo 和手写候选没有 writer 时直接通过。
 * readHtml(candidate) 返回页面字符串；缺文件时返回 null，交给原来的缺失检查。
 */
export function auditStoredRound(roundEntry, readHtml) {
  const problems = [];
  if (!roundEntry || typeof roundEntry.writer !== 'string') return problems;
  const round = roundEntry.round;
  if (roundEntry.writer === WORLDS_WRITER_ID) {
    if (roundEntry.skeletonHash !== skeletonHash()) {
      problems.push(`第 ${round} 轮 HTML 骨架哈希 skeletonHash 与 base.html 不一致`);
    }
    return problems;
  }
  if (roundEntry.writer !== ARCHETYPE_WRITER_ID) return problems;
  let pool;
  try {
    pool = loadPool();
  } catch (error) {
    problems.push(`第 ${round} 轮无法核对骨架库：${error.message}`);
    return problems;
  }
  if (pool.archetypes.length === 0) {
    problems.push(`第 ${round} 轮声明了 archetype，但骨架库为空`);
    return problems;
  }
  const candidates = roundEntry.candidates ?? [];
  const signatures = [];
  const hashEntries = [];
  for (const candidate of candidates) {
    const html = readHtml(candidate);
    if (typeof html !== 'string') continue;
    const archetype = pool.byId.get(candidate.archetypeId);
    if (!archetype) {
      problems.push(`第 ${round} 轮位置 ${candidate.pos} 的 HTML 引用了未知骨架 ${String(candidate.archetypeId)}`);
      continue;
    }
    if (candidate.skeletonHash !== archetype.skeletonHash) {
      problems.push(`第 ${round} 轮位置 ${candidate.pos} 的 HTML 骨架哈希 skeletonHash 与骨架库不一致`);
    }
    if (!html.includes(`data-archetype="${archetype.id}"`)) {
      problems.push(`第 ${round} 轮位置 ${candidate.pos} 的 HTML 缺少 data-archetype`);
    }
    const signature = structureSignature(html);
    if (signature !== archetype.signature) {
      problems.push(`第 ${round} 轮位置 ${candidate.pos} 的 HTML 结构与骨架不一致`);
    } else {
      signatures.push(signature);
    }
    hashEntries.push({ id: archetype.id, skeletonHash: archetype.skeletonHash });
  }
  if (signatures.length === candidates.length && new Set(signatures).size !== signatures.length) {
    problems.push(`第 ${round} 轮 HTML 结构签名重复（不能用同一骨架冒充不同方向）`);
  }
  if (hashEntries.length === candidates.length && roundEntry.skeletonHash !== roundSkeletonHash(hashEntries)) {
    problems.push(`第 ${round} 轮 HTML 骨架哈希 skeletonHash 与三个骨架不一致`);
  }
  return problems;
}

/**
 * 按关系抽出 3 个骨架，填同一份内容槽，再套世界 token。
 * 返回值可直接交给 add。不写文件。
 */
export function generateArchetypeRound({ brief, relationPlan, round, content, pool } = {}) {
  if (!brief || typeof brief !== 'object') throw new Error('generateArchetypeRound 需要 brief 对象');
  const loaded = pool ?? loadPool();
  if (!loaded.archetypes || loaded.archetypes.length === 0) throw new Error('archetype 池为空，不能生成');
  if (typeof brief.title !== 'string' || brief.title.trim() === '') throw new Error('brief.title 必须是非空字符串');
  if (typeof brief.prompt !== 'string' || brief.prompt.trim() === '') throw new Error('brief.prompt 必须是非空字符串');
  const slots = content !== undefined && content !== null ? normalizeContent(content) : contentFromBrief(brief);
  const plan = resolveArchetypePlan({ relationPlan, round });
  const candidates = plan.picks.map((pick) => {
    const archetype = loaded.byId.get(pick.archetypeId);
    if (!archetype) throw new Error(`骨架不在库里：${pick.archetypeId}`);
    const world = getWorld(pick.worldId);
    return {
      id: `${archetype.id}--${world.id}`,
      archetypeId: archetype.id,
      skeletonHash: archetype.skeletonHash,
      world: candidateWorld(archetype, world),
      html: renderArchetype(archetype, world, slots),
    };
  });
  const payload = {
    relation: plan.relation,
    ...(plan.family ? { family: plan.family } : {}),
    ...(plan.axis ? { axis: plan.axis } : {}),
    round: plan.round,
    writer: ARCHETYPE_WRITER_ID,
    contentHash: contentHash(slots),
    skeletonHash: roundSkeletonHash(candidates.map((candidate) => ({
      id: candidate.archetypeId,
      skeletonHash: candidate.skeletonHash,
    }))),
    content: slots,
    candidates,
  };
  assertArchetypeCandidates(payload, loaded);
  return payload;
}
