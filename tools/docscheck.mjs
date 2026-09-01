/**
 * 文档一致性检查。
 *
 * 这个 skill 的本体是 `references/` 下的规则清单 —— Agent 照着清单干活，
 * `run.js` 只是个加速器，把其中一部分判定提前算好。所以：
 *
 *   清单里有、代码里没有  →  **正常**。那些条目由 Agent 自己判
 *   代码里有、清单里没有  →  **错误**。Agent 查不到「为什么 / 怎么改」，只能自己编，
 *                            而现编会导致同一条规则每次说法都不一样
 *
 * 跑：npm run docscheck（已并进 npm test）
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(ROOT, 'seo-doctor');
const REFS = path.join(SKILL_DIR, 'references');

const require = createRequire(import.meta.url);
const { ALL_RULE_IDS } = require(path.join(SKILL_DIR, 'lib', 'check-page.js'));

const problems = [];

// ── 清单：收集所有条目 ──────────────────────────────────────────────────
const tableFiles = (await readdir(REFS)).filter((f) => f.startsWith('rules-') && f.endsWith('.md'));
const documented = new Map(); // 规则 ID → 写在哪个文件里

for (const file of tableFiles) {
  const text = await readFile(path.join(REFS, file), 'utf8');
  // 小节标题形如：## 3 · heading-skip
  for (const m of text.matchAll(/^##\s+\d+\s+·\s+([a-z0-9-]+)\s*$/gm)) {
    const id = m[1];
    if (documented.has(id)) {
      problems.push(`条目 ${id} 在 ${documented.get(id)} 和 ${file} 里各写了一遍`);
    }
    documented.set(id, file);
  }

  // 每条都得有「已知边界」——这一栏记的是真实误报来源，是这个 skill 最值钱的部分
  const sections = text.split(/^##\s+\d+\s+·\s+/m).slice(1);
  for (const sec of sections) {
    const id = sec.split(/\s/)[0];
    if (!/\*\*边界\*\*/.test(sec)) {
      problems.push(`${file} 的 ${id} 缺「边界」栏 —— 那是给 Agent 的防误报说明，不能省`);
    }
  }
}

// ── 代码实现的每一条，清单里都必须有 ────────────────────────────────────
for (const id of ALL_RULE_IDS) {
  if (!documented.has(id)) {
    problems.push(
      `${id} 在代码里实现了，但 references/ 里没有对应条目 —— ` +
        `Agent 查不到「为什么 / 怎么改」，只能自己编`
    );
  }
}

// ── SKILL.md 引用的清单文件都得存在 ────────────────────────────────────
const skill = await readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');

for (const m of skill.matchAll(/`(references\/[a-z0-9-]+\.md)`/g)) {
  try {
    await access(path.join(SKILL_DIR, m[1]));
  } catch {
    problems.push(`SKILL.md 引用了 ${m[1]}，但这个文件不存在`);
  }
}

// 反过来：清单写了却没在 SKILL.md 里挂出来，Agent 不会知道有它
for (const file of tableFiles) {
  if (!skill.includes(`references/${file}`)) {
    problems.push(`references/${file} 没有在 SKILL.md 里挂出来，Agent 不会知道有这份清单`);
  }
}

// frontmatter 少了 license 会被平台安全扫描单独报一条
if (!/^license:\s*\S+/m.test(skill.split('---')[1] || '')) {
  problems.push('SKILL.md 的 frontmatter 缺 license，安全扫描会单独报一条');
}

// ── 上传目录里不该出现开发脚手架 ────────────────────────────────────────
for (const stray of ['node_modules', 'tools', 'dist']) {
  try {
    await access(path.join(SKILL_DIR, stray));
    problems.push(`seo-doctor/ 里出现了 ${stray}/ —— 它不该进上传包`);
  } catch {
    /* 不存在才是对的 */
  }
}

// ── 报告 ────────────────────────────────────────────────────────────────
const byAgent = [...documented.keys()].filter((id) => !ALL_RULE_IDS.includes(id));

console.log(`\n文档一致性检查`);
console.log(`  清单 ${tableFiles.length} 份，条目 ${documented.size} 条`);
console.log(`    ${ALL_RULE_IDS.length} 条 run.js 已判好`);
console.log(`    ${byAgent.length} 条由 Agent 照清单自己判${byAgent.length ? `：${byAgent.join('、')}` : ''}`);

if (problems.length === 0) {
  console.log('  ✓ 代码与清单一致，清单都挂在 SKILL.md 上\n');
} else {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  process.exit(1);
}
