// 流水线 S1–S3：池、滑动窗补位、特征袋、终选轻闸门。
// 运行：node test/pipeline-shortlist.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const BRIEF = {
  title: '半弦咖啡',
  prompt: '给街区咖啡馆选一个首页方向，读者是傍晚会进来坐一会儿的人。',
  context: { projectType: '品牌首页', audience: '街区客人', device: 'desktop' },
};

function initRun(cwd, writer) {
  writeFileSync(join(cwd, 'brief.json'), JSON.stringify(BRIEF), 'utf8');
  const ledger = join(cwd, 'ledger.jsonl');
  const init = runCli(['init', '--brief', 'brief.json', '--run-id', 'sl-pipe', '--out', 'shortlist-runs', '--ledger', ledger], cwd);
  assert(init.status === 0, 'init 失败\n' + init.stderr);
  const run = 'shortlist-runs/sl-pipe';
  const pooled = runCli(['pool', '--run', run, '--writer', writer, '--ledger', ledger], cwd);
  assert(pooled.status === 0, 'pool 失败\n' + pooled.stdout + '\n' + pooled.stderr);
  assert(!pooled.stdout.includes('shortlist.decisions'), 'pool 不应写 decide');
  const ledgerText = readFileSync(ledger, 'utf8');
  assert(!ledgerText.includes('shortlist.decisions') && !ledgerText.includes('shortlist.round'), 'pool 不应写轮次或决策台账');
  const pool = JSON.parse(readFileSync(join(cwd, run, 'pool.json'), 'utf8'));
  assert(pool.schema === 'shortlist-pool/1' && pool.candidates.length === 12, '池应正好 12 张：' + pool.candidates.length);
  assert(pool.window === 3, '窗大小应为 3');
  const slots = pool.candidates.map((candidate) => JSON.stringify(readContentSlots(readFileSync(join(cwd, run, candidate.htmlPath), 'utf8'))));
  assert(slots.every((item) => item === slots[0]), '池内 12 页应锁同一内容槽');
  return { run, ledger, pool };
}

