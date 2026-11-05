/**
 * shortlist 粗选：12 张世界卡 + 受控内容渲染。
 *
 * 世界不是 12 个互不相干的风格：每个世界有 family（大传统）与 variant（同族内的派别），
 * 轮次因此有两种关系形态：
 * - lineage（同族不同派）：同一 family 的 3 个 variant，比同一门手艺里的取舍。
 * - contrast（命名对比轴的三档）：一条对比轴上各取一档，且跨至少 2 个 family，比不同传统。
 *
 * 四轴描述（material/type/layout/color）用于 axisDistance 与「同一轮至少 3 轴不同」；
 * family / variant / contrast 是关系语义层，不参与渲染。
 *
 * 视觉差异全部落在 tokens（颜色/圆角/字体栈）、layoutClass（5 个布局类之一）、
 * decor（装饰类名）与 decorCss（世界专属 CSS）上。fixtures/worlds/base.html 的
 * 内容与骨架逐字节相同，只替换占位符。
 *
 * 零依赖：只用 node:fs / node:path / node:url。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const WORLD_AXES = ['material', 'type', 'layout', 'color'];

/**
 * 命名对比轴：contrast 轮在一条轴上取 low / mid / high 各一个世界。
 * 轴 id 与档位 id 是协议值（对应 world.contrast 的键），中文 label 只用于展示。
 */
export const CONTRAST_AXES = [
  {
    id: 'ornament',
    label: '装饰密度',
    levels: [
      { id: 'low', label: '极简' },
      { id: 'mid', label: '中等' },
      { id: 'high', label: '繁复' },
    ],
  },
  {
    id: 'image',
    label: '影像参与度',
    levels: [
      { id: 'low', label: '无影像' },
      { id: 'mid', label: '图文并置' },
      { id: 'high', label: '影像主导' },
    ],
  },
];

/** base.html 里必须出现的占位符，顺序即渲染时的替换顺序。 */
export const TEMPLATE_PLACEHOLDERS = [
  'BG',
  'SURFACE',
  'INK',
  'MUTED',
  'ACCENT',
  'ACCENT_INK',
  'RULE',
  'RADIUS',
  'FONT_HEAD',
  'FONT_BODY',
  'LAYOUT_CLASS',
  'DECOR_CLASSES',
  'DECOR_CSS',
];

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, '..', 'fixtures', 'worlds', 'base.html');

let templateCache = null;

function loadTemplate() {
  if (templateCache === null) {
    templateCache = readFileSync(TEMPLATE_PATH, 'utf8');
  }
  return templateCache;
}

/**
 * 12 个世界，按 4 轮 x 3 个分组见 WORLD_ROUNDS。
 * decor 里的名字会渲染成 decor-<name> 类名，decorCss 里用 .decor-<name> 选择。
 */
