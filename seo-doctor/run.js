/**
 * seo-doctor · P0 平台能力验证脚本
 *
 * 这个版本不做任何 SEO 检测，只用来确认：
 *   P0-1  skill 能不能被 Agent 匹配到并调起 run.js，参数能不能传进来
 *   P0-3  （在 SKILL.md 侧验证）Agent 会不会去读 references/
 *
 * P0-2 已确认：平台在导入时会自动执行 npm install。
 * 但安全扫描是在装完依赖之后跑的，装了 cheerio 会让目录文件数超过
 * 500 的上限导致扫描失败，因此本版本不声明任何 npm 依赖。
 */

const args = process.argv.slice(2); // 命令行参数
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : '(未传入 --url)';

console.log('=== seo-doctor 调起成功 ===');
console.log('node 版本 :', process.version);
console.log('收到的 url:', url);
console.log('脚本路径  :', __filename);
console.log('工作目录  :', process.cwd());