check('worlds 池满 12，删一张后的下一张来自池，且不抬封顶', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pipe-worlds-'));
  try {
    const { run, ledger, pool } = initRun(cwd, 'worlds');
    const blocked = runCli(['generate', '--run', run, '--round', '1', '--add', '--writer', 'worlds', '--ledger', ledger], cwd);
    assert(blocked.status !== 0 && (blocked.stderr + blocked.stdout).includes('预生成池'), '有池之后不能再 add 出第 13 个\n' + blocked.stderr + blocked.stdout);
    const first = pool.candidates[0];
    const likes = {
      schema: 'shortlist-likes/1',
      runId: 'sl-pipe',
      seen: [first.id],
      eliminated: [{ candidateId: first.id, reasonId: 'too-loud', note: '整页太吵' }],
      traits: [{ candidateId: first.id, kind: 'typography', text: '万圣节标题字体' }],
      likes: [{ candidateId: first.id }],
      shortlist: [],
      passed: [],
      draft: '用咖啡馆底稿',
    };
    writeFileSync(join(cwd, 'likes-in.json'), JSON.stringify(likes), 'utf8');
    const ledgerBefore = readFileSync(ledger, 'utf8');
    const saved = runCli(['likes', '--run', run, '--file', 'likes-in.json', '--ledger', ledger], cwd);
    assert(saved.status === 0, 'likes 失败\n' + saved.stderr);
    assert(readFileSync(ledger, 'utf8') === ledgerBefore, 'likes 不能写台账');
    const generated = runCli(['generate', '--run', run, '--round', '2', '--writer', 'worlds', '--out', 'candidates/next.json', '--ledger', ledger], cwd);
    assert(generated.status === 0, 'generate 失败\n' + generated.stdout + '\n' + generated.stderr);
    assert(generated.stdout.includes('万圣节标题字体'), '下一轮 generate 应把特征袋打出来');
    assert(!generated.stdout.includes('shortlist.decisions'), 'generate 仍不写 decide');
    const next = JSON.parse(readFileSync(join(cwd, 'candidates', 'next.json'), 'utf8'));
    assert(next.likedTraits?.[0]?.text === '万圣节标题字体', '候选 JSON 应带 likedTraits');
    assert(next.candidates.every((candidate) => !candidate.html.includes('万圣节标题字体')), '特征袋不能写进 HTML');
    assert(readFileSync(ledger, 'utf8') === ledgerBefore, '不带 --add 的 generate 仍不写台账');
    const choice = { schema: 'shortlist-choice/1', runId: 'sl-pipe', kind: 'candidate', pos: 1 };
    writeFileSync(join(cwd, 'choice.json'), JSON.stringify(choice), 'utf8');
    const rejected = runCli(['final', '--run', run, '--choice', 'choice.json', '--ledger', ledger], cwd);
    assert(rejected.status !== 0, '没有短名单时不该按待定终选成功');
    const emptyBag = {
      ...likes,
      traits: [],
      likes: [],
      draft: '',
      eliminated: [{ candidateId: first.id, reasonId: 'too-loud' }],
    };
    writeFileSync(join(cwd, 'likes-empty.json'), JSON.stringify(emptyBag), 'utf8');
    assert(runCli(['likes', '--run', run, '--file', 'likes-empty.json', '--ledger', ledger], cwd).status === 0, '清空特征袋失败');
    const denied = runCli(['final', '--run', run, '--choice', 'choice.json', '--ledger', ledger], cwd);
    assert(denied.status !== 0 && (denied.stderr + denied.stdout).includes('特征袋空且无短名单'), '空袋且无短名单应拒 final：\n' + denied.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

check('短名单 1 张或底稿加特征袋可以 final，verify 仍过', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pipe-final-'));
  try {
    const { run, pool } = initRun(cwd, 'archetype');
    const kept = pool.candidates[3];
    const likes = {
      schema: 'shortlist-likes/1',
      runId: 'sl-pipe',
      seen: [kept.id, pool.candidates[0].id],
      shortlist: [{ candidateId: kept.id }],
      passed: [pool.candidates[0].id],
      eliminated: [],
      likes: [],
      traits: [{ candidateId: pool.candidates[0].id, kind: 'palette', text: '骨色底上的朱红' }],
      draft: null,
    };
    writeFileSync(join(cwd, 'likes.json'), JSON.stringify(likes), 'utf8');
    assert(runCli(['likes', '--run', run, '--file', 'likes.json'], cwd).status === 0, '写入短名单失败');
    const choice = { schema: 'shortlist-choice/1', runId: 'sl-pipe', kind: 'shortlist', pos: 1 };
    writeFileSync(join(cwd, 'choice.json'), JSON.stringify(choice), 'utf8');
    const ledger = join(cwd, 'ledger.jsonl');
    const chosen = runCli(['final', '--run', run, '--choice', 'choice.json', '--ledger', ledger], cwd);
    assert(chosen.status === 0, '短名单终选失败\n' + chosen.stdout + '\n' + chosen.stderr);
    const result = JSON.parse(readFileSync(join(cwd, run, 'result.json'), 'utf8'));
    assert(result.chosen.id === kept.id, '终选应是短名单里的那一张');
    const verified = runCli(['verify', '--run', run], cwd);
    assert(verified.status === 0, '短名单终选 verify 失败\n' + verified.stdout);

    const cwd2 = mkdtempSync(join(tmpdir(), 'pipe-draft-'));
    try {
      const second = initRun(cwd2, 'worlds');
      const sample = second.pool.candidates[1];
      const draftLikes = {
        schema: 'shortlist-likes/1',
        runId: 'sl-pipe',
        seen: [sample.id],
        eliminated: [{ candidateId: sample.id, reasonId: 'too-quiet' }],
        traits: [{ candidateId: sample.id, kind: 'typography', text: '窄黑体标题' }],
        likes: [],
        shortlist: [],
        passed: [],
        draft: '沿用现在的底稿',
      };
      writeFileSync(join(cwd2, 'draft-likes.json'), JSON.stringify(draftLikes), 'utf8');
      assert(runCli(['likes', '--run', second.run, '--file', 'draft-likes.json'], cwd2).status === 0, '底稿 likes 失败');
      writeFileSync(join(cwd2, 'draft-choice.json'), JSON.stringify({ schema: 'shortlist-choice/1', runId: 'sl-pipe', kind: 'draft', draft: '沿用现在的底稿' }), 'utf8');
      const drafted = runCli(['final', '--run', second.run, '--choice', 'draft-choice.json', '--ledger', join(cwd2, 'ledger.jsonl')], cwd2);
      assert(drafted.status === 0, '底稿终选失败\n' + drafted.stdout + '\n' + drafted.stderr);
      const draftResult = JSON.parse(readFileSync(join(cwd2, second.run, 'result.json'), 'utf8'));
      assert(draftResult.kind === 'draft' && draftResult.likedTraits[0].text === '窄黑体标题', '底稿终选应带上特征袋');
      const draftVerify = runCli(['verify', '--run', second.run], cwd2);
      assert(draftVerify.status === 0, '底稿 verify 失败\n' + draftVerify.stdout);
      assert(existsSync(join(cwd2, second.run, 'pool.json')), '池文件应还在');
    } finally {
      rmSync(cwd2, { recursive: true, force: true });
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log((item.ok ? '✔ ' : '✖ ') + item.name + (item.ok ? '' : '\n    ' + item.error));
console.log('\n通过 ' + (results.length - failed.length) + ' / 失败 ' + failed.length);
process.exit(failed.length === 0 ? 0 : 1);
