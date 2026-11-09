// Phase 2 骨架库：结构可区分、contrast 跨族、内容槽锁定、worlds 回落。
// 运行：node test/archetype-round.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARCHETYPE_WRITER_ID,
  assertArchetypeCandidates,
  buildArchetypePoolPlan,
  generateArchetypeRound,
  loadPool,
  selectWriter,
  structureSignature,
} from '../skills/design-kit/probe-kit/lib/archetypes.mjs';
import { EXTERNAL_PATTERNS, validateCandidates, validateRelation, DEFAULT_CAP } from '../skills/design-kit/probe-kit/lib/shortlist.mjs';
import { WRITER_ID, readContentSlots } from '../skills/design-kit/probe-kit/lib/worlds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHORTLIST = join(HERE, '..', 'skills', 'design-kit', 'probe-kit', 'shortlist.mjs');
const ARCHETYPE_ROOT = join(HERE, '..', 'skills', 'design-kit', 'probe-kit', 'archetypes');
const results = [];

function check(name, fn) {
  try {
    const value = fn();
    if (value && typeof value.then === 'function') {
      throw new Error('测试不能是异步函数');
    }
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error && error.stack ? error.stack : String(error) });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}
function hasExternal(html) {
  return EXTERNAL_PATTERNS.some((pattern) => pattern.test(html));
}
function runCli(args, cwd) {
  return spawnSync(process.execPath, [SHORTLIST, ...args], { cwd, encoding: 'utf8' });
}

const REAL_BRIEF = {
  title: '山径书店官网',
  prompt: '做一个独立书店的品牌首页，读者是 25–35 岁城市人群。',
  context: { projectType: '品牌首页', audience: '25–35 岁城市读者', device: 'desktop' },
};
const EXPLICIT = {
  title: '北窗茶室',
  subtitle: '午后只留一张靠窗的位子。',
  bullets: [
    { text: '单品手冲', meta: '当日' },
    { text: '季节茶点', meta: '限量' },
    { text: '安静座位', meta: '预约' },
  ],
  cta: '预约座位',
  foot: '三页文案相同',
};
const EXPECTED_IDS = [
  'hero-centered',
  'hero-split',
  'editorial',
  'brutal-cards',
  'minimal-band',
  'hero-offset',
  'minimal-list',
  'editorial-index',
  'poster-stack',
];

check('九张骨架结构签名彼此不同，且无外链', () => {
  const pool = loadPool();
  assert(pool.archetypes.length === 9, '应有 9 张骨架，实际 ' + pool.archetypes.length);
  assert(EXPECTED_IDS.every((id) => pool.byId.has(id)), '九张骨架 id 应齐全');
  const signatures = pool.archetypes.map((item) => item.signature);
  assert(new Set(signatures).size === 9, '九张骨架的结构签名应彼此不同');
  for (const archetype of pool.archetypes) {
    assert(!hasExternal(archetype.source), archetype.id + ' 含外链');
    assert(archetype.license === 'MIT', archetype.id + ' 许可证应为 MIT');
    assert(archetype.sourceNote.length > 0, archetype.id + ' 应有 sourceNote');
    assert(archetype.axisTags.includes('ornament:' + archetype.contrast.ornament), archetype.id + ' 的 axisTags 与 contrast 不一致');
    assert(structureSignature(archetype.source) === archetype.signature, archetype.id + ' 签名应稳定');
  }
  const discipline = readFileSync(join(ARCHETYPE_ROOT, 'DISCIPLINE.md'), 'utf8');
  const notice = readFileSync(join(ARCHETYPE_ROOT, 'NOTICE.md'), 'utf8');
  assert(discipline.includes('反模板'), 'DISCIPLINE 应写明反模板');
  assert(!discipline.includes('github.com'), 'DISCIPLINE 不应挂外部仓库');
  assert(notice.includes('没有复制'), 'NOTICE 应说明当前骨架不是外部拷贝');
});

check('扩展骨架池按 seed 抽 4×3，关系成立且可复现', () => {
  const pool = loadPool();
  const ids = (plans) => plans.flatMap((plan) => plan.picks.map((pick) => pick.archetypeId + '@' + pick.worldId));
  const first = buildArchetypePoolPlan({ seed: 'seed-a', pool });
  const again = buildArchetypePoolPlan({ seed: 'seed-a', pool });
  const other = buildArchetypePoolPlan({ seed: 'seed-b', pool });
  assert(first.length === 4 && other.length === 4, '池计划应有 4 轮');
  const firstIds = ids(first);
  assert(new Set(firstIds).size === 12, '池计划应使用 12 个不同的骨架/世界组合');
  assert(firstIds.join(',') === ids(again).join(','), '同 seed 应复现同一批');
  assert(firstIds.join(',') !== ids(other).join(','), '不同 seed 应抽到不同组合');
  for (const plan of first) {
    const archetypes = plan.picks.map((pick) => pool.byId.get(pick.archetypeId));
    const relation = {
      relation: plan.relation,
      ...(plan.family ? { family: plan.family } : {}),
      ...(plan.axis ? { axis: plan.axis } : {}),
    };
    assert(validateRelation(relation, archetypes).length === 0, `第 ${plan.round} 轮关系不成立`);
    assert(new Set(archetypes.map((item) => item.signature)).size === 3, `第 ${plan.round} 轮结构不可区分`);
    const payload = generateArchetypeRound({ brief: { ...REAL_BRIEF, content: EXPLICIT }, plan, pool });
    const validation = validateCandidates(payload.candidates, DEFAULT_CAP, relation);
    assert(validation.ok, `第 ${plan.round} 轮应能入库：${validation.errors.join(' | ')}`);
  }
});

