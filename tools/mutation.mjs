/**
 * 变异测试：故意把实现改错，确认 ruletest 真的会红。
 *
 * 为什么需要它 —— 用例全绿只证明「当前实现在这些输入下的行为」被记录下来了，
 * 不证明「行为错了会被发现」。一组只覆盖 happy path 的用例可以永远全绿，
 * 却抓不住任何真实 bug，那是一层假保险。
 *
 * 做法：对源码做一处等价于「典型写错」的改动，跑一遍 ruletest，**期望它失败**。
 * 如果改错了测试还是绿的，说明这条判定没有任何用例覆盖 —— 那才是要补的洞。
 *
 * 每加一组规则都跑一次：npm run mutation
 */

import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每一条都是一个「有经验的人真的可能写错」的地方，不是随机改字符。
 * `catcher` 写明期望由哪个用例抓住，跑挂时便于定位。
 */
const MUTATIONS = [
  {
    desc: 'heading-skip 用绝对值比较 —— 会把正常的章节结束（h3→h2）误报成跳级',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: 'if (cur - prev > 1)',
    to: 'if (Math.abs(cur - prev) > 1)',
    catcher: 'heading-05-descend',
  },
  {
    desc: 'heading-skip 的阈值写成 >= 1 —— 会把正常的逐级递增（h1→h2）当成跳级',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: 'if (cur - prev > 1)',
    to: 'if (cur - prev >= 1)',
    catcher: 'heading-02-clean',
  },
  {
    desc: 'h1-missing 的阈值写反 —— 有 h1 时反而报缺失',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "if ($('h1').length !== 0) return null;",
    to: "if ($('h1').length > 1) return null;",
    catcher: 'heading-02-clean',
  },
  {
    desc: 'h1-multiple 的边界写成 < 1 —— 只有一个 h1 也报「多个」',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: 'if (all.length <= 1) return null;',
    to: 'if (all.length < 1) return null;',
    catcher: 'heading-02-clean',
  },
  {
    desc: 'landmarkHint 永远返回空 —— 证据里不再标出 h1 落在哪个地标内',
    file: 'seo-doctor/lib/rule-utils.js',
    from: "  const hit = $(el).closest('nav, header, footer, aside, main');",
    to: "  const hit = $(el).closest('__never__');",
    catcher: 'heading-06-logo-h1-in-nav',
  },
  {
    desc: '证据不再截断 —— 长页面会把整段 HTML 灌进报告和模型上下文',
    file: 'seo-doctor/lib/rule-utils.js',
    from: 'return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;',
    to: 'return flat;',
    catcher: 'heading-07-evidence-clip',
  },

  // ── 图片组 ──
  {
    desc: 'img-alt-missing 判成「alt 为空」而不是「alt 属性不存在」—— 装饰图的 alt="" 被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "const hits = $('img:not([alt])').toArray();",
    to: "const hits = $('img').toArray().filter((el) => !(el.attribs.alt || ''));",
    catcher: 'img-02-decorative-empty-alt',
  },
  {
    desc: 'img-alt-meaningless 改成包含匹配 —— 「产品主图：…」这类好 alt 被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: '    PLACEHOLDER_ALT_WORDS.has(norm) ||',
    to: '    [...PLACEHOLDER_ALT_WORDS].some((w) => norm.includes(w)) ||',
    catcher: 'img-04-alt-substring-not-hit',
  },
  {
    desc: 'img-alt-meaningless 把空 alt 判成「没描述内容」—— 装饰图的 alt="" / alt="   " 被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "  if (norm === '') return false;",
    to: "  if (norm === '') return true;",
    catcher: 'img-02-decorative-empty-alt'
  },
  {
    desc: 'img-alt-meaningless 不认文件名形态的 alt',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: '    ALT_LOOKS_LIKE_FILENAME.test(norm) ||',
    to: '    false ||',
    catcher: 'img-03-alt-meaningless',
  },
  {
    desc: 'img-alt-meaningless 不认相机默认名（DSC_0431）',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: '    ALT_CAMERA_DEFAULT.test(norm)',
    to: '    false',
    catcher: 'img-03-alt-meaningless',
  },

  // ── 链接组 ──
  {
    desc: 'link-empty-href 把页内锚点也算成空 —— href="#materials" 被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "  if (href === '' || href === '#') return true;",
    to: "  if (href === '' || href.startsWith('#')) return true;",
    catcher: 'link-02-real-anchors',
  },
  {
    desc: 'link-empty-href 漏掉 javascript: 伪协议',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "  return href.toLowerCase().startsWith('javascript:');",
    to: '  return false;',
    catcher: 'link-01-empty-href',
  },
  {
    desc: 'link-empty-href 漏掉「压根没有 href 属性」这种',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: '  if (raw === undefined) return true;',
    to: '  if (raw === undefined) return false;',
    catcher: 'link-01-empty-href',
  },
  {
    desc: 'link-fake 不过滤跳转关键词 —— 展开面板、埋点这类 onclick 全被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "        .filter((el) => ONCLICK_NAVIGATES.test(el.attribs.onclick || ''));",
    to: '        .filter(() => true);',
    catcher: 'link-04-onclick-not-navigation',
  },
  {
    desc: 'link-fake 忘了排除 a —— 自带 onclick 的正常链接被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "        .filter((el) => (el.tagName || el.name) !== 'a')",
    to: '        .filter(() => true)',
    catcher: 'link-02-real-anchors',
  },
  {
    desc: 'anchor-text-generic 改成包含匹配 —— 「了解更多关于…的信息」被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: '        .filter((el) => GENERIC_ANCHOR_WORDS.has(anchorText($, el).toLowerCase()));',
    to: "        .filter((el) => [...GENERIC_ANCHOR_WORDS].some((w) => anchorText($, el).toLowerCase().includes(w)));",
    catcher: 'link-06-anchor-substring-not-hit',
  },
  {
    desc: 'anchor-text-generic 大小写敏感 —— 「Read More」漏掉',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: '        .filter((el) => GENERIC_ANCHOR_WORDS.has(anchorText($, el).toLowerCase()));',
    to: '        .filter((el) => GENERIC_ANCHOR_WORDS.has(anchorText($, el)));',
    catcher: 'link-05-anchor-generic',
  },
  {
    desc: 'anchor-text-generic 不拿图片链接的 alt 当锚文本 —— 纯图片链接漏掉',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "  if (imgs.length === 1) return (imgs.get(0).attribs.alt || '').trim();",
    to: "  if (imgs.length === 1) return '';",
    catcher: 'link-05-anchor-generic',
  },

  // ── 地标组 ──
  {
    desc: 'landmark-duplicate 连 nav / header / footer 也查重复 —— 页脚再放一个 nav 就被误报',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "      const all = $('main').toArray();",
    to: "      const all = $('main, nav, header, footer').toArray();",
    catcher: 'landmark-04-multi-nav-ok',
  },
  {
    desc: 'landmark-duplicate 的边界写成 < 1 —— 只有一个 main 也报重复',
    file: 'seo-doctor/lib/rules-semantic.js',
    // `if (all.length <= 1)` 在 h1-multiple 里也有一处，所以要带上上一行才唯一
    from: `      const all = $('main').toArray();
      if (all.length <= 1) return null;`,
    to: `      const all = $('main').toArray();
      if (all.length < 1) return null;`,
    catcher: 'landmark-02-complete',
  },
  {
    desc: 'landmark-missing 漏查其中一个地标（footer）',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "const LANDMARKS = ['main', 'nav', 'header', 'footer'];",
    to: "const LANDMARKS = ['main', 'nav', 'header'];",
    catcher: 'landmark-01-missing',
  },
  {
    desc: 'landmark-missing 不再提示疑似顶替的 div —— 报告只说缺什么，不说改哪个',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: '  const hit = $(`div[class*="${name}"], div[id*="${name}"]`).first();',
    to: "  const hit = $('div[class*=\"__never__\"]').first();",
    catcher: 'landmark-01-missing',
  },
  // ── 元信息组 ──
  {
    desc: 'displayWidth 退回用字符数 —— 34 个汉字的 title 字符数没超、显示宽度超了，会漏报',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '  for (const ch of str) w += FULL_WIDTH.test(ch) ? 2 : 1;',
    to: '  for (const ch of str) w += 1;',
    catcher: 'meta-02-title-too-long',
  },
  {
    desc: 'displayWidth 把半角也算 2 —— 英文 title 被误判成太长',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '  for (const ch of str) w += FULL_WIDTH.test(ch) ? 2 : 1;',
    to: '  for (const ch of str) w += 2;',
    catcher: 'meta-04-title-english-ok',
  },
  {
    desc: 'title-length 不给 title-missing 让路 —— 空标题被同时报「缺失」和「太短」',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '      if (!text) return null; // 空的交给 title-missing，本条不重复报',
    to: '      if (text === null) return null;',
    catcher: 'meta-01-title-missing',
  },
  {
    desc: 'description-length 不给 description-missing 让路',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '      if (!text) return null; // 交给 description-missing',
    to: '      if (text === null) return null;',
    catcher: 'meta-05-description-missing',
  },
  {
    desc: 'meta 名按大小写敏感匹配 —— name="Description" 被当成没写',
    file: 'seo-doctor/lib/rule-utils.js',
    from: '      const k = a.name.trim().toLowerCase();',
    to: '      const k = a.name.trim();',
    catcher: 'meta-16-attr-case-variants',
  },
  {
    desc: 'og 只认 property= 不认 name= —— 用 name 写 og 的站点被误报缺失',
    file: 'seo-doctor/lib/rules-meta.js',
    from: 'const ogValue = (head, key) => head.metaByProperty.get(key) ?? head.metaByName.get(key);',
    to: 'const ogValue = (head, key) => head.metaByProperty.get(key);',
    catcher: 'meta-16-attr-case-variants',
  },
  {
    desc: 'og-incomplete 只要有一个 og 就算齐 —— 缺 og:image 漏报',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '      if (missing.length === 0) return null;',
    to: '      if (missing.length < OG_REQUIRED.length) return null;',
    catcher: 'meta-14-og-partial',
  },

  // ── canonical 归一化：误报的重灾区，每条边界各来一个 ──
  {
    desc: '归一化不去掉追踪参数 —— 「canonical 去掉 utm」这个正当用法被误报',
    file: 'seo-doctor/lib/url-normalize.js',
    from: '    .filter(([k]) => !isTracking(k))',
    to: '    .filter(() => true)',
    catcher: 'meta-09-canonical-normalized-ok',
  },
  {
    desc: '归一化把所有参数都去掉 —— 第 2 页 canonical 指向第 1 页这种真错误漏报',
    file: 'seo-doctor/lib/url-normalize.js',
    from: '    .filter(([k]) => !isTracking(k))',
    to: '    .filter(() => false)',
    catcher: 'meta-11-canonical-page-param',
  },
  {
    desc: '归一化不抹掉 www. 前缀 —— 站点选主域名这个标准做法被误报',
    file: 'seo-doctor/lib/url-normalize.js',
    from: "  const host = u.hostname.toLowerCase().replace(/^www\\./, '');",
    to: '  const host = u.hostname.toLowerCase();',
    catcher: 'meta-09-canonical-normalized-ok',
  },
  {
    desc: '归一化不统一尾斜杠 —— /a 和 /a/ 被当成两个页面',
    file: 'seo-doctor/lib/url-normalize.js',
    from: "  const path = u.pathname.length > 1 ? u.pathname.replace(/\\/+$/, '') : u.pathname;",
    to: '  const path = u.pathname;',
    catcher: 'meta-09-canonical-normalized-ok',
  },
  {
    desc: '<base href> 不先对着页面 URL 解析 —— 协议相对的 base 会抛，合法 canonical 被误报成「不是合法的 URL」',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '      const base = resolveBase(ctx.head.baseHref, ctx.url) || ctx.url;',
    to: '      const base = ctx.head.baseHref || ctx.url;',
    catcher: 'meta-10-canonical-protocol-relative-base',
  },
  {
    desc: 'canonical-mismatch 在没有页面 URL 时也判 —— 没有对照物却硬报',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '      if (!ctx.url) return null;',
    to: "      if (!ctx.url) { ctx = { ...ctx, url: 'https://__never__/' }; }",
    catcher: '任一没写 @url 的用例',
  },
  {
    desc: 'canonical-mismatch 在有多个 canonical 时仍去比对第一个',
    file: 'seo-doctor/lib/rules-meta.js',
    from: '      if (ctx.head.canonicals.length !== 1) return null;',
    to: '      if (ctx.head.canonicals.length < 1) return null;',
    catcher: 'meta-08-canonical-multiple',
  },
];

