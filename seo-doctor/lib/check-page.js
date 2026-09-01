/**
 * M1 单页检查的编排层 + 统一输出层。
 *
 * 对外只有一个函数 `checkHtml(html, options)`。四组检查来源不同 ——
 * 语义化看标签、元信息看 head、索引指令还要看响应头和 robots.txt ——
 * 全部在这里归一成同一种 finding 结构。
 *
 * **这个函数签名是所有上层模块的接缝**：报告生成、爬虫的批量体检、
 * GSC 交叉分析吃的都是它的输出。签名和输出结构不要轻易改。
 *
 * ⚠️ 全文件没有一处 `fs`。早先有个 `--file` 模式用 fs.readFileSync 读本地
 * HTML，被平台安全扫描报 DATA_EXFIL_JS_FS_ACCESS(HIGH)「可能读取敏感数据」。
 * 那只是本地调试的便利，换一条每位同事导入时都会看到的 HIGH 不值得。
 * 要检查本地 HTML，在开发仓库里直接调本函数。
 */

'use strict';

const { load } = require('./vendor/cheerio.js');

const RULE_MODULES = [require('./rules-semantic.js')];

/** 级别从重到轻。报告分组、排序都按这个顺序。 */
const LEVELS = ['阻断', '警告', '建议'];

/** 全部已实现的规则组名。 */
const ALL_GROUPS = RULE_MODULES.map((m) => m.group);

/** 全部已实现的规则 ID —— 测试框架用它校验用例里写的规则名有没有拼错。 */
const ALL_RULE_IDS = RULE_MODULES.flatMap((m) => m.rules.map((r) => r.id));

/**
 * 检查一份 HTML。
 *
 * @param {string} html      页面源码。**服务端返回的原始 HTML**，不是渲染后的 DOM
 * @param {object} [options]
 * @param {string} [options.url]      页面 URL。canonical 归一化等规则要用
 * @param {object} [options.headers]  响应头。X-Robots-Tag 只能从这里拿到
 * @param {object} [options.robots]   同源 robots.txt 的抓取结果
 * @param {string[]} [options.groups] 只跑这几组，缺省全跑。测试用
 * @returns {object[]} findings，按级别从重到轻排序
 */
function checkHtml(html, options = {}) {
  const $ = load(html == null ? '' : html);

  const ctx = {
    $,
    url: options.url || null,
    headers: normalizeHeaders(options.headers),
    robots: options.robots || null,
  };

  const wanted = options.groups ? new Set(options.groups) : null;
  const findings = [];

  for (const mod of RULE_MODULES) {
    if (wanted && !wanted.has(mod.group)) continue;
    for (const rule of mod.rules) {
      // 单条规则出错不该让整次检查失败 —— 报出来，其余规则继续跑
      let hit;
      try {
        hit = rule.run($, ctx);
      } catch (err) {
        findings.push({
          rule: rule.id,
          group: mod.group,
          level: '警告',
          detail: `规则 ${rule.id} 执行出错：${err.message}`,
          evidence: [],
          count: 1,
          error: true,
        });
        continue;
      }
      if (hit) findings.push(hit);
    }
  }

  return findings.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}

/** 响应头统一成小写键 —— HTTP 头名大小写不敏感，各家服务器写法不一。 */
function normalizeHeaders(headers) {
  if (!headers) return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

module.exports = { checkHtml, LEVELS, ALL_GROUPS, ALL_RULE_IDS };
