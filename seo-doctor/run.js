/**
 * seo-doctor · 唯一入口
 *
 * 用法：
 *   node run.js --mode check --url "https://example.com/page"
 *   node run.js --mode check --url "..." --json     输出原始 JSON，给报告层 / CI 吃
 *
 * ⚠️ 全文件没有一处 `fs`。早先有个 `--file` 模式用 fs.readFileSync 读本地 HTML，
 * 被平台安全扫描报 DATA_EXFIL_JS_FS_ACCESS(HIGH)「可能读取敏感数据」。那只是本地
 * 调试的便利，换一条每位同事导入时都会看到的 HIGH 不值得。要检查本地 HTML，
 * 在开发仓库里直接调 lib/check-page.js 的 checkHtml()。
 */

'use strict';

const { analyzePage, LEVELS } = require('./lib/check-page.js');
const { displayWidth } = require('./lib/rule-utils.js');

// ⚠️ HTTP header 只能是 latin1，这里写中文会抛 Cannot convert argument to a ByteString
const USER_AGENT = 'Mozilla/5.0 (compatible; seo-doctor/0.3; +internal SEO lint tool)';
const TIMEOUT_MS = 15000;

/**
 * 已知盲区。**必须跟着结果一起输出。**
 *
 * 不写出来，使用者会把「没报」当成「没问题」，而下面这几条恰恰是脚本永远
 * 看不见的地方 —— 尤其 link-fake 那条，现代前端的事件绑定它一个都抓不到。
 */
const BLIND_SPOTS = [
  '看不到 CSS —— display:none 的 h1 会被算作存在',
  '看不到 JS 绑定的事件 —— 只能抓内联 onclick，React/Vue 的 onClick 抓不到',
  '看不懂图片内容 —— 只能查词表，查不出「alt 与图不符」',
  '只看服务端 HTML —— 水合后才渲染的内容不在检查范围内',
  '  ↳ 对 SPA 尤其要紧：很多站的 meta 是 react-helmet 之类在客户端写的，服务端',
  '    HTML 里一个都没有，而 Google 第一波抓取看到的正是服务端 HTML',
  '结构化数据、索引指令两组还没实现，一条都不会报',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function loadHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return {
    html: await res.text(),
    status: res.status,
    finalUrl: res.url,
    // X-Robots-Tag 只能从这里拿到 —— 它不在 HTML 里，看源码永远看不出来。
    // 索引指令组（未实现）会用它。
    headers: Object.fromEntries(res.headers),
  };
}

const mark = (ok) => (ok ? '✓' : '—');

/**
 * 按**显示宽度**补空格对齐。
 * 不能用 String.padEnd —— 它按字符数补，而「结构化数据」这种全角标签一个字占
 * 两格，补出来是歪的。
 */
function padTo(str, width) {
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}

/**
 * 页面概况：脚本采集到的**事实**，不含判断。
 *
 * 只输出问题的话，一个没什么毛病的页面报告就只剩两三行，看的人不知道到底
 * 查了什么、什么是查过且通过的 —— 然后就会有人（包括 Agent）自己拿别的工具
 * 去翻一遍补上，而手工翻的结果不稳定、不可复现。事实由脚本给全，这个动机就没了。
 */
