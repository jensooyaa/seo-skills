/**
 * 变异测试：故意把实现改错，确认 ruletest 真的会红。
 *
 * 为什么需要它 —— 用例全绿只证明「当前实现在这些输入下的行为」被记录下来了，
 * 不证明「行为错了会被发现」。一组只覆盖 happy path 的用例可以永远全绿，
 * 却抓不住任何真实 bug，那是一层假保险。
 *
 * 做法：对源码做一处等价于「典型写错」的改动，跑一遍 ruletest，**期望它失败**。
 * 如果改错了测试还是绿的，说明这条判定没有任何用例覆盖 —— 那才是要补的洞。
 *
 * 每加一组规则都跑一次：npm run mutation
 */

import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每一条都是一个「有经验的人真的可能写错」的地方，不是随机改字符。
 * `catcher` 写明期望由哪个用例抓住，跑挂时便于定位。
 */
const MUTATIONS = [
  {
    desc: 'heading-skip 用绝对值比较 —— 会把正常的章节结束（h3→h2）误报成跳级',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: 'if (cur - prev > 1)',
    to: 'if (Math.abs(cur - prev) > 1)',
    catcher: 'heading-05-descend',
  },
  {
    desc: 'heading-skip 的阈值写成 >= 1 —— 会把正常的逐级递增（h1→h2）当成跳级',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: 'if (cur - prev > 1)',
    to: 'if (cur - prev >= 1)',
    catcher: 'heading-02-clean',
  },
  {
    desc: 'h1-missing 的阈值写反 —— 有 h1 时反而报缺失',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: "if ($('h1').length !== 0) return null;",
    to: "if ($('h1').length > 1) return null;",
    catcher: 'heading-02-clean',
  },
  {
    desc: 'h1-multiple 的边界写成 < 1 —— 只有一个 h1 也报「多个」',
    file: 'seo-doctor/lib/rules-semantic.js',
    from: 'if (all.length <= 1) return null;',
    to: 'if (all.length < 1) return null;',
    catcher: 'heading-02-clean',
  },
  {
    desc: 'landmarkHint 永远返回空 —— 证据里不再标出 h1 落在哪个地标内',
    file: 'seo-doctor/lib/rule-utils.js',
    from: "  const hit = $(el).closest('nav, header, footer, aside, main');",
    to: "  const hit = $(el).closest('__never__');",
    catcher: 'heading-06-logo-h1-in-nav',
  },
  {
    desc: '证据不再截断 —— 长页面会把整段 HTML 灌进报告和模型上下文',
    file: 'seo-doctor/lib/rule-utils.js',
    from: 'return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;',
    to: 'return flat;',
    catcher: 'heading-07-evidence-clip',
  },
];

/** 跑一次 ruletest，返回它是否通过。 */
async function ruletestPasses() {
  try {
    await run(process.execPath, [path.join(ROOT, 'tools', 'ruletest.mjs')], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

console.log('\n变异测试：把实现改错，期望 ruletest 变红\n');

if (!(await ruletestPasses())) {
  console.error('基线就是红的 —— 先把 npm run ruletest 跑绿再来做变异测试。');
  process.exit(1);
}

const survived = [];
const killed = [];

for (const m of MUTATIONS) {
  const abs = path.join(ROOT, m.file);
  const original = await readFile(abs, 'utf8');

  if (!original.includes(m.from)) {
    console.log(`  ⚠ ${m.desc}`);
    console.log(`      改动点在 ${m.file} 里找不到了，变异用例需要更新`);
    survived.push({ ...m, stale: true });
    continue;
  }

  // 不管中间发生什么都要把源码改回去，否则会把损坏的实现留在工作区
  try {
    await writeFile(abs, original.replace(m.from, m.to));
    const stillGreen = await ruletestPasses();
    if (stillGreen) {
      console.log(`  ${m.expectSurvive ? '·' : '✗'} ${m.desc}`);
      if (!m.expectSurvive) console.log(`      改错了测试还是绿的，说明这条判定没有用例覆盖`);
      survived.push(m);
    } else {
      console.log(`  ✓ ${m.desc}`);
      killed.push(m);
    }
  } finally {
    await writeFile(abs, original);
  }
}

const unexpected = survived.filter((m) => !m.expectSurvive);

console.log(`\n${killed.length} 处改错被抓住，${survived.length} 处存活\n`);

for (const m of survived.filter((x) => x.expectSurvive)) {
  console.log(`· 已知未覆盖：${m.desc}`);
  console.log(`  ${m.catcher}`);
}

if (unexpected.length) {
  console.log('\n以下改动没被任何用例抓住，需要补用例：');
  for (const m of unexpected) console.log(`  - ${m.desc}（本应由 ${m.catcher} 抓住）`);
  process.exit(1);
}

console.log('');
