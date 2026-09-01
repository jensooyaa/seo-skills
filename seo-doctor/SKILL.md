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

给一个 URL，检查页面的 SEO 规范问题，输出分级的问题清单。

> **当前实现范围：语义化组 10 条 + 元信息组 10 条。**
> 结构化数据、索引指令两组尚未实现，**一条都不会报** —— 这一点要向用户说清楚，
> 别让「没报」被理解成「没问题」。

## Usage

```
node "<CUSTOM>/seo-doctor/run.js" --mode check --url "{用户提供的URL}"
```

可选参数：

| 参数 | 作用 |
|---|---|
| `--json` | 输出机器可读的 JSON，给报告层或 CI 用 |

脚本的输出分三段，**三段都要展示给用户**：

| 段 | 是什么 | 怎么用 |
|---|---|---|
| **页面概况** | 脚本采集到的**事实**：title 原文与显示宽度、description、canonical、lang、viewport、Open Graph、地标、图片/链接统计、结构化数据类型、标题层级大纲 | 原样呈现。它回答的是「查了什么、页面上到底有什么」 |
| **问题清单** | 按阻断 / 警告 / 建议分组的命中规则 | 每条按规则 ID 去 `references/` 查表，补上「为什么 / 怎么改」 |
| **已知盲区** | 这个工具**永远看不见**的地方 | **必须原样带出**，省略它会给人虚假的安全感 |

只贴问题清单是不够的 —— 一个没什么毛病的页面只会剩两三行，看的人不知道到底查过什么。
「页面概况」就是为此存在的。

## 检查了什么

### 语义化组 10 条

| 规则 | 判什么 | 级别 |
|---|---|---|
| `h1-missing` | 页面没有 h1 | 阻断 |
| `h1-multiple` | 页面有多个 h1 | 警告 |
| `heading-skip` | 标题层级跳级（h2 直接到 h4） | 警告 |
| `img-alt-missing` | 图片没有 alt 属性 | 警告 |
| `img-alt-meaningless` | alt 写了但没描述内容（文件名、占位词、编号） | 建议 |
| `link-empty-href` | a 标签没有真实跳转地址 | 警告 |
| `link-fake` | 用 div / span 加 onclick 做跳转 | 警告 |
| `anchor-text-generic` | 锚文本是「了解更多」这类无意义词 | 建议 |
| `landmark-missing` | 缺少 main / nav / header / footer | 建议 |
| `landmark-duplicate` | 页面有多个 main | 警告 |

### 元信息组 10 条

| 规则 | 判什么 | 级别 |
|---|---|---|
| `title-missing` | 没有 title，或 title 是空的 | 阻断 |
| `title-length` | title 显示宽度不在 15~60 之间 | 建议 |
| `description-missing` | 没有 meta description | 警告 |
| `description-length` | description 显示宽度不在 50~160 之间 | 建议 |
| `canonical-missing` | 没有 canonical | 警告 |
| `canonical-multiple` | 有多个 canonical（Google 会全部忽略） | 警告 |
| `canonical-mismatch` | canonical 指向了另一个地址 | 警告 |
| `lang-missing` | `<html>` 没有 lang 属性 | 警告 |
| `viewport-missing` | 没有 meta viewport | 警告 |
| `og-incomplete` | 缺 og:title / og:description / og:image | 建议 |

> 长度按**半角当量**算，全角字符算 2 —— Google 是按像素宽度截断的，不是按字符数。

## 怎么解读结果

脚本只输出**命中了哪条规则 + 命中的证据**，不解释。

要向用户说明「为什么这是问题」「该怎么改」时，**按规则 ID 去 `references/` 下对应的
规则表查**（语义化组查 `rules-semantic.md`，元信息组查 `rules-meta.md`），
用表里的原文，不要自己现编 ——
表里每条都写了「为什么 / 怎么改 / 已知边界」，措辞是斟酌过的，
现编会导致同一条规则每次跑出来说法都不一样。

## 输出这份报告时的三条硬规矩

**1. 不要打分。** 不要星级、不要百分制、不要「SEO 配置水平优秀」这类总评。
开发要的是「哪个元素、怎么改」，不是一个分数 —— 分数看完不知道该动哪一行代码。
按脚本给的三级（阻断 / 警告 / 建议）分组呈现，就是全部的分级。

**2. 不要自己动手去翻页面。** 需要的事实脚本都在「页面概况」里给了 ——
title 原文和宽度、canonical、OG、结构化数据有哪些类型、标题层级大纲，全都有。

**不要**再用其他工具（web_fetch、curl、浏览器、PowerShell 正则）去补充分析。
手工翻的结果不稳定、不可复现，而且会明显更软 —— 会写出「建议检查实际渲染长度」
「具体值需确认」这种自己都没确认下来的话。那比不写更糟：用户会以为查过了。

结构化数据和索引指令两组的**规则**还没实现。「页面概况」会列出页面上有哪些
ld+json 类型，但**没有做任何校验** —— 就照这个说，不要自己去校验，也不要
下「配置非常完善」这类结论。

**3. 「已知盲区」那一节必须原样带出。** 它列的是这个工具**永远看不见**的地方
（CSS 隐藏的元素、JS 绑定的事件、图片的实际内容）。省掉它，用户会把「没报」
理解成「没问题」。

## 关于第三方库

`lib/vendor/cheerio.js` 是 HTML 解析库 cheerio 经 esbuild 打包压缩后的单文件。

之所以打包而不是声明 npm 依赖：平台导入时先 `npm install` 再扫描整个目录，
而扫描有 500 文件上限 —— 声明一个 cheerio 依赖会装出一千多个文件，直接导入失败。
打包后 `package.json` 不声明任何依赖，文件数恒定在个位数。

因为这个文件是压缩过的，安全扫描会报一条 `LOW_ANALYZABILITY`（可分析性偏低）。
它报的不是安全问题，而是「这个文件我没法逐行审计」。**不要为此关掉压缩** ——
实测摊开成源码后，几万行第三方代码会撞上扫描器的正则规则，告警从 5 条涨到 24 条、
最高级别从 HIGH 升到 CRITICAL，全是函数名撞车的误报。

## 网络访问说明

这个 skill 会联网抓取网页，安全扫描因此会报 `DATA_EXFIL_JS_NETWORK`（MEDIUM）。
这是功能本身，避不掉。访问范围如下：

| | |
|---|---|
| 请求什么 | **只请求 `--url` 显式传入的那个地址**，以及它的重定向目标 |
| 请求方法 | 只有 GET |
| 内置域名 | **没有**。不传 `--url` 就一个请求都不发 |
| 携带凭证 | **不带**。不发 cookie、不发 Authorization、不读本地任何凭证文件 |
| 遥测上报 | **没有**。不向任何第三方发送数据 |
| 结果去向 | 只打到标准输出。**全文件没有一处 `fs`**，不写盘、不外发 |
