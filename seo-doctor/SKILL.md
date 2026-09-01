---
name: seo-doctor
description: "检测网页 SEO 规范：语义化标签、HTML 元信息、结构化数据。Use when: 用户要检查网页的 SEO、查 meta 标签是否规范、验证结构化数据、体检网站 SEO。NOT for: 页面性能与 Core Web Vitals 检测、关键词研究、外链分析、排名查询、直接修改代码。"
license: MIT
metadata:
  openclaw:
    emoji: "🩺"
    requires:
      bins: [node]
---

# SEO Doctor

检查网页的 SEO 规范，产出开发能直接照着改的报告。

**分工：脚本负责「是不是」，你负责「要不要紧、为什么、先改哪个」。**
脚本跑 20 条确定性规则，每次结果一模一样；语义判断、优先级、模板层归因是你的活。

> **当前实现：语义化组 10 条 + 元信息组 10 条。**
> 结构化数据、索引指令两组的**规则**还没实现，一条都不会报 —— 不要说「已检查」。

## 跑起来

```
node "<CUSTOM>/seo-doctor/run.js" --mode check --url "{URL}"
```

加 `--json` 输出机器可读格式（给 CI、或需要自己聚合多页结果时用）。

**用户给的是站点而不是具体 URL 时，不要只测首页** —— 首页往往是单独写的，最不具
代表性。挑首页 / 列表页 / 详情页各一个分别测，它们通常是三套不同的模板；详情页
最重要，SEO 流量主要落在那里。做法见 `references/review-guide.md` 第四节。

## 输出五段

| 段 | 从哪来 | 怎么处理 |
|---|---|---|
| **一、页面概况** | 脚本的 facts | **原样呈现**。title 原文与显示宽度、description、canonical、lang、viewport、Open Graph、地标、图片/链接统计、ld+json 类型、标题层级大纲 |
| **二、脚本判定** | 脚本的 findings | 每条按规则 ID 去 `references/rules-*.md` 查「为什么 / 怎么改」，**用表里的原文** |
| **三、模型判断** | **你** | 见 `references/review-guide.md`。每条要标明依据的是哪个事实 |
| **四、先改哪几条** | **你** | 按波及面 / 对流量的作用 / 改动成本重排，带理由 |
| **五、已知盲区** | 脚本输出末尾 | **原样带出**。省掉它，用户会把「没报」当成「没问题」 |

第三、四段是这个 skill 相对于「跑个脚本」的全部价值所在。
**开工前先读 `references/review-guide.md`**，那里写了该判断什么、以及哪些话不能说。

## 四条铁律

1. **不打分。** 不要星级、不要百分制、不要「配置水平优秀」这类总评。开发拿到分数
   不知道该动哪一行代码。要总览就给计数（「命中 3 条，阻断 0」），那是事实。
2. **你的判断和脚本的判定分开写。** 脚本那段是确定性的、可复现的；你那段标明
   「模型判断」。混在一起，用户就分不清哪些结论可以直接信 —— 这是唯一不能破的底线。
3. **工具用来补脚本的短板，不用来重做脚本的活。** 脚本查过的（title 长度、
   canonical、OG…）不要重算 —— 你只会得到一个更差的答案；真觉得它判错了，
   当 bug 报出来。脚本查不了的**主动去查**：看图核对 alt、用浏览器对比渲染后的
   DOM（SPA 的 meta 是不是客户端才塞的）、看 `X-Robots-Tag` 响应头、
   验证 og:image 打不打得开。补查的结论进「模型判断」段并写明方法，
   **且必须有结论** —— 「建议进一步确认」等于没查。清单见 review-guide 第一节。
4. **只说你真的查过的。** 「结构化数据配置完善」不能说 —— 那组规则没实现，脚本
   只列了有哪些 `@type`，一个字段都没校验。「alt 与图相符」「没有被 noindex」
   这类，**没去查就不能说；去查了就说清是你查的、怎么查的**。

## 查了哪 20 条

- **语义化组** `h1-missing` `h1-multiple` `heading-skip` `img-alt-missing`
  `img-alt-meaningless` `link-empty-href` `link-fake` `anchor-text-generic`
  `landmark-missing` `landmark-duplicate` → `references/rules-semantic.md`
- **元信息组** `title-missing` `title-length` `description-missing`
  `description-length` `canonical-missing` `canonical-multiple`
  `canonical-mismatch` `lang-missing` `viewport-missing` `og-incomplete`
  → `references/rules-meta.md`

长度按**半角当量**算（全角字符算 2）—— Google 按像素宽度截断，不是按字符数。

## 关于第三方库

`lib/vendor/cheerio.js` 是 HTML 解析库 cheerio 经 esbuild 打包压缩后的单文件。

打包而不声明 npm 依赖，是因为平台导入时先 `npm install` 再扫描整个目录，扫描有
500 文件上限 —— 声明一个 cheerio 依赖会装出一千多个文件，直接导入失败。

压缩过的文件会被扫描器报一条 `LOW_ANALYZABILITY`（可分析性偏低）。它报的不是
安全问题，是「这个文件我没法逐行审计」。**不要为此关掉压缩** —— 实测摊开成源码后
几万行第三方代码会撞上扫描器的正则，告警从 5 条涨到 24 条、最高级别从 HIGH 升到
CRITICAL，全是函数名撞车的误报。

## 网络访问说明

会联网抓取网页，扫描因此报 `DATA_EXFIL_JS_NETWORK`（MEDIUM）。这是功能本身。

下面这张表说的是 **`run.js` 这个脚本**的行为，也就是安全扫描扫的那部分。
Agent 自己用 web_fetch / 浏览器做的补充查证不在此列，那走平台自己的工具权限。

| | |
|---|---|
| 请求什么 | **只请求 `--url` 显式传入的那个地址**及其重定向目标 |
| 请求方法 | 只有 GET |
| 内置域名 | **没有**。不传 `--url` 就一个请求都不发 |
| 携带凭证 | **不带**。不发 cookie、不发 Authorization、不读任何本地凭证 |
| 遥测上报 | **没有** |
| 结果去向 | 只打到标准输出。**全文件没有一处 `fs`**，不写盘、不外发 |
