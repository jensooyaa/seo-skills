/**
 * 终端输出层。run.js 只管解析参数和分发，展示都在这里。
 *
 * 这一层只负责把数据摆出来，**不做任何判断** —— 判断在 lib/rules-*.js，
 * 解读在 references/ 的清单里。
 */

'use strict';

const { LEVELS } = require('./check-page.js');
const { displayWidth } = require('./rule-utils.js');
const { aggregateFindings, groupByPathPrefix } = require('./crawl-site.js');

/**
 * 已知盲区。**必须跟着结果一起输出。**
 *
 * 不写出来，使用者会把「没报」当成「没问题」，而下面这几条恰恰是脚本永远
 * 看不见的地方 —— 尤其第二条，现代前端的事件绑定它一个都抓不到。
 */
const BLIND_SPOTS = [
  '看不到 CSS —— display:none 的 h1 会被算作存在',
  '看不到 JS 绑定的事件 —— 只能抓内联 onclick，React/Vue 的 onClick 抓不到',
  '看不懂图片内容 —— 只能查词表，查不出「alt 与图不符」',
  '只看服务端 HTML —— 水合后才渲染的内容不在检查范围内',
  '  ↳ 对 SPA 尤其要紧：很多站的 meta 是 react-helmet 之类在客户端写的，服务端',
  '    HTML 里一个都没有，而 Google 第一波抓取看到的正是服务端 HTML',
  '结构化数据、索引指令两组的规则没做进脚本 —— 按 references/ 的清单自己判',
];

/**
 * ⚠️ 这几句措辞是刻意的，不要改成「Google 爬不到」。
 * 我们不执行 JS，Googlebot 执行 —— 两者不等价，混为一谈会给出错误结论。
 */
const CRAWL_CAVEAT = [
  '本次爬取**不执行 JS**，走的是「Googlebot 第一波抓取」看到的那份服务端 HTML。',
  '所以结论一律是「服务端 HTML 中可达 / 不可达」，**不等于**「Google 爬得到 / 爬不到」。',
  '要等 JS 渲染才出现的链接，Google 得排进第二波渲染队列：慢得多、优先级低、且不保证。',
];

const mark = (ok) => (ok ? '✓' : '—');
const rule = (n = 60) => '─'.repeat(n);

/** 按**显示宽度**补空格。String.padEnd 按字符数补，全角标签会补歪。 */
function padTo(str, width) {
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}

// ══════════════════════════════════════════════════════════════════════
// 单页检查
// ══════════════════════════════════════════════════════════════════════

/**
 * 页面概况：采集到的**事实**，不含判断。
 *
 * 只输出问题的话，一个没什么毛病的页面报告就只剩两三行，看的人不知道到底查了
 * 什么、什么是查过且通过的 —— 然后就会有人（包括 Agent）自己拿别的工具去翻一遍
 * 补上，而手工翻的结果不稳定、不可复现。事实给全了，这个动机就没了。
 */
function printFacts(f) {
  const line = (k, v) => console.log(`  ${padTo(k, 14)}${v}`);

  console.log('\n页面概况');
  line('title', f.title.value || '（无）');
  if (f.title.value) line('', `显示宽度 ${f.title.width}`);
  line('description', f.description.value || '（无）');
  if (f.description.value) line('', `显示宽度 ${f.description.width}`);
  line('canonical', f.canonical.length ? f.canonical.join('\n' + ' '.repeat(16)) : '（无）');
  line('lang', f.lang || '（无）');
  line('viewport', f.viewport || '（无）');
  if (f.metaRobots) line('meta robots', f.metaRobots);
  line('Open Graph', f.og.map((o) => `${mark(o.value)} ${o.key}`).join('   '));
  line(
    '地标',
    f.landmarks.map((l) => `${mark(l.count > 0)} ${l.tag}${l.count > 1 ? `×${l.count}` : ''}`).join('   ')
  );
  line(
    '统计',
    `图片 ${f.counts.images}（缺 alt ${f.counts.imagesNoAlt}）· 链接 ${f.counts.links}（无跳转地址 ${f.counts.linksNoHref}）`
  );

  if (f.structured.length) {
    const desc = f.structured
      .map((s) => (s.parseError ? `解析失败（${s.parseError}）` : s.types.join(' / ') || '(无 @type)'))
      .join('；');
    line('结构化数据', `${f.structured.length} 段 ld+json：${desc}`);
    line('', '⚠ 这一组规则没做进脚本，上面只是列出有什么，未做任何校验');
  } else {
    line('结构化数据', '（页面里没有 ld+json）');
  }

  if (f.outline.length) {
    console.log('\n  标题大纲');
    for (const h of f.outline) console.log(`  ${'  '.repeat(h.level)}h${h.level}  ${h.text}`);
    if (f.outlineTruncated) console.log(`      …（只列前 ${f.outline.length} 个）`);
  }
}

