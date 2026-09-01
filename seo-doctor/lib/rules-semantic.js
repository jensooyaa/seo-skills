/**
 * 语义化组的规则实现。
 *
 * 判定条件、级别、detail 文案、以及每条的「已知边界」全部来自
 * `references/rules-semantic.md`，**改判定必须同步改那份表** ——
 * 报告里的「为什么 / 怎么改」是按规则 ID 从那张表查的，两边脱节的话
 * 报告会说一套、脚本做另一套。
 *
 * 当前实现：标题组 3 条。其余 7 条按组分批加，每批跑一次 npm run ruletest。
 */

'use strict';

const {
  finding,
  outer,
  openTag,
  textOf,
  landmarkHint,
  EVIDENCE_MAX_LEN,
} = require('./rule-utils.js');

const GROUP = '语义化';

/** 文档顺序的全部标题元素。cheerio 的多选择器返回的就是文档顺序。 */
function headings($) {
  return $('h1, h2, h3, h4, h5, h6').toArray();
}

const levelOf = (el) => Number((el.tagName || el.name).slice(1));

/**
 * 「没描述内容」的 alt 词表。全等匹配，比较前 trim + 转小写。
 *
 * 刻意不做包含匹配 —— 「产品主图：三名工程师在展会上查看样品」包含「主图」，
 * 但它是好 alt。包含匹配会把这类全部误报掉。
 *
 * 单独导出是为了将来接项目级的 `seo-rules.md` 时能往里追加词。
 */
const PLACEHOLDER_ALT_WORDS = new Set([
  'image', 'img', 'photo', 'picture', 'banner', 'icon', 'logo', 'placeholder', 'untitled',
  '图片', '图', '照片', '图标', '横幅', '未命名',
]);

/** alt 直接就是个文件名 —— 描述的是文件，不是图里的内容 */
const ALT_LOOKS_LIKE_FILENAME = /\.(jpe?g|png|gif|webp|svg|avif)$/i;

/** 编号式：图1 / image_2 / pic-3 */
const ALT_NUMBERED = /^(图|图片|image|img|photo|pic)[\s_-]?\d+$/i;

/** 相机默认命名：DSC_0123 / IMG-4567 */
const ALT_CAMERA_DEFAULT = /^(dsc|img)[_-]?\d+$/i;

function isMeaninglessAlt(alt) {
  const norm = alt.trim().toLowerCase();
  if (norm === '') return false; // alt="" 是装饰图的规范写法，归 img-alt-missing 的边界管
  return (
    PLACEHOLDER_ALT_WORDS.has(norm) ||
    ALT_LOOKS_LIKE_FILENAME.test(norm) ||
    ALT_NUMBERED.test(norm) ||
    ALT_CAMERA_DEFAULT.test(norm)
  );
}

/** 图片的标识：优先 src，没有 src（比如只写了 srcset）时退回开标签 */
function imgIdent($, el) {
  return el.attribs && el.attribs.src ? el.attribs.src : openTag($, el);
}

/**
 * 无意义锚文本词表。全等匹配（trim + 转小写后比较）。
 *
 * 同样不做包含匹配 —— 「了解更多关于供应商准入的信息」是好锚文本，
 * 包含匹配会把它误报掉。
 */
const GENERIC_ANCHOR_WORDS = new Set([
  '点击这里', '点这里', '这里', '更多', '了解更多', '查看更多', '阅读更多',
  '详情', '查看详情', '详细',
  'click here', 'read more', 'learn more', 'more', 'here', 'link',
  'this page', 'view more', 'see more',
]);

/**
 * href 里没有真实跳转目标。
 *
 * 比规则表原先列举的几种形态宽一点：**任何 `javascript:` 开头的 href 都算**，
 * 不只 `void(0)` 和 `;`。理由是 `javascript:doSomething()` 同样没给爬虫任何
 * 可跟进的目标，性质完全一样，没道理放过。
 */
function hasNoRealHref(el) {
  const raw = el.attribs ? el.attribs.href : undefined;
  if (raw === undefined) return true;

  const href = raw.trim();
  if (href === '' || href === '#') return true;

  // ⚠️ `#section-id`（# 后面有内容）是合法的页内锚点，不报。只有光秃秃的 # 才算。
  return href.toLowerCase().startsWith('javascript:');
}

