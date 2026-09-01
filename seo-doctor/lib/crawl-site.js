/**
 * 首页可达性爬取 —— 模仿 Googlebot 第一波抓取。
 *
 * 从首页出发做 BFS，**只跟服务端 HTML 里的 `<a href>`，不执行 JS**。
 * 这不是能力不足，这就是要测的东西：Googlebot 第一波看到的正是这份 HTML，
 * 要等 JS 渲染才出现的链接得排进第二波渲染队列，慢得多、优先级低、且不保证。
 *
 * ⚠️ **结论措辞必须钉死：「服务端 HTML 中不可达」，绝不写「Google 爬不到」。**
 * 我们不执行 JS，Googlebot 执行，两者不等价。把这两句话混为一谈会给出错误结论。
 *
 * 为什么这一块非写代码不可（别的规则都写成给 Agent 看的清单）：几百次请求 +
 * 并发控制 + 限速 + 去重归一化 + 每个 URL 都要跑一遍 robots 匹配。
 * 这不是判断力的问题，是靠工具调用做不来的量。
 */

'use strict';

const { analyzePage } = require('./check-page.js');
const { fetchPage, isHtml } = require('./fetch-page.js');
const { normalizeUrl, resolveBase } = require('./url-normalize.js');
const { parseRobotsTxt, isAllowed, interpretStatus } = require('./robots.js');
const { collectSitemapUrls } = require('./sitemap.js');
const { load } = require('./vendor/cheerio.js');
const { clip } = require('./rule-utils.js');

/** 一眼就知道不是 HTML 的后缀，不浪费请求。PDF 不在此列 —— 它是可索引的。 */
const ASSET_EXT =
  /\.(css|js|mjs|json|xml|txt|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|mp3|zip|gz)$/i;

/** 这些协议不是页面 */
const SKIP_SCHEME = /^(mailto:|tel:|javascript:|data:|blob:|sms:|ftp:)/i;

/** 判同源时把 www. 抹掉 —— example.com 和 www.example.com 是同一个站 */
const siteHost = (u) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * 从一份 HTML 里抽出同源的可跟进链接。
 *
 * @returns {Array<{url, anchorText, nofollow}>}
 */
