/**
 * URL 归一化 —— 只服务 canonical-mismatch 这一条规则，但值得单独成文件。
 *
 * 它是元信息组里最容易误报的地方：判得太松，模板把所有详情页的 canonical
 * 写死成首页这种致命错误就漏了；判得太严，「canonical 去掉了 utm 参数」
 * 这种完全正当的用法会被报成问题，报几次之后没人再信这个工具。
 *
 * 归一化的思路是：**把「同一个页面的不同写法」抹平，其余的差异都算真差异。**
 */

'use strict';

/**
 * 追踪参数：只用来统计流量来源，不改变页面内容。
 *
 * canonical 把它们去掉正是最典型的正当用法 —— 归一化时两边都抹掉，
 * 于是「只差追踪参数」不会被报。
 *
 * 反过来，`page=2`、`sort=price` 这类**会改变页面内容**的参数不在名单里，
 * 归一化后仍然保留，所以「第 2 页的 canonical 指向第 1 页」照报不误。
 */
const TRACKING_PARAMS = new Set([
  'gclid', 'dclid', 'fbclid', 'msclkid', 'yclid', 'ttclid', 'twclid', 'igshid',
  '_ga', '_gl', 'mc_cid', 'mc_eid', 'spm', 'scm', 'vero_id', 'wickedid',
]);

/** `utm_source` / `utm_medium` / `utm_campaign` / … 一律算追踪参数 */
const TRACKING_PREFIX = /^utm_/i;

const isTracking = (key) => TRACKING_PARAMS.has(key.toLowerCase()) || TRACKING_PREFIX.test(key);

/**
 * 解析 `<base href>`。
 *
 * ⚠️ 这里有个真踩到过的坑：base 的值本身可能是**协议相对**的
 * （`<base href="//cdn.example.com/">`）。直接拿它当 `new URL(href, base)`
 * 的 base 会抛 Invalid URL，把一个完全合法的 canonical 误报成「不是合法的 URL」。
 *
 * 所以必须**先把 base 自己对着页面 URL 解析一次**，拿到绝对地址再用。
 *
 * @returns {string|null} 绝对化后的 base，解析不出来就返回 null（退回用页面 URL）
 */
function resolveBase(baseHref, pageUrl) {
  if (!baseHref) return null;
  try {
    return new URL(baseHref, pageUrl || undefined).href;
  } catch {
    return null;
  }
}

/**
 * 把 URL 归一化成一个可直接比较的字符串。
 *
 * 抹平的差异（这些都是「同一个页面的不同写法」）：
 *   - 协议         http / https      —— 归一到 https 是标准做法
 *   - www. 前缀    站点选一个主域名做规范，是标准做法
 *   - 主机名大小写  DNS 本来就不区分大小写
 *   - 尾斜杠       /a 和 /a/ 是同一个页面
 *   - 追踪参数     见 TRACKING_PARAMS
 *   - 参数顺序     ?a=1&b=2 和 ?b=2&a=1 是同一个页面
 *   - fragment     #section 不构成新页面，服务端根本收不到它
 *
 * 保留的差异：路径大小写（有些服务器区分）、非追踪参数。
 *
 * @returns {string|null} 归一化结果，URL 非法时返回 null
 */
function normalizeUrl(input, base) {
  let u;
  try {
    u = new URL(input, base || undefined);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  // 根路径的 "/" 要留着，否则 example.com 和 example.com/ 的归一结果会变成空
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;

  const params = [...u.searchParams.entries()]
    .filter(([k]) => !isTracking(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  return `${host}${path}${params ? `?${params}` : ''}`;
}

module.exports = { normalizeUrl, resolveBase, TRACKING_PARAMS };
