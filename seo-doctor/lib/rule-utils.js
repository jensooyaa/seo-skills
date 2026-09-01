/**
 * 规则实现共用的小工具。
 *
 * 放在单独文件是为了避开循环依赖：check-page.js 要 require 各个 rules-*.js，
 * 而 rules-*.js 又要用这些工具。
 */

'use strict';

/** 证据单条的长度上限。超了就截断 —— 别把整页 HTML 塞进报告和模型上下文。 */
const EVIDENCE_MAX_LEN = 120;

/** 每条规则最多带几条证据。命中总数记在 finding.count 里，不靠证据条数表达。 */
const EVIDENCE_MAX_COUNT = 3;

/** 把多行、连续空白压成单个空格，再按长度截断。 */
function clip(text, max = EVIDENCE_MAX_LEN) {
  const flat = String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * 取元素的完整外层 HTML（含标签本身），截断后用作证据。
 *
 * `max` 可以传小一点，给后面要拼接的上下文（比如 landmarkHint）留出位置 ——
 * 否则拼完再被 finding() 截一次，切掉的正好是那段上下文。
 */
function outer($, el, max = EVIDENCE_MAX_LEN) {
  try {
    return clip($.html(el), max);
  } catch {
    return '';
  }
}

/** 取元素的开标签，不含内容 —— 内容很长时比 outer 清爽。 */
function openTag($, el) {
  const attrs = Object.entries(el.attribs || {})
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`))
    .join('');
  return clip(`<${el.tagName || el.name}${attrs}>`);
}

/** 取元素的可见文本，压平空白。 */
function textOf($, el) {
  return clip($(el).text());
}

/**
 * 找元素所在的地标标签，用来给证据补上下文。
 *
 * 这是换 cheerio 换来的能力 —— 线性 token 流查不了祖先。典型场景是
 * `<nav><h1 class="logo">站名</h1></nav>`：它确实是个多余的 h1 该报，
 * 但人一看到「在 <nav> 内」就立刻知道这是 logo，而不是漏了正文标题。
 *
 * @returns {string} 形如 ' 在 <nav> 内'，找不到时返回空串（可直接拼接）
 */
function landmarkHint($, el) {
  const hit = $(el).closest('nav, header, footer, aside, main');
  if (hit.length === 0) return '';
  const tag = hit.get(0).tagName || hit.get(0).name;
  return ` 在 <${tag}> 内`;
}

/**
 * 构造一条统一格式的 finding。
 *
 * 后面所有模块（报告、爬虫批量体检、GSC 交叉分析）吃的都是这个结构，
 * 这层定死了后面全省事。
 *
 * ⚠️ 刻意不含 `why` / `howto`。报告生成时按 `rule` 去 references/ 下的规则表
 * 查这两段文字，不由脚本携带、更不由模型现编 —— 同一条规则在 20 个页面上命中，
 * 文案只存一份，且每次跑出来措辞完全一致。
 */
function finding({ rule, group, level, detail, evidence = [], count }) {
  return {
    rule,
    group,
    level,
    detail,
    evidence: evidence.filter(Boolean).slice(0, EVIDENCE_MAX_COUNT).map((e) => clip(e)),
    count: count == null ? 1 : count,
  };
}

/**
 * 收集 head 里的 meta / link。
 *
 * 属性**名**在 HTML 里大小写不敏感，但 CSS 属性选择器比较**值**时是敏感的 ——
 * `meta[name="description"]` 匹配不到 `name="Description"`，而这种写法真实存在。
 * 所以这里自己遍历、自己转小写比较，不用选择器。
 */
function collectHead($) {
  const metaByName = new Map();
  const metaByProperty = new Map();

  $('head meta').each((_, el) => {
    const a = el.attribs || {};
    if (a.name) {
      const k = a.name.trim().toLowerCase();
      if (!metaByName.has(k)) metaByName.set(k, a.content == null ? '' : a.content);
    }
    // OG 用的是 property，不是 name。有些站两种都写，都收
    if (a.property) {
      const k = a.property.trim().toLowerCase();
      if (!metaByProperty.has(k)) metaByProperty.set(k, a.content == null ? '' : a.content);
    }
  });

  const canonicals = $('head link')
    .toArray()
    .filter((el) => ((el.attribs || {}).rel || '').trim().toLowerCase() === 'canonical');

  const baseHref = (($('head base').first().attr('href') || '') + '').trim() || null;

  return { metaByName, metaByProperty, canonicals, baseHref };
}

module.exports = {
  EVIDENCE_MAX_LEN,
  EVIDENCE_MAX_COUNT,
  clip,
  outer,
  openTag,
  textOf,
  landmarkHint,
  finding,
  collectHead,
};
