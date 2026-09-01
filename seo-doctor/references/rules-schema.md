# 结构化数据规则表

对应诊断链路的**环节 4（页面够不够格）**。共 6 条。

> **必填字段全部来自 Google 官方文档**，不是经验总结：
> [结构化数据总览](https://developers.google.com/search/docs/appearance/structured-data/search-gallery)、
> [Product](https://developers.google.com/search/docs/appearance/structured-data/product-snippet)、
> [Article](https://developers.google.com/search/docs/appearance/structured-data/article)、
> [Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)。
> **拿不准回去查原文，不要凭印象** —— 这一块的「常识」错得特别多。

---

## 先说清这组能做到什么

**只查 Google 富媒体结果的必填字段，不做全量 schema.org 词汇表校验。**

这不是偷懒，是定位问题：我们要的是「`Product` 缺 `offers.price`，补上就能出富媒体
卡片」，不是「schema 校验未通过」。要全量校验，
[validator.schema.org](https://validator.schema.org/) 一直都在，报告里给个链接即可。

另外两个官方工具值得在报告里推荐：
- [富媒体结果测试](https://search.google.com/test/rich-results) —— 看 Google 实际怎么解析
- Search Console 的「增强功能」报告 —— 看全站范围的错误统计

---

## ⚠️ 三个最常见的误报

这一块的「常识」错得特别多，下面三条**几乎所有 SEO 工具都会报错**：

### 1. `Article` **没有任何必填字段**

Google 原话：「**没有必需属性**；请改为添加适用于您内容的属性。」

`author`、`datePublished`、`headline`、`image` 全都是**推荐**，不是必需。
所以「Article 缺少 datePublished」**不能报成错误**，最多说「建议补上」。

### 2. 面包屑最后一项的 `item` **不需要写**

Google 原话：「如果该面包屑是列表中的最后一项，则 `item` 不是必需的。
未提供时 Google 会使用当前页面的网址。」

把它报成「缺少 item」是典型误报。

### 3. 有 `@type` ≠ 字段齐全

只看到 `@type: Product` **说明不了任何关于字段的事**。
措辞必须是「这页是商品详情页，但没有 `Product` 类型」（能确定），
不能是「`Product` 配置完善」（不能确定，除非你逐个字段看过了）。

---

## 1 · schema-json-invalid

| | |
|---|---|
| **判定** | `<script type="application/ld+json">` 的内容 `JSON.parse` 失败 |
| **级别** | 阻断 |
| **detail** | `第 N 段 ld+json 不是合法的 JSON，Google 会整段丢弃` |
| **evidence** | 报错信息 + 出错位置附近的原文 |

**为什么**：JSON 语法错一个字符，**Google 会把整段结构化数据丢掉**，不是部分丢弃。
这页所有富媒体机会归零，而且页面上完全看不出异常。

**怎么改**：最常见的三个成因 ——
① 模板引擎插入的字符串没转义（标题里带引号）；
② 尾随逗号（JS 里合法，JSON 里不合法）；
③ 用了单引号。
把内容丢进 JSON 校验器一眼就能看出来。

**边界**：只查语法。语法对但字段错，归下面几条管。

---

## 2 · schema-type-mismatch

| | |
|---|---|
| **判定** | 页面类型与 `@type` 明显对不上 |
| **级别** | 建议 |
| **detail** | `这是一个<页面类型>，但结构化数据里只有 <@type>` |
| **evidence** | 页面上已有的 `@type` 列表 |

对照表：

| 这是什么页 | 应该有 | 常见的缺 |
|---|---|---|
| 商品详情页 | `Product`（+ 嵌套 `Offer`） | 只有 `Organization`，等于没标 |
| 文章 / 博客 | `Article` / `NewsArticle` / `BlogPosting` | 什么都没有 |
| 列表 / 分类页 | `ItemList` / `CollectionPage` | 什么都没有 |
| 有面包屑的任何页 | `BreadcrumbList` | 页面上有面包屑但没标 |
| 企业官网首页 | `Organization` | — |

**为什么**：`@type` 决定这页能出哪种富媒体结果。商品页只标了 `Organization`，
Google 拿不到价格和库存，搜索结果里就是一条普通蓝链，而竞品带着价格和星级。

**怎么改**：按页面实际内容补上对应类型。别硬套 —— 标一个页面上没有的类型
（比如给没有评价的页面标 `AggregateRating`）属于**违反 Google 结构化数据政策**，
可能被人工处罚。

**边界**：
- **判断「这是什么页」本身是推断**，要在报告里标明依据（URL 形态、h1、正文内容）。
- 只在**明显对不上**时才报。拿不准就不报 —— 这条本来就是「建议」级别。
- `@graph` 包一层是 Yoast / RankMath 的默认输出，类型在里面，别当成没有。

---

## 3 · schema-product-incomplete

| | |
|---|---|
| **判定** | 有 `Product` 类型，但缺必填字段 |
| **级别** | 警告 |
| **detail** | `Product 缺少必填字段：<字段名>` |
| **evidence** | 那段 ld+json 里已有的字段 |

**Google 对商品摘要（product snippet）的要求：**

| 对象 | 必填 | 推荐 |
|---|---|---|
| `Product` | `name`，**外加 `review` / `aggregateRating` / `offers` 三者至少有一个** | `aggregateRating`、`offers`、`review` |
| `Offer` | `price` 或 `priceSpecification.price` | `availability`、`priceCurrency`、`priceValidUntil` |
| `AggregateOffer` | `lowPrice`、`priceCurrency` | `highPrice`、`offerCount` |

**为什么**：缺 `offers.price`，搜索结果里就没有价格；缺 `aggregateRating`，
就没有星级。这两样恰恰是电商类查询里点击率差异最大的元素。

**怎么改**：补上缺的字段。`priceCurrency` 用三位 ISO 4217 代码（`CNY`、`USD`）。

**边界**：
- **只有 `name` 是真·必填**，另外三个是「三选一」不是「全都要」。
  把 `review` / `aggregateRating` / `offers` 各报一条「缺失」是误报。
- `priceCurrency` 是**推荐**不是必填 —— 可以提，但不能报成错误。
- 结构化数据里的价格**必须和页面上显示的一致**，不一致会被 Google 判为
  「内容不匹配」。但你没法可靠地从 HTML 里提取显示价格，所以这一条只能提醒人工核对，
  **不要自己下结论**。

---

## 4 · schema-breadcrumb-incomplete

| | |
|---|---|
| **判定** | 有 `BreadcrumbList`，但结构不合规 |
| **级别** | 建议 |
| **detail** | `BreadcrumbList 的第 N 项缺少 <字段>` |
| **evidence** | 那段 ld+json |

**Google 的要求：**

| 对象 | 必填 |
|---|---|
| `BreadcrumbList` | `itemListElement`（至少 **2** 个 `ListItem`） |
| `ListItem` | `position`（整数，**从 1 开始递增**）、`name`、`item`（URL） |

**为什么**：面包屑决定搜索结果里显示的是
`example.com › 供应商 › 准入标准` 还是一条光秃秃的网址。前者更容易被点。

**怎么改**：补上缺的字段，确认 `position` 从 1 开始连续递增。

**边界**：
- ⚠️ **最后一项的 `item` 不是必填。** Google 明文规定：未提供时它会用当前页面的
  网址。报「最后一项缺 item」是典型误报。
- 少于 2 个 `ListItem` 不构成有效的面包屑，这个可以报。

---

## 5 · schema-org-incomplete

| | |
|---|---|
| **判定** | 有 `Organization`，但缺关键标识信息 |
| **级别** | 建议 |
| **detail** | `Organization 缺少 <字段>，知识面板可能拿不到这些信息` |
| **evidence** | 已有的字段 |

关注 `name`、`url`、`logo`、`sameAs`（社交主页链接）。

**为什么**：这些是 Google 组建品牌知识面板的原料。`sameAs` 指向官方社交账号，
帮助 Google 确认「这些账号属于同一个实体」。

**怎么改**：补齐。`logo` 用绝对 URL。

**边界**：
- Google 对 `Organization` **没有硬性必填清单** —— 这条整体是「建议」级别，
  措辞用「建议补上」，不要说「不合规」。
- 一个站点通常只在首页标一次 `Organization`，**详情页没有它是正常的**，不要报。

---

## 6 · schema-faq-deprecated

| | |
|---|---|
| **判定** | 页面上有 `FAQPage` 结构化数据 |
| **级别** | 建议 |
| **detail** | `FAQPage 富媒体结果已大幅收窄，普通站点标了也不会展示` |
| **evidence** | 那段 ld+json |

**为什么**：2023 年 8 月起，Google 把 FAQ 富媒体结果**限定在政府和医疗卫生类
权威站点**。普通商业站点标了 `FAQPage`，搜索结果里不会再出现折叠问答。

**怎么改**：**不用急着删** —— 它不会带来惩罚，而且对其他搜索引擎和 AI 抓取
仍然有价值（结构化的问答对是很好的可提取内容）。但**不要为了 FAQ 富媒体结果
去新做这块工作**，投入产出不成立。

**边界**：
- 这是「知会」不是「问题」，级别只能是建议，**绝不能报成错误**。
- 政策会变。报的时候带上「截至 2023 年 8 月的政策」，让人自己去核实最新状态。

---

## 已知盲区

| 盲区 | 原因 |
|---|---|
| 不做全量 schema.org 校验 | 只覆盖 Google 富媒体的必填字段。要全量校验去 validator.schema.org |
| 不校验字段**值**对不对 | `price: "abc"` 这种类型错误查不出；结构化数据里的价格和页面显示价格是否一致更查不出 |
| 不查微数据（Microdata）和 RDFa | 只看 `application/ld+json`。老站点用 `itemprop` 属性标的结构化数据看不到 |
| 只看服务端 HTML | 靠 JS 动态插入的 ld+json 看不到 |
| 不知道 Google 实际怎么解析 | 我们按文档判，Google 的实际行为可能有出入。要确认就用[富媒体结果测试](https://search.google.com/test/rich-results) |
