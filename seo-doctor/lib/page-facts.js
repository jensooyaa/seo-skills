/**
 * 页面事实采集 —— 只陈述「页面上有什么」，不做任何判断。
 *
 * 为什么要单独有这一层：
 *
 * 规则只输出「问题」。一个没什么问题的页面，报告就只剩两三行，看的人不知道
 * **到底查了什么、什么是查过且通过的**。实测下来这会有个很糟的后果 ——
 * Agent 会自己拿别的工具去把 meta、OG、结构化数据翻一遍补进报告，而手工翻的
 * 结果不稳定、不可复现，还经常写出「具体值需确认」这种没有结论的话。
 *
 * 所以事实也要由脚本给。给全了，报告既丰富又可复现，Agent 也没有动手的理由。
 *
 * ⚠️ **这里的每一项都必须是客观事实，不能有判断。**
 * 「title 显示宽度 67」是事实；「title 太长了」是判断，那是规则的活儿。
 * 一旦这层开始下判断，就会和规则表两头说话。
 */

'use strict';

const { clip, displayWidth } = require('./rule-utils.js');

/** 标题大纲最多列几条 —— 长页面几十个标题全列出来，报告就没法看了 */
const OUTLINE_MAX = 30;

/** 结构化数据最多列几段 */
const JSONLD_MAX = 10;

/**
 * 从 ld+json 里取出 schema.org 类型名。
 *
 * 三种常见形态都要认：单个对象、数组、以及用 `@graph` 包一层的。
 * 后者是 Yoast、RankMath 这些插件的默认输出，非常常见。
 */
function typesOf(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) typesOf(n, out);
    return out;
  }
  if (Array.isArray(node['@graph'])) for (const n of node['@graph']) typesOf(n, out);
  const t = node['@type'];
  if (typeof t === 'string') out.push(t);
  else if (Array.isArray(t)) out.push(...t.filter((x) => typeof x === 'string'));
  return out;
}

function collectFacts($, ctx) {
  const head = ctx.head;

  const title = ($('head > title').first().text() || '').trim();
  const description = (head.metaByName.get('description') || '').trim();

  const og = ['og:title', 'og:description', 'og:image'].map((key) => ({
    key,
    value: (head.metaByProperty.get(key) ?? head.metaByName.get(key) ?? '').trim() || null,
  }));

  const outline = $('h1, h2, h3, h4, h5, h6')
    .toArray()
    .slice(0, OUTLINE_MAX)
    .map((el) => ({
      level: Number((el.tagName || el.name).slice(1)),
      text: clip($(el).text(), 60),
    }));

  const structured = $('script[type="application/ld+json"]')
    .toArray()
    .slice(0, JSONLD_MAX)
    .map((el) => {
      const raw = $(el).text();
      try {
        return { types: typesOf(JSON.parse(raw)), parseError: null };
      } catch (err) {
        return { types: [], parseError: err.message };
      }
    });

  return {
    title: { value: title || null, width: title ? displayWidth(title) : 0 },
    description: { value: description || null, width: description ? displayWidth(description) : 0 },
    canonical: head.canonicals.map((el) => (el.attribs || {}).href || ''),
    lang: ($('html').first().attr('lang') || '').trim() || null,
    viewport: (head.metaByName.get('viewport') || '').trim() || null,
    /**
     * meta robots 只陈述值，不判断。索引指令组还没实现 ——
     * 但「页面上写着 noindex」是个客观事实，而且是**最要命的那种**，
     * 先摆出来比等那一组做完再说要好。
     */
    metaRobots: (head.metaByName.get('robots') || '').trim() || null,
    og,
    outline,
    outlineTruncated: $('h1, h2, h3, h4, h5, h6').length > OUTLINE_MAX,
    counts: {
      images: $('img').length,
      imagesNoAlt: $('img:not([alt])').length,
      links: $('a').length,
      linksNoHref: $('a:not([href]), a[href=""], a[href="#"]').length,
    },
    landmarks: ['main', 'nav', 'header', 'footer'].map((tag) => ({ tag, count: $(tag).length })),
    structured,
  };
}

module.exports = { collectFacts };
