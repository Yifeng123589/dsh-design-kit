// Phase 1 生成源：内容槽锁定、generateRound、add/verify 闸门。
// 运行：node test/generate-round.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTERNAL_PATTERNS, validateCandidates, DEFAULT_CAP } from '../skills/design-kit/probe-kit/lib/shortlist.mjs';
import {
  DEFAULT_CONTENT,
  WORLD_FAMILIES,
  WORLDS,
  WRITER_ID,
  assertRoundDiversity,
  assertWorldPoolPlan,
  buildWorldPoolPlan,
  contentFromBrief,
  generateRound,
  getWorld,
  readContentSlots,
  renderCandidate,
  skeletonHash,
} from '../skills/design-kit/probe-kit/lib/worlds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHORTLIST = join(HERE, '..', 'skills', 'design-kit', 'probe-kit', 'shortlist.mjs');
const results = [];

function check(name, fn) {
  try {
    fn();
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

check('12 个世界共用默认内容槽，HTML 互异且无外链', () => {
  const pages = ['w-swiss', 'w-newspaper', 'w-blueprint', 'w-sticky', 'w-museum', 'w-club', 'w-kids', 'w-archive', 'w-ma', 'w-brutal', 'w-photomag', 'w-dashboard']
    .map((id) => renderCandidate(getWorld(id)));
  const signature = JSON.stringify(readContentSlots(pages[0]));
  assert(pages.every((html) => JSON.stringify(readContentSlots(html)) === signature), '12 个世界的默认内容槽应相同');
  assert(new Set(pages).size === 12, '12 个世界的 HTML 应互不相同');
  for (const html of pages) {
    assert(!html.includes('{{'), '渲染后不应残留占位符');
    assert(!hasExternal(html), '渲染结果不应有外链');
  }
});

check('扩展世界库 18 个世界、6 族，池计划按 seed 抽 12 个且关系成立', () => {
  assert(WORLDS.length === 18, '应有 18 个世界，实际 ' + WORLDS.length);
  assert(WORLD_FAMILIES.length === 6, '应有 6 个 family，实际 ' + WORLD_FAMILIES.length);
  for (const family of WORLD_FAMILIES) {
    const members = WORLDS.filter((world) => world.family === family.id);
    assert(members.length === 3, `${family.id} 应有 3 个 variant，实际 ${members.length}`);
    assert(new Set(members.map((world) => world.variant)).size === 3, `${family.id} 的 variant 应互不相同`);
    assertRoundDiversity(members);
  }
  const ids = (plans) => plans.flatMap((plan) => plan.worlds.map((world) => world.id));
  const first = buildWorldPoolPlan('seed-a');
  const again = buildWorldPoolPlan('seed-a');
  const other = buildWorldPoolPlan('seed-b');
  assertWorldPoolPlan(first);
  assertWorldPoolPlan(other);
  assert(ids(first).length === 12 && new Set(ids(first)).size === 12, '池计划应恰好 12 个不同世界');
  assert(ids(first).join(',') === ids(again).join(','), '同 seed 应复现同一批');
  assert(ids(first).join(',') !== ids(other).join(','), '不同 seed 应抽到不同组合');
  for (const plan of first) {
    const payload = generateRound({ brief: { ...REAL_BRIEF, content: EXPLICIT }, relationPlan: plan });
    const validation = validateCandidates(payload.candidates, DEFAULT_CAP, {
      relation: plan.relation,
      ...(plan.family ? { family: plan.family } : {}),
      ...(plan.axis ? { axis: plan.axis } : {}),
    });
    assert(validation.ok, '池计划应能入库：' + validation.errors.join(' | '));
  }
});

check('默认渲染仍是山径书店，且两次一致、无占位符', () => {
  const world = getWorld('w-swiss');
  const html = renderCandidate(world);
  const again = renderCandidate(world);
  assert(html === again, '同一世界默认渲染应稳定');
  assert(!html.includes('{{'), '默认渲染不应残留占位符');
  assert(html.includes('山径书店'), '默认标题应仍是山径书店');
  assert(html.includes('《山中最后一季》') && html.includes('查看本周书单'), '默认书单与按钮应保留');
  const slots = readContentSlots(html);
  assert(slots !== null, '默认页应能读回内容槽');
  assert(slots.title === DEFAULT_CONTENT.title, '读回的标题应是演示文案');
  assert(slots.bullets.length === 3, '默认页应有 3 条要点');
  assert(!hasExternal(html), '默认页不应有外链');
});

check('显式内容槽替换山径书店，三世界文案相同且 HTML 不同', () => {
  const ids = ['w-swiss', 'w-newspaper', 'w-brutal'];
  const pages = ids.map((id) => renderCandidate(getWorld(id), EXPLICIT));
  const signatures = pages.map((html) => JSON.stringify(readContentSlots(html)));
  assert(signatures.every((item) => item === signatures[0]), '三页内容槽应相同');
  assert(new Set(pages).size === 3, '三页 HTML 应互不相同');
  for (const html of pages) {
    assert(!html.includes('山径书店'), '显式内容不应再出现山径书店');
    assert(html.includes('北窗茶室') && html.includes('预约座位'), '应写入显式标题和按钮');
    assert(!hasExternal(html), '显式内容页不应有外链');
    assert(!html.includes('{{'), '不应残留占位符');
  }
});

check('内容槽转义，不把尖括号写进标签', () => {
  const html = renderCandidate(getWorld('w-ma'), {
    ...EXPLICIT,
    title: 'A<B>&"C',
  });
  assert(html.includes('A&lt;B&gt;&amp;&quot;C'), '标题应被转义');
  assert(!html.includes('<B>'), '内容里的尖括号不能变成标签');
  const slots = readContentSlots(html);
  assert(slots !== null && slots.title === 'A&lt;B&gt;&amp;&quot;C', '读回应是转义后的同一份标题');
});

check('外链、占位符和条数不对的内容槽被拒绝', () => {
  let threw = false;
  try {
    contentFromBrief({ title: '茶室', prompt: '详情见 https://example.com/menu' });
  } catch (error) {
    threw = true;
    assert(/外链|外部/.test(error.message), '外链错误应说明原因：' + error.message);
  }
  assert(threw, '含外链的 brief 应在生成前拒绝');
  threw = false;
  try {
    renderCandidate(getWorld('w-swiss'), { ...EXPLICIT, title: '有{{TITLE}}' });
  } catch (error) {
    threw = true;
  }
  assert(threw, '内容槽不能再塞占位符');
  threw = false;
  try {
    renderCandidate(getWorld('w-swiss'), { ...EXPLICIT, bullets: EXPLICIT.bullets.slice(0, 2) });
  } catch (error) {
    threw = true;
  }
  assert(threw, '不是 3 条要点应拒绝');
});

check('真实 brief 的 lineage 一轮能过 validateCandidates', () => {
  const round = generateRound({ brief: REAL_BRIEF, round: 1 });
  assert(round.relation === 'lineage' && round.family === 'print-tradition', '第 1 轮应是印刷传统 lineage');
  assert(round.writer === WRITER_ID, 'writer 应为 phase1-worlds');
  assert(typeof round.contentHash === 'string' && round.contentHash.length === 16, 'contentHash 应为 16 位');
  assert(round.skeletonHash === skeletonHash(), 'skeletonHash 应与骨架一致');
  assert(round.candidates.length === 3, '应有 3 个候选');
  const validation = validateCandidates(round.candidates, DEFAULT_CAP, { relation: round.relation, family: round.family });
  assert(validation.ok, '真实 brief 一轮应能入库：' + validation.errors.join(' | '));
  const titles = round.candidates.map((candidate) => readContentSlots(candidate.html).title);
  assert(titles.every((title) => title === titles[0]), '三页标题应相同');
  assert(!titles[0].includes('山径书店') || titles[0] === '山径书店', '推导标题可以是店名本身');
  assert(titles[0].includes('山径书店'), '「山径书店官网」应推导出店名：' + titles[0]);
  for (const candidate of round.candidates) assert(!hasExternal(candidate.html), candidate.id + ' 含外链');
  const again = generateRound({ brief: REAL_BRIEF, relationPlan: { relation: 'lineage', family: 'print-tradition' } });
  assert(again.contentHash === round.contentHash, '同一 brief 的内容哈希应稳定');
  assert(again.candidates.map((item) => item.html).join() === round.candidates.map((item) => item.html).join(), '同一 brief 应渲染出同一轮 HTML');
});

check('contrast 轮同样锁定内容槽', () => {
  const round = generateRound({ brief: REAL_BRIEF, round: 3 });
  assert(round.relation === 'contrast' && round.axis === 'ornament', '第 3 轮应是装饰密度 contrast');
  const validation = validateCandidates(round.candidates, DEFAULT_CAP, { relation: 'contrast', axis: 'ornament' });
  assert(validation.ok, 'contrast 轮应能入库：' + validation.errors.join(' | '));
});

check('内容槽不一致、HTML 相同、缺骨架都不能 add', () => {
  const round = generateRound({ brief: { ...REAL_BRIEF, content: EXPLICIT }, round: 1 });
  const relation = { relation: 'lineage', family: 'print-tradition' };
  const drifted = round.candidates.map((candidate, index) => (
    index === 1
      ? { ...candidate, html: candidate.html.replace('北窗茶室', '南窗茶室') }
      : candidate
  ));
  const drift = validateCandidates(drifted, DEFAULT_CAP, relation);
  assert(!drift.ok && drift.errors.some((error) => error.includes('内容槽')), '文案漂移应拒收：' + drift.errors.join(' | '));
  const cloned = round.candidates.map((candidate, index) => (
    index === 1 ? { ...candidate, html: round.candidates[0].html } : candidate
  ));
  const same = validateCandidates(cloned, DEFAULT_CAP, relation);
  assert(!same.ok && same.errors.some((error) => error.includes('完全相同')), '相同 HTML 应拒收');
  const alien = round.candidates.map((candidate, index) => (
    index === 0
      ? { ...candidate, html: '<!doctype html><html><body>' + 'x'.repeat(220) + '</body></html>' }
      : candidate
  ));
  const missing = validateCandidates(alien, DEFAULT_CAP, relation);
  assert(!missing.ok && missing.errors.some((error) => error.includes('内容槽')), '没有骨架的 HTML 应拒收');
});

function runCli(args, cwd) {
  return spawnSync(process.execPath, [SHORTLIST, ...args], { cwd, encoding: 'utf8' });
}

check('CLI：init 内容槽校验失败时不留下空回合目录', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gen-init-fail-'));
  try {
    writeFileSync(
      join(cwd, 'bad-brief.json'),
      JSON.stringify({
        ...REAL_BRIEF,
        content: { ...EXPLICIT, cta: '这是一个明显超过十六个字符的按钮文案' },
      }),
      'utf8',
    );
    const result = runCli(
      ['init', '--brief', 'bad-brief.json', '--run-id', 'sl-bad', '--out', 'shortlist-runs'],
      cwd,
    );
    assert(result.status === 1, '非法内容槽应退出 1\n' + result.stdout + '\n' + result.stderr);
    assert(
      !existsSync(join(cwd, 'shortlist-runs', 'sl-bad')),
      'init 校验失败后不应留下空回合目录',
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

check('CLI：真实 brief → generate → add → verify，且 generate 本身不写台账', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gen-round-'));
  try {
    const briefPath = join(cwd, 'brief.json');
    writeFileSync(briefPath, JSON.stringify({ ...REAL_BRIEF, content: EXPLICIT }), 'utf8');
    const ledger = join(cwd, 'ledger.jsonl');
    const init = runCli(['init', '--brief', 'brief.json', '--run-id', 'sl-phase1', '--out', 'shortlist-runs', '--ledger', ledger], cwd);
    assert(init.status === 0, 'init 失败\n' + init.stdout + '\n' + init.stderr);
    const runDir = join(cwd, 'shortlist-runs', 'sl-phase1');
    assert(existsSync(join(runDir, 'brief.json')), 'init 应写下 brief');
    const stored = JSON.parse(readFileSync(join(runDir, 'brief.json'), 'utf8'));
    assert(stored.content.title === '北窗茶室', 'init 应保留显式内容槽');
    const ledgerBefore = readFileSync(ledger, 'utf8');
    const generated = runCli(['generate', '--writer=worlds', '--run', 'shortlist-runs/sl-phase1', '--round', '1', '--out', 'candidates/r1.json', '--ledger', ledger], cwd);
    assert(generated.status === 0, 'generate 失败\n' + generated.stdout + '\n' + generated.stderr);
    assert(readFileSync(ledger, 'utf8') === ledgerBefore, '不带 --add 的 generate 不能写台账');
    assert(!generated.stdout.includes('shortlist.decisions'), 'generate 不应写 decide');
    const rounds = JSON.parse(readFileSync(join(runDir, 'rounds.json'), 'utf8'));
    assert(rounds.rounds.length === 0, '不带 --add 时回合里还没有候选');
    const file = JSON.parse(readFileSync(join(cwd, 'candidates', 'r1.json'), 'utf8'));
    assert(file.writer === WRITER_ID && file.candidates.length === 3, '候选 JSON 应可 add');
    assert(file.candidates.every((candidate) => candidate.html.includes('北窗茶室')), '应使用 brief 里的显式内容槽');
    assert(file.candidates.every((candidate) => !candidate.html.includes('山径书店')), '显式内容不应漏出演示文案');
    const added = runCli(['add', '--run', 'shortlist-runs/sl-phase1', '--candidates', 'candidates/r1.json', '--context-token', 'fresh-a', '--ledger', ledger], cwd);
    assert(added.status === 0, 'add 失败\n' + added.stdout + '\n' + added.stderr);
    const verified = runCli(['verify', '--run', 'shortlist-runs/sl-phase1', '--ledger', ledger], cwd);
    assert(verified.status === 0, 'verify 失败\n' + verified.stdout + '\n' + verified.stderr);
    const ledgerText = readFileSync(ledger, 'utf8');
    assert(ledgerText.includes('shortlist.round'), 'add 应写下 shortlist.round');
    assert(!ledgerText.includes('shortlist.decisions'), 'writer 不能写 decide');
    const blocked = runCli(['generate', '--brief', 'brief.json', '--round', '1', '--content', 'bad-content.json', '--out', 'candidates/rejected.json'], cwd);
    assert(blocked.status !== 0, '缺文件的内容槽参数应失败');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

check('CLI：外链 brief 拒收且不写出候选文件；--add 一次过 verify', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gen-round-gate-'));
  try {
    writeFileSync(join(cwd, 'brief.json'), JSON.stringify({ title: '外链案例', prompt: '看 https://example.com 就好' }), 'utf8');
    const ledger = join(cwd, 'ledger.jsonl');
    const rejected = runCli(['generate', '--brief', 'brief.json', '--round', '1', '--out', 'candidates/r1.json', '--ledger', ledger], cwd);
    assert(rejected.status !== 0, '外链 brief 应失败');
    assert(!existsSync(join(cwd, 'candidates', 'r1.json')), '拒收时不能留下候选文件');
    assert(!existsSync(ledger), '拒收时不能写台账');
    writeFileSync(join(cwd, 'brief.json'), JSON.stringify(REAL_BRIEF), 'utf8');
    const init = runCli(['init', '--brief', 'brief.json', '--run-id', 'sl-real', '--out', 'shortlist-runs', '--ledger', ledger], cwd);
    assert(init.status === 0, 'init 失败\n' + init.stderr);
    const added = runCli(['generate', '--run', 'shortlist-runs/sl-real', '--round', '1', '--add', '--context-token', 'fresh-real', '--ledger', ledger], cwd);
    assert(added.status === 0, 'generate --add 失败\n' + added.stdout + '\n' + added.stderr);
    const verified = runCli(['verify', '--run', 'shortlist-runs/sl-real'], cwd);
    assert(verified.status === 0, 'verify 失败\n' + verified.stdout + '\n' + verified.stderr);
    const htmls = ['r1-p1.html', 'r1-p2.html', 'r1-p3.html'].map((name) => readFileSync(join(cwd, 'shortlist-runs', 'sl-real', 'candidates', name), 'utf8'));
    const signatures = htmls.map((html) => JSON.stringify(readContentSlots(html)));
    assert(signatures.every((item) => item === signatures[0]), '入库后的三页内容槽应相同');
    assert(new Set(htmls).size === 3, '入库后的三页 HTML 应不同');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

check('demo 仍能过内容槽闸门', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gen-round-demo-'));
  try {
    const ledger = join(cwd, 'ledger.jsonl');
    const demo = runCli(['demo', '--scenario', 'success', '--out', 'shortlist-runs', '--ledger', ledger], cwd);
    assert(demo.status === 0, 'demo 失败\n' + demo.stdout + '\n' + demo.stderr);
    const runs = ['sl-demo-success'];
    const verified = runCli(['verify', '--run', join('shortlist-runs', runs[0])], cwd);
    assert(verified.status === 0, 'demo verify 失败\n' + verified.stdout + '\n' + verified.stderr);
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
