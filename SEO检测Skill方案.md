# Skills-SEO-Doctor

> 面向 FocusWork 的部门 Skill，前端方向。@黄鑫
>
> 目录名：`seo-doctor`
> 安装路径：`C:/Users/huangxin0510/.focuswork/users/huangxin0510/skills-custom/seo-doctor/`

> **本次修订（2026-08-31）**：P0 平台实测跑完，架构改为**零第三方依赖、解析能力全部自写**。
>
> 起因是平台的两条硬约束叠在一起：安全扫描有 500 文件上限且在 `npm install` 之后跑（声明 cheerio 直接 `scan_failed`），而把库打包成单文件虽然能过扫描、却消不掉 `LOW_ANALYZABILITY`(HIGH) 告警 —— 这个 skill 要发给部门每个人，每人导入都会看到。
>
> 代价约 6 小时（22h → 28h），换来干净的导入体验、小十倍的包体积、以及不再需要构建脚手架。受影响的章节：§三 技术选型（重写）、§四 M1/M3/M5、§五 目录结构、§七 待确认、§八 P0/P1。

> **本次修订（2026-09-01）**：**功能范围从 5 条收敛到 3 条** —— 单页检查、GSC 数据分析、首页可达性爬取。砍掉「上线前后 diff」与「sitemap 差集对比」。
>
> 触发点是一个刚确认的事实：**本站的 SEO 落地页全部只靠 sitemap 提交，从首页没有任何入口**。这让原 M3「爬全站 vs sitemap 求差集找孤儿页」失去意义 —— 差集的答案已经知道了，全都是孤儿页。爬虫因此换了定位：从「找孤儿页」改成「**证明服务端 HTML 中哪些页面可达**」，产出一份能直接甩给产品和开发的证据 + 顺带批量体检。
>
> 同时 GSC 分析的优先级大幅上升 —— 只有它能回答「这批页到底被收录了多少、为什么没收录」，而这是当前最需要的答案。P0-4（browser 下载能力）随之从「不急」变成「该提前验」。
>
> 受影响的章节：§二 功能范围（5→3）、§四 M3（重写）/ M4（移出范围）、§八 优先级清单（重排）。

> **本次修订（2026-09-01 · 第二次）**：**技术路线从「零依赖全自写」改回「三方库预打包」。**
>
> 起因是两件事同时确认了：① 已向平台确认 `LOW_ANALYZABILITY`(HIGH) **这条告警可以忽略**；② 实测发现**零依赖版照样报这条 HIGH，而且分数最差**（47.4 分 vs 打包版 52.8 分）—— 原因是那 4 份中文 markdown（SKILL.md + 3 份规则表）本身就被算作「不可分析」，而它们是核心资产，删不掉。
>
> 也就是说 8/31 那次「全自写」决策的唯一论据（去掉第三方代码就能消掉这条 HIGH）**两头都错了**：既消不掉，也不需要消。
>
> 但有一条没变：**`scan_failed`（500 文件上限）是硬失败，不在「确认风险即可使用」的范畴**。所以「直接声明 dependencies」这条最省事的路依然不通，必须走 esbuild 预打包。打包链已建好并实测：cheerio 383 KB、fast-xml-parser 62 KB、papaparse 21 KB。
>
> 受影响的章节：§三 技术选型（整节重写）、§四 M1/M3/M5 的「用什么」、§五 目录结构、§七 待确认、§八 优先级清单（新增打包链与 cheerio 迁移任务）。
>
> 已完成的 25 条规则不受影响 —— `tools/ruletest.mjs` 的 184 条断言与实现无关，是迁移的安全网。

## 一、定位

**总指挥型 Skill** —— 负责决定测什么、把各路结果统一解读，产出开发能直接行动的报告。

- **用户**：前端 / 测试 / 运营，不需要懂 SEO
- **场景**：转测前自测、上线前卡口、上线后效果分析
- **原则**：确定性规则交给脚本执行以保证稳定，模型负责编排、语义判断与报告生成
- **不声明依赖**：`package.json` 不声明任何 npm 依赖，需要的三方库在本地打包成单文件提交 —— 平台的 500 文件上限逼出来的结论，见 §三
- **不绑业务线**：规范取自公开标准（Google Search Essentials、schema.org、W3C）

命名取「医生」之意：查症状（页面规范）、看化验单（GSC 数据）、做体检（全站可达性）。

---

## 二、功能范围

**三个功能，外加贯穿始终的报告生成。**

| # | 功能 | 一句话 |
|---|---|---|
| 1 | **单页规范检查** | 给一个 URL，查语义化标签、HTML 元信息、结构化数据、robots 屏蔽 |
| 2 | **GSC 数据分析** | Agent 用浏览器进 Search Console 导出 CSV，模型分析后给可行动结论 |
| 3 | **首页可达性爬取** | 给站点首页，模拟爬虫从首页往下走，列出**服务端 HTML 中真正可达**的页面，并顺带批量体检 |
| — | **报告生成** | 上面三个共用的输出层：分级 + 四段式，面向不懂 SEO 的开发 |

### 明确不做

| 不做 | 原因 |
|---|---|
| 性能与 Core Web Vitals | Lighthouse 的主场，做不过它 |
| 修复代码自动生成 | 报告给「怎么改」的文字说明即可，不替开发写代码 |
| 关键词研究 / 外链 / SERP 排名 | 需要 Ahrefs / Semrush 级别的付费数据源 |
| SSR / CSR 差异对比 | 判定标准难调、误报率高，暂不纳入 |
| AI 搜索可见性（GEO） | 结果不稳定需多次采样，留作二期 |
| 内置任何业务线的规范 | 通用工具，不绑业务 |
| **上线前后 diff（原功能 3）** | **2026-09-01 移出范围。** 跑两遍单页检查做对比，约 1h，是唯一能接进 CI 的模块。砍掉后本 skill 从「每次上线自动卡一道」变成「想起来才跑一次的诊断工具」。`run.js --json` 已经写好，将来想捡回来成本很低 |
| **sitemap 差集对比（原 M3 核心）** | **2026-09-01 移出范围。** 原设计是「爬全站 vs sitemap 求差集找孤儿页」。但本站 SEO 落地页**全部只靠 sitemap 提交、首页无入口**，差集的答案已知（全是孤儿页），跑一遍得出已知结论没有意义 |

---

## 三、技术选型

### 总原则：三方库走「构建期预打包」，不声明 dependencies

**结论：需要什么库就用什么库，但一律在本地用 esbuild 打成单文件提交；`seo-doctor/package.json` 永远不声明 `dependencies`。**

这是 2026-09-01 修订后的路线。它替代了 8/31 定下的「零第三方依赖全自写」——那条路线的唯一论据（第三方 bundle 必然带来一条消不掉的 HIGH 告警）已被推翻，详见「§三·平台约束」。

