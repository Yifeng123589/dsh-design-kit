// 粗选流水线：≤12 的池、3 张滑动窗、sidecar 喜欢/特征/短名单、终选轻闸门。
// 不写 decide、不写台账、不改候选 HTML。writer 仍只产候选。

export const LIKES_SCHEMA = 'shortlist-likes/1';
export const POOL_SCHEMA = 'shortlist-pool/1';
export const WINDOW_SIZE = 3;
export const POOL_CAP = 12;
export const SHORTLIST_MAX = 3;

export const TRAIT_KINDS = Object.freeze([
  Object.freeze({ id: 'typography', label: '字体' }),
  Object.freeze({ id: 'palette', label: '配色' }),
  Object.freeze({ id: 'layout', label: '版式' }),
  Object.freeze({ id: 'graphic', label: '图形' }),
]);

function candidateIdOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.candidateId === 'string') return value.candidateId;
  return '';
}

/** 还没看过的候选里取前 size 张。删/路过把 id 放进 seen 后，第三张就是池里的下一张。 */
export function slidingWindow(pool, seenIds, size = WINDOW_SIZE) {
  const seen = new Set(Array.isArray(seenIds) ? seenIds : []);
  const rest = (Array.isArray(pool) ? pool : []).filter((item) => item && typeof item.id === 'string' && !seen.has(item.id));
  const width = Number.isInteger(size) && size > 0 ? size : WINDOW_SIZE;
  return rest.slice(0, width);
}

/** 给 preview / generate 看的特征袋摘要。不包含删除 note，也不改写成 token。 */
export function traitSummary(record) {
  if (!record || record.schema !== LIKES_SCHEMA || !Array.isArray(record.traits)) return [];
  const summary = [];
  for (const trait of record.traits) {
    if (!trait || typeof trait !== 'object') continue;
    if (typeof trait.candidateId !== 'string' || trait.candidateId === '') continue;
    if (typeof trait.kind !== 'string' || trait.kind === '') continue;
    if (typeof trait.text !== 'string') continue;
    const text = trait.text.trim().slice(0, 200);
    if (text === '') continue;
    summary.push({ candidateId: trait.candidateId, kind: trait.kind, text });
  }
  return summary;
}

/**
 * 终选轻闸门：短名单 ≥ 1，或（声明底稿且特征袋 ≥ 1）。
 * 特征袋空且没有短名单时拒绝。
 */
export function finalGate({ shortlistCount = 0, traitCount = 0, draft = '' } = {}) {
  const kept = Number.isInteger(shortlistCount) ? shortlistCount : 0;
  const traits = Number.isInteger(traitCount) ? traitCount : 0;
  const declared = typeof draft === 'string' && draft.trim() !== '';
  if (kept >= 1) return { ok: true, via: 'shortlist' };
  if (traits < 1) return { ok: false, error: '特征袋空且无短名单，不能终选' };
  if (!declared) return { ok: false, error: '没有整页短名单时，需要声明底稿并且特征袋至少 1 条' };
  return { ok: true, via: 'draft' };
}

