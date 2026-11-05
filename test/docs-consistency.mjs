// A10：工具计数与文档同源检查。运行：node test/docs-consistency.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_NAMES } from '../lib/tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
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

check('README 写明 10 个工具', () => {
  const text = read('README.md');
  assert(text.includes('10 个工具'), 'README 应出现「10 个工具」');
  assert(!text.includes('8 个工具'), 'README 不应再有「8 个工具」');
});

check('SKILL 工具表包含 TOOL_NAMES 全部 10 个工具', () => {
  const text = read('skills/design-kit/SKILL.md');
  const missing = TOOL_NAMES.filter((name) => !text.includes('`' + name + '`'));
  assert(missing.length === 0, 'SKILL 缺少工具：' + missing.join(', '));
});

check('ACCEPTANCE 不再写 8 个工具', () => {
  const text = read('test/ACCEPTANCE.md');
  assert(!text.includes('8 个工具'), 'ACCEPTANCE 仍有过时「8 个工具」');
  assert(text.includes('10 个工具'), 'ACCEPTANCE 应写「10 个工具」');
});

check('同步清单 probe-kit 计数与 sync-kit 当前口径一致（40）', () => {
  const manifest = JSON.parse(read('skills/design-kit/.sync-manifest.json'));
  assert(manifest.probeKit === 40, 'sync manifest probeKit 应为 40，实际 ' + manifest.probeKit);
});

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log((item.ok ? '✔ ' : '✖ ') + item.name + (item.ok ? '' : '\n    ' + item.error));
console.log('\n通过 ' + (results.length - failed.length) + ' / 失败 ' + failed.length);
process.exit(failed.length === 0 ? 0 : 1);
