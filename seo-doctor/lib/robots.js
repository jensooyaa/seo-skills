/**
 * robots.txt 解析与匹配。
 *
 * 判定规则全部照 Google 官方规范实现，不是经验总结：
 * https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
 *
 * 之所以这一段值得写成代码（而不是像别的规则那样写成给 Agent 看的清单）：
 * 爬虫每抓一个 URL 都要判一次，几百次判定必须每次都一样。而这套规则反直觉的地方
 * 特别多 —— 分组怎么选、平局怎么破、`/fish` 匹配 `/fishheads` 但 `/fish/` 不匹配
 * `/fish` —— 靠人（或模型）每次现判，迟早判错，而且错了没人知道。
 *
 * 对应的人类可读说明在 `references/rules-indexing.md`。**两边必须一致**。
 */

'use strict';

/**
 * 解析 robots.txt 文本。
 *
 * 分组规则：连续的 User-agent 行属于同一组；出现规则行之后再出现 User-agent 行，
 * 就是新的一组开始。
 *
 * @returns {{groups: Array<{agents: string[], rules: Array<{allow: boolean, path: string}>}>, sitemaps: string[]}}
 */
function parseRobotsTxt(text) {
  const groups = [];
  const sitemaps = [];

  let current = null;
  // 刚读过规则行之后再遇到 User-agent，说明上一组结束了
  let sawRuleInCurrent = false;

  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    // 注释可以出现在行尾
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx < 0) continue;

    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || sawRuleInCurrent) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRuleInCurrent = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      // 组外的规则行没有归属，忽略
      if (!current) continue;
      sawRuleInCurrent = true;
      /**
       * 空值是「什么都不限制」，是个空操作 —— 不能当成一条匹配所有路径的规则，
       * 否则 `Disallow:` 会把全站挡住，正好搞反。
       */
      if (value === '') continue;
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }

  return { groups, sitemaps };
}

/**
 * 挑出适用于某个 user-agent 的规则集。
 *
 * Google 的规则：
 *   - 找 user-agent **最具体**的那一组。有具体分组时，`*` 那组**整个忽略**
 *     （不是合并 —— 这点最容易搞错）
 *   - 同一个具体 user-agent 声明了多个分组 → 这几组的规则**合并**
 *   - 没有具体分组 → 用 `*`
 */
function rulesFor(parsed, userAgent) {
  const ua = String(userAgent || '*').toLowerCase();

  const specific = [];
  const wildcard = [];
  for (const g of parsed.groups) {
    if (g.agents.includes(ua)) specific.push(...g.rules);
    else if (g.agents.includes('*')) wildcard.push(...g.rules);
  }

  return specific.length > 0 || parsed.groups.some((g) => g.agents.includes(ua))
    ? specific
    : wildcard;
}

/**
 * 把 robots.txt 的路径模式编译成正则。
 *
 * 两个通配符：`*` 任意长度任意字符，`$` 锚定 URL 结尾。
 * 没有 `$` 时是**前缀匹配** —— 所以 `/fish` 匹配 `/fishheads`。
 * 路径**大小写敏感**。
 */
function compilePath(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  // 除 * 之外的正则元字符全部转义
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/** URL 里参与 robots 匹配的部分：路径 + 查询串（不含 host、不含 fragment）。 */
function pathAndQuery(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    // 已经是路径形态的直接用
    return String(url).split('#')[0];
  }
}

/**
 * 这个 URL 允不允许抓。
 *
 * 判定顺序（Google 规范）：
 *   1. 取适用分组的全部规则
 *   2. 路径模式匹配上的规则里，**写得最长的赢**
 *   3. 长度相同时，**限制最少的赢**（即 Allow 赢）
 *   4. 一条都没匹配上 → 允许
 *
 * @returns {{allowed: boolean, rule: object|null}} rule 是生效的那条，报告里要引用它
 */
function isAllowed(parsed, url, userAgent) {
  const rules = rulesFor(parsed, userAgent);
  const target = pathAndQuery(url);

  let best = null;
  for (const r of rules) {
    if (!compilePath(r.path).test(target)) continue;
    if (
      best === null ||
      r.path.length > best.path.length ||
      // 平局：限制最少的赢
      (r.path.length === best.path.length && r.allow && !best.allow)
    ) {
      best = r;
    }
  }

  return { allowed: best === null ? true : best.allow, rule: best };
}

/**
 * 按 HTTP 状态码解释一份 robots.txt 该怎么用。
 *
 * ⚠️ 4xx 和 5xx 的处理**方向相反**，这是最容易搞错的地方：
 *   4xx（429 除外）→ 当作没有 robots.txt，**不设任何限制**。404 是常态，不是错误
 *   5xx / 429 / 网络错误 → Google 前 12 小时**停止抓取**。一个挂掉的 robots.txt
 *                          能让全站掉出索引，这个必须报
 *
 * @returns {{mode: 'parse'|'allow-all'|'blocked', reason: string}}
 */
function interpretStatus(status, networkError) {
  if (networkError) {
    return { mode: 'blocked', reason: `请求失败（${networkError}），Google 按服务器错误处理` };
  }
  if (status >= 200 && status < 300) {
    return { mode: 'parse', reason: `${status}，按内容执行` };
  }
  if (status === 429 || status >= 500) {
    return {
      mode: 'blocked',
      reason: `${status}，Google 会临时按「整站禁止抓取」处理（前 12 小时停止抓取）`,
    };
  }
  if (status >= 400) {
    return { mode: 'allow-all', reason: `${status}，等于没有 robots.txt，不设任何抓取限制` };
  }
  return { mode: 'allow-all', reason: `${status}，按无限制处理` };
}

module.exports = { parseRobotsTxt, rulesFor, isAllowed, interpretStatus, compilePath };
