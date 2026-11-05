// 模拟一次指认：读取回合清单，按脚本指定的位置生成一条合法 answer.jsonl。
// 明确标注为模拟数据，用于自测与演示；真实使用请在浏览器里点。
//
// 用法：
//   node examples/simulate-answer.mjs --run runs/r4-demo-1 --pos 2 --out /tmp/answer.jsonl
//   node examples/simulate-answer.mjs --run runs/r4-demo-1 --between 1,3 --confidence 2 --flips 1 --out /tmp/answer.jsonl
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createSession } from '../lib/recorder.mjs';

const argv = process.argv.slice(2);
function flag(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

const runDir = flag('run');
if (!runDir) {
  console.error('用法：node examples/simulate-answer.mjs --run <回合目录> [--pos 1..N | --between a,b] --out <answer.jsonl>');
  process.exit(2);
}
const out = flag('out');
if (!out) {
  console.error('缺少 --out');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(resolve(runDir), 'run.json'), 'utf8'));
const count = manifest.variants.length;
const confidence = Number(flag('confidence') ?? 3);
const flips = Number(flag('flips') ?? 0);

const session = createSession({ runId: manifest.runId, positionCount: count, sessionId: 'simulated' });
session.setEnvironment({ viewport: { w: 1440, h: 900 }, lang: 'zh-CN', reducedMotion: false });

const between = flag('between');
const firstPos = Number(flag('pos') ?? 2);
if (!Number.isInteger(firstPos) || firstPos < 1 || firstPos > count) {
  console.error(`--pos 需要 1..${count} 的整数`);
  process.exit(2);
}
const alternate = firstPos === count ? 1 : firstPos + 1;
if (between) {
  const [a, b] = between.split(',').map(Number);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    console.error('--between 需要两个不同的位置，例如 1,3');
    process.exit(2);
  }
  for (let i = 0; i < flips; i++) session.choose(i % 2 === 0 ? alternate : a);
  session.chooseBetween(a, b);
} else {
  for (let i = 0; i < flips; i++) session.choose(i % 2 === 0 ? alternate : firstPos);
  session.choose(firstPos);
}
session.setConfidence(confidence);
const record = session.lock();
writeFileSync(resolve(out), JSON.stringify(record) + '\n', 'utf8');
console.log(`已生成模拟指认：${out}`);
console.log(`  runId=${record.runId} · kind=${record.answer.kind} · 翻转 ${record.flips} · 把握 ${record.confidence}`);
console.log('  注意：这是脚本模拟，不是真人在呈现器里的真实指认。');
