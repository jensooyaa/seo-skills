/**
 * undici 的桩。见同目录 README.md。
 *
 * cheerio 只在 fromURL() 里用它发请求。我们刻意不用 fromURL —— 自己发请求才能控
 * User-Agent、超时和重定向策略，而且 X-Robots-Tag 只能从响应头拿到，fromURL 不给。
 */

'use strict';

function unavailable(name) {
  throw new Error(
    `seo-doctor 的 cheerio bundle 不包含 ${name}（undici 被替换成了桩）。\n` +
      '这条路径只有 cheerio 的 fromURL() 会走。我们用 Node 内置的网络 API 自己发请求，' +
      '这样才能控 User-Agent、超时、重定向，并读到 X-Robots-Tag 响应头。\n' +
      '如果确实需要 fromURL，去 tools/build.mjs 把这个桩去掉。'
  );
}

class Client {
  constructor() {
    unavailable('undici.Client');
  }
}

class ResponseError extends Error {}

module.exports = {
  Client,
  errors: { ResponseError },
  interceptors: {
    redirect: () => unavailable('undici.interceptors.redirect'),
  },
  request: () => unavailable('undici.request'),
};