| 能力 | 方案 | 打包体积 | 说明 |
|---|---|---|---|
| 编排调度 | 🔴 自己做 | — | `SKILL.md`，**核心资产** |
| **HTML 解析** | 🟡 **cheerio（预打包）** | **383 KB** | DOM 树 + CSS 选择器。替代自写的 `lib/html.js`，见下面「HTML 解析的路线变更」 |
| 语义化 / 元信息检查 | 🔴 自己做 | — | 基于 cheerio 的选择器 |
| **robots.txt 匹配** | 🔴 **保留自写** | 0 | `lib/robots.js` 已完成，71 条断言全绿。理由见下面「哪些坚持自写」 |
| **sitemap 解析** | 🟡 **fast-xml-parser** | **62 KB** | XML 的边界比想象多：CDATA、命名空间前缀、`sitemapindex` 递归、gzip 压缩的 `.xml.gz` |
| **CSV 解析** | 🟡 **papaparse** | **21 KB** | RFC4180 完整实现，含带引号字段里的逗号／换行／`""` 转义 |
| 结构化数据校验 | ⏳ **P5 再评估** | 待测 | 如果只做 Google 富媒体必填字段，`JSON.parse` + 查表就够；如果要全量 schema.org 词汇表校验，那是自写不现实的场景，候选 `ajv` + schema.org JSON-LD context |
| 爬虫并发控制 | 🔴 自己做 | 0 | 约 20 行，`p-limit` 本身也就这么大，不值得多一个依赖 |
| 首页可达性爬虫 | 🔴 自己做 | 0 | 见 M3 说明 |
| 输出统一层 + 报告生成 | 🔴 自己做 | 0 | 面向开发的四段式，模板字符串够用，不需要模板引擎 |
| **浏览器操作** | 🟢 **平台自带** | — | FocusWork 内置 `browser` 工具，Agent 直接调，不进 run.js |
| HTTP 请求 | 🟢 运行时自带 | — | Node 22 内置 `fetch` |
| 规则表 / 提示词 | 🟢 抄改 | — | `claude-seo`（MIT），只抄规则定义 |

三个库全上的话上传包约 **470 KB**（cheerio 383 + fast-xml-parser 62 + papaparse 21），文件数 15 上下，离 500 上限很远。

**不挂任何外部 MCP** —— 每多一个 MCP 就多一道安装门槛，和「零配置、装上即用」的定位冲突。

---

### 平台约束

两条约束的性质完全不同，**必须分开看** —— 8/31 那次决策失误就是因为把它们当成了同一类东西。

#### 约束一：500 文件硬上限 —— 这条是硬失败，绕不过

平台导入流程是 **先 `npm install`，再扫描整个 skill 目录**，顺序不可调，`node_modules` 全部计入。

实测：声明一个 `cheerio` 依赖 → `scan_failed: ZIP contains 1232 files, exceeding limit of 500`。

也试过平台官方的运行时依赖机制（`skills/_ensure-deps.js`，内置 skill 都在用）——**走不通**。内置 skill 不受影响是因为它们压根不走扫描流程，两条官方机制在自定义 skill 上互斥。

> ⚠️ `scan_failed` 是**导入失败**，不是「有风险待确认」。它不在「确认风险即可使用」的范畴里，**和风险容忍度无关**。
>
> **所以「直接声明 dependencies」这条最省事的路，无论如何都不通。** 预打包不是为了规避告警，是为了绕过这条硬上限 —— 这是整个打包链存在的唯一理由。

#### 约束二：`LOW_ANALYZABILITY` (HIGH) —— 这条可以忽略（2026-09-01 更新）

安全扫描是**纯正则逐行匹配，不做语义分析**。它有一条元规则 `LOW_ANALYZABILITY`，报的不是安全问题，而是「这些文件我没法可靠审计，所以我的结论可信度打折」。

**8/31 的判断是：只要包里有第三方 bundle 就消不掉这条 HIGH，而这个 skill 要发给部门每个人，每人导入都会看到 —— 所以否掉打包方案，全部自写。**

**9/1 实测推翻了这个判断，两条都错了：**

| 当时的假设 | 实测结果 |
|---|---|
| 去掉第三方代码，这条 HIGH 就会消失 | ❌ **零依赖版照样是 HIGH，而且分数更差** |
| 这条 HIGH 是必须消除的信任成本 | ❌ **已向平台确认：这个告警可以忽略** |

零依赖版的实测数据：

```
score 47.4   unanalyzable_files 7 / total_files 15   risk_level HIGH
```

对比历史：cheerio 压缩 bundle 版 52.8 分，不压缩版 63.6 分 —— **零依赖版反而是三者里最差的**。

原因不是第三方代码，是**文件构成**。7 个「不可分析」文件里有 4 个是我们自己的中文 markdown（SKILL.md + 3 份规则表），另 3 个是平台自己在安装目录生成的（`.config-schema.json`、`.scan-result.json`、`package-lock.json`）。也就是说：

> **只要 SKILL.md 和 references/ 里的中文规则表存在，这条告警就消不掉。** 而它们是这个 skill 的核心资产，不可能为了一条元告警删掉。这条告警对我们是**结构性的**。

具体是「按文件类型（markdown 无代码解析器）」还是「按非 ASCII 字符占比」，三种候选启发式都能凑出 7，一个数据点分不开。`experiments/analyzability-probe/` 下有个探针 skill，导入后读 `unanalyzable_files` 即可分辨，但**这已经不影响决策** —— 两种情况下结论都是「消不掉，接受」。

#### 这条约束仍然管一件事：minify 不能关

`LOW_ANALYZABILITY` 可忽略，**但 CRITICAL 不在可忽略范畴**。第三方 bundle 必须压缩：

| 做法 | 扫描结果 |
|---|---|
| **压缩**后的单文件 | 5 条告警，最高 HIGH（`LOW_ANALYZABILITY`），cheerio 内部 **0 命中** |
| 不压缩的源码形态 | **24 条告警，最高 CRITICAL**，内部 20 命中 |

原因：文件压缩时扫描器跳过逐行内容规则，只报一条 `LOW_ANALYZABILITY`；摊开成源码后几万行第三方代码会撞上 `compile(`（css-select 编译 CSS 选择器，走函数组合不经过 eval）和 `fetch(`（htmlparser2 里 RSS 解析的局部函数名 `fetch(tagName, children)`，与网络无关）这类正则，全是名字撞车的误报。

**8/31 曾为「提高可分析性」关掉 minify，是判断失误** —— 可分析性分数没救回来（52.8 → 63.6，都是 HIGH），却把最高级别从 HIGH 推到了 CRITICAL。`tools/build.mjs` 里 `minify: true` 是硬约束，别关。

#### 其余已知的扫描规则

| 规则 | 触发条件 | 我们的应对 |
|---|---|---|
| `LOW_ANALYZABILITY` (HIGH) | 包里有压缩或难解析的文件 | **接受**，结构性的，消不掉 |
| `DATA_EXFIL_JS_NETWORK` (MEDIUM) × 2 | 源码里出现 `fetch(` | 功能本质。SKILL.md 用「网络访问说明」一节写明访问范围 |
| `DATA_EXFIL_JS_FS_ACCESS` (HIGH) | `fs.readFileSync` 等 | **已消除** —— 去掉了 `--file` 模式，run.js 全文没有一处 `fs` |
| `HIDDEN_DATA_FILE` (LOW) × 2 | 点开头的文件 | 平台自己在安装目录生成的 `.config-schema.json` / `.scan-result.json`，不是我们的文件 |
| `COMMAND_INJECTION_EVAL` (CRITICAL) | 未压缩的第三方源码里的 `compile(` | 靠 minify 规避，见上 |
| frontmatter 缺 `license` | — | 已写 `license: MIT` |

> 扫描结果读安装目录的 `.scan-result.json`，**比 UI 完整** —— UI 只显示低级别的几条。零依赖版实际是 2 HIGH + 2 MEDIUM + 2 LOW，UI 只呈现了「6 个 low」。
>
> **重新导入前必须先在平台删掉旧的**，否则上一次的 `.scan-result.json` 会被算进新一轮扫描的文件数，还会多报一条 `HIDDEN_DATA_FILE`。