check('lineage 同族三派，结构不同且内容槽锁定', () => {
  const round = generateArchetypeRound({ brief: { ...REAL_BRIEF, content: EXPLICIT }, round: 1 });
  assert(round.writer === ARCHETYPE_WRITER_ID, 'writer 应为 phase2-archetype');
  assert(round.relation === 'lineage' && round.family === 'stage', '第 1 轮应是开场舞台 lineage');
  const validation = validateCandidates(round.candidates, DEFAULT_CAP, { relation: 'lineage', family: 'stage' });
  assert(validation.ok, 'lineage 应能入库：' + validation.errors.join(' | '));
  const families = new Set(round.candidates.map((item) => item.world.family));
  const variants = new Set(round.candidates.map((item) => item.world.variant));
  assert(families.size === 1 && variants.size === 3, 'lineage 应是同族三个 variant');
  const signatures = round.candidates.map((item) => structureSignature(item.html));
  assert(new Set(signatures).size === 3, '一轮三页的结构应可区分');
  const slots = round.candidates.map((item) => JSON.stringify(readContentSlots(item.html)));
  assert(slots.every((item) => item === slots[0]), '三页内容槽应相同');
  assert(round.candidates.every((item) => item.html.includes('北窗茶室') && !item.html.includes('山径书店')), '应使用显式内容槽');
  const accents = round.candidates.map((item) => item.html.match(/--accent:\s*([^;]+);/)?.[1]);
  assert(new Set(accents).size === 3, '三页应套上不同世界的强调色：' + accents.join(' / '));
  for (const candidate of round.candidates) assert(!hasExternal(candidate.html), candidate.id + ' 含外链');
});

check('contrast 覆盖三档且跨至少两个 family', () => {
  for (const roundIndex of [2, 3]) {
    const round = generateArchetypeRound({ brief: REAL_BRIEF, round: roundIndex });
    assert(round.relation === 'contrast', '第 ' + roundIndex + ' 轮应是 contrast');
    const validation = validateCandidates(round.candidates, DEFAULT_CAP, { relation: 'contrast', axis: round.axis });
    assert(validation.ok, 'contrast 应能入库：' + validation.errors.join(' | '));
    const families = new Set(round.candidates.map((item) => item.world.family));
    assert(families.size >= 2, 'contrast 应跨至少 2 个 family，实际 ' + [...families].join(','));
    const levels = round.candidates.map((item) => item.world.contrast[round.axis]).sort();
    assert(levels.join(',') === 'high,low,mid', '应覆盖 low/mid/high，实际 ' + levels.join(','));
    const signatures = round.candidates.map((item) => structureSignature(item.html));
    assert(new Set(signatures).size === 3, 'contrast 三页结构应可区分');
    const relationErrors = validateRelation({ relation: 'contrast', axis: round.axis }, round.candidates.map((item) => item.world));
    assert(relationErrors.length === 0, relationErrors.join(' | '));
  }
});

check('改 skeletonHash 或把结构换成另一张骨架会被拒绝', () => {
  const round = generateArchetypeRound({ brief: { ...REAL_BRIEF, content: EXPLICIT }, round: 2 });
  const tampered = {
    ...round,
    candidates: round.candidates.map((candidate, index) => (
      index === 0 ? { ...candidate, skeletonHash: '0000000000000000' } : candidate
    )),
  };
  let threw = false;
  try {
    validateCandidates(tampered.candidates, DEFAULT_CAP, { relation: 'contrast', axis: 'ornament' });
  } catch (error) {
    threw = true;
  }
  assert(!threw, '内容槽闸门本身不认识 skeletonHash');
  threw = false;
  try {
    assertArchetypeCandidates(tampered);
  } catch (error) {
    threw = true;
    assert(/skeletonHash/.test(error.message), error.message);
  }
  assert(threw, '伪造 skeletonHash 应被 archetype 闸门拒绝');
  const swapped = {
    ...round,
    candidates: round.candidates.map((candidate, index) => (
      index === 0 ? { ...candidate, html: round.candidates[1].html, archetypeId: round.candidates[1].archetypeId, skeletonHash: round.candidates[1].skeletonHash } : candidate
    )),
  };
  threw = false;
  try {
    assertArchetypeCandidates(swapped);
  } catch (error) {
    threw = true;
  }
  assert(threw, '两页同一结构应被拒绝');
});

