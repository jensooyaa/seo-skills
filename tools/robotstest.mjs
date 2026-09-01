/**
 * robots.txt 匹配测试。
 *
 * **用例全部抄自 Google 官方文档的三张表，一条都不自己编。**
 * 这套规则反直觉的地方太多（`/fish` 匹配 `/fishheads` 但 `/fish/` 不匹配 `/fish`、
 * 平局时限制最少的赢、`/*.htm` 会赢过 `/page`），自己编的用例只会印证自己的误解。
 *
 * 出处：https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
 *
 * 跑：npm run robotstest（已并进 npm test）
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { parseRobotsTxt, isAllowed, interpretStatus } = require(
  path.join(ROOT, 'seo-doctor', 'lib', 'robots.js')
);

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) passed++;
  else failures.push(`${name}\n      期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`);
}

const HOST = 'https://example.com';
const under = (rule, urls, expectAllowed, label) => {
  const parsed = parseRobotsTxt(`User-agent: *\nDisallow: ${rule}`);
  for (const u of urls) {
    check(`${label}｜规则 ${rule} 对 ${u}`, isAllowed(parsed, HOST + u, 'googlebot').allowed, expectAllowed);
  }
};

// ── 表一：路径匹配（官方 "URL matching based on path values"）─────────────
// Disallow 命中 → allowed=false；没命中 → allowed=true

under('/fish',
  ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'],
  false, '表一 /fish 匹配');
under('/fish',
  ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish'],
  true, '表一 /fish 不匹配');

under('/fish*',
  ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fish.php?id=anything'],
  false, '表一 /fish* 匹配');
under('/fish*',
  ['/Fish.asp', '/catfish', '/?id=fish'],
  true, '表一 /fish* 不匹配');

under('/fish/',
  ['/fish/', '/fish/?id=anything', '/fish/salmon.htm'],
  false, '表一 /fish/ 匹配');
under('/fish/',
  // ⚠️ /fish/ 不匹配 /fish —— 反直觉，最容易写错的一条
  ['/fish', '/fish.html', '/animals/fish/', '/Fish/Salmon.asp'],
  true, '表一 /fish/ 不匹配');

under('/*.php',
  ['/index.php', '/filename.php', '/folder/filename.php', '/folder/filename.php?parameters',
   '/folder/any.php.file.html', '/filename.php/'],
  false, '表一 /*.php 匹配');
under('/*.php',
  ['/', '/windows.PHP'],
  true, '表一 /*.php 不匹配');

under('/*.php$',
  ['/filename.php', '/folder/filename.php'],
  false, '表一 /*.php$ 匹配');
under('/*.php$',
  ['/filename.php?parameters', '/filename.php/', '/filename.php5', '/windows.PHP'],
  true, '表一 /*.php$ 不匹配');

under('/fish*.php',
  ['/fish.php', '/fishheads/catfish.php?parameters'],
  false, '表一 /fish*.php 匹配');
under('/fish*.php', ['/Fish.PHP'], true, '表一 /fish*.php 不匹配');

// `/$` 只管根路径
under('/$', ['/'], false, '表一 /$ 匹配');
under('/$', ['/page', '/a/b'], true, '表一 /$ 不匹配');

// ── 表二：优先级（官方 "order of precedence for rules"）──────────────────

const prec = (label, txt, url, expectAllowed) => {
  const parsed = parseRobotsTxt(`User-agent: *\n${txt}`);
  check(`表二 ${label}`, isAllowed(parsed, HOST + url, 'googlebot').allowed, expectAllowed);
};

prec('allow:/p vs disallow:/ 对 /page → allow（更长）',
  'allow: /p\ndisallow: /', '/page', true);
prec('allow:/folder vs disallow:/folder 对 /folder/page → allow（平局取限制最少）',
  'allow: /folder\ndisallow: /folder', '/folder/page', true);
prec('allow:/page vs disallow:/*.htm 对 /page.htm → disallow（6 > 5）',
  'allow: /page\ndisallow: /*.htm', '/page.htm', false);
prec('allow:/page vs disallow:/*.ph 对 /page.php5 → allow（平局取限制最少）',
  'allow: /page\ndisallow: /*.ph', '/page.php5', true);
prec('allow:/$ vs disallow:/ 对 / → allow（更具体）',
  'allow: /$\ndisallow: /', '/', true);
prec('allow:/$ vs disallow:/ 对 /page.htm → disallow（/$ 只管根路径）',
  'allow: /$\ndisallow: /', '/page.htm', false);

// ── 分组选择 ────────────────────────────────────────────────────────────

{
  // 有具体分组时，`*` 那组整个忽略 —— 不是合并
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /';
  const p = parseRobotsTxt(txt);
  check('分组｜有 Googlebot 专属组时，* 组整个忽略',
    isAllowed(p, HOST + '/anything', 'googlebot').allowed, true);
  check('分组｜其他爬虫仍受 * 组约束',
    isAllowed(p, HOST + '/anything', 'bingbot').allowed, false);
}
{
  // 同一个具体 user-agent 的多个分组要合并
  const txt = 'User-agent: googlebot\nDisallow: /a\n\nUser-agent: googlebot\nDisallow: /b';
  const p = parseRobotsTxt(txt);
  check('分组｜同名 UA 的多组合并（/a）', isAllowed(p, HOST + '/a/x', 'googlebot').allowed, false);
  check('分组｜同名 UA 的多组合并（/b）', isAllowed(p, HOST + '/b/x', 'googlebot').allowed, false);
}
{
  // 具体分组存在但没写任何规则 → 该 UA 不受限制，且 * 组仍然整个忽略
  const p = parseRobotsTxt(`User-agent: *
Disallow: /

User-agent: googlebot`);
  check('分组｜具体分组为空时该 UA 不受限制',
    isAllowed(p, HOST + '/anything', 'googlebot').allowed, true);
}
{
  // user-agent 大小写不敏感
  const p = parseRobotsTxt('User-agent: GoogleBot\nDisallow: /x');
  check('分组｜UA 大小写不敏感', isAllowed(p, HOST + '/x', 'googlebot').allowed, false);
}

// ── 解析的边角 ──────────────────────────────────────────────────────────

{
  // ⚠️ 空的 Disallow 是「什么都不限制」，不是「挡住全站」——搞反就是灾难
  const p = parseRobotsTxt('User-agent: *\nDisallow:');
  check('解析｜空 Disallow 等于不限制', isAllowed(p, HOST + '/anything', 'googlebot').allowed, true);
}
{
  const p = parseRobotsTxt('User-agent: *  # 所有爬虫\nDisallow: /admin  # 后台\nSitemap: https://a.com/s.xml');
  check('解析｜行尾注释要剥掉', isAllowed(p, HOST + '/admin/x', 'googlebot').allowed, false);
  check('解析｜Sitemap 收集', p.sitemaps[0], 'https://a.com/s.xml');
}
{
  const p = parseRobotsTxt('DISALLOW: /x\nUser-Agent: *\nDISALLOW: /y');
  check('解析｜字段名大小写不敏感', isAllowed(p, HOST + '/y', 'googlebot').allowed, false);
  check('解析｜组外的规则行忽略', isAllowed(p, HOST + '/x', 'googlebot').allowed, true);
}
{
  const p = parseRobotsTxt('');
  check('解析｜空文件等于全放行', isAllowed(p, HOST + '/anything', 'googlebot').allowed, true);
}
{
  // 生效的规则要能拿出来，报告里要引用它
  const p = parseRobotsTxt('User-agent: *\nDisallow: /admin');
  check('返回｜生效规则的路径', isAllowed(p, HOST + '/admin/x', 'googlebot').rule.path, '/admin');
}

// ── 表三：HTTP 状态码（官方 "How Google handles robots.txt errors"）─────

check('表三 200 → 按内容执行', interpretStatus(200).mode, 'parse');
check('表三 404 → 不设任何限制（常态，不该报）', interpretStatus(404).mode, 'allow-all');
check('表三 403 → 不设任何限制', interpretStatus(403).mode, 'allow-all');
check('表三 410 → 不设任何限制', interpretStatus(410).mode, 'allow-all');
check('表三 429 → 按服务器错误（4xx 里的例外）', interpretStatus(429).mode, 'blocked');
check('表三 500 → 临时整站禁抓', interpretStatus(500).mode, 'blocked');
check('表三 503 → 临时整站禁抓', interpretStatus(503).mode, 'blocked');
check('表三 网络错误 → 按服务器错误', interpretStatus(null, 'ETIMEDOUT').mode, 'blocked');

// ── 报告 ────────────────────────────────────────────────────────────────

console.log(`\nrobots.txt 匹配测试（用例抄自 Google 官方文档）`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`  ${failures.length ? '✗' : '✓'} ${passed}/${passed + failures.length} 条断言通过\n`);

if (failures.length) process.exit(1);
