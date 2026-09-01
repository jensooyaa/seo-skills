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
];

module.exports = { group: GROUP, rules };
