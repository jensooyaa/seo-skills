/**
 * HTTP 抓取。单页检查和爬虫共用。
 *
 * 之所以自己发请求而不用现成的高层封装：只有自己发才能控 User-Agent、超时和
 * 重定向策略，而且 **`X-Robots-Tag` 只能从响应头拿到** —— 那条指令在 HTML 源码里
 * 一个字都看不到。
 */

'use strict';

// ⚠️ HTTP header 只能是 latin1，这里写中文会抛 Cannot convert argument to a ByteString
const USER_AGENT = 'Mozilla/5.0 (compatible; seo-doctor/0.4; +internal SEO lint tool)';
const TIMEOUT_MS = 15000;

/**
 * 抓一个 URL。**不抛异常** —— 网络错误也是一种结果，爬虫要靠它记录死链。
 *
 * @returns {{ok, status, finalUrl, redirected, headers, contentType, body, error}}
 */
async function fetchPage(url, { accept = 'text/html', timeout = TIMEOUT_MS, method = 'GET' } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });

    const headers = Object.fromEntries(res.headers);
    const contentType = (headers['content-type'] || '').toLowerCase();

    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      // 跟过重定向 —— 内链指向重定向是在浪费抓取预算，值得单独报
      redirected: (res.url || url) !== url,
      headers,
      contentType,
      body: method === 'HEAD' ? '' : await res.text(),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      redirected: false,
      headers: {},
      contentType: '',
      body: '',
      error: err.message,
    };
  }
}

const isHtml = (contentType) => contentType.includes('html') || contentType === '';

module.exports = { fetchPage, isHtml, USER_AGENT, TIMEOUT_MS };
