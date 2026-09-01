/**
 * encoding-sniffer 的桩。见同目录 README.md。
 *
 * cheerio 只在 loadBuffer() / fromURL() 里用它猜字节流的编码。我们自己 fetch、
 * 自己 res.text()，喂给 cheerio 的永远是解码好的字符串，这条路径碰不到。
 */

'use strict';

function unavailable(name) {
  throw new Error(
    `seo-doctor 的 cheerio bundle 不包含 ${name}（encoding-sniffer 被替换成了桩）。\n` +
      '这条路径只有 cheerio 的 loadBuffer() / fromURL() 会走，而我们应当自己 fetch、' +
      '再把解码好的 HTML 字符串交给 load()。\n' +
      '如果确实需要让 cheerio 自己处理字节流，去 tools/build.mjs 把这个桩去掉。'
  );
}

function decodeBuffer() {
  unavailable('decodeBuffer');
}

function sniffEncoding() {
  unavailable('sniffEncoding');
}

class DecodeStream {
  constructor() {
    unavailable('DecodeStream');
  }
}

module.exports = { decodeBuffer, sniffEncoding, DecodeStream };