---

### HTML 解析的路线变更：自写 tokenizer → cheerio

这是本次修订里唯一涉及**已完成代码**的变更，代价和收益都要说清楚。

#### 已完成的自写实现

`lib/html.js`，394 行，只 tokenize 不建树。差分测试 103 项比对：1 条已登记偏差（不做错误恢复），0 条未登记。25 条规则全部建在它的 token 流上，184 条断言全绿。**它是能用的，不是不得不换。**

#### 换 cheerio 的理由

1. **DOM 树解锁嵌套判定。** 自写 tokenizer 只有线性 token 流，判定不了「这个 `h1` 在 `nav` 里」（那是 logo，不是页面标题，不该算进 `h1-multiple`）、「标题层级只在 `main` 内部算」、「面包屑的嵌套结构对不对」。这类规则用 CSS 选择器是一行，用 token 流要自己实现祖先查找。
2. **后续加规则快得多。** 结构化数据组（P5）、爬虫的链接提取、以及试用反馈里必然要加的新规则，用 `$('main h2')` 这种写法和用 `findTagsWithin` 手动圈范围，效率差好几倍。
3. **一个包里不该有两个 HTML 解析器。** 保留 html.js 又引入 cheerio，等于每页解析两遍、两套心智模型，是明确的坏味道。

#### 代价

| 项 | 说明 |
|---|---|
| 重写工作量 | 约 3h。`check-page.js` 的 ctx 层 + 3 个 `rules-*.js`，从 token 流改成 cheerio 选择器 |
| 包体积 | 47 KB → 约 430 KB（约 10 倍，但离任何上限都很远） |
| 构建脚手架 | 需要 `tools/build.mjs` + esbuild，源码目录不再等于成品 |
| **差分测试失去意义** | cheerio 从「对照组」变成「被测对象本身」，`tools/difftest.mjs` 原本的用途消失 |

#### 迁移的安全网

**`tools/ruletest.mjs` 的 184 条断言是现成的、与实现无关的安全网。** 它调的是 `checkHtml(html, options)`，不关心内部用什么解析。所以迁移方式是：只改内部实现，断言必须保持全绿。这比无保护地重写风险低得多。

`difftest.mjs` 不删，**改造成回归快照测试**：把当前（cheerio 版）对那批真实页面的探针输出存成快照，之后升级 cheerio 时能立刻发现行为漂移。这样它从「验证自写实现」转为「验证依赖升级」，仍然有用。

`lib/html.js` 迁移完成后从上传目录删除。它的设计说明留在这份文档里作为记录 —— 那 10 条语义化规则「没有一条需要 DOM 树」的分析是对的，只是「所以不需要 DOM 树」这个推论只对当时那 10 条成立，对后续要加的规则不成立。

---

### 哪些坚持自写

不是「能用库的地方都用库」，下面这几处用库是净亏：

| 能力 | 为什么不用库 |
|---|---|
| **robots.txt 匹配** | `lib/robots.js` 已完成，180 行，**71 条断言全绿，用例全部抄自 Google 官方文档的三张表**，并在真实站点验过。换成 `robots-parser` 是用未经我们测试的代码换掉已经测过的代码，纯风险。而且 robots 匹配有一堆反直觉规则（最长匹配优先、平局归 allow、`/fish` 匹配 `/fishheads` 但 `/fish/` 不匹配 `/fish`），换库还得重新验一遍它对不对 —— 那还不如用自己的 |
| **并发控制** | 约 20 行。`p-limit` 自身也就这个量级，多一个依赖不划算 |
| **报告生成** | 模板字符串够用。引模板引擎只会让「改文案」这件最高频的操作多一层间接 |
| **检查逻辑本身** | 误报可控 + 输出可控。用现成 SEO 工具，它报什么你收什么，想调阈值、想去掉误报高的规则都做不到；而且它给的是「SEO score 68 分」，我们要的是「哪个元素、怎么改」。这部分是报告的骨架，不该外包 |

---

### 打包链

```
tools/build.mjs          esbuild 把库打成单文件 → seo-doctor/lib/vendor/*.js
tools/verify-vendor.mjs  打完自检：bundle 能 require、核心 API 可用
tools/pack.mjs           只压 seo-doctor/ 那一层，产出上传用的 zip
```

三个脚本和 esbuild、node_modules 都在仓库根，**不随 skill 上传**。`seo-doctor/package.json` 保持不声明 `dependencies` —— 平台无从安装，文件数恒定。

`build.mjs` 里有一处关键优化：**external 掉 `undici` / `whatwg-encoding` / `encoding-sniffer` / `iconv-lite`**。它们只服务 `cheerio.fromURL()`，而我们自己 `fetch` 再把 HTML 字符串喂给 `cheerio.load()`，这条路径一行都用不到。external 掉体积从 1454 KB 降到 383 KB，降了 74%。

> 不该改用 `cheerio.fromURL()` 省掉自己 fetch —— 自己发请求才能控 User-Agent、超时和重定向策略，而这三样正是 SEO 检测要的（还要读 `X-Robots-Tag` 响应头）。

---

### 运行时：只用 Node，不用 Python

平台环境里 Node v22.16.0 和 Python 3.12.10 都可用，但**统一用 Node**：

- SKILL.md 的 `requires: bins: [node]` 是已声明的硬依赖，平台会校验；Python 没有对应声明
- 这个 skill 要发给部门其他同事，**他们机器上有没有 Python 是未知数**
- 没有任何一件事是 Node 做不了、非要 Python 的

将来真出现 Node 搞不定的需求（比如用 pandas 做 GSC 大表分析）再翻案。

---

### 平台带来的分工线

FocusWork 的浏览器是内置 `browser` 工具，由 Agent 直接调用，**不经过 Skill**。因此：

| | 归谁 |
|---|---|
| 打开页面、点击、输入、snapshot | **Agent 调 `browser` 工具** |
| GSC 导航步骤 | **写成 `references/gsc-navigation.md` 的自然语言步骤**，不是代码 |
| HTTP 请求、HTML 解析、CSV 解析、robots 匹配 | **run.js** |

---

## 四、模块拆解

按依赖关系排列，可逐个实施。

### M0 · 平台能力实测（阻塞项）—— 除 M5 相关外已完成

结论会改变后面的架构，**跳过直接写代码有返工风险**。四条里三条已实测有结论。

| 要确认 | 结论 |
|---|---|
| skill 能否被匹配、`run.js` 能否被调起、参数能否传入 | ✅ **通过** —— `<CUSTOM>` 占位符会展开成绝对路径，路径不用写死；Node v22.16.0 |
| `references/` 能否被 Agent 按需读取 | ✅ **能** —— 规则表确定外置，SKILL.md 保持精简 |
| ~~skill 能否执行 `npm i`~~ | ⚠️ **能装，但装了必挂** —— 平台先 `npm install` 再扫描，扫描有 500 文件硬上限，`scan_failed` 是硬失败。**最终决定：三方库预打包成单文件、不声明依赖**，详见「§三·平台约束」 |
| `browser` 有没有下载类 action、下载文件落在哪；`snapshot` 对表格页能读出什么 | ⏳ **待验，且已升为该提前做** —— 只影响 M5（GSC 分析），不阻塞 M1/M2/M3，但 GSC 现在是核心功能，别拖到最后 |

详见第八节 P0。

---

### M1 · 单页检查引擎 ⭐ 地基

其他所有模块都依赖它。