function printCheck(facts, findings, meta) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const f of findings) counts[f.level] = (counts[f.level] || 0) + 1;

  console.log('');
  console.log(`检查对象   ${meta.url}`);
  if (meta.finalUrl && meta.finalUrl !== meta.url) console.log(`最终 URL   ${meta.finalUrl}`);
  console.log(`状态码     ${meta.status}`);
  console.log(`HTML 大小  ${(meta.size / 1024).toFixed(1)} KB`);

  printFacts(facts);

  console.log(`\n${rule()}`);
  console.log(`\n阻断 ${counts['阻断']}   警告 ${counts['警告']}   建议 ${counts['建议']}`);

  if (findings.length === 0) console.log('\n脚本这一部分没发现问题。');

  for (const level of LEVELS) {
    const group = findings.filter((f) => f.level === level);
    if (group.length === 0) continue;
    console.log(`\n${rule()}`);
    for (const f of group) {
      console.log(`\n[${f.level}] ${f.detail}`);
      console.log(`        规则 ${f.rule}（${f.group}）`);
      for (const e of f.evidence) console.log(`        · ${e}`);
    }
  }

  console.log(`\n${rule()}`);
  console.log('\n已知盲区（没报不等于没问题）：');
  // 以空格开头的是上一条的续行，不再加项目符号
  for (const line of BLIND_SPOTS) console.log(line.startsWith(' ') ? `   ${line}` : `  · ${line}`);
  console.log('');
  console.log('每条问题的「为什么 / 怎么改」见 references/ 下对应的清单，按规则 ID 查表。');
  console.log('');
}

// ══════════════════════════════════════════════════════════════════════
// 全站爬取
// ══════════════════════════════════════════════════════════════════════

/**
 * 内链结构。
 *
 * 入链数是 Google 判断「站内哪些页面重要」的直接信号 —— 一个页面被内部链了 20 次，
 * 说明站点自己认为它重要；只被链 1 次、还是从深层页面链过来的，权重就很薄。
 *
 * 出链为 0 的页面是「死胡同」：爬虫走到这里就停了，抓取预算花在这一页上换不来
 * 任何新发现。
 */
function printLinkGraph(r, html) {
  console.log(`\n${rule()}`);
  console.log('\n内链结构');

  const scored = html
    .map((p) => ({ p, inbound: p.inboundCount || 0, out: p.outLinks || 0 }))
    .sort((a, b) => b.inbound - a.inbound);

  console.log('\n  入链   出链   深度   页面');
  for (const s of scored.slice(0, 25)) {
    const flags = [];
    if (s.p.nofollowOnly) flags.push('只被 nofollow 链接指向');
    if (s.out === 0) flags.push('死胡同，没有出链');
    if (s.inbound <= 1 && s.p.depth >= 2) flags.push('入链薄弱');
    console.log(
      `  ${String(s.inbound).padStart(4)}   ${String(s.out).padStart(4)}   ${String(s.p.depth).padStart(4)}   ${s.p.url}` +
        (flags.length ? `\n                        ↳ ${flags.join('；')}` : '')
    );
  }
  if (scored.length > 25) console.log(`  …（还有 ${scored.length - 25} 个，用 --json 看全部）`);

  const deadEnds = scored.filter((s) => s.out === 0);
  const weak = scored.filter((s) => s.inbound <= 1 && s.p.depth >= 2);
  const nofollowOnly = scored.filter((s) => s.p.nofollowOnly);

  console.log('');
  if (deadEnds.length) console.log(`  死胡同（没有任何出链）${deadEnds.length} 个 —— 爬虫走到这里就停了`);
  if (weak.length) console.log(`  入链薄弱（只有 1 条入链且深度 ≥2）${weak.length} 个 —— 站点自己都没在推它`);
  if (nofollowOnly.length) console.log(`  只被 nofollow 链接指向 ${nofollowOnly.length} 个 —— Google 可能不跟进，等于半个孤儿`);
  if (!deadEnds.length && !weak.length && !nofollowOnly.length) console.log('  没有发现明显的内链断点。');
}