function takeIds(list, label, allowed, errors) {
  if (!Array.isArray(list)) {
    errors.push(`${label} 必须是数组`);
    return [];
  }
  const out = [];
  const used = new Set();
  for (const item of list) {
    const id = candidateIdOf(item);
    if (!allowed.has(id)) {
      errors.push(`${label} 含池外候选：${JSON.stringify(id)}`);
      continue;
    }
    if (used.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 规范化 sidecar。短名单最多 3 张整页；看过不超过 12；不要求每轮有 defer。
 * 已删除的候选仍可以出现在 traits 里。
 */
export function normalizeLikesRecord(input, { runId, poolIds, reasonIds, poolById = null } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    throw new Error('likes 记录必须是对象');
  }
  if (input.schema !== LIKES_SCHEMA) errors.push(`schema 应为 ${LIKES_SCHEMA}，收到 ${JSON.stringify(input.schema)}`);
  if (input.runId !== runId) errors.push(`runId 不匹配：${JSON.stringify(input.runId)}`);
  const allowed = new Set(Array.isArray(poolIds) ? poolIds : []);
  const reasons = new Set(Array.isArray(reasonIds) ? reasonIds : []);
  const kindIds = new Set(TRAIT_KINDS.map((item) => item.id));

  const seen = takeIds(input.seen ?? [], 'seen', allowed, errors);
  if (seen.length > POOL_CAP) errors.push(`看过的候选不能超过 ${POOL_CAP}`);
  const shortlistIds = takeIds(input.shortlist ?? [], 'shortlist', allowed, errors);
  if (shortlistIds.length > SHORTLIST_MAX) errors.push(`短名单最多 ${SHORTLIST_MAX} 张整页`);
  const likeIds = takeIds(input.likes ?? [], 'likes', allowed, errors);
  const passed = takeIds(input.passed ?? [], 'passed', allowed, errors);

  const eliminated = [];
  if (!Array.isArray(input.eliminated ?? [])) errors.push('eliminated 必须是数组');
  else {
    const used = new Set();
    for (const item of input.eliminated ?? []) {
      const id = candidateIdOf(item);
      if (!allowed.has(id)) {
        errors.push(`eliminated 含池外候选：${JSON.stringify(id)}`);
        continue;
      }
      if (used.has(id)) continue;
      used.add(id);
      const reasonId = item && typeof item === 'object' ? item.reasonId : undefined;
      if (typeof reasonId !== 'string' || !reasons.has(reasonId)) {
        errors.push(`删除必须带合法理由：${JSON.stringify(id)}`);
      }
      const note = item && typeof item.note === 'string' ? item.note.trim().slice(0, 200) : '';
      eliminated.push({
        candidateId: id,
        reasonId: typeof reasonId === 'string' ? reasonId : '',
        ...(note ? { note } : {}),
      });
    }
  }

  const traits = [];
  if (!Array.isArray(input.traits ?? [])) errors.push('traits 必须是数组');
  else {
    for (const trait of input.traits) {
      const id = candidateIdOf(trait);
      if (!allowed.has(id)) {
        errors.push(`特征引用了池外候选：${JSON.stringify(id)}`);
        continue;
      }
      if (!trait || !kindIds.has(trait.kind)) {
        errors.push('特征类型只能是 typography/palette/layout/graphic');
        continue;
      }
      const text = typeof trait.text === 'string' ? trait.text.trim().slice(0, 200) : '';
      if (text === '') {
        errors.push('特征需要一句说明');
        continue;
      }
      traits.push({ candidateId: id, kind: trait.kind, text });
    }
  }

  const draft = typeof input.draft === 'string' ? input.draft.trim().slice(0, 200) : '';
  const seenSet = new Set(seen);
  for (const id of shortlistIds) {
    if (!seenSet.has(id)) errors.push(`短名单候选必须先看过：${id}`);
  }
  for (const item of eliminated) {
    if (!seenSet.has(item.candidateId)) errors.push(`已删候选必须记入看过：${item.candidateId}`);
  }
  for (const id of passed) {
    if (!seenSet.has(id)) errors.push(`路过的候选必须记入看过：${id}`);
  }
  const eliminatedSet = new Set(eliminated.map((item) => item.candidateId));
  const passSet = new Set(passed);
  for (const id of shortlistIds) {
    if (eliminatedSet.has(id)) errors.push(`同一张不能既收藏整页又删除：${id}`);
    if (passSet.has(id)) errors.push(`同一张不能既收藏整页又路过：${id}`);
  }
  for (const id of passed) {
    if (eliminatedSet.has(id)) errors.push(`同一张不能既删除又路过：${id}`);
  }
  if (errors.length > 0) throw new Error(errors.join('；'));

  const lookup = poolById instanceof Map ? poolById : new Map();
  return {
    schema: LIKES_SCHEMA,
    runId,
    likes: likeIds.map((candidateId) => ({ candidateId })),
    traits,
    shortlist: shortlistIds.map((candidateId) => {
      const source = lookup.get(candidateId);
      return {
        candidateId,
        htmlPath: source && typeof source.htmlPath === 'string' ? source.htmlPath : '',
        poolIndex: source && Number.isInteger(source.poolIndex) ? source.poolIndex : null,
      };
    }),
    draft: draft === '' ? null : draft,
    seen,
    eliminated,
    passed,
  };
}