- **输入**：一个 URL
- **输出**：统一格式的问题列表 JSON

#### 四组检查

| 组 | 内容 | 用什么 |
|---|---|---|
| **语义化** | `div` / `button` + onClick 当跳转、空 href、img 缺 alt、h1 缺失或多个、标题层级跳级、有无 `<main>` / `<nav>` / `<header>` / `<footer>` | cheerio 选择器（原为 `lib/html.js` 的 token 流，见 §三 路线变更） |
| **元信息** | title / description 缺失与长度、canonical 缺失／多个／指向他页、lang、viewport、og | cheerio 选择器，`head` 范围用 `$('head')` 直接圈定 |
| **结构化数据** | ld+json 提取、JSON 语法、schema.org 类型与属性、Google 富媒体必填字段 | `$('script[type="application/ld+json"]')` + `JSON.parse` + `references/rules-schema.md` 查表 |
| **索引指令** | meta robots noindex、**响应头 X-Robots-Tag**、robots.txt 屏蔽 | `lib/robots.js` 自写匹配（保留，71 断言全绿）+ 响应头 |

> **结构化数据这组有能力损失，要说清楚**：不做全量 schema.org 词汇表校验，只覆盖 Google 富媒体结果的必填 / 推荐字段（Product、Article、FAQPage、BreadcrumbList、Organization 等常用类型）。
>
> 但这本来就符合「输出可控」的定位 —— 我们要的是「`Product` 缺 `offers.price`，补上就能出富媒体卡片」，不是「schema 校验未通过」。真要全量校验，`validator.schema.org` 网页版一直都在，报告里给个链接即可。

#### 关键设计：输出统一层

四组检查来源不同，必须归一成同一种结构：

```json
{
  "rule":   "h1-missing",
  "level":  "阻断",
  "target": "页面",
  "detail": "该页面没有 h1 标题",
  "howto":  "在正文最顶部加一个描述页面核心内容的 h1"
}
```

后面所有模块吃的都是这个结构，这层做扎实了后面全省事。

#### 已确认的两处收敛

- **语义化只查唯一性标签**（`main` / `nav` / `header` / `footer`），**不查「正文有没有包 article」** —— 脚本判定不了正文在哪，会大量误报
- **不查「面包屑与可见面包屑一致」** —— 定位不到可见面包屑，不可靠

> 事后看，这两处收敛的意外收益是：**砍掉的恰好就是仅有的两条需要 DOM 树的规则**，这才让「自写 tokenizer 替掉 cheerio」变得可行。

**工作量**：✅ 已完成。检查逻辑约 900 行（三组 25 条规则）+ `lib/robots.js` 180 行 + `lib/html.js` 394 行（将迁移到 cheerio，约 3h）· 难度 ★★☆

---

### M2 · 报告生成

- **输入**：M1 的 JSON
- **输出**：HTML 报告

结构：

- **顶部**：阻断 / 警告 / 建议三级计数
- **每条问题四段式**：

```
[阻断] 该页面没有 h1 标题
  是什么   页面中 <h1> 数量为 0
  为什么   搜索引擎用 h1 判断页面主题，缺失会显著影响主题识别
  怎么改   在正文最顶部加一个描述页面核心内容的 h1
  影响面   抽样 20 页命中 12 页，推算全站约 60%
```

「怎么改」是**文字说明**，不生成代码片段。只给「缺少 canonical」这种规则名，对不懂 SEO 的开发等于没说。

**M1 + M2 完成即第一个可交付节点**，到这里就有能给人看的东西了。

**工作量**：模板 + 提示词 · 难度 ★☆☆

---

### M3 · 首页可达性爬取

> **2026-09-01 重写。** 原设计是「爬全站 vs sitemap 求差集找孤儿页」，因为本站
> SEO 落地页全部只靠 sitemap 提交、首页无入口，差集的答案已知，那个设计失去意义。
> 现在的定位是**证明可达性 + 批量体检**。

- **输入**：站点首页 URL
- **输出**：① 服务端 HTML 中可达的页面清单 ② 每页的检查结果汇总 ③ 可达性结论

#### 这个模块要回答的三个问题

| 问题 | 对谁有用 |
|---|---|
| 从首页出发，服务端 HTML 里到底能走到哪些页面？ | 产品 / 开发 —— 拿到证据，推动建索引页与内链 |
| 这份清单和我们以为的线上页面对得上吗？ | 开发 —— 和路由表对一遍，常能翻出下线了但仍可访问的老页面 |
| 这批页面有没有共性问题？ | 前端 —— 同一套模板生成的页面，模板层一坏就是全站性的 |

第三条是「顺带」，但性价比很高：抽样几十页就能推断整体，比一个个手工查快得多。

#### ⚠️ 必须写死在报告里的一条边界

**我们的爬虫不执行 JS，Googlebot 执行。**

所以「我们爬不到」**不等于**「Google 爬不到」。结论的措辞一律写成「**服务端 HTML 中不可达**」，绝不写成「Google 爬不到」。

不过这个差异本身就是有价值的信息：

| 链接出现在哪 | 意味着 |
|---|---|
| 服务端 HTML 里就有 | Google 第一波抓取即可发现，快 |
| 要等 JS 渲染后才有 | 要进第二波渲染队列，**慢得多，优先级低，且不保证** |

#### 爬虫自己写，不用 site-audit-seo

三个理由：

1. 只需要「发现 URL + 抓 HTML」，不需要它的评分体系
2. 要边爬边跑 M1 检查，用现成的得多一层数据搬运
3. 它强绑 Lighthouse，每页都跑一遍会非常慢，而性能我们不做

#### 必须做的三件事

| 项 | 说明 |
|---|---|
| 控制并发 | 别把测试环境打挂 |
| 遵守 robots | 用 `lib/robots.js`（M1 已写）判断能不能爬 |
| 限制深度与总量 | 默认封顶（建议 500 页），可显式放大 |

URL 归一化要一并处理：去 fragment、统一尾斜杠、只跟同源链接、`rel="nofollow"` 单独标注但仍记录。

#### sitemap 解析：降级为可选

差集对比虽然移出范围，但 `lib/sitemap.js` 用 **fast-xml-parser**（打包 62 KB）解析很省事 —— XML 的边界比想象多：CDATA、命名空间前缀、`sitemapindex` 递归、gzip 压缩的 `.xml.gz`。留一个 `--sitemap` 可选参数，传了就顺手把两份清单摆在一起给人看，不传就只输出可达清单。**不作为主线，有空再加。**

**工作量**：爬虫约 200 行 · 难度 ★★☆ · 约 3h

---

### M5 · GSC 数据分析

唯一的真技术难点，也是最有价值的一块。

#### 链路

```
Agent 调 browser 工具 → Search Console → 选资源和时间范围
  → 点「导出」下载 CSV → run.js 读取并用 lib/csv.js 解析
  → 模型分析 → 报告
```

#### 关键：走导出，不抓 DOM

| 做法 | 评价 |
|---|---|
| ❌ 抓 GSC 页面 DOM | 重 JS 的 SPA，表格虚拟滚动、图表是 canvas 读不出数值，一改版全废 |
| ✅ **点「导出」下 CSV** | 每个报告都有官方导出功能，数据完整，不受改版影响 |
| ⭕ 接 Search Console API | 最稳，但要建 GCP 项目、配 OAuth，**二期再说** |

用用户已登录的浏览器会话，不需要处理登录、不需要 API key、不花钱，却能拿到最权威的数据。