function printFacts(f) {
  const line = (k, v) => console.log(`  ${padTo(k, 14)}${v}`);

  console.log('\n页面概况');
  line('title', f.title.value ? `${f.title.value}` : '（无）');
  if (f.title.value) line('', `显示宽度 ${f.title.width}`);
  line('description', f.description.value ? f.description.value : '（无）');
  if (f.description.value) line('', `显示宽度 ${f.description.width}`);
  line('canonical', f.canonical.length ? f.canonical.join('\n              ') : '（无）');
  line('lang', f.lang || '（无）');
  line('viewport', f.viewport || '（无）');
  if (f.metaRobots) line('meta robots', f.metaRobots);
  line('Open Graph', f.og.map((o) => `${mark(o.value)} ${o.key}`).join('   '));
  line('地标', f.landmarks.map((l) => `${mark(l.count > 0)} ${l.tag}${l.count > 1 ? `×${l.count}` : ''}`).join('   '));
  line('统计', `图片 ${f.counts.images}（缺 alt ${f.counts.imagesNoAlt}）· 链接 ${f.counts.links}（无跳转地址 ${f.counts.linksNoHref}）`);

  if (f.structured.length) {
    const desc = f.structured
      .map((s) => (s.parseError ? `解析失败（${s.parseError}）` : s.types.join(' / ') || '(无 @type)'))
      .join('；');
    line('结构化数据', `${f.structured.length} 段 ld+json：${desc}`);
    line('', '⚠ 这一组规则还没实现，上面只是列出有什么，未做任何校验');
  } else {
    line('结构化数据', '（页面里没有 ld+json）');
  }

  if (f.outline.length) {
    console.log('\n  标题大纲');
    for (const h of f.outline) console.log(`  ${'  '.repeat(h.level)}h${h.level}  ${h.text}`);
    if (f.outlineTruncated) console.log(`      …（只列前 ${f.outline.length} 个）`);
  }
}

function printHuman(facts, findings, meta) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const f of findings) counts[f.level] = (counts[f.level] || 0) + 1;

  console.log('');
  console.log(`检查对象   ${meta.url}`);
  if (meta.finalUrl && meta.finalUrl !== meta.url) console.log(`最终 URL   ${meta.finalUrl}`);
  console.log(`状态码     ${meta.status}`);
  console.log(`HTML 大小  ${(meta.size / 1024).toFixed(1)} KB`);

  printFacts(facts);

  console.log(`
${'─'.repeat(60)}`);
  console.log(`
阻断 ${counts['阻断']}   警告 ${counts['警告']}   建议 ${counts['建议']}`);

  if (findings.length === 0) console.log('\n检查未发现问题。');

  for (const level of LEVELS) {
    const group = findings.filter((f) => f.level === level);
    if (group.length === 0) continue;
    console.log(`\n${'─'.repeat(60)}`);
    for (const f of group) {
      console.log(`\n[${f.level}] ${f.detail}`);
      console.log(`        规则 ${f.rule}（${f.group}）`);
      for (const e of f.evidence) console.log(`        · ${e}`);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('\n已知盲区（没报不等于没问题）：');
  // 以空格开头的是上一条的续行，不再加项目符号
  for (const line of BLIND_SPOTS) console.log(line.startsWith(' ') ? `   ${line}` : `  · ${line}`);
  console.log('');
  console.log('每条问题的「为什么 / 怎么改」见 references/ 下对应的规则表，按规则 ID 查表。');
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || 'check';

  if (mode !== 'check') {
    console.error(`暂不支持的 --mode：${mode}（当前只实现了 check）`);
    process.exit(2);
  }
  if (!args.url || args.url === true) {
    console.error('用法：node run.js --mode check --url "https://example.com/page"');
    console.error('      可选：--json 输出机器可读格式');
    process.exit(2);
  }

  let loaded;
  try {
    loaded = await loadHtml(args.url);
  } catch (err) {
    console.error(`读取失败：${err.message}`);
    process.exit(1);
  }

  const pageUrl = loaded.finalUrl || args.url;
  const { facts, findings } = analyzePage(loaded.html, { url: pageUrl, headers: loaded.headers });
  const meta = { url: args.url, finalUrl: loaded.finalUrl, status: loaded.status, size: loaded.html.length };

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          url: pageUrl,
          status: meta.status,
          checkedAt: new Date().toISOString(),
          blindSpots: BLIND_SPOTS,
          facts,
          findings,
        },
        null,
        2
      )
    );
    return;
  }

  printHuman(facts, findings, meta);
}

main().catch((err) => {
  console.error('未预期的错误：', err);
  process.exit(1);
});
