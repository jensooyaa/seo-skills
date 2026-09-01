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

检测网页的 SEO 规范问题：语义化标签、HTML 元信息、结构化数据。

> **当前是打包链验证版**，尚未实现检测逻辑。
> 这一版只确认一件事：预打包的 cheerio 单文件在本平台加载得了、用得了。

## Usage

运行以下命令：

```
node "<CUSTOM>/seo-doctor/run.js"
```

把命令的输出原样展示给用户。全部 ✓ 且最后一行是「打包链通过」即为正常。

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

当前版本**不发起任何网络请求**。

检测功能实现后会发起 HTTP 请求，届时本节会写明具体范围。
届时的边界是：只 GET 用户在参数里显式给出的地址及其重定向目标和同源的
`/robots.txt`，无内置域名、不带 cookie、不做遥测，结果只打到标准输出，
不写本地文件、不外发。