#### 三条备选方案（取决于 P0-4 实测结果）

| 方案 | 做法 | 前提 / 风险 |
|---|---|---|
| **A（首选）** | `profile: "user"` 打开 GSC → 点导出 → run.js 扫描用户下载目录取最新 CSV | 需用户授权本机浏览器；要按修改时间 + 文件名匹配识别「刚下的那个」 |
| **B** | 用 `snapshot` 直接读 GSC 表格 | 不确定能否拿到表格数值；虚拟滚动可能只读到当前视口 |
| **C** | 改走 Search Console API（`googleapis`） | 最稳但要 GCP 项目 + OAuth，门槛高 |

#### 拉哪些数据

| 数据源 | 内容 |
|---|---|
| 效果报告 | 点击 / 曝光 / CTR / 平均排名，可按查询、页面、国家、设备拆 |
| 网页收录状态 | 已编入索引 vs 未编入索引，**及未收录的原因分类**（重复网页未选定 canonical、已抓取尚未编入索引、已发现尚未抓取、软 404、被 robots 屏蔽） |
| 站点地图 | 提交状态、已发现 URL 数 |
| 增强报告 | 面包屑、FAQ、产品等结构化数据的有效 / 警告 / 错误 |

#### 模型要产出的是结论，不是搬运数据

- **高曝光低点击的页面** → title / description 没吸引力
- **排名 11~20 的查询** → 临门一脚，推一把就能上第一页的机会词
- **零曝光页面占比** → 说明选词有问题，不是页面质量问题
- **收录失败原因聚类** → 哪些是模板层问题（会波及全站），哪些是个例
- **交叉分析** → GSC 说这批页没收录，丢给 M1 实测，一路追到代码根因

#### 前提、风险与边界

| 项 | 说明 |
|---|---|
| 前提 | 用户 Chrome 已登录 Google 账号，且对该 GSC 资源有访问权限 |
| 风险 | 界面改版会让导航步骤失效 → **把界面操作步骤单独抽成 `references/gsc-navigation.md`**，坏了能快速改 |
| 风险 | 控制操作频率，别短时间反复点 |
| 边界 | **只读 + 导出，不做任何写操作**（不提交 sitemap、不请求编入索引） |

#### CSV 解析也自己写

GSC 导出的是规规矩矩的 UTF-8 CSV，但带引号字段（字段里含逗号、含换行、`""` 转义引号）+ BOM 剥离这几处边界不值得自己踩 —— **用 papaparse**，打包只 21 KB。

流式解析、Worker、自动类型推断这些我们用不上（GSC 单次导出最多 1000 行），但 21 KB 的体积也没必要为此自写 60 行。

**工作量**：约 150 行 + papaparse 接线约 20 行 + 大量调试 · 难度 ★★☆

---

## 五、目录结构

分成两层：**上传给平台的 skill 目录**，和**只在本地存在的开发仓库**。这条界线很重要 —— 上传目录里只有打包好的三方库单文件，`node_modules`、构建脚本、测试与 fixture 全留在仓库里。

### 上传的 skill 目录（约 15 个文件，含预打包的三方库单文件）

```
C:/Users/huangxin0510/.focuswork/users/huangxin0510/skills-custom/
└── seo-doctor/
    ├── SKILL.md                  ← 必须，name 必须等于目录名
    ├── package.json              ← 刻意不声明 dependencies
    ├── run.js                    ← 唯一入口，--mode 分发
    ├── lib/
    │   ├── vendor/               # ⭐ esbuild 预打包的三方库，不声明 dependencies
    │   │   ├── cheerio.js        #   383 KB，HTML 解析（压缩，minify 不能关）
    │   │   ├── fast-xml-parser.js#    62 KB，sitemap（M3 可选时再打）
    │   │   └── papaparse.js      #    21 KB，GSC 导出的 CSV（M5 时再打）
    │   ├── robots.js             # 自写 robots.txt 匹配，71 断言全绿（✅ 保留自写）
    │   ├── check-page.js         # M1 编排 + 统一输出层（✅，待迁移到 cheerio）
    │   ├── rules-semantic.js     # 语义化组 10 条（✅，待迁移）
    │   ├── rules-meta.js         # 元信息组 10 条（✅，待迁移）
    │   ├── rules-indexing.js     # 索引指令组 5 条（✅，待迁移）
    │   ├── sitemap.js            # sitemap 解析，接 fast-xml-parser（未做，M3 可选）
    │   ├── csv.js                # CSV 解析，接 papaparse（未做，M5）
    │   ├── crawl-site.js         # M3 首页可达性爬取（未做）
    │   └── report.js             # M2 报告生成（未做）
    └── references/
        ├── rules-semantic.md     # 语义化规则表（✅ 10 条）
        ├── rules-meta.md         # 元信息规则表（✅ 10 条）
        ├── rules-indexing.md     # 索引指令规则表（✅ 5 条）
        ├── rules-schema.md       # 结构化数据规则表 + Google 富媒体必填字段（未做）
        ├── gsc-navigation.md     # ⭐ GSC 界面操作步骤，给 Agent 看（未做）
        └── report-template.md    # 报告模板（未做）
```

> `lib/html.js`（自写 tokenizer，394 行）迁移到 cheerio 后从上传目录删除 —— 一个包里不该有两个 HTML 解析器，理由见 §三「HTML 解析的路线变更」。
>
> `lib/vendor/` 里三个 bundle **按需打**：cheerio 现在就要（M1 迁移），fast-xml-parser 等 M3 做可选的 sitemap 对比时再打，papaparse 等 M5 时再打。没用到的不进包。

### 开发仓库（`F:/project/seo-skills`，不上传）

```
seo-skills/
├── seo-doctor/                   ← 上面那个目录，打包时只压这一层
├── package.json                  ← devDependencies: esbuild + cheerio / fast-xml-parser / papaparse
├── tools/
│   ├── build.mjs                 # ⭐ esbuild 打包三方库 → seo-doctor/lib/vendor/
│   ├── verify-vendor.mjs         # 打完自检：bundle 能 require、核心 API 可用
│   ├── pack.mjs                  # 只压 seo-doctor/ 那一层，产出上传 zip
│   ├── ruletest.mjs              # ⭐ 规则测试：32 用例 / 184 断言。迁移 cheerio 的安全网
│   ├── robotstest.mjs            # robots 匹配测试：71 断言，用例抄自 Google 官方文档
│   ├── difftest.mjs              # 原为「自写解析器 vs cheerio」差分测试；迁移后改造成
│   │                             # 回归快照测试，用于发现升级 cheerio 时的行为漂移
│   ├── fixtures/*.html           # 刁钻用例：假标签、无引号属性、未闭合…
│   ├── cases/*.html              # 规则用例，期望写在文件头
│   ├── live-urls.txt             # 真实页面清单
│   └── scan-preview.mjs          # 本地复现平台扫描规则，打包前预判命中（待补）
├── experiments/
│   └── analyzability-probe/      # 探针 skill：分辨扫描器把哪类文件算作不可分析
└── SEO检测Skill方案.md
```

> `cheerio` / `fast-xml-parser` / `papaparse` / `esbuild` 都在仓库根的 `devDependencies` 里。前三个**通过 `build.mjs` 打包成单文件进上传包**，`esbuild` 和 `node_modules` 永远不进。
>
> `seo-doctor/package.json` 保持不声明 `dependencies` —— 这样平台无从 `npm install`，文件数恒定，绕过 500 上限。

### SKILL.md frontmatter

