// Smoke test：仪器通电检查。不开浏览器也能确认的部分全跑一遍，剩下的人工项明确列出。
// 运行：node test/smoke.mjs
//
// 覆盖：
//   1. 运行环境（Node 版本、平台、环境指纹稳定性）
//   2. 三条轴（r4 颜色 / r5 字号 / r6 间距）各 build + verify
//   3. 完整链路：build → 模拟指认 → 落账 → credentialState（含三态凭证）
//   4. 环境指纹漂移 → expired；指纹复位 → 恢复 fresh（env_fp reset 演练）
//   5. 页面结构（无外链、可被静态解析）
//   6. 插件包结构（dsh-probe-kit 或合并后的 dsh-design-kit）
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AXES } from '../lib/axis.mjs';
import { createSession } from '../lib/recorder.mjs';
import * as ledger from '../lib/ledger.mjs';
import { buildRun, verifyRun, PRESENTER_VERSION, normalizeAuthorization, checkApplyCredential } from '../probe.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const KIT = resolve(HERE, '..');
const ROOT = resolve(KIT, '..');
const TMP = join(tmpdir(), 'dsh-smoke-' + process.pid);

// 兼容两种布局：源仓库（../dsh-probe-kit）与合并插件（skills/design-kit/probe-kit/test/）
function findPluginRoot(start) {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.dsh) return dir;
      } catch {
        // 忽略坏 package.json，继续向上找
      }
    }
    dir = dirname(dir);
  }
  return null;
}
const PLUGIN = findPluginRoot(HERE) ?? join(ROOT, 'dsh-probe-kit');
const PLUGIN_NAME = PLUGIN.split(/[\\/]/).pop();

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
function equal(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message || '值不相等'}\n  实际: ${a}\n  期望: ${b}`);
}

function makeAnswer(runManifest, chosenPos) {
  const session = createSession({ runId: runManifest.runId, positionCount: runManifest.variants.length, sessionId: 'smoke' });
  session.setEnvironment({ viewport: { w: 1440, h: 900 }, lang: 'zh-CN', reducedMotion: false });
  session.choose(chosenPos);
  session.setConfidence(2);
  return session.lock();
}

const env = {
  platform: process.platform,
  node: process.versions.node,
  presenter: PRESENTER_VERSION,
  recorder: '1',
};
env.fingerprint = ledger.envFingerprint(env);

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// ---------- 1. 运行环境 ----------
check('运行环境：Node ≥ 18 且环境指纹稳定', () => {
  const major = Number(String(process.versions.node).split('.')[0]);
  assert(major >= 18, `Node 需要 ≥ 18，当前 ${process.versions.node}`);
  equal(ledger.envFingerprint(env), env.fingerprint, '同输入指纹应一致');
  assert(ledger.envFingerprint({ ...env, node: 'v0.0.0' }) !== env.fingerprint, 'node 变化应改变指纹');
});

// ---------- 2. 三条轴 ----------
const AXIS_CASES = [
  ['r4', [0.25, 0.5, 0.75]],
  ['r5', [15, 17, 19]],
  ['r6', [12, 24, 36]],
];
for (const [axisId, values] of AXIS_CASES) {
  check(`轴 ${axisId}：build + verify + 副作用记录`, () => {
    const axis = AXES[axisId];
    const { manifest } = buildRun({
      axis,
      values,
      runId: `smoke-${axisId}`,
      round: 1,
      seed: 7,
      outRoot: join(TMP, 'runs'),
      title: `smoke ${axisId}`,
      prompt: 'smoke',
      templateRel: axis.templateRel,
      templatePath: join(KIT, axis.templateRel),
    });
    assert(manifest.sideEffects && manifest.sideEffects.ok === true, `${axisId} 应有通过的副作用记录`);
    const verified = verifyRun(join(TMP, 'runs', manifest.runId));
    assert(verified.ok, `${axisId} verify 失败：${verified.problems.join('；')}`);
  });
}

// ---------- 3. 完整链路 + 三态凭证 ----------
check('链路：build → 指认 → 落账 → exploration 凭证', () => {
  const axis = AXES.r5;
  const { manifest } = buildRun({
    axis,
    values: [15, 17, 19],
    runId: 'smoke-chain',
    round: 1,
    seed: 7,
    outRoot: join(TMP, 'runs'),
    title: 'smoke chain',
    prompt: 'smoke',
    templateRel: axis.templateRel,
    templatePath: join(KIT, axis.templateRel),
  });
  const answer = makeAnswer(manifest, 2);
  const event = ledger.makeRunEvent({ runManifest: manifest, answer, context: { projectType: 'smoke' }, env, round: 1 });
  const ledgerPath = join(TMP, 'ledger.jsonl');
  const appended = ledger.appendEvent(ledgerPath, event);
  assert(appended.ok, '落账失败：' + appended.error);
  const state = ledger.credentialState({
    events: ledger.readEvents(ledgerPath),
    dim: event.dim,
    context: event.context,
    envFingerprint: env.fingerprint,
  });
  equal(state.state, 'fresh', '单轮不应 expired');
  equal(state.kind, 'exploration', '单轮只有探索证据');
  assert(state.kindReason.includes('频谱'), 'kindReason 应说明探索证据');
});

check('凭证三态：副作用在界内 + 两轮收敛 → axis', () => {
  const axis = AXES.r5;
  const ledgerPath = join(TMP, 'ledger-axis.jsonl');
  const events = [];
  for (const [round, values] of [
    [1, [15, 17, 19]],
    [2, [15.5, 17, 18.5]],
  ]) {
    const { manifest } = buildRun({
      axis,
      values,
      runId: `smoke-axis-r${round}`,
      round,
      seed: 7,
      outRoot: join(TMP, 'runs'),
      title: 'smoke axis',
      prompt: 'smoke',
      templateRel: axis.templateRel,
      templatePath: join(KIT, axis.templateRel),
    });
    const answer = makeAnswer(manifest, 2);
    const event = ledger.makeRunEvent({ runManifest: manifest, answer, context: { projectType: 'smoke-axis' }, env, round });
    events.push(event);
    const appended = ledger.appendEvent(ledgerPath, event);
    assert(appended.ok, '落账失败：' + appended.error);
  }
  const state = ledger.credentialState({
    events,
    dim: events[0].dim,
    context: events[0].context,
    envFingerprint: env.fingerprint,
  });
  equal(state.kind, 'axis', '两轮收敛后应为 axis 凭证');
});

// ---------- 4. 环境指纹漂移 / 复位 ----------
check('env_fp 漂移会 expired，指纹复位后恢复', () => {
  const events = ledger.readEvents(join(TMP, 'ledger-axis.jsonl'));
  const event = events[0];
  const drifted = ledger.credentialState({
    events,
    dim: event.dim,
    context: event.context,
    envFingerprint: 'ffffffffffff',
  });
  equal(drifted.state, 'expired', '指纹变化应 expired');
  assert(drifted.reasons.some((reason) => reason.includes('环境指纹')), '应给出指纹变化理由');
  const restored = ledger.credentialState({
    events,
    dim: event.dim,
    context: event.context,
    envFingerprint: env.fingerprint,
  });
  assert(restored.state !== 'expired', '指纹复位后不应 expired');
});

// ---------- 5. 页面结构 ----------
check('页面结构：无外链 / 无占位符 / run-data 可解析', () => {
  const runDir = join(TMP, 'runs', 'smoke-r4');
  const html = readFileSync(join(runDir, 'run.html'), 'utf8');
  assert(!/https?:\/\//i.test(html), '页面不应含 http(s) 外链');
  assert(!html.includes('__PRESENTER_VERSION__') && !html.includes('__RUN_DATA_JSON__'), '不应残留占位符');
  const json = /<script[^>]*id="run-data"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  assert(json !== null, '缺少 run-data');
  const data = JSON.parse(json[1]);
  equal(data.positions.length, 3, 'run-data 应有 3 个位置');
});

// ---------- 6. 凭证门槛与项目授权 ----------
check('--strict：unverified/exploration 拒绝，axis 放行', () => {
  const strict = { strict: true };
  assert(checkApplyCredential({ kind: 'axis', kindReason: 'ok' }, strict) === 'axis', 'axis 应放行');
  const expectThrow = (cred, message) => {
    let threw = null;
    try {
      checkApplyCredential(cred, strict);
    } catch (error) {
      threw = error;
    }
    assert(threw !== null, `${message}：应抛错`);
    assert(String(threw.message).includes('--strict'), `${message}：错误应提示 --strict`);
  };
  expectThrow({ kind: 'exploration', kindReason: '单轮' }, 'exploration');
  expectThrow({ kind: 'unverified', kindReason: '无代理' }, 'unverified');
  expectThrow({ kind: undefined }, '缺少 kind');
  assert(checkApplyCredential({ kind: 'exploration' }, { strict: false }) === 'exploration', '非 strict 只告警不抛');
});

check('项目授权：只接受 spectrum_only 与非空问题', () => {
  const normalized = normalizeAuthorization({ question: '这个项目值不值得探间距？', grantedBy: 'owner' }, '2026-11-02T00:00:00Z');
  equal(normalized.scope, 'spectrum_only', 'scope');
  equal(normalized.grantedBy, 'owner', 'grantedBy');
  equal(normalized.authorizedAt, '2026-11-02T00:00:00Z', 'authorizedAt');
  const expectThrow = (input, includes) => {
    let threw = null;
    try {
      normalizeAuthorization(input);
    } catch (error) {
      threw = error;
    }
    assert(threw !== null, `应抛错：${JSON.stringify(input)}`);
    assert(String(threw.message).includes(includes), `错误信息应包含「${includes}」：${threw.message}`);
  };
  expectThrow({ question: '', scope: 'spectrum_only' }, 'question');
  expectThrow({ question: '探吗', scope: 'interpolation' }, 'spectrum_only');
  expectThrow('not-an-object', '对象');
});

// ---------- 7. 插件包结构 ----------
check('插件包结构齐全（' + PLUGIN_NAME + '）', () => {
  const unified = PLUGIN_NAME === 'dsh-design-kit';
  const required = unified
    ? [
        'package.json',
        'cordis.patch.yml',
        'lib/index.js',
        'lib/tools.js',
        'lib/skill.js',
        'skills/design-kit/SKILL.md',
        'skills/design-kit/probe-kit/shortlist.mjs',
        'skills/design-kit/probe-kit/lib/side-effects.mjs',
        'skills/design-kit/probe-kit/PROTOCOL-V0.2.md',
      ]
    : [
        'package.json',
        'cordis.patch.yml',
        'lib/index.js',
        'lib/tools.js',
        'lib/skill.js',
        'skills/probe-kit/SKILL.md',
        'skills/probe-kit/shortlist.mjs',
        'skills/probe-kit/lib/side-effects.mjs',
        'skills/probe-kit/PROTOCOL-V0.2.md',
      ];
  for (const file of required) {
    assert(existsSync(join(PLUGIN, file)), `缺少 ${file}`);
  }
  assert(
    PLUGIN_NAME === 'dsh-probe-kit' || PLUGIN_NAME === 'dsh-design-kit',
    '未知插件布局：' + PLUGIN,
  );
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? '✔' : '✖'} ${item.name}${item.ok ? '' : `\n    ${item.error}`}`);
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);

rmSync(TMP, { recursive: true, force: true });

console.log('\n需要人工/真实环境才能完成的 smoke 项：');
console.log('  · 在浏览器打开 run.html / round-1.html / final.html，目检三列布局、缩略图、窄屏告警');
console.log('  · 在真实 DSH profile 里 pnpm add / 重启，确认技能路由与工具可调用');
console.log('  · 在真实宿主里执行一次 probe_shortlist / probe_measure，确认子进程在非沙箱环境可用');
console.log('  · 用真实评审人跑一轮，复核 JND 标定（字号 1px / 间距 6px 目前是估值）');

process.exit(failed.length === 0 ? 0 : 1);
