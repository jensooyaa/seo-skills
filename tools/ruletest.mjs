/**
 * 规则测试：拿 tools/cases/ 下的 HTML 喂给 checkHtml()，比对文件头声明的期望。
 *
 * 它调的是 `checkHtml(html, options)`，**不关心内部怎么实现** —— 换解析库、
 * 重构规则都不用改用例，这是重构时唯一的安全网。
 *
 * ## 用例格式
 *
 * 文件头第一个 HTML 注释就是期望声明：
 *
 *   <!--
 *   @case  标题组：页面完全没有 h1
 *   @url   https://example.com/p          可选，规则要用到页面 URL 时才写
 *   @header x-robots-tag: noindex          可选，可写多行
 *   @robots 404                            可选，同源 robots.txt 的状态
 *   + h1-missing
 *   - h1-multiple    只有一个 h1 时不该报（抄规则表的「边界」栏）
 *   -->
 *
 * ## 判定是严格的
 *
 * **`+` 之外的规则一律不许命中。** 不这样的话，将来新加一条规则如果误报，
 * 老用例照样全绿，保险就是假的。
 *
 * `- ` 行在严格模式下是冗余的，但仍然要写 —— 它把「这里为什么不该报」这件事
 * 写在了用例里。写法一律抄规则表的「边界」栏，那里记的正是已知的误报来源。
 * 拼错的规则名会被当场报出来。
 *
 * 用法：npm run ruletest            跑全部
 *       npm run ruletest h1         只跑文件名含 h1 的
 */

import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES = path.join(ROOT, 'tools', 'cases');

const require = createRequire(import.meta.url);
const { checkHtml, ALL_RULE_IDS } = require(path.join(ROOT, 'seo-doctor', 'lib', 'check-page.js'));

const RULE_SET = new Set(ALL_RULE_IDS);

/** 解析文件头第一个注释里的期望声明。 */
function parseCase(text, file) {
  const m = text.match(/<!--([\s\S]*?)-->/);
  if (!m) throw new Error(`${file}：文件头缺少期望声明注释`);

  const spec = {
    name: file,
    url: undefined,
    headers: {},
    robots: undefined,
    expect: new Set(),
    forbid: new Map(), // 规则 ID → 写在后面的理由
    contains: [],      // {id, field, needle} —— 对证据/文案内容的断言
    groups: undefined,
  };

  for (const raw of m[1].split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('@case')) {
      spec.name = line.slice(5).trim() || file;
    } else if (line.startsWith('@url')) {
      spec.url = line.slice(4).trim();
    } else if (line.startsWith('@groups')) {
      spec.groups = line
        .slice(7)
        .split(/[,，\s]+/)
        .filter(Boolean);
    } else if (line.startsWith('@header')) {
      const [k, ...rest] = line.slice(7).trim().split(':');
      spec.headers[k.trim().toLowerCase()] = rest.join(':').trim();
    } else if (line.startsWith('@robots')) {
      spec.robots = line.slice(7).trim();
    } else if (line.startsWith('@evidence') || line.startsWith('@detail')) {
      // @evidence <规则> <必须出现的子串>   证据里要包含什么
      // @detail   <规则> <必须出现的子串>   detail 文案里要包含什么
      const field = line.startsWith('@detail') ? 'detail' : 'evidence';
      const rest = line.slice(field === 'detail' ? 7 : 9).trim();
      const [id, ...needle] = rest.split(/\s+/);
      spec.contains.push({ id, field, needle: needle.join(' ') });
    } else if (line.startsWith('+')) {
      spec.expect.add(line.slice(1).trim().split(/\s+/)[0]);
    } else if (line.startsWith('-')) {
      const rest = line.slice(1).trim();
      const [id, ...why] = rest.split(/\s+/);
      spec.forbid.set(id, why.join(' '));
    }
  }

  // 用例写错比实现写错更难发现 —— 规则名拼错会让一条断言静默失效
  for (const id of [...spec.expect, ...spec.forbid.keys(), ...spec.contains.map((c) => c.id)]) {
    if (!RULE_SET.has(id)) {
      throw new Error(`${file}：用例里的规则名 "${id}" 不存在。已实现的：${ALL_RULE_IDS.join(', ')}`);
    }
  }
  for (const id of spec.forbid.keys()) {
    if (spec.expect.has(id)) {
      throw new Error(`${file}：规则 "${id}" 同时写在 + 和 - 里，自相矛盾`);
    }
  }

  return spec;
}