/** 跑一次 ruletest，返回它是否通过。 */
async function ruletestPasses() {
  try {
    await run(process.execPath, [path.join(ROOT, 'tools', 'ruletest.mjs')], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

console.log('\n变异测试：把实现改错，期望 ruletest 变红\n');

if (!(await ruletestPasses())) {
  console.error('基线就是红的 —— 先把 npm run ruletest 跑绿再来做变异测试。');
  process.exit(1);
}

const survived = [];
const killed = [];

for (const m of MUTATIONS) {
  const abs = path.join(ROOT, m.file);
  const original = await readFile(abs, 'utf8');

  if (!original.includes(m.from)) {
    console.log(`  ⚠ ${m.desc}`);
    console.log(`      改动点在 ${m.file} 里找不到了，变异用例需要更新`);
    survived.push({ ...m, stale: true });
    continue;
  }

  // 不管中间发生什么都要把源码改回去，否则会把损坏的实现留在工作区
  try {
    await writeFile(abs, original.replace(m.from, m.to));
    const stillGreen = await ruletestPasses();
    if (stillGreen) {
      console.log(`  ${m.expectSurvive ? '·' : '✗'} ${m.desc}`);
      if (!m.expectSurvive) console.log(`      改错了测试还是绿的，说明这条判定没有用例覆盖`);
      survived.push(m);
    } else {
      console.log(`  ✓ ${m.desc}`);
      killed.push(m);
    }
  } finally {
    await writeFile(abs, original);
  }
}

const unexpected = survived.filter((m) => !m.expectSurvive);

console.log(`\n${killed.length} 处改错被抓住，${survived.length} 处存活\n`);

for (const m of survived.filter((x) => x.expectSurvive)) {
  console.log(`· 已知未覆盖：${m.desc}`);
  console.log(`  ${m.catcher}`);
}

if (unexpected.length) {
  console.log('\n以下改动没被任何用例抓住，需要补用例：');
  for (const m of unexpected) console.log(`  - ${m.desc}（本应由 ${m.catcher} 抓住）`);
  process.exit(1);
}

console.log('');
