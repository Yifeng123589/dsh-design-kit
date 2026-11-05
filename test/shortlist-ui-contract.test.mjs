// A8：UI ↔ CLI 契约测试。锁 preview payload → persistAction → 决策/终选 JSONL 的字段，
// 并和 probe-kit CLI 的 schema/reason chip 对齐。
// 运行：node test/shortlist-ui-contract.test.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPreview, persistAction, SHORTLIST_UI_REASON_CHIPS } from '../lib/shortlist-ui.js';
import { REASON_CHIPS } from '../skills/design-kit/probe-kit/lib/shortlist.mjs';

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
    const payload = {
      schema: 'shortlist-ui-action/1',
      kind: 'decide',
      run: dir,
      round: preview.round,
      uiToken: preview.uiToken,
      decisions: [
        { pos: 1, action: 'eliminate', reasonId: SHORTLIST_UI_REASON_CHIPS[2].id },
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
    assert(existsSync(join(dir, '.ui-token.json')) === false, '令牌应被消费');
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

check('CLI 源码仍接受这两个 schema（防单边改字段）', () => {
  const cli = readFileSync(join(ROOT, 'skills/design-kit/probe-kit/shortlist.mjs'), 'utf8');
  assert(cli.includes("'shortlist-decisions/1'"), 'CLI 应校验 shortlist-decisions/1');
  assert(cli.includes("'shortlist-choice/1'"), 'CLI 应校验 shortlist-choice/1');
  assert(cli.includes('--decisions') && cli.includes('--choice'), 'CLI 应接受 --decisions/--choice');
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? '✔' : '✖'} ${item.name}${item.ok ? '' : '\n    ' + item.error}`);
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