/** `@robots 404` 这类简写还原成 loadRobots() 的返回结构。 */
function buildRobots(decl) {
  if (decl === undefined) return null;
  const status = Number(decl);
  if (Number.isFinite(status)) return { url: null, status, parsed: null, error: null };
  return { url: null, status: 200, parsed: null, error: null, raw: decl };
}

const filter = process.argv.slice(2).filter((a) => !a.startsWith('--'));

let files;
try {
  files = (await readdir(CASES)).filter((f) => f.endsWith('.html')).sort();
} catch {
  console.error(`用例目录不存在：${path.relative(ROOT, CASES)}`);
  process.exit(1);
}
if (filter.length) files = files.filter((f) => filter.some((k) => f.includes(k)));

if (files.length === 0) {
  console.error('没有匹配到用例。');
  process.exit(1);
}

let passedCases = 0;
let assertions = 0;
const failures = [];

for (const file of files) {
  const text = await readFile(path.join(CASES, file), 'utf8');
  let spec;
  try {
    spec = parseCase(text, file);
  } catch (err) {
    failures.push({ file, name: file, lines: [err.message] });
    continue;
  }

  const findings = checkHtml(text, {
    url: spec.url,
    headers: spec.headers,
    robots: buildRobots(spec.robots),
    groups: spec.groups,
  });
  const fired = new Map(findings.map((f) => [f.rule, f]));

  const lines = [];

  // 严格判定：遍历**每一条已实现的规则**，命中与否都必须和期望一致
  for (const id of ALL_RULE_IDS) {
    assertions++;
    const should = spec.expect.has(id);
    const did = fired.has(id);
    if (should === did) continue;

    if (should) {
      lines.push(`期望报 ${id}，但没报`);
    } else {
      const why = spec.forbid.get(id);
      lines.push(
        `不该报 ${id}，却报了：${fired.get(id).detail}` + (why ? `\n        （用例注明：${why}）` : '')
      );
    }
  }

  // 对证据 / detail 文案的断言
  for (const c of spec.contains) {
    assertions++;
    const f = fired.get(c.id);
    if (!f) {
      lines.push(`@${c.field} 断言的规则 ${c.id} 根本没报`);
      continue;
    }
    const haystack = c.field === 'detail' ? f.detail : f.evidence.join(' | ');
    if (!haystack.includes(c.needle)) {
      lines.push(`${c.id} 的 ${c.field} 里应含「${c.needle}」，实得：${haystack}`);
    }
  }

  // 规则执行时抛异常会被 checkHtml 兜住并标 error，这里要单独揪出来
  for (const f of findings) {
    if (f.error) {
      assertions++;
      lines.push(f.detail);
    }
  }

  if (lines.length === 0) {
    passedCases++;
    console.log(`  ✓ ${file.padEnd(30)} ${spec.name}`);
  } else {
    failures.push({ file, name: spec.name, lines });
    console.log(`  ✗ ${file.padEnd(30)} ${spec.name}`);
  }
}

for (const f of failures) {
  console.log(`\n✗ ${f.file} —— ${f.name}`);
  for (const line of f.lines) console.log(`    ${line}`);
}

console.log(
  `\n${passedCases}/${files.length} 个用例通过，共 ${assertions} 条断言` +
    `（${ALL_RULE_IDS.length} 条规则 × ${files.length} 个用例，另加内容断言）\n`
);

if (failures.length) process.exit(1);