function printCrawl(r) {
  const html = r.pages.filter((p) => p.html);
  const broken = r.pages.filter((p) => p.error || (p.status && p.status >= 400));
  const redirected = r.pages.filter((p) => p.redirected);

  console.log('');
  console.log(`起点       ${r.start}`);
  console.log(`robots.txt ${r.robots.reason}`);
  if (r.robots.sitemaps.length) {
    console.log(`sitemap    ${r.robots.sitemaps.length} 份`);
    for (const s of r.robots.sitemaps) console.log(`           ${s}`);
  }
  console.log(
    `封顶       ${r.maxPages} 页 / 深度 ${r.maxDepth}` +
      (r.stopReason === 'maxPages' ? '   ⚠ 已达总量上限，还有链接没走完' : '')
  );

  console.log(`\n${rule()}`);
  console.log(`\n服务端 HTML 中可达 ${r.pages.length} 个 URL（其中 HTML 页面 ${html.length} 个）`);
  if (broken.length) console.log(`其中打不开 ${broken.length} 个   ← 死掉的内链`);
  if (redirected.length) console.log(`其中经过重定向 ${redirected.length} 个   ← 内链指向重定向，浪费抓取预算`);
  if (r.skipped.length) console.log(`跳过 ${r.skipped.length} 个`);

  // ── 可达清单，按点击深度 ──────────────────────────────────────────
  console.log(`\n${rule()}`);
  console.log('\n可达页面（按从首页起算的点击深度）');

  const byDepth = new Map();
  for (const p of r.pages) {
    if (!byDepth.has(p.depth)) byDepth.set(p.depth, []);
    byDepth.get(p.depth).push(p);
  }
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    const list = byDepth.get(d);
    console.log(`\n  深度 ${d}   ${list.length} 个`);
    for (const p of list.slice(0, 40)) {
      const flag = p.error
        ? `✗ ${p.error}`
        : p.status >= 400
          ? `✗ ${p.status}`
          : p.redirected
            ? '→ 重定向'
            : `  ${p.status}`;
      const hits = p.findings.length ? `   命中 ${p.findings.length}` : '';
      console.log(`    ${flag}  ${p.url}${hits}`);
      if (p.anchorText) console.log(`           ↳ 锚文本「${p.anchorText}」   入链 ${p.inboundCount}`);
    }
    if (list.length > 40) console.log(`    …（还有 ${list.length - 40} 个，用 --json 看全部）`);
  }

  // ── sitemap 差集：孤儿页 ──────────────────────────────────────────
  if (r.sitemap) {
    const sm = r.sitemap;
    console.log(`\n${rule()}`);
    console.log('\nsitemap 对比');
    for (const f of sm.files) {
      const what = f.error ? `✗ ${f.error}` : f.status !== 200 ? `✗ ${f.status}` : `${f.count} 条${f.isIndex ? '（索引）' : ''}`;
      console.log(`  ${what.padEnd(14)} ${f.url}`);
    }
    if (sm.truncated) console.log('  ⚠ sitemap 份数过多，只展开了前几份');

    console.log(`\n  sitemap 里共 ${sm.total} 个 URL，从首页走到的 ${r.pages.length} 个`);

    if (sm.orphans.length) {
      const pct = Math.round((sm.orphans.length / (sm.total || 1)) * 100);
      console.log(`\n  ⚠ 孤儿页 ${sm.orphans.length} 个（占 sitemap 的 ${pct}%）`);
      console.log('    这些页面只在 sitemap 里，从首页出发在服务端 HTML 中一步都走不到 ——');
      console.log('    也就是说它们没有任何内链，只靠向搜索引擎提交 sitemap 被发现。');
      console.log('    对应 GSC 里的「已发现——尚未编入索引」，是内链问题，不是内容问题。');

      // 按路径前缀归类，看是哪一整批
      const byPrefix = new Map();
      for (const u of sm.orphans) {
        let seg = '/';
        try {
          seg = '/' + (new URL(u).pathname.split('/').filter(Boolean)[0] || '');
        } catch {
          /* 用默认值 */
        }
        byPrefix.set(seg, (byPrefix.get(seg) || 0) + 1);
      }
      console.log('');
      for (const [prefix, n] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(n).padStart(5)} 个  ${prefix}`);
      }
      console.log('\n    举例：');
      for (const u of sm.orphans.slice(0, 5)) console.log(`      ${u}`);
      if (sm.orphans.length > 5) console.log(`      …（还有 ${sm.orphans.length - 5} 个，用 --json 看全部）`);
    } else {
      console.log('  ✓ sitemap 里的页面从首页都走得到，没有孤儿页');
    }

    if (sm.notInSitemap.length) {
      console.log(`\n  另有 ${sm.notInSitemap.length} 个页面走得到但不在 sitemap 里：`);
      for (const u of sm.notInSitemap.slice(0, 8)) console.log(`    ${u}`);
      if (sm.notInSitemap.length > 8) console.log(`    …（还有 ${sm.notInSitemap.length - 8} 个）`);
    }
  }

  // ── 内链结构 ──────────────────────────────────────────────────────
  printLinkGraph(r, html);

  // ── 按路径前缀分组，粗略对应「模板」 ──────────────────────────────
  const groups = groupByPathPrefix(html);
  if (groups.length > 1) {
    console.log(`\n${rule()}`);
    console.log('\n按路径前缀分组（粗略对应模板）');
    for (const g of groups) console.log(`  ${String(g.count).padStart(4)} 个  ${g.prefix}`);
  }

  // ── 规则聚合：模板层问题一眼可见 ──────────────────────────────────
  const agg = aggregateFindings(r.pages);
  console.log(`\n${rule()}`);
  console.log(`\n批量体检（${html.length} 个 HTML 页面）`);
  if (agg.length === 0) {
    console.log('  脚本这一部分没有命中任何规则。');
  } else {
    console.log('\n  命中 / 总数    规则                       级别');
    for (const a of agg) {
      const pct = Math.round(a.ratio * 100);
      const tag = pct >= 80 ? '   ← 几乎每页都命中，是模板层问题' : '';
      console.log(
        `  ${String(a.count).padStart(4)} / ${String(html.length).padEnd(5)}  ` +
          `${a.rule.padEnd(24)} ${a.level}${tag}`
      );
    }
    console.log('\n  命中比例高的优先改 —— 一条规则命中八成页面，说明问题在模板里，改一处修全站。');
    console.log('  每条的「为什么 / 怎么改」按规则 ID 去 references/ 查表。');
  }

  // ── 跳过的，按原因归类 ────────────────────────────────────────────
  if (r.skipped.length) {
    console.log(`\n${rule()}`);
    console.log(`\n跳过的 ${r.skipped.length} 个`);
    const byReason = new Map();
    for (const s of r.skipped) {
      if (!byReason.has(s.reason)) byReason.set(s.reason, []);
      byReason.get(s.reason).push(s.url);
    }
    for (const [reason, urls] of byReason) {
      console.log(`\n  ${reason}   ${urls.length} 个`);
      for (const u of urls.slice(0, 10)) console.log(`    ${u}`);
      if (urls.length > 10) console.log(`    …（还有 ${urls.length - 10} 个）`);
    }
  }

  console.log(`\n${rule()}`);
  console.log('\n这份结果怎么读：');
  for (const line of CRAWL_CAVEAT) console.log(`  · ${line}`);
  console.log('');
  console.log('  · 要找出孤儿页，把上面的可达清单和 sitemap 里的 URL 求差集 ——');
  console.log('    只在 sitemap 里、这里走不到的，就是纯靠 sitemap 提交、没有任何内链的页面。');
  console.log('');
}

module.exports = { printCheck, printCrawl, printFacts, BLIND_SPOTS, CRAWL_CAVEAT };
