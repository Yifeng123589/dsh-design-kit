// 回归夹具：冻结 2026-11-02 的三轮真实精调结论，任何代码改动都要能复现它们。
// 直接运行：node test/regression.test.mjs
//
// 夹具来源（不是模拟）：
//   runs-real/r4-demo-1-r2、runs-real/r4-demo-1-r2-r3（真实回合）
//   ledger/answers/*.jsonl（真实指认）
//   ledger/calibration-real-final.json（真实落账的校准）
//   test/fixtures/real-runs/ledger-real.jsonl（真实台账事件切片）
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convergence, resolveVariantValues } from '../lib/ledger.mjs';
import { analyzeColorSideEffects } from '../lib/side-effects.mjs';
import { AXES } from '../lib/axis.mjs';
import { verifyRun } from '../probe.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const KIT = resolve(HERE, '..');
const RUNS_DIR = existsSync(join(KIT, 'runs-real'))
  ? join(KIT, 'runs-real')
  : join(HERE, 'fixtures', 'real-runs', 'runs-real');
const FIXTURES = join(HERE, 'fixtures', 'real-runs');

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
function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message || '值不相等'}\n  实际: ${a}\n  期望: ${b}`);
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'));
}
function readLines(rel) {
  return readFileSync(join(FIXTURES, rel), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ---------- 夹具完整性 ----------
check('夹具齐全且格式正确', () => {
  for (const file of [
    'manifest-r4-demo-1-r2.json',
    'manifest-r4-demo-1-r2-r3.json',
    'answer-r4-demo-1-r2.jsonl',
    'answer-r4-demo-1-r2-r3.jsonl',
    'calibration-real-final.json',
    'ledger-real.jsonl',
  ]) {
    assert(existsSync(join(FIXTURES, file)), `缺少夹具 ${file}`);
  }
  const events = readLines('ledger-real.jsonl');
  assert(events.length >= 7, `真实台账切片应至少 7 条，实际 ${events.length}`);
  assert(events.every((event) => event.t && event.schema), '台账事件缺 t/schema');
});

// ---------- 三轮真实指认的值 ----------
check('R2 指认解析为 0.4375', () => {
  const derived = resolveVariantValues({
    runManifest: readJson('manifest-r4-demo-1-r2.json'),
    answer: readLines('answer-r4-demo-1-r2.jsonl')[0],
  });
  assertEqual(derived.chosenValue, 0.4375, 'R2 chosenValue');
  assertEqual(derived.interval, null, 'R2 应为单点指认');
});

check('R3 指认解析为 0.421875', () => {
  const derived = resolveVariantValues({
    runManifest: readJson('manifest-r4-demo-1-r2-r3.json'),
    answer: readLines('answer-r4-demo-1-r2-r3.jsonl')[0],
  });
  assertEqual(derived.chosenValue, 0.421875, 'R3 chosenValue');
});

check('R1 事件记录值 0.375 与区间 [0.25, 0.5]', () => {
  const event = readLines('ledger-real.jsonl').find((item) => item.t === 'run.recorded' && item.runId === 'r4-demo-1');
  assert(event, '缺少 R1 run.recorded');
  assertEqual(event.derived.chosenValue, 0.375, 'R1 chosenValue');
  assertEqual(event.derived.interval, { lo: 0.25, hi: 0.5, mid: 0.375, half: 0.125 }, 'R1 interval');
});

// ---------- 收敛判定（协议 P4 的已知结论） ----------
check('三轮收敛判定复现：evidence + n=3 弱证据', () => {
  const conv = convergence({ events: readLines('ledger-real.jsonl'), dim: 'accent_saturation' });
  assertEqual(conv.verdict, 'evidence', 'verdict');
  assert(conv.note.includes('n=3'), `note 应写明 n=3：${conv.note}`);
  assertEqual(
    conv.rounds.map((round) => round.chosenValue),
    [0.375, 0.4375, 0.421875],
    '轮次值顺序',
  );
});

// ---------- 真实校准结论 ----------
check('真实校准：42% + JND 等效带，且来源/有效期一致', () => {
  const calibration = readJson('calibration-real-final.json');
  assertEqual(calibration.schema, 'calibration/1', 'schema');
  assertEqual(calibration.dim, 'accent_saturation', 'dim');
  assertEqual(calibration.value, 0.421875, 'value');
  assertEqual(calibration.source.runId, 'r4-demo-1-r2-r3', 'source.runId');
  assertEqual(calibration.boundary.kind, 'jnd-band', 'boundary.kind');
  assertEqual([calibration.boundary.lo, calibration.boundary.hi], [0.421875, 0.4375], 'boundary 区间');
  assertEqual(calibration.expires.runCount, 3, 'runCount');
  assertEqual(calibration.attribution.confidence, 'low', 'confidence 应为 low');
});

// ---------- 轴副作用代理：真实饱和度轴不串维 ----------
check('R4 真实取值过副作用阈值：色相/明度/对比度都没漂移', () => {
  const manifest = readJson('manifest-r4-demo-1-r2-r3.json');
  const template = readFileSync(join(KIT, 'fixtures', 'r4', 'base.html'), 'utf8');
  const analysis = analyzeColorSideEffects({
    axis: AXES.r4,
    values: manifest.input.values,
    templateHtml: template,
  });
  assert(analysis.ok, '真实取值应通过副作用检查：' + analysis.violations.join('；'));
  assertEqual(analysis.deltas.hueDeg, 0, '色相漂移应为 0');
  assertEqual(analysis.deltas.lightness, 0, '明度漂移应为 0');
  assert(analysis.deltas.contrastRatio < 0.15, '对比度漂移应在阈值内');
  assert(analysis.monotonicChroma, '色度应随轴值单调');
});

check('副作用代理能抓住串维：明度漂移被拒', () => {
  const badAxis = { id: 'bad', dim: 'bad', render: (value) => `oklch(${(60 + value * 20).toFixed(2)}% 0.12 246)` };
  const analysis = analyzeColorSideEffects({ axis: badAxis, values: [0.3, 0.5, 0.7], templateHtml: '<style>--paper:#ffffff</style>' });
  assert(!analysis.ok, '明度漂移应被拒绝');
  assert(analysis.violations.some((message) => message.includes('明度漂移')), '应报告明度漂移');
});

check('副作用代理能抓住串维：色相漂移被拒', () => {
  const badAxis = { id: 'bad', dim: 'bad', render: (value) => `oklch(66% 0.12 ${200 + value * 90})` };
  const analysis = analyzeColorSideEffects({ axis: badAxis, values: [0.3, 0.5, 0.7], templateHtml: '<style>--paper:#ffffff</style>' });
  assert(!analysis.ok, '色相漂移应被拒绝');
  assert(analysis.violations.some((message) => message.includes('色相漂移')), '应报告色相漂移');
});

// ---------- 真实回合仍通过完整性校验 ----------
check('真实回合 r2 / r3 verify 仍通过', () => {
  for (const dir of ['r4-demo-1-r2', 'r4-demo-1-r2-r3']) {
    const result = verifyRun(join(RUNS_DIR, dir));
    assert(result.ok, `${dir} verify 失败：${result.problems.join('；')}`);
  }
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? '✔' : '✖'} ${item.name}${item.ok ? '' : `\n    ${item.error}`}`);
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