function extractLinks($, pageUrl) {
  const base = resolveBase(($('head base').first().attr('href') || '').trim(), pageUrl) || pageUrl;
  const host = siteHost(pageUrl);
  const out = [];

  $('a[href]').each((_, el) => {
    const raw = (el.attribs.href || '').trim();
    if (!raw || raw.startsWith('#') || SKIP_SCHEME.test(raw)) return;

    let abs;
    try {
      abs = new URL(raw, base);
    } catch {
      return;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return;
    if (siteHost(abs.href) !== host) return; // 只跟同源
    if (ASSET_EXT.test(abs.pathname)) return;

    abs.hash = ''; // fragment 不构成新页面，服务端根本收不到它

    const $el = $(el);
    const text = $el.text().trim() || ($el.find('img').first().attr('alt') || '').trim();

    out.push({
      url: abs.href,
      anchorText: clip(text, 60),
      // rel=nofollow 现在只是「提示」，Google 仍可能跟进 —— 记录但照爬
      nofollow: /\bnofollow\b/i.test(el.attribs.rel || ''),
    });
  });

  return out;
}

/**
 * 爬一个站。
 *
 * @param {string} startUrl 首页
 * @param {object} [opt]
 * @param {number} [opt.maxPages=200]   总量封顶。别把测试环境打挂
 * @param {number} [opt.maxDepth=3]     从首页起算的点击深度
 * @param {number} [opt.concurrency=3]  并发
 * @param {number} [opt.delayMs=200]    每批之间歇一下
 * @param {function} [opt.onProgress]   进度回调
 * @param {boolean|string[]} [opt.sitemap=true]  展开 sitemap 求差集找孤儿页。
 *        缺省用 robots.txt 里声明的；传数组则用指定的；传 false 跳过
 */
async function crawlSite(startUrl, opt = {}) {
  const maxPages = opt.maxPages ?? 200;
  const maxDepth = opt.maxDepth ?? 3;
  const concurrency = opt.concurrency ?? 3;
  const delayMs = opt.delayMs ?? 200;
  const onProgress = opt.onProgress || (() => {});

  const host = siteHost(startUrl);
  if (!host) throw new Error(`不是合法的 URL：${startUrl}`);

  // ── 先读 robots.txt。爬之前必须先问准许不准许 ──────────────────────────
  const robotsUrl = new URL('/robots.txt', startUrl).href;
  const rres = await fetchPage(robotsUrl, { accept: 'text/plain' });
  const status = interpretStatus(rres.status, rres.error);
  const parsedRobots = status.mode === 'parse' ? parseRobotsTxt(rres.body) : parseRobotsTxt('');

  const robots = {
    url: robotsUrl,
    status: rres.status,
    error: rres.error,
    mode: status.mode,
    reason: status.reason,
    sitemaps: parsedRobots.sitemaps,
    parsed: parsedRobots,
  };

  /**
   * 两个不同的问题，都要答：
   *   googlebot 允不允许 —— 这是 SEO 上真正关心的
   *   `*` 允不允许       —— 这是我们自己该守的规矩
   * 只要有一边禁止就不抓，但要分别记下来。
   */
  const verdict = (url) => {
    if (status.mode === 'allow-all') return { googlebot: true, us: true, rule: null };
    if (status.mode === 'blocked') {
      return { googlebot: false, us: false, rule: null, blockedByStatus: true };
    }
    const g = isAllowed(parsedRobots, url, 'googlebot');
    const s = isAllowed(parsedRobots, url, '*');
    return { googlebot: g.allowed, us: s.allowed, rule: (g.allowed ? s : g).rule };
  };

  // ── BFS ────────────────────────────────────────────────────────────────
  const seen = new Set(); // 归一化后的 key，防重复抓
  /** 归一化 key → 所有指向它的链接。**发现了但没抓的也要计入** */
  const inbound = new Map();
  const pages = [];
  const skipped = [];

  const keyOf = (u) => normalizeUrl(u) || u;

  const noteInbound = (url, from, anchorText, nofollow) => {
    const k = keyOf(url);
    if (!inbound.has(k)) inbound.set(k, []);
    inbound.get(k).push({ from, anchorText, nofollow });
  };

  let queue = [{ url: startUrl, depth: 0, from: null, anchorText: null, nofollow: false }];
  seen.add(keyOf(startUrl));
  let stopReason = 'done';

  while (queue.length > 0) {
    if (pages.length >= maxPages) {
      stopReason = 'maxPages';
      for (const q of queue) skipped.push({ url: q.url, from: q.from, reason: '超出总量上限' });
      break;
    }

    const batch = queue.splice(0, Math.min(concurrency, maxPages - pages.length));
    const results = await Promise.all(
      batch.map(async (item) => {
        const v = verdict(item.url);
        if (!v.googlebot || !v.us) {
          return {
            skip: {
              url: item.url,
              from: item.from,
              reason: v.blockedByStatus
                ? `robots.txt ${robots.status || '请求失败'}，按整站禁止抓取处理`
                : `robots.txt 禁止（规则 ${v.rule ? (v.rule.allow ? 'Allow' : 'Disallow') + ': ' + v.rule.path : '未知'}）` +
                  (v.googlebot !== v.us ? `｜googlebot ${v.googlebot ? '允许' : '禁止'}、* ${v.us ? '允许' : '禁止'}` : ''),
            },
          };
        }

        const res = await fetchPage(item.url);
        return { item, res };
      })
    );

    const nextLinks = [];

    for (const r of results) {
      if (r.skip) {
        skipped.push(r.skip);
        continue;
      }
      const { item, res } = r;

      const page = {
        url: item.url,
        normalized: keyOf(item.url),
        depth: item.depth,
        from: item.from,
        anchorText: item.anchorText,
        status: res.status,
        error: res.error,
        finalUrl: res.finalUrl,
        redirected: res.redirected,
        contentType: res.contentType,
        html: false,
        findings: [],
        facts: null,
        outLinks: 0,
      };

      if (res.error || !res.ok) {
        // 死链和错误页 —— 这是单页检查看不到、只有爬全站才捞得到的东西
        pages.push(page);
        onProgress({ done: pages.length, queued: queue.length, url: item.url, status: res.status });
        continue;
      }

      if (!isHtml(res.contentType)) {
        page.html = false;
        pages.push(page);
        onProgress({ done: pages.length, queued: queue.length, url: item.url, status: res.status });
        continue;
      }

      page.html = true;
      const analysis = analyzePage(res.body, {
        url: res.finalUrl,
        headers: res.headers,
      });
      page.findings = analysis.findings;
      page.facts = analysis.facts;

      const $ = load(res.body);
      const links = extractLinks($, res.finalUrl);
      page.outLinks = links.length;

      for (const l of links) {
        noteInbound(l.url, item.url, l.anchorText, l.nofollow);
        const k = keyOf(l.url);
        if (seen.has(k)) continue;
        if (item.depth + 1 > maxDepth) {
          skipped.push({ url: l.url, from: item.url, reason: `超出深度上限 ${maxDepth}` });
          seen.add(k); // 记下来，免得每次遇到都塞一条
          continue;
        }
        seen.add(k);
        nextLinks.push({
          url: l.url,
          depth: item.depth + 1,
          from: item.url,
          anchorText: l.anchorText,
          nofollow: l.nofollow,
        });
      }

      pages.push(page);
      onProgress({ done: pages.length, queued: queue.length + nextLinks.length, url: item.url, status: res.status });
    }

    queue.push(...nextLinks);
    if (queue.length && delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }

  // 把入链挂回每个页面
  for (const p of pages) {
    const links = inbound.get(p.normalized) || [];
    p.inbound = links;
    p.inboundCount = links.length;
    // 只有 nofollow 链接指向它 —— Google 可能不跟进，等于半个孤儿
    p.nofollowOnly = links.length > 0 && links.every((l) => l.nofollow);
  }

  // ── sitemap 差集：只在 sitemap 里、从首页走不到的，就是孤儿页 ──────────
  let sitemap = null;
  const wanted = opt.sitemap === false ? [] : Array.isArray(opt.sitemap) ? opt.sitemap : robots.sitemaps;
  if (wanted.length) {
    onProgress({ done: pages.length, queued: 0, url: '（展开 sitemap）', status: '' });
    const collected = await collectSitemapUrls(wanted);

    const reachable = new Set(pages.map((p) => p.normalized));
    const sitemapKeys = new Map(); // 归一化 key → 原始 URL
    for (const u of collected.urls) sitemapKeys.set(keyOf(u), u);

    const orphans = [...sitemapKeys.entries()].filter(([k]) => !reachable.has(k)).map(([, u]) => u);
    const notInSitemap = pages.filter((p) => !sitemapKeys.has(p.normalized)).map((p) => p.url);

    sitemap = {
      files: collected.files,
      truncated: collected.truncated,
      total: sitemapKeys.size,
      orphans,
      notInSitemap,
    };
  }

  return {
    start: startUrl, host, robots, pages, skipped, inbound,
    stopReason, maxPages, maxDepth, sitemap,
  };
}

/**
 * 按规则聚合 —— 这是批量体检真正的价值所在。
 *
 * 一条规则命中 18/20 页，说明它是**模板层**问题：改一处修全站。
 * 逐页罗列 60 条问题没人看得下去，聚合后一眼就能看出该动模板还是动单页。
 */
function aggregateFindings(pages) {
  const htmlPages = pages.filter((p) => p.html);
  const byRule = new Map();

  for (const p of htmlPages) {
    for (const f of p.findings) {
      if (!byRule.has(f.rule)) {
        byRule.set(f.rule, { rule: f.rule, group: f.group, level: f.level, pages: [], sample: f });
      }
      byRule.get(f.rule).pages.push(p.url);
    }
  }

  return [...byRule.values()]
    .map((r) => ({ ...r, count: r.pages.length, ratio: r.pages.length / (htmlPages.length || 1) }))
    .sort((a, b) => b.count - a.count);
}

/** 按 URL 路径的第一段分组 —— 粗略但有效地对应「模板」 */
function groupByPathPrefix(pages) {
  const groups = new Map();
  for (const p of pages) {
    let seg = '/';
    try {
      seg = '/' + (new URL(p.url).pathname.split('/').filter(Boolean)[0] || '');
    } catch {
      /* 用默认值 */
    }
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg).push(p);
  }
  return [...groups.entries()]
    .map(([prefix, list]) => ({ prefix, count: list.length, pages: list }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { crawlSite, aggregateFindings, groupByPathPrefix, extractLinks };