```yaml
---
name: seo-doctor
description: "检测网页 SEO 规范：语义化标签、HTML 元信息、结构化数据、robots 屏蔽；支持从首页爬取可达页面并批量体检、分析 Search Console 导出数据。Use when: 用户要检查网页的 SEO、查 meta 标签是否规范、验证结构化数据、看网站从首页能爬到哪些页面、分析 Search Console 数据。NOT for: 页面性能与 Core Web Vitals 检测、关键词研究、外链分析、排名查询、直接修改代码。"
license: MIT
metadata:
  openclaw:
    emoji: "🩺"
    requires:
      bins: [node]
---
```

- `NOT for:` 里把已砍掉的功能明确列出，避免 Agent 误匹配
- **`license` 不能少** —— 缺了会被安全扫描单独报一条

### SKILL.md 必须有「网络访问说明」一节（已写）

`fetch(` 会被扫描器标成 MEDIUM（`DATA_EXFIL_JS_NETWORK`），这是功能本质、避不掉。应对办法是在 SKILL.md 里用一张表把访问范围写死：只 GET `--url` 传入的地址及其重定向目标、无内置域名、无遥测、不带 cookie、结果只打 stdout 不写盘不外发。这既是给扫描器的交代，也是给使用者的交代。

### 调用方式

```bash
node "C:/Users/huangxin0510/.focuswork/users/huangxin0510/skills-custom/seo-doctor/run.js" --mode check --url "https://xxx.com/p/123"
```

**路径一律用绝对路径**（规范硬要求）。

---

## 六、可参考的资产

