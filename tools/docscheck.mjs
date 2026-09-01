/**
 * 文档一致性检查：确认代码、规则表、SKILL.md 三者说的是同一件事。
 *
 * 为什么需要它 —— 这个 skill 的报告文案不在代码里，在 `references/` 的规则表里
 * （脚本只输出规则 ID，「为什么 / 怎么改」由 Agent 查表得到）。所以**表和代码
 * 脱节不会让任何测试变红，但会让报告说一套、脚本做另一套**。
 *
 * 加一条规则忘了写表 → Agent 查不到，只能自己编，正是我们要避免的事。
 * 删一条规则忘了删表 → 表里躺着一条永远不会命中的规则。
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

// ── 规则表：每条实现的规则都要有一节，反之亦然 ──────────────────────────
const tableFiles = (await readdir(REFS)).filter((f) => f.startsWith('rules-') && f.endsWith('.md'));
const documented = new Map(); // 规则 ID → 写在哪个文件里

for (const file of tableFiles) {
  const text = await readFile(path.join(REFS, file), 'utf8');
  // 小节标题形如：## 3 · heading-skip
  for (const m of text.matchAll(/^##\s+\d+\s+·\s+([a-z0-9-]+)\s*$/gm)) {
    const id = m[1];
    if (documented.has(id)) {
      problems.push(`规则 ${id} 在 ${documented.get(id)} 和 ${file} 里各写了一遍`);
    }
    documented.set(id, file);
  }
}

for (const id of ALL_RULE_IDS) {
  if (!documented.has(id)) {
    problems.push(
      `规则 ${id} 已实现，但 references/ 里没有对应小节 —— ` +
        `Agent 查不到「为什么 / 怎么改」，只能自己编`
    );
  }
}
for (const [id, file] of documented) {
  if (!ALL_RULE_IDS.includes(id)) {
    problems.push(`${file} 里写着规则 ${id}，但代码里没有实现 —— 表里躺着一条永远不会命中的规则`);
  }
}

// ── SKILL.md：规则清单要和实现一致，引用的文件要存在 ────────────────────
const skill = await readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');

for (const id of ALL_RULE_IDS) {
  if (!skill.includes(`\`${id}\``)) {
    problems.push(`SKILL.md 的规则清单里没有 ${id}`);
  }
}

for (const m of skill.matchAll(/`(references\/[a-z0-9-]+\.md)`/g)) {
  try {
    await access(path.join(SKILL_DIR, m[1]));
  } catch {
    problems.push(`SKILL.md 引用了 ${m[1]}，但这个文件不存在`);
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

console.log(`\n文档一致性检查：${ALL_RULE_IDS.length} 条规则 × ${tableFiles.length} 份规则表`);

if (problems.length === 0) {
  console.log('  ✓ 代码、规则表、SKILL.md 三者一致\n');
} else {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  process.exit(1);
}
