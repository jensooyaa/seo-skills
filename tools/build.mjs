/**
 * 把三方库用 esbuild 打成单文件，输出到 seo-doctor/lib/vendor/。
 *
 * 为什么必须打包 —— 平台导入流程是「先 npm install，再扫描整个目录」，扫描有
 * 500 文件硬上限。声明一个 cheerio 依赖会装出 1232 个文件，直接 scan_failed，
 * 这是导入失败、不是可确认的风险。打包后 seo-doctor/package.json 不声明任何
 * dependencies，平台无从安装，文件数恒定。
 *
 * 用法：
 *   node tools/build.mjs            只打默认集（当前只有 cheerio）
 *   node tools/build.mjs papaparse  按名字打指定的
 *   node tools/build.mjs --all      全打
 */

import { build } from 'esbuild';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'seo-doctor', 'lib', 'vendor');

const STUBS = path.join(ROOT, 'tools', 'vendor-stubs');

/**
 * undici 与 encoding-sniffer 只服务 cheerio 的 fromURL() / loadBuffer() —— 它自己
 * 发请求、自己猜字节流编码。我们走的是「自己 fetch 拿到 HTML 字符串，再喂给
 * cheerio.load()」这条路径，一行都用不到。它俩又是体积大头（不换掉 1454 KB）。
 *
 * ⚠️ 换掉的方式是 alias 到桩，**不是 external**。
 * external 会在 bundle 里留下 `require("undici")`，而 cheerio 是在**顶层** require
 * 它们的 —— 本地 node_modules 里有（是 cheerio 的依赖）所以怎么试都绿，平台上没有，
 * bundle 连 require 都过不去。这个坑由 verify-vendor.mjs 在无 node_modules 的临时
 * 目录里复现平台环境钉住。
 *
 * 也不该改用 cheerio/slim 来躲开它们：slim 同时把 parse5 换成 htmlparser2，丢掉
 * HTML5 建树纠错，而那正是我们放弃自写 tokenizer 换 cheerio 的理由。
 */
const CHEERIO_ALIAS = {
  undici: path.join(STUBS, 'undici.cjs'),
  'encoding-sniffer': path.join(STUBS, 'encoding-sniffer.cjs'),
};

const TARGETS = {
  cheerio: {
    entry: 'cheerio',
    outfile: 'cheerio.js',
    alias: CHEERIO_ALIAS,
    // 体积护栏：桩没生效时体积会翻几倍，这里直接失败而不是默默变大
    maxKB: 500,
    // 打完自检要用：从 bundle 里取出来必须存在的导出
    exports: ['load'],
    default: true,
  },
  'fast-xml-parser': {
    entry: 'fast-xml-parser',
    outfile: 'fast-xml-parser.js',
    alias: {},
    maxKB: 120,
    exports: ['XMLParser'],
    default: false, // M3 做可选的 sitemap 对比时再打
  },
  papaparse: {
    entry: 'papaparse',
    outfile: 'papaparse.js',
    alias: {},
    maxKB: 60,
    exports: ['parse'],
    default: false, // M5 读 GSC 导出的 CSV 时再打
  },
};

function pickTargets(argv) {
  if (argv.includes('--all')) return Object.keys(TARGETS);
  const named = argv.filter((a) => !a.startsWith('--'));
  if (named.length === 0) {
    return Object.keys(TARGETS).filter((k) => TARGETS[k].default);
  }
  for (const n of named) {
    if (!TARGETS[n]) {
      console.error(`未知的打包目标：${n}`);
      console.error(`可选：${Object.keys(TARGETS).join(' / ')}`);
      process.exit(2);
    }
  }
  return named;
}

async function buildOne(name) {
  const t = TARGETS[name];
  const outfile = path.join(OUT_DIR, t.outfile);

  await build({
    entryPoints: [t.entry],
    outfile,
    bundle: true,
    // run.js 与 lib/ 全是 CommonJS（seo-doctor/package.json 没有 "type"）
    format: 'cjs',
    platform: 'node',
    // 平台是 Node v22.16.0，本地可能更高，按平台的来
    target: 'node22',
    alias: t.alias,
    /**
     * ⚠️ minify 是硬约束，不要为了「提高可分析性」关掉。
     * 实测：压缩后 5 条告警最高 HIGH，cheerio 内部 0 命中；不压缩 24 条最高
     * CRITICAL，内部 20 命中 —— 摊开成源码后几万行第三方代码会撞上扫描器的
     * `compile(`（css-select 编译选择器）和 `fetch(`（htmlparser2 里 RSS 解析
     * 的局部函数名）这类纯正则，全是名字撞车的误报。
     * 而 LOW_ANALYZABILITY 那条 HIGH 压不压缩都消不掉，不压缩纯亏。
     */
    minify: true,
    legalComments: 'none',
    absWorkingDir: ROOT,
    logLevel: 'warning',
  });

  const kb = (await stat(outfile)).size / 1024;
  const over = kb > t.maxKB;
  console.log(
    `  ${over ? '✗' : '✓'} ${t.outfile.padEnd(22)} ${kb.toFixed(0).padStart(4)} KB` +
      (Object.keys(t.alias).length
        ? `   桩: ${Object.keys(t.alias).join(', ')}`
        : '') +
      (over ? `   ← 超出护栏 ${t.maxKB} KB` : '')
  );
  return { name, kb, over };
}

const targets = pickTargets(process.argv.slice(2));

await mkdir(OUT_DIR, { recursive: true });
// vendor/ 是构建产物，不该有人手改它。放个说明，免得后来人（包括我自己）去编辑它
await writeFile(
  path.join(OUT_DIR, 'README.md'),
  [
    '# lib/vendor/',
    '',
    '这个目录下的 `.js` 全部是 `tools/build.mjs` 用 esbuild 生成的**构建产物**，',
    '不要手改 —— 下一次 `npm run build` 会原样覆盖。',
    '',
    '之所以把三方库打成单文件提交，是因为 FocusWork 导入时先 `npm install` 再扫描，',
    '扫描有 500 文件硬上限；声明依赖会装出上千个文件直接导入失败。',
    '所以 `seo-doctor/package.json` 永远不声明 `dependencies`。',
    '',
    '要改版本，改仓库根的 `devDependencies` 后重新 `npm run build`。',
    '',
  ].join('\n')
);

console.log(`\n打包 → seo-doctor/lib/vendor/`);
const results = [];
for (const name of targets) results.push(await buildOne(name));

const total = results.reduce((s, r) => s + r.kb, 0);
console.log(`  ${''.padEnd(24)}${total.toFixed(0).padStart(4)} KB  合计\n`);

if (results.some((r) => r.over)) {
  console.error('有 bundle 超出体积护栏，多半是 CHEERIO_ALIAS 的桩没生效。');
  process.exit(1);
}
