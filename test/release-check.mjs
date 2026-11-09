// B10：发布物矩阵自检。运行：node test/release-check.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const candidates = [join(HERE, '..', 'dist'), join(HERE, '..', '..', 'dist')];
const DIST = candidates.find((dir) => existsSync(dir)) ?? candidates[0];
const VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;
const artifact = (kind) => `dsh-design-kit-${kind}-v${VERSION}.zip`;

/** 极简 ZIP 中央目录读取：只取文件名，避免沙箱里 spawn 外部解压工具。 */
function listZip(file) {
  const buffer = readFileSync(join(DIST, file));
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是有效 ZIP：' + file);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 中央目录损坏：' + file);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

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

check('runtime 包存在且不含测试/证据/QA', () => {
  const names = listZip(artifact('runtime'));
  assert(names.length > 30, 'runtime 文件太少：' + names.length);
  assert(names.every((name) => !name.includes('/test/')), 'runtime 不应包含 test/');
  assert(names.every((name) => !name.includes('/runs-real/')), 'runtime 不应包含 runs-real/');
  assert(names.every((name) => !name.includes('/ledger/')), 'runtime 不应包含 ledger/');
  assert(names.every((name) => !name.includes('/qa-')), 'runtime 不应包含 QA 报告');
  assert(names.some((name) => name.endsWith('/lib/index.js')), 'runtime 应包含 lib/index.js');
  assert(names.some((name) => name.endsWith('/lib/client.js')), 'runtime 应包含 client.js');
});

check('source 包含 test/scripts/CHANGELOG，可直接做二次开发', () => {
  const names = listZip(artifact('source'));
  assert(names.some((name) => name.endsWith('/test/apply.mock.mjs')), 'source 应包含 test/');
  assert(names.some((name) => name.endsWith('/scripts/release.mjs')), 'source 应包含 scripts/');
  assert(names.some((name) => name.endsWith('CHANGELOG.md')), 'source 应包含 CHANGELOG.md');
  assert(names.some((name) => name.endsWith('/skills/design-kit/SKILL.md')), 'source 应包含技能');
  assert(names.some((name) => name.endsWith('/package.json')), 'source 应包含 package.json');
});

check('fixtures 包含测试与真实回合夹具，docs 包含验收/QA/协议', () => {
  const fixtures = listZip(artifact('fixtures'));
  assert(fixtures.some((name) => name.endsWith('test/apply.mock.mjs')), 'fixtures 应包含 mock 测试');
  assert(fixtures.some((name) => name.includes('real-runs/')), 'fixtures 应包含真实回合证据');
  assert(fixtures.some((name) => name.endsWith('axis-lock.test.mjs')), 'fixtures 应包含 axis-lock 测试');
  const docs = listZip(artifact('docs'));
  assert(docs.some((name) => name.endsWith('ACCEPTANCE.md')), 'docs 应包含验收记录');
  assert(docs.some((name) => name.includes('qa-')), 'docs 应包含 QA 报告');
  assert(docs.some((name) => name.endsWith('PROTOCOL-V0.2.md')), 'docs 应包含协议');
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log((item.ok ? '✔ ' : '✖ ') + item.name + (item.ok ? '' : '\n    ' + item.error));
console.log(`\n通过 ${results.length - failed.length} / 失败 ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
