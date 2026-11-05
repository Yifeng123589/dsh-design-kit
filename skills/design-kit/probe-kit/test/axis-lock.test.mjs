// A4：锁验证 + 假轴拒收（不做 AST；当前架构是模板填充）。
// 运行：node test/axis-lock.test.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AXES } from '../lib/axis.mjs';
import { axisLockProblems, buildRun, verifyRun } from '../probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..');
const TMP = mkdtempSync(join(tmpdir(), 'probe-axis-lock-'));

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

const axis = AXES.r4;
const { manifest, runDir } = buildRun({
  axis,
  values: [0.25, 0.5, 0.75],
  runId: 'axis-lock-r4',
  round: 1,
  seed: 7,
  outRoot: join(TMP, 'runs'),
  title: 'axis lock',
  prompt: 'axis lock',
  templateRel: axis.templateRel,
  templatePath: join(KIT, axis.templateRel),
});
const manifestPath = join(runDir, 'run.json');
const originalText = readFileSync(manifestPath, 'utf8');
const original = JSON.parse(originalText);
const restore = () => writeFileSync(manifestPath, originalText, 'utf8');
const mutate = (fn) => {
  const next = JSON.parse(originalText);
  fn(next);
  writeFileSync(manifestPath, JSON.stringify(next), 'utf8');
};

check('正常回合：锁验证通过，新清单带 placeholder / sideEffectKind', () => {
  restore();
  const result = verifyRun(runDir);
  assert(result.ok, 'verify 应通过：' + result.problems.join('；'));
  assert(manifest.axis.placeholder === axis.placeholder, '清单应记录 placeholder 锁');
  assert(manifest.axis.sideEffectKind === axis.sideEffectKind, '清单应记录 sideEffectKind 锁');
  assert(axisLockProblems(JSON.parse(originalText)).length === 0, 'axisLockProblems 应通过');
});

check('轴声明被篡改：verifyRun 拒绝（如 kind 被改成 fake）', () => {
  mutate((next) => {
    next.axis.kind = 'fake-axis';
  });
  const result = verifyRun(runDir);
  assert(!result.ok, '篡改轴声明应被拒绝');
  assert(result.problems.some((problem) => problem.includes('轴锁不一致')), '应报告轴锁不一致');
  restore();
});

check('未知/伪造轴：轴锁拒收', () => {
  mutate((next) => {
    next.axis.id = 'r99';
  });
  const problems = axisLockProblems(JSON.parse(readFileSync(manifestPath, 'utf8')));
  assert(problems.length === 1 && problems[0].includes('未知轴'), '应报告未知轴，实际：' + problems.join('；'));
  let threw = false;
  try {
    verifyRun(runDir);
  } catch (error) {
    threw = true;
    assert(String(error.message).includes('未知的轴'), 'verifyRun 应抛未知轴错误，实际：' + error.message);
  }
  assert(threw, '未知轴回合不应通过 verify');
  restore();
});

check('变体值越界：轴锁拒收', () => {
  mutate((next) => {
    next.variants[0].value = 999;
  });
  const problems = axisLockProblems(JSON.parse(readFileSync(manifestPath, 'utf8')));
  assert(problems.some((problem) => problem.includes('超出')), '应报告越界值');
  restore();
});

check('旧清单缺新增锁字段：向后兼容', () => {
  mutate((next) => {
    delete next.axis.placeholder;
    delete next.axis.sideEffectKind;
  });
  assert(axisLockProblems(JSON.parse(readFileSync(manifestPath, 'utf8'))).length === 0, '缺字段的旧清单不应误报');
  restore();
});

rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? '✔' : '✖'} ${item.name}${item.ok ? '' : '\n    ' + item.error}`);
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
