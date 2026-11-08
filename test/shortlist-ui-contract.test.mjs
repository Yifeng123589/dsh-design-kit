// A8：UI ↔ CLI 契约测试。锁 preview payload → persistAction → 决策/终选 JSONL 的字段，
// 并和 probe-kit CLI 的 schema/reason chip 对齐。
// 运行：node test/shortlist-ui-contract.test.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPreview, persistAction, SHORTLIST_UI_REASON_CHIPS } from '../lib/shortlist-ui.js';
import { REASON_CHIPS } from '../skills/design-kit/probe-kit/lib/shortlist.mjs';
import { finalGate, normalizeLikesRecord, slidingWindow } from '../skills/design-kit/probe-kit/lib/pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error && error.message ? error.message : String(error) });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function makeRun({ final = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'signal-contract-'));
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  for (const pos of [1, 2, 3]) {
    writeFileSync(
      join(dir, 'candidates', 'p' + pos + '.html'),
      '<!doctype html><html><body><h1>候选 ' + pos + '</h1></body></html>',
      'utf8',
    );
  }
  const candidates = [1, 2, 3].map((pos) => ({
    id: 'candidate-' + pos,
    pos,
    world: { variant: 'v' + pos },
    htmlPath: 'candidates/p' + pos + '.html',
  }));
  writeFileSync(join(dir, 'brief.json'), JSON.stringify({ title: 'contract', prompt: 'contract', runId: 'contract-run', cap: 12 }), 'utf8');
  writeFileSync(
    join(dir, 'rounds.json'),
    JSON.stringify({ schema: 'shortlist-rounds/1', runId: 'contract-run', rounds: [{ round: 1, relation: { relation: 'lineage', family: 'print-tradition' }, candidates }] }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      schema: 'shortlist-state/1',
      runId: 'contract-run',
      pending: final ? candidates.map((c, index) => ({ id: c.id, fromRound: 1, pos: index + 1, htmlPath: c.htmlPath })) : [],
      eliminated: [],
      decisionsByRound: {},
      nextRound: final ? 2 : 1,
      generationContexts: ['fresh-1'],
      finished: false,
      outcome: null,
    }),
    'utf8',
  );
  return { dir, candidates };
}

function tempFileFromCli(cli, flag) {
  const index = cli.indexOf(flag);
  assert(index >= 0 && typeof cli[index + 1] === 'string', 'CLI 缺少 ' + flag);
  return cli[index + 1];
}

check('reason chips 与 probe-kit CLI 完全同源', () => {
  const ui = SHORTLIST_UI_REASON_CHIPS.map((chip) => chip.id).sort();
  const cli = REASON_CHIPS.map((chip) => chip.id).sort();
  assert(JSON.stringify(ui) === JSON.stringify(cli), 'UI chips 与 CLI REASON_CHIPS 不一致：\n  UI=' + ui.join(',') + '\n  CLI=' + cli.join(','));
});

