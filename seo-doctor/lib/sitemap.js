/**
 * sitemap 读取与展开。
 *
 * 只干一件事：把一份（或一组）sitemap 里的 URL 全部取出来。
 * 有了它，「哪些页面只在 sitemap 里、从首页一步都走不到」这个差集就能自动算，
 * 不用人拿两份清单肉眼对。**那批页面就是孤儿页。**
 *
 * 不引 XML 库：sitemap 是机器生成的、格式极其规整，我们只要 `<loc>` 一个字段。
 * 需要处理的四种边界都覆盖了 ——
 *   CDATA         `<loc><![CDATA[https://…]]></loc>`
 *   命名空间前缀   `<sm:loc>…</sm:loc>`
 *   sitemapindex  一份索引指向若干份子 sitemap，要递归展开
 *   .xml.gz       gzip 压缩，用内置 zlib 解
 */

'use strict';

const { gunzipSync } = require('node:zlib');
const { fetchPage } = require('./fetch-page.js');

/** 一次展开最多读几份子 sitemap —— 大站的 sitemapindex 可能有上百份 */
const MAX_SITEMAP_FILES = 50;

/** 取出所有 `<loc>` 的内容。命名空间前缀和 CDATA 都吃得下。 */
function extractLocs(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?loc>/gi)) {
    const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    if (raw) out.push(decodeEntities(raw));
  }
  return out;
}

/** sitemap 里的 URL 常带 `&amp;`，要还原 */
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const isIndex = (xml) => /<(?:[\w-]+:)?sitemapindex\b/i.test(xml);

/** 抓一份 sitemap。`.gz` 结尾的先解压。 */
async function fetchSitemap(url) {
  const res = await fetchPage(url, { accept: 'application/xml,text/xml,*/*' });
  if (res.error) return { url, error: res.error, status: null, xml: null };
  if (!res.ok) return { url, error: null, status: res.status, xml: null };

  let xml = res.body;
  if (/\.gz($|\?)/i.test(url) || res.contentType.includes('gzip')) {
    try {
      // fetchPage 已经按文本读了，要还原成字节再解压
      xml = gunzipSync(Buffer.from(res.body, 'binary')).toString('utf8');
    } catch (err) {
      return { url, error: `gzip 解压失败：${err.message}`, status: res.status, xml: null };
    }
  }
  return { url, error: null, status: res.status, xml };
}

/**
 * 展开一组 sitemap（含 sitemapindex 递归），返回全部 URL。
 *
 * @returns {{urls: string[], files: Array<{url, status, error, count, isIndex}>, truncated: boolean}}
 */
async function collectSitemapUrls(startUrls) {
  const queue = [...startUrls];
  const seenFile = new Set();
  const files = [];
  const urls = [];
  let truncated = false;

  while (queue.length) {
    if (files.length >= MAX_SITEMAP_FILES) {
      truncated = true;
      break;
    }
    const url = queue.shift();
    if (seenFile.has(url)) continue;
    seenFile.add(url);

    const r = await fetchSitemap(url);
    if (!r.xml) {
      files.push({ url, status: r.status, error: r.error, count: 0, isIndex: false });
      continue;
    }

    const locs = extractLocs(r.xml);
    const idx = isIndex(r.xml);
    files.push({ url, status: r.status, error: null, count: locs.length, isIndex: idx });

    // 索引文件里的 <loc> 是子 sitemap 的地址，不是页面地址
    if (idx) queue.push(...locs);
    else urls.push(...locs);
  }

  return { urls: [...new Set(urls)], files, truncated };
}

module.exports = { collectSitemapUrls, extractLocs, fetchSitemap, MAX_SITEMAP_FILES };