/** onclick 里出现这些词，基本可以断定它在做跳转而不是别的交互 */
const ONCLICK_NAVIGATES = /location|href|open\(|push\(|navigate|router/i;

/**
 * 取链接的锚文本。
 *
 * a 里只放一张图时，锚文本取该图的 alt —— 对搜索引擎来说图片链接的 alt
 * 就承担锚文本的角色。alt 空或缺失的图片链接交给 img-alt-missing 管，
 * 本条不重复报，所以返回空串。
 */
/** 要检查的四个地标标签，顺序固定 —— 报告里的措辞要稳定。 */
const LANDMARKS = ['main', 'nav', 'header', 'footer'];

/**
 * 地标缺失时，找找页面里有没有「一看就是拿 div 当它用」的元素。
 *
 * 这条不是判定的一部分，只进证据 —— 但它把「缺少 <header>」变成了
 * 「把 `<div class="site-header">` 改成 `<header>` 就行」，对开发有用得多。
 * 命名匹配难免有噪音（`domain-header` 也会命中），所以措辞写「疑似」。
 */
function suspectedLandmarkDiv($, name) {
  const hit = $(`div[class*="${name}"], div[id*="${name}"]`).first();
  return hit.length ? `疑似用 div 代替：${openTag($, hit.get(0))}` : null;
}

function anchorText($, el) {
  const own = $(el).text().trim();
  if (own !== '') return own;

  const imgs = $(el).find('img');
  if (imgs.length === 1) return (imgs.get(0).attribs.alt || '').trim();
  return '';
}

const rules = [
  {
    id: 'h1-missing',
    level: '阻断',
    run($) {
      if ($('h1').length !== 0) return null;

      // 证据给第一个 h2 —— 提示「是不是本该是 h1」，比空证据有用得多
      const firstH2 = $('h2').first();
      return finding({
        rule: 'h1-missing',
        group: GROUP,
        level: '阻断',
        detail: '页面中 <h1> 数量为 0',
        evidence: firstH2.length ? [`页面第一个标题是 ${outer($, firstH2.get(0))}`] : [],
      });
    },
  },

  {
    id: 'h1-multiple',
    level: '警告',
    run($) {
      const all = $('h1').toArray();
      if (all.length <= 1) return null;

      return finding({
        rule: 'h1-multiple',
        group: GROUP,
        level: '警告',
        detail: `页面中有 ${all.length} 个 <h1>`,
        // 带上文本内容和所在地标，人一眼能分出「logo 用了 h1」还是「多个模板各写了一个」。
        // 先给地标提示留出位置再截标题内容 —— 否则长标题会把提示挤掉，
        // 而那段提示正是用来区分两种来源的关键信息
        evidence: all.map((el) => {
          const hint = landmarkHint($, el);
          return `${outer($, el, EVIDENCE_MAX_LEN - hint.length)}${hint}`;
        }),
        count: all.length,
      });
    },
  },

  {
    id: 'heading-skip',
    level: '警告',
    run($) {
      const all = headings($);
      const skips = [];

      for (let i = 1; i < all.length; i++) {
        const prev = levelOf(all[i - 1]);
        const cur = levelOf(all[i]);
        // ⚠️ 只查递增方向。递减（h4 → h2）是正常的章节结束，不报。
        if (cur - prev > 1) skips.push({ index: i, prev: all[i - 1], cur: all[i] });
      }

      if (skips.length === 0) return null;

      const first = skips[0];
      const detail =
        skips.length === 1
          ? `第 ${first.index + 1} 个标题「${textOf($, first.cur)}」从 h${levelOf(first.prev)} 直接跳到 h${levelOf(first.cur)}`
          : `标题层级有 ${skips.length} 处跳级`;

      return finding({
        rule: 'heading-skip',
        group: GROUP,
        level: '警告',
        detail,
        evidence: skips.map(
          (s) => `${openTag($, s.prev)}「${textOf($, s.prev)}」→ ${openTag($, s.cur)}「${textOf($, s.cur)}」`
        ),
        count: skips.length,
      });
    },
  },

  {
    id: 'img-alt-missing',
    level: '警告',
    run($) {
      // ⚠️ `:not([alt])` 判的是「属性不存在」。alt="" 有属性，落不进来 ——
      // 装饰图写空 alt 恰恰是规范做法，把它算作缺失是典型误报。
      const hits = $('img:not([alt])').toArray();
      if (hits.length === 0) return null;

      return finding({
        rule: 'img-alt-missing',
        group: GROUP,
        level: '警告',
        detail: `${hits.length} 张图片没有 alt 属性`,
        evidence: hits.map((el) => imgIdent($, el)),
        count: hits.length,
      });
    },
  },

  {
    id: 'img-alt-meaningless',
    level: '建议',
    run($) {
      const hits = $('img[alt]')
        .toArray()
        .filter((el) => isMeaninglessAlt(el.attribs.alt || ''));
      if (hits.length === 0) return null;

      return finding({
        rule: 'img-alt-meaningless',
        group: GROUP,
        level: '建议',
        detail: `${hits.length} 张图片的 alt 没有描述内容`,
        // alt 原文 + src，两个都要 —— 只给 alt 的话人找不到是哪张图
        evidence: hits.map((el) => `alt="${el.attribs.alt}" ← ${imgIdent($, el)}`),
        count: hits.length,
      });
    },
  },

  {
    id: 'link-empty-href',
    level: '警告',
    run($) {
      const hits = $('a').toArray().filter(hasNoRealHref);
      if (hits.length === 0) return null;

      return finding({
        rule: 'link-empty-href',
        group: GROUP,
        level: '警告',
        detail: `${hits.length} 个 <a> 没有真实的跳转地址`,
        evidence: hits.map((el) => `${openTag($, el)}「${textOf($, el)}」`),
        count: hits.length,
      });
    },
  },

  {
    id: 'link-fake',
    level: '警告',
    run($) {
      /**
       * ⚠️ 本条召回率低，只作补充 —— 它只看得到写在 HTML 里的内联 onclick。
       * React / Vue 用 JSX 的 onClick 或 addEventListener 绑的事件，在服务端
       * 返回的 HTML 里一个字都看不到，而那恰恰是现代前端的主流写法。
       * 「没报」在这条上完全不等于「没问题」，报告里必须带这句免责说明。
       *
       * 选择器比规则表原先的 div/span/button 宽 —— 改成「除 a 之外任何带
       * onclick 的元素」。老代码里 li / tr / td 当链接用同样常见，而精度是靠
       * 下面那个跳转关键词过滤保证的，放宽选择器不影响误报率。
       */
      const hits = $('[onclick]')
        .toArray()
        .filter((el) => (el.tagName || el.name) !== 'a')
        .filter((el) => ONCLICK_NAVIGATES.test(el.attribs.onclick || ''));
      if (hits.length === 0) return null;

      return finding({
        rule: 'link-fake',
        group: GROUP,
        level: '警告',
        detail: `${hits.length} 处用非链接元素做跳转`,
        evidence: hits.map((el) => `${openTag($, el)}「${textOf($, el)}」`),
        count: hits.length,
      });
    },
  },

  {
    id: 'anchor-text-generic',
    level: '建议',
    run($) {
      const hits = $('a')
        .toArray()
        .filter((el) => GENERIC_ANCHOR_WORDS.has(anchorText($, el).toLowerCase()));
      if (hits.length === 0) return null;

      return finding({
        rule: 'anchor-text-generic',
        group: GROUP,
        level: '建议',
        detail: `${hits.length} 个链接使用了无意义锚文本`,
        // aria-label 写清楚了本条也照报（搜索引擎主要看可见文本），
        // 但放进证据里，方便人判断优先级
        evidence: hits.map((el) => {
          const label = el.attribs['aria-label'];
          return (
            `「${anchorText($, el)}」→ ${el.attribs.href || '(无 href)'}` +
            (label ? `（aria-label="${label}"）` : '')
          );
        }),
        count: hits.length,
      });
    },
  },

  {
    id: 'landmark-missing',
    level: '建议',
    run($) {
      const missing = LANDMARKS.filter((tag) => $(tag).length === 0);
      if (missing.length === 0) return null;

      return finding({
        rule: 'landmark-missing',
        group: GROUP,
        level: '建议',
        detail: `页面缺少地标标签：${missing.join('、')}`,
        evidence: missing.map((tag) => {
          const hint = suspectedLandmarkDiv($, tag);
          return hint ? `<${tag}>　${hint}` : null;
        }),
        count: missing.length,
      });
    },
  },

  {
    id: 'landmark-duplicate',
    level: '警告',
    run($) {
      /**
       * ⚠️ 只查 main。nav / header / footer **允许多个** —— 顶部一个 nav、
       * 页脚再一个 nav 是完全正常的写法，查它们就是纯误报。
       */
      const all = $('main').toArray();
      if (all.length <= 1) return null;

      return finding({
        rule: 'landmark-duplicate',
        group: GROUP,
        level: '警告',
        detail: `页面中有 ${all.length} 个 <main>`,
        evidence: all.map((el) => openTag($, el)),
        count: all.length,
      });
    },
  },
];

module.exports = { group: GROUP, rules, PLACEHOLDER_ALT_WORDS, GENERIC_ANCHOR_WORDS };
