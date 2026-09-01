/**
 * seo-doctor · 打包链验证版
 *
 * 这一版还不做 SEO 检测，只回答一个问题：
 *
 *   **esbuild 打出来的 cheerio 单文件，在平台上真的加载得了、用得了吗？**
 *
 * 为什么非得在平台上跑一遍才算数：bundle 里只要还留着一处「没打进来的包」的
 * require，在开发仓库里是发现不了的 —— 那些包就躺在仓库的 node_modules 里
 * （都是 cheerio 的依赖），怎么试都是绿的；而平台的 skill 目录没有 node_modules。
 * 这个坑真踩过：最初用 esbuild 的 external 处理 undici / encoding-sniffer，
 * 本地全绿，换到无 node_modules 的环境立刻 `Cannot find module`。
 *
 * 仓库里 `npm run verify` 会在临时目录复现平台环境，但那终究是模拟，
 * 平台跑通才是终验。
 */

'use strict';

const { load } = require('./lib/vendor/cheerio.js');

console.log('=== seo-doctor · 打包链验证 ===');
console.log('node 版本  :', process.version);
console.log('脚本路径   :', __filename);

// 用真正会用到的能力做冒烟：选择器、属性、后代、缺属性筛选、向上找祖先
const $ = load(`
  <html lang="zh-CN"><head><title>示例</title></head>
  <body><nav><a href="/">首页</a></nav>
  <main><h1>正文标题</h1><img src="a.png"><img src="b.png" alt="有 alt"></main>
  </body></html>`);

const checks = [
  ['html[lang]', $('html').attr('lang'), 'zh-CN'],
  ['title 文本', $('title').text(), '示例'],
  ['main h1 数', String($('main h1').length), '1'],
  ['img 缺 alt 数', String($('img:not([alt])').length), '1'],
  ['a 的 nav 祖先', String($('a').closest('nav').length), '1'],
];

let bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(16)} ${got}${ok ? '' : `（应为 ${want}）`}`);
}

if (bad) {
  console.error(`\ncheerio bundle 有 ${bad} 项不对，先别往下做。`);
  process.exit(1);
}

console.log('\ncheerio bundle 在本环境加载正常，打包链通过。');
console.log('检测逻辑尚未实现，下一步开始按 references/ 的规则表往上盖规则。');
