/**
 * 元信息组的规则实现。
 *
 * 判定条件、级别、detail 文案、以及每条的「已知边界」全部来自
 * `references/rules-meta.md`，**改判定必须同步改那份表**。
 */

'use strict';

const { finding, clip, outer, openTag } = require('./rule-utils.js');
const { normalizeUrl, resolveBase } = require('./url-normalize.js');

const GROUP = '元信息';

/** title / description 的长度阈值，单位是「半角当量」，见规则表开头那节。 */
const TITLE_MIN = 15;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

/** 分享卡片的三个必需项。og:url / og:type / og:site_name 是推荐项，不查。 */
const OG_REQUIRED = ['og:title', 'og:description', 'og:image'];

/**
 * 东亚全角字符。这些字的显示宽度约等于两个半角字符。
 * 范围取自 Unicode 的 East Asian Wide / Fullwidth 两类。
 */
const FULL_WIDTH =
  /[ᄀ-ᅟ⺀-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/;

/**
 * 「半角当量」长度。
 *
 * ⚠️ 不能用 `str.length`。**Google 是按像素宽度截断的，不是按字符数** ——
 * 一个汉字约等于两个英文字母宽。按字符数算的话，中文页面会被判成「太短」、
 * 英文页面被判成「太长」，两头都错。
 */
function displayWidth(str) {
  let w = 0;
  for (const ch of str) w += FULL_WIDTH.test(ch) ? 2 : 1;
  return w;
}


const ogValue = (head, key) => head.metaByProperty.get(key) ?? head.metaByName.get(key);

const rules = [
  {
    id: 'title-missing',
    level: '阻断',
    run($) {
      // ⚠️ 只看 head 里的 title。正文里内联 SVG 的 <title> 是图形的无障碍标题，无关
      const el = $('head > title').first();
      const text = el.length ? el.text().trim() : null;
      if (text) return null;

      const h1 = $('h1').first();
      return finding({
        rule: 'title-missing',
        group: GROUP,
        level: '阻断',
        detail: el.length ? '页面的 title 是空的' : '页面没有 title',
        evidence: h1.length ? [`页面的 h1 是 ${outer($, h1.get(0))}，title 可以据此写`] : [],
      });
    },
  },

  {
    id: 'title-length',
    level: '建议',
    run($) {
      const text = ($('head > title').first().text() || '').trim();
      if (!text) return null; // 空的交给 title-missing，本条不重复报

      const w = displayWidth(text);
      if (w >= TITLE_MIN && w <= TITLE_MAX) return null;

      return finding({
        rule: 'title-length',
        group: GROUP,
        level: '建议',
        detail:
          w < TITLE_MIN
            ? `title 显示宽度 ${w}，低于建议下限 ${TITLE_MIN}，信息量不足`
            : `title 显示宽度 ${w}，超出建议上限 ${TITLE_MAX}，搜索结果里会被截断`,
        evidence: [clip(text)],
      });
    },
  },

  {
    id: 'description-missing',
    level: '警告',
    run($, ctx) {
      const has = ctx.head.metaByName.has('description');
      const value = (ctx.head.metaByName.get('description') || '').trim();
      if (value) return null;

      return finding({
        rule: 'description-missing',
        group: GROUP,
        level: '警告',
        detail: has ? 'meta description 的内容是空的' : '页面没有 meta description',
        evidence: [],
      });
    },
  },

  {
    id: 'description-length',
    level: '建议',
    run($, ctx) {
      const text = (ctx.head.metaByName.get('description') || '').trim();
      if (!text) return null; // 交给 description-missing

      const w = displayWidth(text);
      if (w >= DESC_MIN && w <= DESC_MAX) return null;

      return finding({
        rule: 'description-length',
        group: GROUP,
        level: '建议',
        detail:
          w < DESC_MIN
            ? `description 显示宽度 ${w}，低于建议下限 ${DESC_MIN}，信息量不足`
            : `description 显示宽度 ${w}，超出建议上限 ${DESC_MAX}，搜索结果里会被截断`,
        evidence: [clip(text)],
      });
    },
  },

  {
    id: 'canonical-missing',
    level: '警告',
    run($, ctx) {
      if (ctx.head.canonicals.length > 0) return null;
      return finding({
        rule: 'canonical-missing',
        group: GROUP,
        level: '警告',
        detail: '页面没有 canonical',
        evidence: [],
      });
    },
  },

  {
    id: 'canonical-multiple',
    level: '警告',
    run($, ctx) {
      const all = ctx.head.canonicals;
      if (all.length <= 1) return null;

      /**
       * Google 的明文规定是「出现多个 canonical 时全部忽略」——
       * 多写一个不是多一层保险，而是一个都不生效。
       */
      return finding({
        rule: 'canonical-multiple',
        group: GROUP,
        level: '警告',
        detail: `页面有 ${all.length} 个 canonical`,
        evidence: all.map((el) => openTag($, el)),
        count: all.length,
      });
    },
  },

  {
    id: 'canonical-mismatch',
    level: '警告',
    run($, ctx) {
      // 没有页面 URL 就没有对照物，无从判断 —— 不报
      if (!ctx.url) return null;
      // 多个 canonical 时 Google 全部忽略，比对哪一个都没意义，交给 canonical-multiple
      if (ctx.head.canonicals.length !== 1) return null;

      const raw = ((ctx.head.canonicals[0].attribs || {}).href || '').trim();
      if (!raw) return null;

      // ⚠️ base 自己可能是协议相对的（//cdn.example.com/），必须先对着页面 URL
      // 解析一次拿到绝对地址，否则 new URL(raw, base) 会抛，合法 canonical 被误报
      const base = resolveBase(ctx.head.baseHref, ctx.url) || ctx.url;

      const canon = normalizeUrl(raw, base);
      const page = normalizeUrl(ctx.url);
      if (canon === null) {
        return finding({
          rule: 'canonical-mismatch',
          group: GROUP,
          level: '警告',
          detail: 'canonical 的值不是一个合法的 URL',
          evidence: [`canonical: ${clip(raw)}`, `当前页面: ${clip(ctx.url)}`],
        });
      }
      if (page === null || canon === page) return null;

      return finding({
        rule: 'canonical-mismatch',
        group: GROUP,
        level: '警告',
        detail: 'canonical 指向了另一个地址',
        evidence: [
          `当前页面: ${clip(ctx.url)}`,
          `canonical: ${clip(raw)}`,
          `归一化后: ${clip(page)}  ≠  ${clip(canon)}`,
        ],
      });
    },
  },

  {
    id: 'lang-missing',
    level: '警告',
    run($) {
      const html = $('html').first();
      if ((html.attr('lang') || '').trim()) return null;

      return finding({
        rule: 'lang-missing',
        group: GROUP,
        level: '警告',
        detail: '<html> 缺少 lang 属性',
        evidence: html.length ? [openTag($, html.get(0))] : [],
      });
    },
  },

  {
    id: 'viewport-missing',
    level: '警告',
    run($, ctx) {
      if (ctx.head.metaByName.has('viewport')) return null;
      return finding({
        rule: 'viewport-missing',
        group: GROUP,
        level: '警告',
        detail: '页面没有 meta viewport',
        evidence: [],
      });
    },
  },

  {
    id: 'og-incomplete',
    level: '建议',
    run($, ctx) {
      const present = OG_REQUIRED.filter((k) => (ogValue(ctx.head, k) || '').trim());
      const missing = OG_REQUIRED.filter((k) => !(ogValue(ctx.head, k) || '').trim());
      if (missing.length === 0) return null;

      return finding({
        rule: 'og-incomplete',
        group: GROUP,
        level: '建议',
        detail:
          present.length === 0
            ? '页面没有 Open Graph 标签，分享到社交平台时没有卡片'
            : `Open Graph 缺少：${missing.join('、')}`,
        evidence: present.map((k) => `${k} = ${clip(ogValue(ctx.head, k))}`),
        count: missing.length,
      });
    },
  },
];

module.exports = { group: GROUP, rules, displayWidth };