| 来源 | 参考什么 |
|---|---|
| [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | MIT 协议，25 个 sub-skill 的**规则定义**，直接对照可省掉大半规则表工作量。**只抄规则，不抄代码** —— 规则是我们要的，它的实现方式与我们的输出结构不兼容 |
| [Google Search Central](https://developers.google.com/search/docs) | 富媒体结果字段要求，`rules-schema.md` 的权威来源 |
| schema.org 官方 JSON-LD 词汇表 | 全量类型与属性定义 |
| [Google robots.txt 解析规范](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt) | 写 `lib/robots.js` 的依据：分组、最长匹配、`*`/`$` 通配 |
| ~~WHATWG HTML 标准 · Tokenization 一章~~ | ~~写 `lib/html.js` 的依据~~ —— 改用 cheerio 后不再需要 |
| `cheerio` | **HTML 解析主力**，经 `tools/build.mjs` 打包成 383 KB 单文件进上传包 |
| `fast-xml-parser` / `papaparse` | sitemap（62 KB）与 GSC 导出的 CSV（21 KB），同样走预打包 |
| `esbuild` | 打包工具，仓库根 devDependency，**永远不进上传包** |
| 王尊 `Skills-Web-Test` | 浏览器操作的实践经验（平台自带 browser 工具，链路本身不用复用） |
| 本仓库 `src/docs/` 的四份 SEO 文档 | 作为**验证数据集** —— 有已知答案的真实样本，用于测召回率与误报率 |

---

## 七、待确认

| # | 事项 | 何时确认 |
|---|---|---|
| ~~1~~ | ~~`references/` 能否被 Agent 按需读取~~ | ✅ P0-3 已确认能读 |
| ~~2~~ | ~~依赖怎么带进去~~ | ✅ **已定（9/1 第二次修订）**：esbuild 预打包成单文件、不声明 dependencies。声明依赖必然 `scan_failed`，这条与风险容忍度无关。见「§三·平台约束」 |
| 3 | `browser` 能否拿到下载的文件 | P0-4，决定 M5 走 A / B / C |
| 4 | 全站爬取默认封顶页数 | 建议 500 页，可显式放大 |
| 5 | 报告落盘位置 | 生成到当前目录，还是固定路径 |
| ~~6~~ | ~~自写 tokenizer 与 cheerio 的差异容忍线~~ | ✅ 已无意义 —— 改用 cheerio 后不存在差异。历史结论：曾只有 1 条已知偏差（不做错误恢复），18 个真实页面 0 命中 |
| ~~7~~ | ~~`LOW_ANALYZABILITY`(HIGH) 能不能消掉~~ | ✅ **已确认可忽略**（9/1）。而且实测消不掉 —— 中文 markdown 本身就被算作不可分析 |
| 8 | 扫描器把哪类文件算作「不可分析」 | 导入 `experiments/analyzability-probe/` 读 `unanalyzable_files` 即知。**不影响决策**，纯好奇 |
| 9 | 结构化数据要不要全量 schema.org 校验 | P5 开工前定。只做 Google 富媒体必填字段 → 查表即可；要全量 → 引 `ajv` + schema.org context |

---

## 八、实施优先级清单

每一条都可独立验证，做完一条确认通过再做下一条。

### P0 · 平台能力实测（先做，不写业务代码）—— 基本完成

**结论会改变后面的架构。跳过 P0 直接写代码有返工风险。**

| # | 任务 | 结论 | 状态 |
|---|---|---|---|
| **P0-1** | 建空壳 skill，看能不能被匹配到并调起 `run.js` | 能匹配、能调起、`--url` 能传入、`<CUSTOM>` 展开成绝对路径 | ✅ 通过 |
| **P0-2** | 在 skill 目录 `npm i cheerio` 并 require | 本地能跑，但**平台导入必挂**：先 install 再扫描，1232 个文件超 500 上限 | ✅ 有结论 |
| **P0-2b** | 试「构建期打包成单文件、不声明依赖」 | **技术上通** —— esbuild 打成 471 KB 单文件，上传包 6 个文件，扫描能过 | ✅ 有结论 |
| **P0-2c** | 试平台官方的运行时依赖机制 `skills/_ensure-deps.js` | **走不通** —— 自定义 skill 的扫描流程和它互斥，内置 skill 不受影响是因为压根不走扫描 | ✅ 有结论 |
| **P0-3** | 建 `references/test.md`，看 Agent 会不会主动去读 | **会读** → 规则表确定外置，SKILL.md 保持精简 | ✅ 通过 |
| **P0-4** | 试 `browser` 下载能力：① 有没有 download 类 action ② `profile:"user"` 下载的文件落到哪 ③ `snapshot` 对表格页能读出什么 | — | ⏳ **待验**，只卡 P5 |

> **P0-2 系列的最终决定（9/1 第二次修订后）**：走 **P0-2b 的预打包方案**。
>
> 8/31 曾因「打包方案消不掉 `LOW_ANALYZABILITY`(HIGH)」而否掉它、改为全自写，9/1 实测证明那个论据两头都错：零依赖版照样报这条 HIGH（47.4 分，比打包版的 52.8 分还差），而且这条告警已确认可忽略。理由展开见「§三·平台约束」。
>
> **P0-4 的影响**：能拿到下载文件 → M5 走方案 A；不能 → 退到 B（snapshot）或 C（GSC API）。**不阻塞 P1~P4，可以并行去验。**

### P1 · M1 单页检查引擎

自写解析器带来两条新任务（P1-0 / P1-0b），插在最前面。

| # | 任务 | 产出 | 怎么验证 | 耗时 |
|---|---|---|---|---|
| **P1-1** | 写语义化规则表（10 条） | `references/rules-semantic.md` | 通读一遍，判定条件与报告文案是否说得清 | ✅ 已完成 |
| **P1-0** | ⭐ 写 HTML 词法分析器 | `lib/html.js`，约 340 行 | 见下面 P1-0b | ✅ 已完成 |
| **P1-0b** | ⭐ 差分测试脚手架 | `tools/difftest.mjs` + 8 个 fixture + `live-urls.txt` | 13 条探针 × 26 份 HTML = **338 次比对，337 一致 + 1 条已登记偏差，0 条未登记** | ✅ 已完成 |
| **P1-2** | `lib/check-page.js` + `lib/rules-semantic.js`：token 流 → 跑语义化规则 → 输出统一 JSON。**按规则表的四个组分四步做，每步跑 `npm run ruletest` 见红绿** | 能跑的脚本 + `tools/ruletest.mjs` + `tools/cases/` | 用例把期望写在文件头（`+` 必须报 / `-` 必须不报）；`-` 那些行一律抄规则表的「边界」栏，那里写的正是已知误报来源 | 3h |
| ↳ P1-2a | 统一输出层 + 规则测试框架 + **标题组**（h1-missing / h1-multiple / heading-skip） | 6 个用例 · 18 条断言 | ✅ 全绿，且做过变异测试（把递增判定改成 `Math.abs`、把 h1 阈值改成 `>=1`，都被对应用例抓住） | ✅ 已完成 |
| ↳ P1-2b | **图片组**（img-alt-missing / img-alt-meaningless） | 3 个用例 | ✅ 全绿，`alt=""` 的反例用例钉住 | ✅ 已完成 |
| ↳ P1-2c | **链接组**（link-empty-href / link-fake / anchor-text-generic） | 3 个用例 | ✅ 全绿 | ✅ 已完成 |
| ↳ P1-2d | **地标组**（landmark-missing / landmark-duplicate）+ 接进 `run.js --mode check` | 2 个用例 | ✅ 全绿，端到端跑过真实 URL | ✅ 已完成 |
| **P1-3** | 加元信息组（10 条） | `references/rules-meta.md` + `lib/rules-meta.js` + 10 个用例 | ✅ canonical 归一化四条边界各有用例（追踪参数、尾斜杠、分页、`<base href>`）。18 个真实页面复跑 0 误报 | ✅ 已完成 |
| **P1-4b** | 索引指令组（5 条）：meta noindex / **响应头 X-Robots-Tag** / robots.txt 屏蔽 | `references/rules-indexing.md` + `lib/rules-indexing.js` + 8 个用例 | ✅ 全绿。X-Robots-Tag 是原计划里没单列的一条，但它藏在响应头里、看源码完全看不到，前端排查经常卡好几天，性价比最高 | ✅ 已完成 |
| **P1-4** | 结构化数据：`JSON.parse` + 必填字段查表 | `references/rules-schema.md` + 代码 | **拿 SourcingX 关键词页跑，和 `validator.schema.org` 对比**，明确记录哪些它报了我们没报 | 3h |
| **P1-5** | 写 `lib/robots.js`：User-agent 分组 + 最长匹配 + `*`/`$` 通配 | `lib/robots.js` + `tools/robotstest.mjs` | ✅ **71 条断言全绿**，用例全部抄自 Google 官方文档的三张表；真实站点验过（知乎 `/search` 被 googlebot 专属组拦下） | ✅ 已完成 |

> 验证数据集用自家站 —— `src/docs/` 里有已知答案（如那 226 个缺 canonical 的页面），最适合测召回率与误报率。
>
> **P1-0b 是整个自写路线的安全带**，别跳。写完 tokenizer 先跑差分测试，绿了再往上盖规则。
>
> 结构化数据组已移到 P5，排最后按需做 —— 它最贵（3h），而当前更该先拿到 GSC 的收录率数据。

### P1.5 · 打包链与 cheerio 迁移（9/1 第二次修订新增）

技术路线变更带来的两条任务。**P1-6 已完成**，P1-7 是唯一涉及重写已完成代码的任务。

| # | 任务 | 产出 | 怎么验证 | 耗时 |
|---|---|---|---|---|
| **P1-6** | esbuild 打包链 | `tools/build.mjs` | ✅ cheerio 打成 383 KB 单文件；external 掉 undici / whatwg-encoding / encoding-sniffer / iconv-lite，体积从 1454 KB 降到 383 KB | ✅ 已完成 |
| ↳ P1-6b | 打包自检 + 打 zip | `tools/verify-vendor.mjs` + `tools/pack.mjs` | bundle 能 `require`、`load()` 可用；zip 只含 seo-doctor/ 那一层 | 40min |
| **P1-7** | ⭐ 把 25 条规则从 token 流迁到 cheerio | 改 `check-page.js` + 3 个 `rules-*.js`，删 `lib/html.js` | **`npm run ruletest` 184 条断言必须保持全绿** —— 它调的是 `checkHtml()`，与内部实现无关，是现成的安全网。再跑一遍 18 个真实页面对比迁移前后的命中差异 | 3h |
| ↳ P1-7b | `difftest.mjs` 改造成回归快照测试 | 快照文件 | 存下当前对真实页面的探针输出；改坏 cheerio 版本能被发现 | 1h |

> ⚠️ **P1-7 的验收线是「命中结果一个不差」**，不是「测试通过」。迁移前先跑一遍 18 个真实页面存下完整 findings，迁移后逐条 diff —— 断言只覆盖已知场景，真实页面才能暴露没想到的差异。
>
> `lib/robots.js` **不迁移、不换库**，理由见 §三「哪些坚持自写」。

### P2 · M2 报告生成 ⭐ 第一个可交付节点

| # | 任务 | 怎么验证 | 耗时 |
|---|---|---|---|
| **P2-1** | 报告模板 + 生成逻辑：三级计数 + 四段式，「为什么／怎么改」按规则 ID 从 `references/` 查表 | **找一个不懂 SEO 的同事看报告，问「你知道该改什么吗」** —— 答不上来就是模板没写好 | 2h |

验收标准不是技术性的，是**可读性**。别自己判断，一定找人看。

**到这里就有能演示、能给人用的东西了。**

### P3 · M3 首页可达性爬取

依赖 P1-5（robots 匹配）。

| # | 任务 | 怎么验证 | 耗时 |
|---|---|---|---|
| **P3-1** | 写爬虫：BFS 从首页出发 + URL 归一化 + 同源过滤 + 并发控制 + 遵守 robots + 深度与总量封顶 | 对测试环境跑，看会不会打挂、封顶生不生效 | 2h |
| **P3-2** | 输出可达页面清单 + 批量跑 M1 检查 + 汇总模板层共性问题 | **拿自家站跑：SEO 落地页应当一个都爬不到** —— 这正是要拿出的证据 | 1h |
| **P3-3** | （可选）`--sitemap` 参数：把 sitemap 清单和可达清单并排列出。用 **fast-xml-parser**（打包 62 KB） | 条数对不对、嵌套 sitemapindex 能不能展开、`.xml.gz` 能不能读 | 40min |

> ⚠️ **报告措辞必须钉死**：结论写「**服务端 HTML 中不可达**」，绝不写「Google 爬不到」。我们不执行 JS，Googlebot 执行，两者不等价。详见 M3。

### P4 · M5 GSC 数据分析 ⭐ 当前最有价值的一块

**依赖 P0-4 结论，方案定了再开始 —— 所以 P0-4 要尽早插空做掉。**

| # | 任务 | 怎么验证 | 耗时 |
|---|---|---|---|
| **P4-1** | 写 `references/gsc-navigation.md`：GSC 界面操作步骤 | Agent 照着能不能走通全流程 | 1h |
| **P4-2** | 拿到 CSV → `lib/csv.js` 接 **papaparse**（打包 21 KB） | 数据条数、字段和 GSC 界面上看到的一致；字段里含逗号／换行的行要正确 | 40min |
| **P4-3** | 分析逻辑：**收录率与未收录原因分类**、高曝光低点击、排名 11-20 | **结论要能人工复核** —— 随机抽 5 条去 GSC 里对一遍 | 3h |
| **P4-4** | 交叉分析：GSC 报的问题页 → 丢给 M1 实测 → 找根因 | 拿缺 canonical 那批页面试，能不能自动串起来 | 2h |

> **P4-3 里「未收录原因分类」是当前最该先做的一条。** 本站 SEO 落地页全部只靠 sitemap 提交、首页无入口，需要先用数据定性：
>
> | GSC 里看到什么 | 说明什么 |
> |---|---|
> | 大量「已发现——尚未编入索引」 | 印证孤儿页假设，内链缺失是主因 |
> | 大量「已抓取——尚未编入索引」 | 是**内容质量**问题，建内链解决不了 |
> | 大量「重复网页，未选定 canonical」 | 是 canonical 配置问题，和入口无关 |
> | 收录率其实还不错 | 那就别动，先修别的 |
>
> **三种病因的药完全不同，靠猜没用。** 这一步不写代码也能先做 —— 打开 GSC 看一眼就有答案。

### P5 · 单页检查补完

排在最后，按需做。

| # | 任务 | 怎么验证 | 耗时 |
|---|---|---|---|
| **P5-1** | 结构化数据组：`JSON.parse` + Google 富媒体必填字段查表 | 和 `validator.schema.org` 对比，明确记录哪些它报了我们没报 | 3h |

### 总览

```
P0 平台实测              ← ✅ 基本完成，只剩 P0-4（GSC 的前置，尽早插空做）
  ↓
P1 单页检查
   ├─ P1-0/0b 解析器 + 差分测试   ✅ 已完成
   ├─ P1-2   语义化 10 条规则      ✅ 已完成
   ├─ P1-3   元信息组 10 条        ✅ 已完成
   ├─ P1-4b  索引指令组 5 条        ✅ 已完成（原计划外，X-Robots-Tag 值得单列）
   └─ P1-5   robots 匹配           ✅ 已完成  ← 爬虫的前置
  ↓
P1.5 打包链与迁移（9/1 新增）
   ├─ P1-6   esbuild 打包链         ✅ 已完成（cheerio 383 KB）
   ├─ P1-6b  打包自检 + pack.mjs    40min
   └─ P1-7   25 条规则迁到 cheerio  4h  ← 184 断言是安全网
  ↓
P2 报告生成（2h）         ← ⭐ 第一个可交付
  ↓
P3 首页可达性爬取（3h + 可选 1h）
  ↓
P4 GSC 分析（7.5h）       ← ⭐ 当前最有价值
  ↓
P5 结构化数据（3h）        ← 最贵，按需
```

**剩余约 17 小时**（已完成约 15h）。**M1 单页检查已完整可用**：语义化 10 条 + 元信息 10 条 + 索引指令 5 条 = 25 条规则，`--mode check` 端到端跑通、已导入平台验过。

技术路线变更净增约 4.7h（P1-6b 0.7h + P1-7 4h），换来的是后续所有模块都能用现成库 —— sitemap 从 1h 降到 40min、CSV 从 1.5h 降到 40min，以及新规则用 CSS 选择器的长期效率。

关键节点与两条可选顺序：

| 顺序 | 先做什么 | 适合 |
|---|---|---|
| **A（推荐）** | P2 报告生成（2h）→ 再回头做 P1-7 迁移 | **2 小时后就有完整交付物可以给人看**。迁移是内部重构，对使用者不可见，晚做没有损失 |
| B | P1-7 迁移（4h）→ P2 报告生成 | 想先把技术底座统一，避免报告层写完又要跟着改。但报告层吃的是 `checkHtml()` 的输出结构，迁移不改这个结构，所以这个顾虑不成立 |

按 A 走。**迁移不阻塞任何东西** —— 25 条规则现在就能用，token 流版和 cheerio 版对外行为一致。

---

## 附：部门文档格式

按其他同事的条目体例撰写，可直接复制进部门文档。

### 【背景】

- 前端页面的 SEO 问题上线时看不出来，往往几个月后才从 Search Console 里发现，返工成本高。

- 开发同学在转测前想自测 SEO，缺少低门槛工具：专业 SEO 软件需付费安装、配置门槛高，输出的又是给 SEO 专员看的评分报告，开发看不出该改哪里。

- 上线后的效果数据在 Google Search Console 里，需要人工逐个报表翻看和导出，既费时又难和代码问题对应起来。

- SEO 规范散落在各处，靠人眼逐页抽检，既不稳定也无法沉淀为团队可复用的检查标准。

### 【目标】

- 提升前端转测前的 SEO 自测能力，让不懂 SEO 的开发同学也能在上线前完成检查。

- 基于任意 URL，自动完成页面规范检测；基于站点首页，自动爬出服务端 HTML 中真正可达的页面清单并批量体检，为内链结构问题提供可核对的证据。

- 打通「线上数据异常 → 页面实测 → 代码根因」的分析链路，让 Search Console 的数据能直接落到具体改动上。

- 沉淀可复用的 SEO 检查规范，支持各业务线持续补充。

### 【解决方案】

基于 Focus Work 内置 AI Agent、子 Agent 与浏览器操作能力，形成「范围确认 → 单页规范检查（语义化 / 元信息 / 结构化数据 / robots 屏蔽）→ 首页可达性爬取与批量体检 → Search Console 数据导出与归因 → 分级报告输出 → 检查规范沉淀」的 SEO 检测 Skill。

Skill 定位为总指挥：确定性规则一律交由脚本判定以保证结果稳定可复现，浏览器操作交由平台内置 browser 工具，模型负责编排调度、语义判断、跨数据源归因与报告生成。规范知识底座取自 Google Search Essentials、schema.org、W3C 无障碍标准等公开权威标准，不绑定任何业务线。

实现上采用**构建期预打包**方案：HTML 解析、XML 与 CSV 解析等能力使用成熟的开源库（cheerio、fast-xml-parser、papaparse），但在本地经 esbuild 打包为单文件后提交，`package.json` 不声明任何 npm 依赖。这样做规避了平台安全扫描的 500 文件上限——直接声明依赖会因依赖树文件数超限而导入失败，而预打包后上传目录文件数恒定在 15 个左右。

robots.txt 匹配规则自行实现，依据 Google 公开的解析规范，并用其官方文档中的测试用例逐条验证（71 条断言）。检查规则的判定逻辑同样自行实现，以保证误报可控、输出可控——现成 SEO 工具给出的是评分，而开发需要的是「哪个元素、怎么改」。

导入时安全扫描会提示两类常规告警：一是「联网抓取网页」这一功能本身（SKILL.md 中已用专门章节写明访问范围：只 GET 用户指定的 URL 及同源 robots.txt，不读写本地文件、不携带凭证、不外发数据）；二是「可分析性」提示，因技能包含压缩后的第三方库与中文规则文档而触发，不涉及实际安全风险。

### 【计划】

> * [ ] **9月4日：确定技术架构方案和实施方向，完成平台能力前置验证。**
>
> * [ ] **9月5日-9月18日**：**完成开发，调试优化检测效果**
>
> * [ ] **9月19日-9月30日**：**找各业务线开发试用，调优误报率并完善**
>
