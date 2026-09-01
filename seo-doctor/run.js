/**
 * seo-doctor · 唯一入口
 *
 * 用法：
 *   node run.js --mode check --url "https://example.com/page"
 *   node run.js --mode crawl --url "https://example.com/"
 *
 *   通用：      --json                 输出机器可读格式
 *   crawl 专属： --max-pages 200        总量封顶
 *               --max-depth 3          从首页起算的点击深度
 *               --concurrency 3        并发
 *
 * ⚠️ 全文件没有一处 `fs`。早先有个 `--file` 模式用 fs.readFileSync 读本地 HTML，
 * 被平台安全扫描报 DATA_EXFIL_JS_FS_ACCESS(HIGH)「可能读取敏感数据」。那只是本地
 * 调试的便利，换一条每位同事导入时都会看到的 HIGH 不值得。要检查本地 HTML，
 * 在开发仓库里直接调 lib/check-page.js 的 analyzePage()。
 */

'use strict';

const { analyzePage } = require('./lib/check-page.js');
const { fetchPage } = require('./lib/fetch-page.js');
const { crawlSite, aggregateFindings } = require('./lib/crawl-site.js');
const { printCheck, printCrawl, BLIND_SPOTS, CRAWL_CAVEAT } = require('./lib/report.js');

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

function usage() {
  console.error('用法：node run.js --mode check --url "https://example.com/page"');
  console.error('      node run.js --mode crawl --url "https://example.com/"');
  console.error('');
  console.error('通用      --json                输出机器可读格式');
  console.error('crawl     --max-pages 200       总量封顶');
  console.error('          --max-depth 3         从首页起算的点击深度');
  console.error('          --concurrency 3       并发');
}

async function runCheck(args) {
  const loaded = await fetchPage(args.url);
  if (loaded.error) {
    console.error(`读取失败：${loaded.error}`);
    process.exit(1);
  }

  const pageUrl = loaded.finalUrl || args.url;
  const { facts, findings } = analyzePage(loaded.body, { url: pageUrl, headers: loaded.headers });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'check',
          url: pageUrl,
          status: loaded.status,
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

  printCheck(facts, findings, {
    url: args.url,
    finalUrl: loaded.finalUrl,
    status: loaded.status,
    size: loaded.body.length,
  });
}

async function runCrawl(args) {
  const quiet = Boolean(args.json);

  const r = await crawlSite(args.url, {
    maxPages: Number(args['max-pages']) || undefined,
    maxDepth: Number(args['max-depth']) || undefined,
    concurrency: Number(args.concurrency) || undefined,
    // 进度打到 stderr，这样 --json 时 stdout 依然是干净的 JSON
    onProgress: quiet
      ? undefined
      : ({ done, queued, url, status }) =>
          process.stderr.write(
            `\r已抓 ${done}，待抓 ${queued}   ${String(status || '-').padEnd(4)} ${url.slice(0, 56).padEnd(56)}`
          ),
  });

  if (!quiet) process.stderr.write('\r' + ' '.repeat(100) + '\r');

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'crawl',
          start: r.start,
          crawledAt: new Date().toISOString(),
          caveat: CRAWL_CAVEAT,
          robots: {
            url: r.robots.url,
            status: r.robots.status,
            mode: r.robots.mode,
            reason: r.robots.reason,
            sitemaps: r.robots.sitemaps,
          },
          stopReason: r.stopReason,
          maxPages: r.maxPages,
          maxDepth: r.maxDepth,
          aggregate: aggregateFindings(r.pages),
          pages: r.pages.map((p) => ({
            url: p.url,
            depth: p.depth,
            status: p.status,
            error: p.error,
            redirected: p.redirected,
            finalUrl: p.finalUrl,
            from: p.from,
            anchorText: p.anchorText,
            inboundCount: p.inboundCount,
            outLinks: p.outLinks,
            findings: p.findings,
            facts: p.facts,
          })),
          skipped: r.skipped,
        },
        null,
        2
      )
    );
    return;
  }

  printCrawl(r);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || 'check';

  if (mode !== 'check' && mode !== 'crawl') {
    console.error(`暂不支持的 --mode：${mode}（当前有 check 和 crawl）`);
    process.exit(2);
  }
  if (!args.url || args.url === true) {
    usage();
    process.exit(2);
  }

  if (mode === 'crawl') await runCrawl(args);
  else await runCheck(args);
}

main().catch((err) => {
  console.error('未预期的错误：', err);
  process.exit(1);
});