export const WORLDS = [
  {
    id: 'w-swiss',
    label: '瑞士网格',
    note: '国际主义排法，网格与细线说话',
    family: 'print-tradition',
    variant: '理性网格',
    contrast: { ornament: 'low', image: 'low' },
    axes: {
      material: '哑光纸面，隐形十二列网格',
      type: '无衬线',
      layout: '网格',
      color: '克制',
    },
    tokens: {
      BG: '#e6e6e1',
      SURFACE: '#fbfbf8',
      INK: '#101010',
      MUTED: '#5f5f5a',
      ACCENT: '#e30613',
      ACCENT_INK: '#ffffff',
      RULE: '#d7d7d1',
      RADIUS: '0px',
      FONT_HEAD: '"Helvetica Neue", "Arial Narrow", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
      FONT_BODY: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    layoutClass: 'layout-grid',
    decor: ['swiss'],
    decorCss: `
body { background: var(--bg); }
.decor-swiss {
  background-color: var(--surface);
  background-image: repeating-linear-gradient(to right, rgb(16 16 16 / 0.045) 0 1px, transparent 1px 24px);
}
.decor-swiss .masthead::before { content: ''; display: block; width: 26px; height: 26px; margin-bottom: 12px; background: var(--accent); }
.decor-swiss .shop { font-size: 42px; font-weight: 700; line-height: 1; }
.decor-swiss .tagline { font-size: 12px; max-inline-size: 18em; }
.decor-swiss .item { border-top-color: var(--ink); }
.decor-swiss .num { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; }
.decor-swiss .book { font-size: 15px; font-weight: 700; }
.decor-swiss .meta { font-size: 10px; }
.decor-swiss .cta { min-height: 44px; font-size: 13px; font-weight: 700; }
.decor-swiss .foot { font-size: 9px; }
`,
  },
  {
    id: 'w-newspaper',
    label: '旧报纸',
    note: '泛黄新闻纸，报头与密排',
    family: 'print-tradition',
    variant: '旧式密排',
    contrast: { ornament: 'mid', image: 'low' },
    axes: {
      material: '泛黄新闻纸，油墨压痕',
      type: '衬线',
      layout: '编辑',
      color: '克制',
    },
    tokens: {
      BG: '#ddd2bb',
      SURFACE: '#f4eddb',
      INK: '#241f17',
      MUTED: '#5d5445',
      ACCENT: '#8a3a2c',
      ACCENT_INK: '#f7f0df',
      RULE: '#c8b898',
      RADIUS: '0px',
      FONT_HEAD: '"Songti SC", "Source Han Serif SC", "Noto Serif SC", "SimSun", "PingFang SC", serif',
      FONT_BODY: '"Songti SC", "Source Han Serif SC", "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif',
    },
    layoutClass: 'layout-editorial',
    decor: ['newsprint'],
    decorCss: `
body { background: var(--bg); }
.decor-newsprint {
  background-color: var(--surface);
  background-image:
    repeating-linear-gradient(to bottom, rgb(72 55 30 / 0.05) 0 1px, transparent 1px 3px),
    radial-gradient(120% 90% at 20% 0%, rgb(255 250 235 / 0.7), transparent 60%);
}
.decor-newsprint .masthead { border-top: 4px solid var(--ink); border-bottom: 2px solid var(--ink); padding: 10px 0 12px; }
.decor-newsprint .shop { font-size: 44px; font-weight: 700; line-height: 1.02; }
.decor-newsprint .tagline { color: var(--ink); font-size: 12px; }
.decor-newsprint .item { grid-template-columns: 18px minmax(0, 1fr); column-gap: 6px; row-gap: 0; padding: 5px 0; border-top: 1px dotted var(--rule); }
.decor-newsprint .num { align-self: start; font-size: 10px; }
.decor-newsprint .book { font-size: 14px; font-weight: 700; }
.decor-newsprint .meta { grid-column: 2; font-size: 10px; }
.decor-newsprint .cta { background: transparent; color: var(--ink); border: 1px double var(--ink); border-radius: 0; font-size: 13px; min-height: 44px; }
.decor-newsprint .foot { border-top: 1px solid var(--ink); padding-top: 8px; font-size: 9px; }
`,
  },
  {
    id: 'w-blueprint',
    label: '施工蓝图',
    note: '晒图纸、制图线与标注',
    family: 'information',
    variant: '工程图纸',
    contrast: { ornament: 'mid', image: 'low' },
    axes: {
      material: '深蓝晒图纸，白色制图线',
      type: '等宽',
      layout: '网格',
      color: '浸染',
    },
    tokens: {
      BG: '#0c2338',
      SURFACE: '#123a5c',
      INK: '#e9f2f8',
      MUTED: '#9dbad2',
      ACCENT: '#ffd43b',
      ACCENT_INK: '#12293f',
      RULE: '#3f6c94',
      RADIUS: '0px',
      FONT_HEAD: '"JetBrains Mono", "IBM Plex Mono", "Courier New", "PingFang SC", monospace',
      FONT_BODY: '"JetBrains Mono", "IBM Plex Mono", "Courier New", "PingFang SC", monospace',
    },
    layoutClass: 'layout-grid',
    decor: ['blueprint'],
    decorCss: `
body { background: var(--bg); }
.decor-blueprint {
  background-color: var(--surface);
  background-image:
    linear-gradient(to right, rgb(255 255 255 / 0.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(255 255 255 / 0.07) 1px, transparent 1px);
  background-size: 24px 24px;
  border: 1px solid var(--rule);
  box-shadow: inset 0 0 0 5px var(--surface), inset 0 0 0 6px var(--rule);
  padding: 24px 18px 16px;
}
.decor-blueprint .masthead { padding-bottom: 10px; border-bottom: 1px dashed var(--rule); }
.decor-blueprint .shop { align-self: flex-start; display: inline-block; padding: 3px 10px; border: 1px solid var(--accent); font-size: 28px; font-weight: 500; line-height: 1.2; }
.decor-blueprint .tagline { font-size: 11px; }
.decor-blueprint .item { border-top: 1px dashed var(--rule); }
.decor-blueprint .num { color: var(--accent); font-size: 10px; letter-spacing: 0.14em; }
.decor-blueprint .book { font-size: 13px; }
.decor-blueprint .meta { font-size: 9px; }
.decor-blueprint .cta { background: transparent; color: var(--accent); border: 1px solid var(--accent); border-radius: 0; font-size: 12px; min-height: 44px; }
.decor-blueprint .foot { border-top: 1px dashed var(--rule); padding-top: 8px; font-size: 9px; }
`,
  },
  {
    id: 'w-sticky',
    label: '手写便签',
    note: '便利贴、胶带与蓝墨水',
    family: 'handmade-paper',
    variant: '随手贴',
    contrast: { ornament: 'mid', image: 'low' },
    axes: {
      material: '黄色便利贴，胶带与折角',
      type: '手写',
      layout: '堆叠',
      color: '承诺',
    },
    tokens: {
      BG: '#cfc2a6',
      SURFACE: '#fff1a3',
      INK: '#2c3966',
      MUTED: '#6c5f45',
      ACCENT: '#c2185b',
      ACCENT_INK: '#fff6f9',
      RULE: '#e6d585',
      RADIUS: '2px',
      FONT_HEAD: '"Bradley Hand", "Chalkboard SE", "Kaiti SC", "KaiTi", "Comic Sans MS", cursive',
      FONT_BODY: '"Bradley Hand", "Chalkboard SE", "Kaiti SC", "KaiTi", "Comic Sans MS", cursive',
    },
    layoutClass: 'layout-stack',
    decor: ['sticky'],
    decorCss: `
body {
  background-color: var(--bg);
  background-image: repeating-linear-gradient(115deg, rgb(255 255 255 / 0.14) 0 8px, transparent 8px 22px);
}
.decor-sticky {
  min-height: calc(100% - 44px);
  margin: 22px 18px;
  padding: 34px 24px 20px;
  overflow: visible;
  transform: rotate(-1.4deg);
  border-radius: 2px;
  box-shadow: 0 14px 26px rgb(60 44 16 / 0.28);
  text-align: left;
  align-items: stretch;
  justify-content: flex-start;
  gap: 16px;
}
.decor-sticky::before {
  content: '';
  position: absolute;
  top: -13px;
  left: 50%;
  width: 92px;
  height: 26px;
  transform: translateX(-50%) rotate(2deg);
  background: rgb(255 255 255 / 0.5);
  border-left: 1px solid rgb(255 255 255 / 0.8);
  border-right: 1px solid rgb(255 255 255 / 0.8);
}
.decor-sticky .masthead { align-items: flex-start; }
.decor-sticky .shop { font-size: 36px; font-weight: 600; transform: rotate(-1deg); }
.decor-sticky .tagline { color: var(--accent); font-size: 14px; }
.decor-sticky .shelf { gap: 12px; }
.decor-sticky .item { grid-template-columns: 1.6em 1fr; justify-items: start; gap: 2px 6px; padding: 2px 0; border-top: 0; }
.decor-sticky .item:last-child { border-bottom: 0; }
.decor-sticky .num { color: var(--accent); font-size: 11px; }
.decor-sticky .book { font-size: 15px; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; text-decoration-color: rgb(194 24 91 / 0.45); }
.decor-sticky .meta { grid-column: 2; font-size: 11px; }
.decor-sticky .cta { margin-top: 6px; border-radius: 3px; font-size: 15px; font-weight: 700; }
.decor-sticky .foot { margin: 6px 0 0; font-size: 9px; }
`,
  },
  {
    id: 'w-museum',
    label: '博物馆标签',
    note: '卡纸、细框与克制的展签',
    family: 'information',
    variant: '展签说明',
    contrast: { ornament: 'low', image: 'mid' },
    axes: {
      material: '米白卡纸，凹版压边',
      type: '无衬线',
      layout: '卡片',
      color: '克制',
    },
    tokens: {
      BG: '#d5d1c7',
      SURFACE: '#f5f3ec',
      INK: '#24241f',
      MUTED: '#6f6a5e',
      ACCENT: '#3f6f5f',
      ACCENT_INK: '#f5f3ec',
      RULE: '#bdb7a8',
      RADIUS: '0px',
      FONT_HEAD: '"Gill Sans", "Optima", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
      FONT_BODY: '"Gill Sans", "Optima", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    layoutClass: 'layout-card',
    decor: ['museum'],
    decorCss: `
body { background: var(--bg); }
.decor-museum {
  padding: 34px 26px 22px;
  gap: 14px;
  border: 1px solid var(--ink);
  border-radius: 0;
  box-shadow: 0 18px 40px rgb(30 26 20 / 0.18), inset 0 0 0 7px var(--surface), inset 0 0 0 8px var(--rule);
}
.decor-museum .masthead { align-items: center; text-align: center; padding-bottom: 14px; border-bottom: 1px solid var(--rule); }
.decor-museum .shop { font-size: 26px; font-weight: 400; }
.decor-museum .tagline { max-inline-size: 19em; font-size: 12px; }
.decor-museum .shelf { gap: 14px; }
.decor-museum .item { grid-template-columns: 2.2em 1fr auto; padding: 8px 0; border-top: 1px solid var(--rule); }
.decor-museum .item:last-child { border-bottom: 1px solid var(--rule); }
.decor-museum .num { color: var(--accent); font-size: 9px; }
.decor-museum .book { font-size: 13px; font-weight: 500; }
.decor-museum .meta { font-size: 10px; }
.decor-museum .cta { background: transparent; color: var(--ink); border: 1px solid var(--ink); border-radius: 0; font-size: 11px; font-weight: 500; min-height: 44px; }
.decor-museum .foot { margin: 2px 0 0; text-align: center; font-size: 9px; }
`,
  },
  {
    id: 'w-club',
    label: '夜店海报',
    note: '黑卡纸、荧光丝印与描边大字',
    family: 'image-display',
    variant: '高能海报',
    contrast: { ornament: 'high', image: 'high' },
    axes: {
      material: '黑卡纸，荧光丝网印',
      type: '展示体',
      layout: '海报',
      color: '浸染',
    },
    tokens: {
      BG: '#070709',
      SURFACE: '#0d0d11',
      INK: '#f2f2ee',
      MUTED: '#8b8b94',
      ACCENT: '#2df2ff',
      ACCENT_INK: '#031015',
      RULE: '#2b2b33',
      RADIUS: '0px',
      FONT_HEAD: 'Impact, "Arial Black", "PingFang SC", "Microsoft YaHei", sans-serif',
      FONT_BODY: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    layoutClass: 'layout-poster',
    decor: ['club'],
    decorCss: `
body { background: var(--bg); }
.decor-club { background: var(--surface); }
.decor-club::before {
  content: '';
  position: absolute;
  top: -110px;
  right: -120px;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(45 242 255 / 0.22), transparent 62%);
}
.decor-club::after {
  content: '';
  position: absolute;
  top: 0;
  right: 16px;
  width: 24px;
  height: 150px;
  background: repeating-linear-gradient(to bottom, var(--accent) 0 3px, transparent 3px 11px);
  opacity: 0.5;
}
.decor-club .masthead { position: relative; }
.decor-club .shop { color: var(--ink); font-size: 62px; font-weight: 900; line-height: 0.92; -webkit-text-stroke: 1.5px var(--accent); }
.decor-club .tagline { color: var(--muted); font-size: 13px; }
.decor-club .item { border-top: 2px solid var(--accent); }
.decor-club .item:last-child { border-bottom: 2px solid var(--accent); }
.decor-club .num { color: var(--accent); font-size: 11px; letter-spacing: 0.16em; }
.decor-club .book { font-size: 15px; font-weight: 800; }
.decor-club .meta { font-size: 10px; }
.decor-club .cta { border-radius: 0; background: var(--accent); color: var(--accent-ink); font-size: 15px; font-weight: 900; min-height: 50px; box-shadow: 0 0 26px rgb(45 242 255 / 0.55); }
.decor-club .foot { color: var(--muted); font-size: 9px; }
`,
  },
  {
    id: 'w-kids',
    label: '儿童绘本',
    note: '水彩纸、圆角与粗描边',
    family: 'image-display',
    variant: '插画叙事',
    contrast: { ornament: 'high', image: 'mid' },
    axes: {
      material: '厚涂水彩纸，蜡笔粗边',
      type: '圆体',
      layout: '卡片',
      color: '承诺',
    },
    tokens: {
      BG: '#ffe9cc',
      SURFACE: '#fffaf0',
      INK: '#2f2d2a',
      MUTED: '#6f6257',
      ACCENT: '#d43b1e',
      ACCENT_INK: '#ffffff',
      RULE: '#f0c9a8',
      RADIUS: '26px',
      FONT_HEAD: '"Comic Sans MS", "Chalkboard SE", "Yuanti SC", "YouYuan", "PingFang SC", sans-serif',
      FONT_BODY: '"Comic Sans MS", "Chalkboard SE", "Yuanti SC", "YouYuan", "PingFang SC", sans-serif',
    },
    layoutClass: 'layout-card',
    decor: ['kids'],
    decorCss: `
body {
  background-color: var(--bg);
  background-image: radial-gradient(rgb(212 59 30 / 0.16) 1.5px, transparent 1.5px);
  background-size: 18px 18px;
}
.decor-kids {
  padding: 26px 22px 20px;
  gap: 16px;
  border: 4px solid var(--ink);
  border-radius: 28px;
  box-shadow: 0 14px 28px rgb(212 59 30 / 0.22);
}
.decor-kids .masthead { align-items: flex-start; gap: 8px; }
.decor-kids .shop { color: var(--accent); font-size: 38px; font-weight: 800; line-height: 1.1; }
.decor-kids .tagline { color: var(--ink); font-size: 14px; max-inline-size: 17em; }
.decor-kids .shelf { gap: 14px; }
.decor-kids .item { grid-template-columns: 24px 1fr auto; align-items: center; padding: 8px 0; border-top: 3px dotted var(--rule); }
.decor-kids .num { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font-size: 10px; font-weight: 700; }
.decor-kids .book { font-size: 16px; font-weight: 700; }
.decor-kids .meta { font-size: 11px; }
.decor-kids .cta { border: 3px solid var(--ink); border-radius: 999px; box-shadow: 0 6px 14px rgb(47 45 42 / 0.18); font-size: 16px; font-weight: 800; min-height: 50px; }
.decor-kids .foot { margin: 0; font-size: 9px; }
`,
  },
  {
    id: 'w-archive',
    label: '档案卡片',
    note: '牛皮索引卡、打字机与印章红',
    family: 'handmade-paper',
    variant: '索引归档',
    contrast: { ornament: 'mid', image: 'low' },
    axes: {
      material: '牛皮索引卡，打字机墨',
      type: '等宽',
      layout: '卡片',
      color: '克制',
    },
    tokens: {
      BG: '#cfc0a6',
      SURFACE: '#f2e8d4',
      INK: '#2a2620',
      MUTED: '#6a5f4f',
      ACCENT: '#a63a2b',
      ACCENT_INK: '#f8f0df',
      RULE: '#b8a88b',
      RADIUS: '0px',
      FONT_HEAD: '"Courier New", Courier, "IBM Plex Mono", "PingFang SC", monospace',
      FONT_BODY: '"Courier New", Courier, "IBM Plex Mono", "PingFang SC", monospace',
    },
    layoutClass: 'layout-card',
    decor: ['archive'],
    decorCss: `
body {
  background-color: var(--bg);
  background-image: repeating-linear-gradient(45deg, rgb(90 72 44 / 0.06) 0 2px, transparent 2px 7px);
}
.decor-archive {
  padding: 34px 22px 18px;
  gap: 14px;
  overflow: visible;
  border: 1px solid var(--ink);
  border-radius: 2px;
  box-shadow: 0 12px 26px rgb(42 38 32 / 0.18);
}
.decor-archive::before {
  content: '';
  position: absolute;
  top: -15px;
  left: 24px;
  width: 116px;
  height: 28px;
  background: var(--surface);
  border: 1px solid var(--ink);
  border-bottom: 0;
  border-radius: 3px 3px 0 0;
}
.decor-archive .masthead { padding-bottom: 8px; border-bottom: 1px solid var(--ink); }
.decor-archive .shop { font-size: 28px; font-weight: 700; }
.decor-archive .tagline { font-size: 11px; }
.decor-archive .item { padding: 5px 0; border-top: 1px dashed var(--rule); }
.decor-archive .num { color: var(--accent); font-size: 10px; letter-spacing: 0.3em; }
.decor-archive .book { font-size: 13px; font-weight: 700; }
.decor-archive .meta { font-size: 9px; }
.decor-archive .cta { background: transparent; color: var(--accent); border: 2px dashed var(--accent); border-radius: 0; font-size: 12px; font-weight: 700; min-height: 44px; }
.decor-archive .foot { margin: 0; padding-top: 6px; border-top: 1px solid var(--ink); font-size: 9px; }
`,
  },
  {
    id: 'w-ma',
    label: '日式留白',
    note: '和纸、竖排标题与朱色印',
    family: 'handmade-paper',
    variant: '克制留白',
    contrast: { ornament: 'low', image: 'low' },
    axes: {
      material: '和纸，木版墨与朱印',
      type: '衬线',
      layout: '编辑',
      color: '克制',
    },
    tokens: {
      BG: '#e7e2d6',
      SURFACE: '#f6f3ea',
      INK: '#21211d',
      MUTED: '#6b675e',
      ACCENT: '#b23a30',
      ACCENT_INK: '#f7f2e6',
      RULE: '#d9d3c4',
      RADIUS: '0px',
      FONT_HEAD: '"Songti SC", "Source Han Serif SC", "Noto Serif SC", "SimSun", serif',
      FONT_BODY: '"Songti SC", "Source Han Serif SC", "Noto Serif SC", "SimSun", serif',
    },
    layoutClass: 'layout-editorial',
    decor: ['ma'],
    decorCss: `
body { background: var(--bg); }
.decor-ma { padding: 30px 30px 16px; gap: 16px; }
.decor-ma .masthead { position: relative; display: block; min-height: 200px; padding: 0; border: 0; text-align: left; align-items: stretch; }
.decor-ma .tagline { position: absolute; top: 24px; left: 0; max-inline-size: 9em; color: var(--ink); font-size: 13px; line-height: 2; }
.decor-ma .shop { position: absolute; top: 20px; right: 6px; height: 184px; padding-left: 18px; border-left: 1px solid var(--rule); font-size: 34px; font-weight: 500; line-height: 1.15; writing-mode: vertical-rl; text-orientation: upright; }
.decor-ma .shelf { margin-top: auto; gap: 12px; padding-top: 14px; border-top: 1px solid var(--rule); }
.decor-ma .item { grid-template-columns: 1.6em 1fr auto; padding: 4px 0; border-top: 0; }
.decor-ma .item:last-child { border-bottom: 0; }
.decor-ma .num { color: var(--muted); font-size: 10px; }
.decor-ma .book { font-size: 13px; font-weight: 400; }
.decor-ma .meta { font-size: 10px; }
.decor-ma .cta { background: transparent; color: var(--ink); border: 0; border-bottom: 1px solid var(--accent); border-radius: 0; padding: 10px 2px 8px; text-align: left; font-size: 12px; min-height: 44px; }
.decor-ma .foot { margin: 0; padding-top: 10px; border-top: 1px solid var(--rule); font-size: 9px; }
.decor-ma .foot::after { content: ''; display: inline-block; width: 10px; height: 10px; margin-left: 8px; vertical-align: -1px; background: var(--accent); }
`,
  },
  {
    id: 'w-brutal',
    label: '新粗野',
    note: '荧光纸、粗黑框与硬阴影',
    family: 'print-tradition',
    variant: '粗野拼贴',
    contrast: { ornament: 'high', image: 'low' },
    axes: {
      material: '荧光纸，粗黑胶印',
      type: '展示体',
      layout: '海报',
      color: '承诺',
    },
    tokens: {
      BG: '#e8f000',
      SURFACE: '#f4ff2e',
      INK: '#050505',
      MUTED: '#1c1c1c',
      ACCENT: '#1800ff',
      ACCENT_INK: '#ffffff',
      RULE: '#050505',
      RADIUS: '0px',
      FONT_HEAD: '"Arial Black", Impact, "PingFang SC", "Microsoft YaHei", sans-serif',
      FONT_BODY: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    layoutClass: 'layout-poster',
    decor: ['brutal'],
    decorCss: `
body { background: var(--bg); }
.decor-brutal {
  min-height: calc(100% - 24px);
  margin: 12px;
  padding: 18px 16px 14px;
  gap: 0;
  border: 4px solid var(--ink);
  box-shadow: 8px 8px 0 var(--ink);
}
.decor-brutal .masthead { gap: 6px; padding: 10px 12px 12px; background: var(--ink); color: var(--surface); }
.decor-brutal .shop { color: var(--surface); font-size: 48px; font-weight: 900; line-height: 0.92; }
.decor-brutal .tagline { color: var(--surface); font-size: 11px; line-height: 1.6; }
.decor-brutal .shelf { margin-top: auto; padding-top: 12px; }
.decor-brutal .item { align-items: center; padding: 6px 0; border-top: 3px solid var(--ink); }
.decor-brutal .item:last-child { border-bottom: 3px solid var(--ink); }
.decor-brutal .num { justify-self: start; padding: 1px 5px; background: var(--accent); color: var(--accent-ink); font-size: 10px; font-weight: 700; }
.decor-brutal .book { font-size: 16px; font-weight: 800; }
.decor-brutal .meta { font-size: 10px; font-weight: 700; }
.decor-brutal .cta { margin-top: 14px; border: 4px solid var(--ink); border-radius: 0; box-shadow: 5px 5px 0 var(--ink); font-size: 17px; font-weight: 900; min-height: 52px; }
.decor-brutal .foot { margin: 10px 0 0; font-size: 9px; font-weight: 700; }
`,
  },
  {
    id: 'w-photomag',
    label: '摄影杂志',
    note: '暖褐图版、衬线大标题与图注',
    family: 'image-display',
    variant: '图版编辑',
    contrast: { ornament: 'mid', image: 'high' },
    axes: {
      material: '铜版纸，暖褐图版',
      type: '衬线',
      layout: '编辑',
      color: '承诺',
    },
    tokens: {
      BG: '#ddd2c4',
      SURFACE: '#f7f2e8',
      INK: '#1c1813',
      MUTED: '#6d6355',
      ACCENT: '#9e4423',
      ACCENT_INK: '#fbf6ec',
      RULE: '#c8bbaa',
      RADIUS: '0px',
      FONT_HEAD: '"Didot", "Bodoni MT", "Times New Roman", "Songti SC", "Source Han Serif SC", serif',
      FONT_BODY: '"Avenir Next", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    layoutClass: 'layout-editorial',
    decor: ['photomag'],
    decorCss: `
body { background: var(--bg); }
.decor-photomag { padding: 0; gap: 0; background: var(--surface); }
.decor-photomag .masthead {
  min-height: 216px;
  padding: 118px 22px 18px;
  border: 0;
  text-align: left;
  align-items: flex-start;
  background-color: #6f5843;
  background-image:
    radial-gradient(140% 90% at 18% 8%, #e0b27c 0%, #a4764e 34%, #6b4f38 62%, #3a2c22 100%),
    repeating-linear-gradient(112deg, rgb(255 255 255 / 0.05) 0 2px, transparent 2px 7px);
}
.decor-photomag .shop { color: #fbf5e8; font-size: 42px; font-weight: 700; line-height: 1.02; }
.decor-photomag .tagline { color: #f0e2cc; font-size: 11px; }
.decor-photomag .shelf { gap: 12px; padding: 16px 22px 0; }
.decor-photomag .item { padding: 6px 0; border-top: 1px solid var(--rule); }
.decor-photomag .num { color: var(--accent); font-size: 9px; letter-spacing: 0.18em; }
.decor-photomag .book { font-size: 14px; font-weight: 700; }
.decor-photomag .meta { font-size: 10px; }
.decor-photomag .cta { border: 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); border-radius: 0; background: transparent; color: var(--ink); font-size: 11px; font-weight: 600; min-height: 44px; }
.decor-photomag .foot { margin: auto 0 0; padding: 8px 22px 12px; border: 0; font-size: 9px; }
`,
  },
  {
    id: 'w-dashboard',
    label: '数据仪表',
    note: '深色面板、等宽数字与指标条',
    family: 'information',
    variant: '实时读数',
    contrast: { ornament: 'mid', image: 'low' },
    axes: {
      material: '磨砂深色面板，细网格',
      type: '等宽',
      layout: '网格',
      color: '浸染',
    },
    tokens: {
      BG: '#0b1014',
      SURFACE: '#121a20',
      INK: '#e7eef2',
      MUTED: '#8ba0ab',
      ACCENT: '#3ddc97',
      ACCENT_INK: '#06251b',
      RULE: '#22313a',
      RADIUS: '6px',
      FONT_HEAD: '"IBM Plex Mono", "JetBrains Mono", "SFMono-Regular", "Courier New", "PingFang SC", monospace',
      FONT_BODY: '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    },
    layoutClass: 'layout-grid',
    decor: ['dashboard'],
    decorCss: `
body {
  background-color: var(--bg);
  background-image: radial-gradient(120% 80% at 80% 0%, rgb(61 220 151 / 0.08), transparent 60%);
}
.decor-dashboard {
  min-height: calc(100% - 20px);
  margin: 10px;
  padding: 16px;
  gap: 12px;
  border: 1px solid var(--rule);
  border-radius: 12px;
  background-color: var(--surface);
  background-image:
    linear-gradient(to right, rgb(255 255 255 / 0.035) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(255 255 255 / 0.035) 1px, transparent 1px);
  background-size: 20px 20px;
}
.decor-dashboard .masthead { padding: 10px 12px; border: 1px solid var(--rule); border-radius: 8px; background: rgb(255 255 255 / 0.025); }
.decor-dashboard .shop { font-size: 25px; font-weight: 600; line-height: 1.2; }
.decor-dashboard .tagline { font-size: 11px; }
.decor-dashboard .shelf { padding-top: 2px; }
.decor-dashboard .item { position: relative; padding: 9px 0 10px; border-top: 1px solid var(--rule); }
.decor-dashboard .item::after { content: ''; position: absolute; left: 0; bottom: -1px; height: 2px; background: var(--accent); opacity: 0.75; }
.decor-dashboard .item:nth-child(1)::after { width: 64%; }
.decor-dashboard .item:nth-child(2)::after { width: 38%; }
.decor-dashboard .item:nth-child(3)::after { width: 81%; }
.decor-dashboard .num { color: var(--accent); font-family: var(--font-head); font-size: 10px; letter-spacing: 0.1em; }
.decor-dashboard .book { font-size: 13px; }
.decor-dashboard .meta { font-family: var(--font-head); font-size: 9px; }
.decor-dashboard .cta { width: 100%; border-radius: 6px; font-family: var(--font-head); font-size: 12px; font-weight: 700; min-height: 44px; }
.decor-dashboard .foot { font-family: var(--font-head); font-size: 9px; }
`,
  },
];

/**
 * 4 个大传统（family），每个 3 个同族派别（variant）。
 * variants 与 worldIds 按相同顺序对应；world.family / world.variant 必须与这里一致。
 */
export const WORLD_FAMILIES = [
  {
    id: 'print-tradition',
    label: '印刷传统',
    variants: ['理性网格', '旧式密排', '粗野拼贴'],
    worldIds: ['w-swiss', 'w-newspaper', 'w-brutal'],
  },
  {
    id: 'handmade-paper',
    label: '手作纸品',
    variants: ['随手贴', '索引归档', '克制留白'],
    worldIds: ['w-sticky', 'w-archive', 'w-ma'],
  },
  {
    id: 'image-display',
    label: '图像展示',
    variants: ['图版编辑', '高能海报', '插画叙事'],
    worldIds: ['w-photomag', 'w-club', 'w-kids'],
  },
  {
    id: 'information',
    label: '信息呈现',
    variants: ['工程图纸', '实时读数', '展签说明'],
    worldIds: ['w-blueprint', 'w-dashboard', 'w-museum'],
  },
];

/**
 * 4 轮 × 3 个候选：前两轮同族不同派（lineage），后两轮各取一条命名对比轴（contrast）。
 * 每轮内四轴两两最多 1 个轴相同（至少 3 轴不同）；12 个世界各出现一次。
 */
export const WORLD_ROUNDS = [
  ['w-swiss', 'w-newspaper', 'w-brutal'],
  ['w-sticky', 'w-archive', 'w-ma'],
  ['w-museum', 'w-blueprint', 'w-club'],
  ['w-dashboard', 'w-kids', 'w-photomag'],
];

/** 每轮的关系形态。family / axis 都是协议字符串，与 world.family、world.contrast 的键一致。 */
const ROUND_RELATIONS = [
  { relation: 'lineage', family: 'print-tradition' },
  { relation: 'lineage', family: 'handmade-paper' },
  { relation: 'contrast', axis: 'ornament' },
  { relation: 'contrast', axis: 'image' },
];

/**
 * 取第 roundIndex（1-based）轮的生成计划。
 * lineage 轮返回 { relation: 'lineage', family, familyLabel, worlds }；
 * contrast 轮返回 { relation: 'contrast', axis, axisLabel, worlds }。
 * family / axis 是协议字符串，与 world.family、world.contrast 的键一致。
 */
export function roundPlan(roundIndex) {
  if (!Number.isInteger(roundIndex) || roundIndex < 1 || roundIndex > WORLD_ROUNDS.length) {
    throw new RangeError(`roundPlan 的轮次必须是 1 到 ${WORLD_ROUNDS.length} 的整数，收到 ${String(roundIndex)}`);
  }
  const meta = ROUND_RELATIONS[roundIndex - 1];
  const worlds = WORLD_ROUNDS[roundIndex - 1].map((id) => getWorld(id));
  if (meta.relation === 'lineage') {
    const family = WORLD_FAMILIES.find((item) => item.id === meta.family);
    if (!family) throw new Error(`第 ${roundIndex} 轮引用了未知 family：${meta.family}`);
    return { relation: 'lineage', family: family.id, familyLabel: family.label, worlds };
  }
  const axis = CONTRAST_AXES.find((item) => item.id === meta.axis);
  if (!axis) throw new Error(`第 ${roundIndex} 轮引用了未知对比轴：${meta.axis}`);
  return { relation: 'contrast', axis: axis.id, axisLabel: axis.label, worlds };
}

const WORLD_BY_ID = new Map(WORLDS.map((world) => [world.id, world]));

/** 按 id 取世界；找不到时抛中文错误。 */
export function getWorld(id) {
  const world = WORLD_BY_ID.get(id);
  if (!world) throw new Error(`未知世界 id：${String(id)}`);
  return world;
}

function unwrapWorld(value) {
  if (value && typeof value === 'object' && value.world && typeof value.world === 'object' && !value.tokens && !value.axes) {
    return value.world;
  }
  return value;
}

function asAxes(worldOrAxes, label) {
  const item = unwrapWorld(worldOrAxes);
  if (!item || typeof item !== 'object') {
    throw new Error(`${label} 需要一个世界对象或轴对象`);
  }
  const axes = item.axes && typeof item.axes === 'object'
    ? item.axes
    : item;
  return axes;
}

/**
 * 两个世界（或轴对象）在 4 个轴上相同的数量，0 到 4。
 * 4 表示完全同一世界；0 表示四轴全不同。
 */
export function axisDistance(a, b) {
  const axesA = asAxes(a, 'axisDistance 的第一个参数');
  const axesB = asAxes(b, 'axisDistance 的第二个参数');
  let same = 0;
  for (const axis of WORLD_AXES) {
    if (axesA[axis] === axesB[axis]) same += 1;
  }
  return same;
}

/**
 * 校验一轮的 3 个世界两两至少 3 轴不同。
 * 参数可以是世界对象，也可以是 WORLD_ROUNDS 里的 id 数组。不满足时抛中文错误。
 */
export function assertRoundDiversity(roundWorlds) {
  if (!Array.isArray(roundWorlds) || roundWorlds.length !== 3) {
    throw new Error('assertRoundDiversity 需要一轮 3 个世界（对象或 id）');
  }
  const worlds = roundWorlds.map((item, index) => {
    if (typeof item === 'string') return getWorld(item);
    const world = unwrapWorld(item);
    if (!world || typeof world !== 'object' || !world.axes) {
      throw new Error(`本轮第 ${index + 1} 个候选不是世界对象`);
    }
    return world;
  });
  for (let i = 0; i < worlds.length; i += 1) {
    for (let j = i + 1; j < worlds.length; j += 1) {
      const sameAxes = WORLD_AXES.filter((axis) => worlds[i].axes[axis] === worlds[j].axes[axis]);
      const required = WORLD_AXES.length - 1;
      if (sameAxes.length > required) {
        throw new Error(
          `同一轮的世界「${worlds[i].label ?? worlds[i].id}」与「${worlds[j].label ?? worlds[j].id}」` +
          `有 ${sameAxes.length} 个轴相同（${sameAxes.join('、')}），` +
          `要求两两至少 3 轴不同（最多 1 轴相同）`,
        );
      }
    }
  }
  return true;
}

/** 把一个世界渲染成完整 HTML 字符串：只替换 base.html 的占位符，无随机、无外部资源。 */
export function renderCandidate(worldInput) {
  const world = unwrapWorld(worldInput);
  if (!world || typeof world !== 'object') {
    throw new Error('renderCandidate 需要一个世界对象');
  }
  const tokens = world.tokens && typeof world.tokens === 'object' ? world.tokens : {};
  const decorClasses = (world.decor ?? []).map((name) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error(`世界 ${world.id ?? '?'} 的 decor 名字不合法`);
    return `decor-${name.trim()}`;
  }).join(' ');
  const values = {
    ...tokens,
    LAYOUT_CLASS: world.layoutClass,
    DECOR_CLASSES: decorClasses,
    DECOR_CSS: world.decorCss ?? '',
  };

  let html = loadTemplate();
  for (const key of TEMPLATE_PLACEHOLDERS) {
    const value = values[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`世界 ${world.id ?? '?'} 缺少 ${key} 的取值`);
    }
    html = html.split(`{{${key}}}`).join(value);
  }
  if (html.includes('{{')) {
    throw new Error(`世界 ${world.id ?? '?'} 渲染后仍有未替换的占位符`);
  }
  return html;
}
