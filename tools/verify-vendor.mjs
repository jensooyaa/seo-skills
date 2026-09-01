/**
 * 打包自检：确认 lib/vendor/ 下的 bundle 在平台上真的能用。
 *
 * ⚠️ 关键：自检必须在**没有 node_modules 的目录**里跑。
 *
 * 只要 bundle 里还留着任何一处 `require("某个没打进来的包")`，本地都发现不了 ——
 * 那些包就躺在仓库的 node_modules 里（是 cheerio 的依赖），在仓库里 require 一定过；
 * 平台上它们不存在，只要有一条被求值就是 MODULE_NOT_FOUND。
 *
 * 这不是假想的风险：最早 build.mjs 用 esbuild 的 external 处理这几个包，仓库里跑得
 * 好好的，搬到这个沙箱里立刻 `Cannot find module 'encoding-sniffer'` —— cheerio 是在
 * **顶层** require 它的，bundle 连加载都过不去。改成 alias 到桩才真正解决。
 *
 * 所以这里把 bundle 复制到系统临时目录（往上没有任何 node_modules）再 require，
 * 复现平台的环境。本地绿而平台红的情况就是这么来的。
 */

import { mkdtemp, copyFile, rm, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'seo-doctor', 'lib', 'vendor');

/** 每个 bundle 一组冒烟断言。用的都是检测规则真正会走的 API，不是随便调一下。 */
const SUITES = {
  'cheerio.js': async (mod) => {
    const { load } = mod;
    assert(typeof load === 'function', 'load 应当是函数');

    // 刁钻一点：未闭合标签、无引号属性、大小写混写、实体
    const $ = load(`
      <html lang=zh-CN><head><title>标题 &amp; 副标题</title>
      <meta name="description" content="摘要">
      <link rel=canonical href="https://a.com/p">
      </head><body>
      <NAV><a href="/x">首页</a></NAV>
      <main><h1>正文标题</h1><p>段落
      <img src="a.png"><img src="b.png" alt="有 alt">
      </main></body></html>`);

    // 选择器 + 属性
    assert($('html').attr('lang') === 'zh-CN', 'lang 应为 zh-CN');
    assert($('title').text() === '标题 & 副标题', '实体应被解码，实得：' + $('title').text());
    assert($('meta[name="description"]').attr('content') === '摘要', 'description 取值');
    assert($('link[rel="canonical"]').attr('href') === 'https://a.com/p', 'canonical 取值');

    // 大小写不敏感 + 后代选择器（这两条是语义化规则的主力用法）
    assert($('nav').length === 1, '<NAV> 应能被 nav 选中');
    assert($('main h1').length === 1, '后代选择器 main h1');

    // 属性存在性筛选 —— img 缺 alt 这条规则就靠它
    assert($('img').length === 2, 'img 总数');
    assert($('img:not([alt])').length === 1, ':not([alt]) 应筛出 1 张');

    // 建树 + 祖先查询：这正是换 cheerio 的理由，token 流做不到
    assert($('a').closest('nav').length === 1, 'closest 能向上找到 nav');

    // 未闭合的 <p> 不应吞掉后面的内容
    assert($('img').first().parents('main').length === 1, '未闭合 p 之后的 img 仍在 main 内');

    /**
     * ⭐ 这条钉的是「打进去的是 parse5，不是 htmlparser2」。
     * HTML5 规范要求给 <table><tr> 补出隐式的 <tbody>，parse5 会补，htmlparser2 不会。
     * 万一将来有人为了省体积把入口换成 cheerio/slim，建树纠错就没了，这里会红。
     */
    const $t = load('<table><tr><td>x</td></tr></table>');
    assert($t('table tbody').length === 1, 'parse5 应补出隐式 tbody（换成 slim 会丢）');

    // 桩被误调时要报能看懂的话，而不是 undefined is not a constructor。
    // fromURL 是 async，桩的抛出会变成 rejected promise，必须 await 才接得住
    let stubMsg = '';
    try {
      await mod.fromURL('https://example.com');
    } catch (e) {
      stubMsg = e.message;
    }
    assert(stubMsg.includes('被替换成了桩'), 'fromURL 应抛出说明桩的错误，实得：' + stubMsg);
  },

  'fast-xml-parser.js': (mod) => {
    const { XMLParser } = mod;
    assert(typeof XMLParser === 'function', 'XMLParser 应当是构造函数');
    const p = new XMLParser({ ignoreAttributes: false });
    const r = p.parse(
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
         <url><loc><![CDATA[https://a.com/1]]></loc></url>
         <url><loc>https://a.com/2</loc></url>
       </urlset>`
    );
    assert(r.urlset.url.length === 2, 'urlset 应解析出 2 条');
    assert(r.urlset.url[0].loc === 'https://a.com/1', 'CDATA 应被解开');
  },

  'papaparse.js': (mod) => {
    const parse = mod.parse || mod.default?.parse;
    assert(typeof parse === 'function', 'parse 应当是函数');
    // 带引号字段里的逗号和转义引号 —— GSC 导出的查询词里真的会有
    const r = parse('a,b\n"含,逗号","含""引号"""', { header: true });
    assert(r.data[0].a === '含,逗号', '引号内的逗号');
    assert(r.data[0].b === '含"引号"', '"" 转义');
  },
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const present = [];
for (const file of Object.keys(SUITES)) {
  if (await exists(path.join(VENDOR, file))) present.push(file);
}

if (present.length === 0) {
  console.error('lib/vendor/ 下没有任何 bundle，先跑 npm run build。');
  process.exit(1);
}

// 系统临时目录，往上找不到任何 node_modules —— 复现平台环境
const sandbox = await mkdtemp(path.join(tmpdir(), 'seo-doctor-verify-'));
const require = createRequire(path.join(sandbox, 'noop.cjs'));

console.log(`\n自检 → ${sandbox}（无 node_modules，复现平台环境）`);

let failed = 0;
try {
  for (const file of present) {
    const dest = path.join(sandbox, file);
    await copyFile(path.join(VENDOR, file), dest);
    try {
      const mod = require(dest);
      await SUITES[file](mod);
      console.log(`  ✓ ${file}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${file}`);
      console.log(`      ${err.message}`);
      if (err.code === 'MODULE_NOT_FOUND') {
        console.log('      ← bundle 里有没打进来的包被求值了。要么在 build.mjs 里让它');
        console.log('        真正打进 bundle，要么 alias 到 tools/vendor-stubs/ 下的桩。');
      }
    } finally {
      await rm(dest, { force: true });
    }
  }
} finally {
  await rm(sandbox, { recursive: true, force: true });
}

console.log('');
if (failed) {
  console.error(`${failed} 个 bundle 自检未通过。`);
  process.exit(1);
}
