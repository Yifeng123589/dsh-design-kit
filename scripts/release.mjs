// 发布物矩阵：runtime / fixtures / docs。仓库根即插件包根目录。
// 运行：node scripts/release.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const py = String.raw`
import os, zipfile, sys, json

root, dist, version = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(dist, exist_ok=True)
PKG = "dsh-design-kit"

def rels(rel_base, exclude_dirs=()):
    base = os.path.join(root, rel_base)
    out = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in exclude_dirs and not d.startswith(".tmp"))
        for name in sorted(filenames):
            out.append(os.path.relpath(os.path.join(dirpath, name), root).replace(os.sep, "/"))
    return out

def write_zip(path, rel_files, extra_text=None):
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in rel_files:
            zf.write(os.path.join(root, rel), PKG + "/" + rel)
        for arc, text in (extra_text or {}).items():
            zf.writestr(arc, text)
    return os.path.getsize(path)

runtime = [
    "package.json", "cordis.patch.yml", "README.md", "LICENSE",
    "skills/design-kit/SKILL.md", "skills/design-kit/.sync-manifest.json",
]
runtime += rels("lib")
for base in ["skills/design-kit/references", "skills/design-kit/deck", "skills/design-kit/ui-craft"]:
    runtime += rels(base)
for base in ["skills/design-kit/probe-kit/lib", "skills/design-kit/probe-kit/templates", "skills/design-kit/probe-kit/fixtures"]:
    runtime += rels(base)
for name in ["probe.mjs", "shortlist.mjs"]:
    runtime.append("skills/design-kit/probe-kit/" + name)
for name in os.listdir(os.path.join(root, "skills/design-kit/probe-kit")):
    if name.endswith(".md"):
        runtime.append("skills/design-kit/probe-kit/" + name)
runtime = sorted(set(runtime))
runtime_size = write_zip(os.path.join(dist, "dsh-design-kit-runtime-v" + version + ".zip"), runtime)
compat_size = write_zip(os.path.join(dist, "dsh-design-kit-v" + version + ".zip"), runtime)

fixtures = rels("test/fixtures") + rels("skills/design-kit/probe-kit/test")
for rel in ["test/apply.mock.mjs", "test/shortlist-ui-contract.test.mjs", "test/generate-round.test.mjs", "test/docs-consistency.mjs", "test/release-check.mjs"]:
    if os.path.exists(os.path.join(root, rel)):
        fixtures.append(rel)
fixtures_readme = """# dsh-design-kit fixtures

证据/测试包，不是运行时插件。

解压到插件根目录（与 lib/、skills/ 同级），或在仓库内直接运行：
  npm test
  node test/shortlist-ui-contract.test.mjs
  node skills/design-kit/probe-kit/test/smoke.mjs
  node skills/design-kit/probe-kit/test/regression.test.mjs
  node skills/design-kit/probe-kit/test/axis-lock.test.mjs
"""
fixtures_size = write_zip(
    os.path.join(dist, "dsh-design-kit-fixtures-v" + version + ".zip"),
    sorted(set(fixtures)),
    {"dsh-design-kit/FIXTURES-README.md": fixtures_readme},
)

docs = ["README.md", "skills/design-kit/SKILL.md", "test/ACCEPTANCE.md"]
docs += ["test/" + name for name in sorted(os.listdir(os.path.join(root, "test"))) if name.startswith("qa-") and name.endswith(".md")]
for name in ["PROTOCOL-V0.2.md", "REAL-RUN.md", "REVIEW-SUGGESTIONS.md", "SHORTLIST-SPEC.md", "SPEC.md", "README.md"]:
    rel = "skills/design-kit/probe-kit/" + name
    if os.path.exists(os.path.join(root, rel)):
        docs.append(rel)
docs += rels("skills/design-kit/references")
for rel in ["docs/INSTALL.md", "docs/TESTING.md", "docs/README-FULL.md", "CHANGELOG.md"]:
    if os.path.exists(os.path.join(root, rel)):
        docs.append(rel)
docs_readme = """# dsh-design-kit docs

验收记录、QA 报告、粗选/精调协议与参考。运行时只需要 runtime 包。
"""
docs_size = write_zip(
    os.path.join(dist, "dsh-design-kit-docs-v" + version + ".zip"),
    docs,
    {"dsh-design-kit-docs/README-DOCS.md": docs_readme},
)

with open(os.path.join(dist, "_release.json"), "w", encoding="utf8") as fh:
    json.dump({"runtime": runtime_size, "compat": compat_size, "fixtures": fixtures_size, "docs": docs_size,
               "runtimeFiles": len(runtime), "fixtureEntries": len(fixtures), "docEntries": len(docs)}, fh)
`;

const python = process.platform === 'win32' ? 'python' : 'python3';
execFileSync(python, ['-c', py, root, dist, version], { stdio: 'inherit' });
const result = JSON.parse(readFileSync(join(dist, '_release.json'), 'utf8'));
rmSync(join(dist, '_release.json'), { force: true });

const artifacts = [
  { file: `dsh-design-kit-runtime-v${version}.zip`, use: '运行时：技能 + 10 工具 + 客户端；不含测试/证据/QA', bytes: result.runtime },
  { file: `dsh-design-kit-fixtures-v${version}.zip`, use: '测试与证据：真实回合夹具、回归/契约测试', bytes: result.fixtures },
  { file: `dsh-design-kit-docs-v${version}.zip`, use: '文档：验收、QA、粗选/精调协议与参考', bytes: result.docs },
];
const lines = [`# dsh-design-kit 发布物矩阵（${version}）`, '', '| 文件 | 用途 | 字节 |', '|---|---|---:|'];
for (const item of artifacts) lines.push(`| ${item.file} | ${item.use} | ${item.bytes} |`);
lines.push('', '安装只用 runtime；fixtures/docs 是复核材料，不要装进 DSH。', '', 'SHA-256：', '');
const sums = [];
for (const item of artifacts) {
  const hash = createHash('sha256').update(readFileSync(join(dist, item.file))).digest('hex');
  sums.push(`${hash}  ${item.file}`);
  lines.push(`- \`${hash}\`  ${item.file}`);
}
lines.push('', `兼容旧文件名：\`dsh-design-kit-v${version}.zip\` 与 runtime 内容相同。`);
writeFileSync(join(dist, 'RELEASE-README.md'), lines.join('\n') + '\n', 'utf8');
writeFileSync(join(dist, 'SHA256SUMS.txt'), sums.join('\n') + '\n', 'utf8');
console.log(JSON.stringify(result, null, 2));
