// 外部 skill 生成：plan → 4×3 HTML（data-slot 契约）→ import → pool → verify。
// 运行：node test/external-import.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPreview } from '../lib/shortlist-ui.js';
import { DEFAULT_CAP, validateCandidates } from '../skills/design-kit/probe-kit/lib/shortlist.mjs';
import { readContentSlots } from '../skills/design-kit/probe-kit/lib/worlds.mjs';

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
function runCli(args, cwd) {
  return spawnSync(process.execPath, [SHORTLIST, ...args], { cwd, encoding: 'utf8' });
}
function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function page(content, variant, accent) {
  const bullets = content.bullets
    .map((item) => `<li><span data-slot="bullet">${esc(item.text)}</span><span data-slot="meta">${esc(item.meta)}</span></li>`)
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(content.title)}</title><style>
  :root { --accent: ${accent}; }
  body { margin: 0; background: #f7f5ee; color: #1a1a1a; font-family: Inter, "PingFang SC", sans-serif; line-height: 1.6; }
  main { max-width: 420px; margin: 0 auto; padding: 28px 22px; }
  .variant { color: var(--accent); font-size: 11px; letter-spacing: .08em; }
  h1 { font-size: 34px; line-height: 1.08; margin: 0 0 10px; }
  p { margin: 0 0 12px; }
  ul { padding: 0; list-style: none; border-top: 1px solid #ddd; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #ddd; }
  button { margin-top: 18px; min-height: 44px; padding: 8px 14px; border: 1px solid #1a1a1a; background: transparent; color: #1a1a1a; }
  footer { margin-top: 28px; color: #777; font-size: 11px; }
  </style></head><body><main>
  <div class="variant">${esc(variant)}</div>
  <h1 data-slot="title">${esc(content.title)}</h1>
  <p data-slot="subtitle">${esc(content.subtitle)}</p>
  <ul>${bullets}</ul>
  <button data-slot="cta" type="button">${esc(content.cta)}</button>
  <p data-slot="foot">${esc(content.foot)}</p>
  </main></body></html>`;
}

const BRIEF = {
  title: 'External import test',
  prompt: 'A landing page generated from an external skill',
  content: {
    title: 'Make the work visible',
    subtitle: 'A studio for interface decisions',
    bullets: ['Direction first', 'Evidence over taste', 'Ship the flat parts'],
    cta: 'Start here',
    foot: 'External import test',
  },
};
const AXES = [
  { material: 'paper-a', type: 'sans-a', layout: 'grid-a', color: 'ink-a' },
  { material: 'paper-b', type: 'serif-b', layout: 'column-b', color: 'paper-b' },
  { material: 'screen-c', type: 'mono-c', layout: 'stack-c', color: 'signal-c' },
];

check('data-slot 内容契约：不依赖 class 也能读回内容槽', () => {
  const html = `<!doctype html><html><head><title>T</title></head><body>
    <h1 data-slot="title">T</h1>
    <p data-slot="subtitle">S</p>
    <span data-slot="bullet">A</span><span data-slot="meta">1</span>
    <span data-slot="bullet">B</span><span data-slot="meta">2</span>
    <span data-slot="bullet">C</span><span data-slot="meta">3</span>
    <a data-slot="cta" href="#">Go</a>
    <div data-slot="foot">F</div>
  </body></html>`;
  const slots = readContentSlots(html);
  assert(slots && slots.title === 'T' && slots.bullets.length === 3 && slots.cta === 'Go' && slots.foot === 'F', 'data-slot 内容槽解析失败');
});

check('静态预览闸门：<script> 与内联事件被拒绝', () => {
  const candidate = (index, extra) => ({
    id: 'script-' + index,
    world: {
      family: 'script-family',
      variant: 'variant-' + index,
      contrast: { ornament: ['low', 'mid', 'high'][index], image: 'low' },
      material: 'm',
      type: 't',
      layout: 'l',
      color: 'c',
    },
    html: page(BRIEF.content, 'script-' + index, '#000') + extra,
  });
  const relation = { relation: 'lineage', family: 'script-family' };
  const scripted = validateCandidates(
    [candidate(0, '<script>alert(1)</script>'), candidate(1, ''), candidate(2, '')],
    DEFAULT_CAP,
    relation,
  );
  assert(!scripted.ok && scripted.errors.some((error) => /script/i.test(error)), '带 <script> 的候选应被拒绝');
  const evented = validateCandidates(
    [candidate(0, '<div onclick="x()">x</div>'), candidate(1, ''), candidate(2, '')],
    DEFAULT_CAP,
    relation,
  );
  assert(!evented.ok && evented.errors.some((error) => /onclick|外部依赖/i.test(error)), '带内联事件的候选应被拒绝');
});

check('外部 skill：plan → import 12 页 → pool → preview → verify', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'external-import-'));
  try {
    writeFileSync(join(cwd, 'brief.json'), JSON.stringify(BRIEF, null, 2), 'utf8');
    let result = runCli(
      ['init', '--brief', 'brief.json', '--run-id', 'external-run', '--out', 'shortlist-runs', '--ledger', 'ledger.jsonl'],
      cwd,
    );
    assert(result.status === 0, 'init 失败\n' + result.stdout + '\n' + result.stderr);
    result = runCli(['plan', '--run', 'shortlist-runs/external-run', '--seed', 'ext-a'], cwd);
    assert(result.status === 0, 'plan 失败\n' + result.stdout + '\n' + result.stderr);
    const planPath = join(cwd, 'shortlist-runs', 'external-run', 'plan.json');
    assert(existsSync(planPath), 'plan.json 应写出');
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    assert(plan.writer === 'external' && plan.rounds.length === 4, 'plan 应包含 4 轮外部生成计划');
    assert(plan.content && plan.contentHash, 'plan 应锁定内容槽');

    const rounds = plan.rounds.map((planRound, index) => {
      const candidates = [];
      for (let pos = 0; pos < 3; pos += 1) {
        const lineageFamily = index === 0 ? 'ext-family-a' : 'ext-family-b';
        const world = planRound.relation === 'lineage'
          ? {
              family: lineageFamily,
              variant: 'variant-' + pos,
              contrast: { ornament: pos === 0 ? 'low' : pos === 1 ? 'mid' : 'high', image: pos === 2 ? 'high' : 'low' },
              axes: AXES[pos],
            }
          : {
              family: 'ext-family-' + pos,
              variant: 'contrast-' + pos,
              contrast: {
                ornament: pos === 0 ? 'low' : pos === 1 ? 'mid' : 'high',
                image: pos === 0 ? 'low' : pos === 1 ? 'mid' : 'high',
              },
              axes: AXES[pos],
            };
        candidates.push({
          id: `${planRound.round}-${pos + 1}`,
          world,
          html: page(plan.content, `${planRound.round}-${pos + 1}`, ['#e30613', '#0a5ca8', '#4f6b3a'][pos]),
        });
      }
      return {
        round: planRound.round,
        relation: planRound.relation === 'lineage'
          ? { relation: 'lineage', family: index === 0 ? 'ext-family-a' : 'ext-family-b' }
          : { relation: 'contrast', axis: planRound.axis },
        candidates,
      };
    });
    const bundle = {
      schema: 'shortlist-external-import/1',
      writer: 'external',
      skill: { id: 'test-skill', source: 'local:test-skill', license: 'MIT', promptHash: 'test' },
      seed: 'ext-a',
      rounds,
    };
    writeFileSync(join(cwd, 'bundle.json'), JSON.stringify(bundle, null, 2), 'utf8');
    result = runCli(['import', '--run', 'shortlist-runs/external-run', '--bundle', 'bundle.json'], cwd);
    assert(result.status === 0, 'import 失败\n' + result.stdout + '\n' + result.stderr);

    const runDir = join(cwd, 'shortlist-runs', 'external-run');
    const pool = JSON.parse(readFileSync(join(runDir, 'pool.json'), 'utf8'));
    assert(pool.writer === 'external' && pool.candidates.length === 12, '外部池应有 12 个候选');
    assert(pool.skill.id === 'test-skill' && pool.contentHash === plan.contentHash, '外部池应记录 skill 与 contentHash');

    const preview = buildPreview({ run: runDir }, cwd);
    assert(preview.ok === true && preview.mode === 'pool', '外部池应能 preview：' + preview.error);
    assert(preview.candidates.length === 3, '工作台应只亮 3 张');

    result = runCli(['verify', '--run', 'shortlist-runs/external-run'], cwd);
    assert(result.status === 0, 'verify 失败\n' + result.stdout + '\n' + result.stderr);
    assert(result.stdout.includes('外部池来源、12 页、内容槽与关系一致'), 'verify 应检查外部池');

    // plan 写了 R3/R4 是 contrast；bundle 不能偷偷改成 lineage。
    result = runCli(
      ['init', '--brief', 'brief.json', '--run-id', 'bad-run', '--out', 'shortlist-runs', '--ledger', 'ledger.jsonl'],
      cwd,
    );
    assert(result.status === 0, 'bad-run init 失败');
    result = runCli(['plan', '--run', 'shortlist-runs/bad-run', '--seed', 'ext-a'], cwd);
    assert(result.status === 0, 'bad-run plan 失败');
    const badRounds = JSON.parse(JSON.stringify(rounds));
    badRounds[2].relation = { relation: 'lineage', family: 'bad-family' };
    badRounds[2].candidates = badRounds[2].candidates.map((candidate, index) => ({
      ...candidate,
      world: {
        family: 'bad-family',
        variant: 'bad-variant-' + index,
        contrast: { ornament: 'low', image: 'low' },
        axes: AXES[index],
      },
    }));
    writeFileSync(
      join(cwd, 'bad-bundle.json'),
      JSON.stringify({ ...bundle, rounds: badRounds }, null, 2),
      'utf8',
    );
    result = runCli(['import', '--run', 'shortlist-runs/bad-run', '--bundle', 'bad-bundle.json'], cwd);
    assert(result.status === 1, '违反 plan 关系的 bundle 应被拒绝');
    assert(
      (result.stdout + result.stderr).includes('plan 要求 contrast'),
      '拒绝原因应指出 plan 要求 contrast：' + result.stdout + result.stderr,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log((item.ok ? '✔ ' : '✖ ') + item.name + (item.ok ? '' : '\n    ' + item.error));
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