check('decide：preview payload → persistAction 生成 CLI 可读的 shortlist-decisions/1', () => {
  const { dir } = makeRun();
  try {
    const preview = buildPreview({ run: dir }, dir);
    assert(preview.ok === true, 'preview 失败：' + preview.error);
    assert(Array.isArray(preview.likedTraits) && preview.likedTraits.length === 0, '没有 sidecar 时 likedTraits 应是空数组');
    const payload = {
      schema: 'shortlist-ui-action/1',
      kind: 'decide',
      run: dir,
      round: preview.round,
      uiToken: preview.uiToken,
      decisions: [
        { pos: 1, action: 'eliminate', reasonId: SHORTLIST_UI_REASON_CHIPS[2].id, note: '  首屏太满，信息层级不清  ' },
        { pos: 2, action: 'defer' },
        { pos: 3, action: 'eliminate', reasonId: SHORTLIST_UI_REASON_CHIPS[0].id },
      ],
    };
    const prepared = persistAction(payload, dir, 5000);
    assert(prepared.cli[0] === 'decide', 'CLI 子命令应为 decide');
    const decisionsPath = tempFileFromCli(prepared.cli, '--decisions');
    const record = JSON.parse(readFileSync(decisionsPath, 'utf8'));
    assert(record.schema === 'shortlist-decisions/1', 'schema 应锁 shortlist-decisions/1');
    assert(record.runId === 'contract-run' && record.round === 1, 'runId/round 应写对');
    assert(record.decisions.length === 3, '应写 3 条决策');
    assert(record.decisions.every((item) => typeof item.pos === 'number' && ['eliminate', 'defer'].includes(item.action)), '决策字段不合法');
    assert(record.decisions[0].note === '首屏太满，信息层级不清', '自定义删除理由应被 trim 并写入决策');
    assert(!('note' in record.decisions[2]), '未输入理由时不应写空 note');
    assert(existsSync(join(dir, '.ui-tokens', preview.uiToken + '.json')) === false, '令牌应被消费');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('final：preview payload → persistAction 生成 CLI 可读的 shortlist-choice/1', () => {
  const { dir } = makeRun({ final: true });
  try {
    const preview = buildPreview({ run: dir }, dir);
    assert(preview.ok === true && preview.mode === 'final', '应进入终选模式：' + JSON.stringify(preview.error));
    const prepared = persistAction(
      { schema: 'shortlist-ui-action/1', kind: 'final', run: dir, uiToken: preview.uiToken, choice: { kind: 'candidate', pos: 2 } },
      dir,
      5000,
    );
    assert(prepared.cli[0] === 'final', 'CLI 子命令应为 final');
    const choicePath = tempFileFromCli(prepared.cli, '--choice');
    const record = JSON.parse(readFileSync(choicePath, 'utf8'));
    assert(record.schema === 'shortlist-choice/1', 'schema 应锁 shortlist-choice/1');
    assert(record.kind === 'candidate' && record.pos === 2, 'choice 字段应写对');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('final none：自定义「都不行」理由写入 shortlist-choice/1', () => {
  const { dir } = makeRun({ final: true });
  try {
    const preview = buildPreview({ run: dir }, dir);
    assert(preview.ok === true && preview.mode === 'final', '应进入终选模式：' + JSON.stringify(preview.error));
    const prepared = persistAction(
      {
        schema: 'shortlist-ui-action/1',
        kind: 'final',
        run: dir,
        uiToken: preview.uiToken,
        choice: { kind: 'none', reasonIds: [SHORTLIST_UI_REASON_CHIPS[0].id], note: '  都不像我们的产品  ' },
      },
      dir,
      5000,
    );
    const choicePath = tempFileFromCli(prepared.cli, '--choice');
    const record = JSON.parse(readFileSync(choicePath, 'utf8'));
    assert(record.schema === 'shortlist-choice/1' && record.kind === 'none', '终选 none 字段不合法');
    assert(record.note === '都不像我们的产品', '终选自定义理由应被 trim 并写入 choice');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makePool(count) {
  const dir = mkdtempSync(join(tmpdir(), 'signal-pool-'));
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  const candidates = [];
  for (let index = 1; index <= count; index += 1) {
    const htmlPath = 'candidates/pool-p' + index + '.html';
    writeFileSync(join(dir, htmlPath), '<!doctype html><html><body><h1>池 ' + index + '</h1></body></html>', 'utf8');
    candidates.push({
      id: 'pool-' + index,
      poolIndex: index,
      round: Math.ceil(index / 3),
      pos: ((index - 1) % 3) + 1,
      htmlPath,
      world: { material: 'm', type: 't', layout: 'l', color: 'c' },
    });
  }
  writeFileSync(join(dir, 'brief.json'), JSON.stringify({ schema: 'shortlist-brief/1', title: 'pool', prompt: 'pool', runId: 'pool-run', cap: { maxRounds: 4, perRound: 3, maxPending: 3 } }), 'utf8');
  writeFileSync(join(dir, 'rounds.json'), JSON.stringify({ schema: 'shortlist-rounds/1', runId: 'pool-run', rounds: [] }), 'utf8');
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ schema: 'shortlist-state/1', runId: 'pool-run', pending: [], eliminated: [], decisionsByRound: {}, nextRound: 1, generationContexts: [], finished: false, outcome: null }), 'utf8');
  writeFileSync(join(dir, 'pool.json'), JSON.stringify({ schema: 'shortlist-pool/1', runId: 'pool-run', cap: 12, window: 3, candidates }), 'utf8');
  return { dir, candidates };
}

check('滑动窗：删一张后第三栏是池里的下一张，路过不必待定', () => {
  const pool = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => ({ id }));
  const first = slidingWindow(pool, []).map((item) => item.id);
  assert(first.join(',') === 'c1,c2,c3', '窗应先亮前 3 张：' + first.join(','));
  const afterDelete = slidingWindow(pool, ['c1']).map((item) => item.id);
  assert(afterDelete.join(',') === 'c2,c3,c4', '删掉第一张后第三栏应补上 c4：' + afterDelete.join(','));
  const afterPass = slidingWindow(pool, ['c2']).map((item) => item.id);
  assert(afterPass[2] === 'c4', '路过中间一张后第三栏仍是池里的下一张');
  const seen = pool.map((item) => item.id);
  assert(seen.length <= 12, '看过不能超过 12');
  const passed = normalizeLikesRecord({
    schema: 'shortlist-likes/1',
    runId: 'pool-run',
    seen,
    passed: seen,
    likes: [],
    traits: [],
    shortlist: [],
    eliminated: [],
  }, { runId: 'pool-run', poolIds: seen, reasonIds: ['too-loud'] });
  assert(passed.shortlist.length === 0 && passed.passed.length === 6, '可以不选待定一路路过');
  let rejected = false;
  try {
    normalizeLikesRecord({
      schema: 'shortlist-likes/1',
      runId: 'pool-run',
      seen: ['c1', 'c2', 'c3', 'c4'],
      shortlist: ['c1', 'c2', 'c3', 'c4'].map((candidateId) => ({ candidateId })),
      likes: [],
      traits: [],
      eliminated: [],
      passed: [],
    }, { runId: 'pool-run', poolIds: seen, reasonIds: ['too-loud'] });
  } catch (error) {
    rejected = /最多 3/.test(error.message);
  }
  assert(rejected, '短名单超过 3 张应拒绝');
  const keptTrait = normalizeLikesRecord({
    schema: 'shortlist-likes/1',
    runId: 'pool-run',
    seen: ['c1'],
    eliminated: [{ candidateId: 'c1', reasonId: 'too-loud' }],
    traits: [{ candidateId: 'c1', kind: 'typography', text: '万圣节标题字体' }],
    likes: [{ candidateId: 'c1' }],
    shortlist: [],
    passed: [],
  }, { runId: 'pool-run', poolIds: seen, reasonIds: ['too-loud'] });
  assert(keptTrait.traits[0].text === '万圣节标题字体', '已删候选仍可 save-trait');
  assert(finalGate({ shortlistCount: 0, traitCount: 0, draft: '' }).error === '特征袋空且无短名单，不能终选', '空袋且无短名单应拒 final');
  assert(finalGate({ shortlistCount: 1, traitCount: 0 }).ok === true, '有短名单可以 final');
  assert(finalGate({ shortlistCount: 0, traitCount: 1, draft: '用这版底稿' }).ok === true, '底稿加特征袋可以 final');
  assert(finalGate({ shortlistCount: 0, traitCount: 1, draft: '' }).ok === false, '只有特征、没有底稿不能 final');
});

check('pool preview 只亮 3 张，sidecar 提交不要求每轮 defer', () => {
  const { dir, candidates } = makePool(4);
  try {
    const preview = buildPreview({ run: dir }, dir);
    assert(preview.ok === true && preview.mode === 'pool', '应进入池模式：' + preview.error);
    assert(preview.candidates.length === 3 && preview.pool.length === 4, '窗 3、池 4');
    assert(preview.pool[3].id === 'pool-4', '第 4 张应留在池里等补位');
    assert(Array.isArray(preview.likedTraits), 'preview 应带 likedTraits');
    const first = candidates[0];
    const prepared = persistAction({
      schema: 'shortlist-ui-action/1',
      kind: 'pipeline',
      run: dir,
      uiToken: preview.uiToken,
      record: {
        schema: 'shortlist-likes/1',
        runId: 'pool-run',
        seen: [first.id],
        eliminated: [{ candidateId: first.id, reasonId: SHORTLIST_UI_REASON_CHIPS[0].id, note: '  字体很好  ' }],
        traits: [{ candidateId: first.id, kind: 'typography', text: '  万圣节标题字体  ' }],
        likes: [{ candidateId: first.id }],
        shortlist: [],
        passed: [],
        draft: '',
      },
    }, dir, 5000);
    assert(prepared.cli[0] === 'likes', 'pipeline 应走 likes，而不是 decide');
    const record = JSON.parse(readFileSync(tempFileFromCli(prepared.cli, '--file'), 'utf8'));
    assert(record.schema === 'shortlist-likes/1', 'sidecar schema 应为 shortlist-likes/1');
    assert(record.traits[0].text === '万圣节标题字体' && record.eliminated[0].note === '字体很好', '已删候选的特征应写入 sidecar');
    assert(record.shortlist.length === 0, '路过/删除不必带 defer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('CLI 源码仍接受这两个 schema（防单边改字段）', () => {
  const cli = readFileSync(join(ROOT, 'skills/design-kit/probe-kit/shortlist.mjs'), 'utf8');
  const pipeline = readFileSync(join(ROOT, 'skills/design-kit/probe-kit/lib/pipeline.mjs'), 'utf8');
  assert(cli.includes("'shortlist-decisions/1'"), 'CLI 应校验 shortlist-decisions/1');
  assert(cli.includes("'shortlist-choice/1'"), 'CLI 应校验 shortlist-choice/1');
  assert(cli.includes('shortlist-likes/1') && pipeline.includes('shortlist-likes/1'), 'CLI 应认识 shortlist-likes/1');
  assert(pipeline.includes('特征袋空且无短名单'), '终选闸门应拒绝空特征袋且无短名单');
  assert(cli.includes('--decisions') && cli.includes('--choice'), 'CLI 应接受 --decisions/--choice');
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? '✔' : '✖'} ${item.name}${item.ok ? '' : '\n    ' + item.error}`);
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
