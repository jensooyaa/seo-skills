/**
 * 打上传用的 zip：**只压 seo-doctor/ 那一层**。
 *
 * 仓库根的 package.json、tools/、node_modules、experiments/ 一律不进包 ——
 * 上传目录的文件数必须恒定，那是绕过平台 500 文件上限的整个前提。
 *
 * 为什么不用 PowerShell 的 Compress-Archive：它写出来的条目名是反斜杠
 * （`seo-doctor\run.js`），不符合 ZIP 规范里「路径分隔符一律 /」的要求，标准
 * unzip 会当成文件名里含反斜杠的单个文件，解出来是一堆散文件。这里自己写，
 * 顺便能精确控制排除名单和文件计数。
 *
 * 用法：node tools/pack.mjs
 */

import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'seo-doctor');
/**
 * 产物写进 dist/，不写仓库根。
 * 根目录曾经放过一个手工备份的 seo-doctor.zip，这个脚本第一次跑就把它覆盖了 ——
 * 构建产物的输出路径必须是一个「只可能有构建产物」的目录。
 */
const OUT_ZIP_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_ZIP_DIR, 'seo-doctor.zip');

/** 平台的硬上限。留足余量报警，别等导入时才发现。 */
const FILE_LIMIT = 500;
const WARN_AT = 100;

/**
 * 不进包的东西。
 * - 点开头的文件会触发扫描器的 HIDDEN_DATA_FILE
 * - `.scan-result.json` 是平台上一轮扫描留下的，混进去会被算进新一轮的文件数
 * - node_modules 一旦出现就是几百上千个文件，直接 scan_failed
 */
const EXCLUDE_DIRS = new Set(['node_modules', '.git']);
/** 只给仓库开发者看的说明，没必要占上传包一个文件位。路径是 seo-doctor/ 下的相对路径。 */
const EXCLUDE_PATHS = new Set(['lib/vendor/README.md']);
const isExcluded = (name) => name.startsWith('.') || EXCLUDE_DIRS.has(name);

async function collect(dir, prefix = '') {
  const out = [];
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (isExcluded(e.name)) continue;
    const abs = path.join(dir, e.name);
    // ZIP 规范：条目名一律用正斜杠，不管在什么系统上打的
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await collect(abs, rel)));
    else if (e.isFile() && !EXCLUDE_PATHS.has(rel)) {
      out.push({ abs, rel, size: (await stat(abs)).size });
    }
  }
  return out;
}

/**
 * 时间戳统一写死成 1980-01-01 00:00，让同样的输入永远产出同样的 zip ——
 * 这样 zip 的哈希变了就一定是内容变了，好排查。
 * 不能整个置 0：DOS 日期里月份和日都是从 1 开始的，全 0 会解出 1980-00-00 这种
 * 非法日期，有些解压工具会报错。
 */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** 最小可用的 ZIP 写入器：只 deflate，不做加密、不做 zip64。 */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { rel, data } of entries) {
    const name = Buffer.from(rel, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    // 压不动的（已压缩的 bundle 偶尔会这样）就存原始字节，method 0
    const useStore = deflated.length >= data.length;
    const body = useStore ? data : deflated;
    const method = useStore ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0x0800, 6); // 文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // 时间 00:00:00
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra 字段长度
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // 打包方版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

const files = await collect(SRC);
if (files.length === 0) {
  console.error('seo-doctor/ 下没有文件。');
  process.exit(1);
}

const entries = [];
for (const f of files) {
  // 打包时统一带上顶层目录名，解出来就是 seo-doctor/
  entries.push({ rel: `seo-doctor/${f.rel}`, data: await readFile(f.abs) });
}

await mkdir(OUT_ZIP_DIR, { recursive: true });
await writeFile(OUT, makeZip(entries));

const totalKB = files.reduce((s, f) => s + f.size, 0) / 1024;
const zipKB = (await stat(OUT)).size / 1024;

console.log(`\n打包 → ${path.relative(ROOT, OUT)}`);
for (const f of files) {
  console.log(`  ${f.rel.padEnd(34)} ${(f.size / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`  ${''.padEnd(34)} ${'─'.repeat(7)}`);
console.log(`  ${String(files.length).padStart(2)} 个文件${''.padEnd(24)} ${totalKB.toFixed(1).padStart(7)} KB`);
console.log(`  压缩后${''.padEnd(28)} ${zipKB.toFixed(1).padStart(7)} KB\n`);

if (files.length > FILE_LIMIT) {
  console.error(`✗ ${files.length} 个文件超过平台 ${FILE_LIMIT} 的上限，导入会 scan_failed。`);
  process.exit(1);
}
if (files.length > WARN_AT) {
  console.warn(`⚠ 文件数 ${files.length}，接近 ${FILE_LIMIT} 的上限了，检查一下是不是混进了 node_modules。`);
}

console.log('上传前记得：**先在平台删掉旧的那个 skill**。');
console.log('否则上一轮留下的 .scan-result.json 会被算进新一轮扫描的文件数，还会多报一条 HIDDEN_DATA_FILE。\n');