check('空池回落 worlds；显式 worlds 仍是 phase1', () => {
  assert(selectWriter(undefined, { archetypes: [] }) === 'worlds', '空池默认应回落 worlds');
  assert(selectWriter(undefined, { archetypes: [{ id: 'x' }] }) === 'archetype', '有库时默认 archetype');
  assert(selectWriter('worlds', { archetypes: [{ id: 'x' }] }) === 'worlds', '显式 worlds 不被默认覆盖');
  let threw = false;
  try {
    selectWriter('archetype', { archetypes: [] });
  } catch (error) {
    threw = true;
    assert(/为空/.test(error.message), error.message);
  }
  assert(threw, '空池不能强制 archetype');
  let bad = false;
  try {
    selectWriter('figma', { archetypes: [{ id: 'x' }] });
  } catch (error) {
    bad = true;
  }
  assert(bad, '未知 writer 应拒绝');
});

check('CLI：默认 archetype 可 add+verify，且不写 decide；--writer=worlds 仍绿', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-round-'));
  try {
    const briefPath = join(cwd, 'brief.json');
    writeFileSync(briefPath, JSON.stringify({ ...REAL_BRIEF, content: EXPLICIT }), 'utf8');
    const ledger = join(cwd, 'ledger.jsonl');
    const init = runCli(['init', '--brief', 'brief.json', '--run-id', 'sl-arch', '--out', 'shortlist-runs', '--ledger', ledger], cwd);
    assert(init.status === 0, init.stderr);
    const before = readFileSync(ledger, 'utf8');
    const generated = runCli(['generate', '--run', 'shortlist-runs/sl-arch', '--round', '1', '--out', 'candidates/r1.json', '--ledger', ledger], cwd);
    assert(generated.status === 0, generated.stdout + '\n' + generated.stderr);
    assert(readFileSync(ledger, 'utf8') === before, '不带 --add 不能写台账');
    assert(!generated.stdout.includes('shortlist.decisions'), 'generate 不应写 decide');
    const file = JSON.parse(readFileSync(join(cwd, 'candidates', 'r1.json'), 'utf8'));
    assert(file.writer === ARCHETYPE_WRITER_ID, '默认 writer 应为 archetype，实际 ' + file.writer);
    const ids = file.candidates.map((item) => item.archetypeId);
    assert(new Set(ids).size === 3, '默认一轮应是三张不同骨架');
    const added = runCli(['add', '--run', 'shortlist-runs/sl-arch', '--candidates', 'candidates/r1.json', '--context-token', 'fresh-arch', '--ledger', ledger], cwd);
    assert(added.status === 0, added.stdout + '\n' + added.stderr);
    const verified = runCli(['verify', '--run', 'shortlist-runs/sl-arch'], cwd);
    assert(verified.status === 0, verified.stdout + '\n' + verified.stderr);
    const ledgerText = readFileSync(ledger, 'utf8');
    assert(ledgerText.includes('shortlist.round') && !ledgerText.includes('shortlist.decisions'), '只应由 add 写 round，不能写 decide');
    const htmls = ['r1-p1.html', 'r1-p2.html', 'r1-p3.html'].map((name) => readFileSync(join(cwd, 'shortlist-runs', 'sl-arch', 'candidates', name), 'utf8'));
    const slots = htmls.map((html) => JSON.stringify(readContentSlots(html)));
    assert(slots.every((item) => item === slots[0]), '入库后内容槽应相同');
    assert(new Set(htmls.map((html) => structureSignature(html))).size === 3, '入库后结构仍应可区分');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

check('CLI：--writer=worlds 单独回合仍是 phase1 且 verify 绿', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-worlds-'));
  try {
    writeFileSync(join(cwd, 'brief.json'), JSON.stringify(REAL_BRIEF), 'utf8');
    const ledger = join(cwd, 'ledger.jsonl');
    const init = runCli(['init', '--brief', 'brief.json', '--run-id', 'sl-worlds', '--out', 'shortlist-runs', '--ledger', ledger], cwd);
    assert(init.status === 0, init.stderr);
    const generated = runCli(['generate', '--writer=worlds', '--run', 'shortlist-runs/sl-worlds', '--round', '1', '--add', '--context-token', 'fresh-w', '--ledger', ledger], cwd);
    assert(generated.status === 0, generated.stdout + '\n' + generated.stderr);
    const verified = runCli(['verify', '--run', 'shortlist-runs/sl-worlds'], cwd);
    assert(verified.status === 0, verified.stdout + '\n' + verified.stderr);
    const rounds = JSON.parse(readFileSync(join(cwd, 'shortlist-runs', 'sl-worlds', 'rounds.json'), 'utf8'));
    assert(rounds.rounds[0].writer === WRITER_ID, 'worlds 模式 writer 应为 phase1-worlds');
    assert(rounds.rounds[0].candidates.every((item) => item.id.startsWith('w-')), '候选应是世界卡 id');
    const unknown = runCli(['generate', '--writer=nope', '--brief', 'brief.json', '--round', '1'], cwd);
    assert(unknown.status === 2, '未知 writer 应为参数错误');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log((item.ok ? '✔ ' : '✖ ') + item.name + (item.ok ? '' : '\n    ' + item.error));
}
console.log('\n通过 ' + (results.length - failed.length) + ' / 失败 ' + failed.length);
process.exit(failed.length === 0 ? 0 : 1);
