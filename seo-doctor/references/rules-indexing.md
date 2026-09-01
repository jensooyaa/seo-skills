# 索引指令规则表

共 6 条。体例与 `rules-semantic.md` / `rules-meta.md` 一致。

> **判定依据全部来自 Google 官方文档**，不是经验总结：
> [robots.txt 规范](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt)、
> [robots meta 标签与 X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)。
> 拿不准的时候回去查原文，不要凭印象。

---

## 这组和别的组不一样

前两组查的是「排名好不好、点击率高不高」。**这一组查的是「在不在」** ——
命中任何一条，这个页面根本不会出现在搜索结果里，前面所有优化归零。

所以这组的级别几乎全是**阻断**，而且**误报的代价特别高** —— 报一条假的「阻断收录」，
开发会立刻停下手上的活去查，查完发现没事。下面每条的「边界」栏都要读。

---

## 要查三个地方

| 查哪 | 怎么拿 | 备注 |
|---|---|---|
| **HTML 里的 meta** | `<meta name="robots" content="...">`、`<meta name="googlebot" content="...">` | 页面源码里能看到 |
| **HTTP 响应头** | `X-Robots-Tag` | ⚠️ **源码里完全看不到**。来自 Nginx / CDN / 网关，前端在自己代码里搜 `noindex` 一行都搜不到，这类问题排查经常卡好几天 |
| **同源 robots.txt** | `GET https://<host>/robots.txt` | 注意是**同源**：`https://a.com/p` 查 `https://a.com/robots.txt`，子域名各有各的 |

---

## 怎么正确读指令

### 有效指令一览

| 指令 | 含义 | 是不是「阻断」 |
|---|---|---|
| `noindex` | 不要在搜索结果里展示这个页面 | ✅ 是 |
| `none` | **等同于 `noindex, nofollow`** | ✅ 是 |
| `nofollow` | 不要跟进这个页面上的链接 | 不阻断本页，但断掉它指向的页面的内链 |
| `nosnippet` | 不展示摘要 | ❌ 只影响展示 |
| `max-snippet:[数字]` | 摘要最多多少字符 | ❌ 只影响展示 |
| `max-image-preview:[none / standard / large]` | 图片预览尺寸 | ❌ 只影响展示 |
| `max-video-preview:[数字]` | 视频预览秒数 | ❌ 只影响展示 |
| `noimageindex` | 不索引本页的图片 | ❌ 不影响页面本身 |
| `notranslate` | 不提供翻译 | ❌ |
| `unavailable_after:[日期]` | 该日期之后不再展示 | ⚠️ 到期后等于 noindex |
| `indexifembedded` | 被 iframe 嵌入时仍可索引（配合 noindex 用） | — |
| `noarchive` / `nocache` | **历史遗留，Google 已经不用了** | ❌ 看到不用报 |

指令**大小写不敏感**，逗号分隔，也可以写成多个标签／多个响应头。

### ⚠️ 陷阱一：`max-image-preview: none` 里那个 `none` 是值，不是指令

```
X-Robots-Tag: max-image-preview: none
```

这里的 `none` 是 `max-image-preview` 的**取值**，意思是「不展示图片预览」。
但 `none` 单独作为指令时**等同于 `noindex, nofollow`**。

**按冒号切开、读后半截 → 会凭空报出一条最高级别的「页面被阻断收录」。**
正确读法：先按逗号切成若干条指令，每条如果含冒号，**指令名是冒号前面那部分**。

### ⚠️ 陷阱二：`googlebot: nofollow` 和 `max-image-preview: none` 长得一模一样

```
X-Robots-Tag: googlebot: nofollow          ← 前半截是 user-agent 名
X-Robots-Tag: max-image-preview: none      ← 前半截是指令名
```

两者结构完全相同（`词: 词`），含义完全不同。分辨办法：**冒号前面那个词是不是上表里
的已知指令名** —— 是，就当指令读；不是，那是 user-agent 前缀，真正的指令在冒号后面。

带 user-agent 前缀的指令只对那个爬虫生效。`<meta name="googlebot" content="noindex">`
同理，只影响 Google，不影响 Bing。

### 指令冲突：限制最严的赢

多个指令矛盾时（比如一个 meta 写 `index`、响应头写 `noindex`），
**Google 取限制最严的那个** —— 所以只要任何一处出现 `noindex`，这页就是 noindex。

> ⚠️ 注意这条和下面 robots.txt 的平局规则**方向相反**（那边是「限制最少的赢」）。
> 别记混。

---

## robots.txt 怎么匹配

这套规则很反直觉，**照下面执行，不要凭感觉判**。

### 第一步：挑出适用的分组

Google 找 **user-agent 最具体**的那个分组。

- 有针对该爬虫的具体分组 → 用它，`User-agent: *` 那组**整个忽略**
- 同一个具体 user-agent 声明了多个分组 → **这几个分组的规则合并**成一组
- 没有具体分组 → 用 `*`

```
User-agent: *
Disallow: /

User-agent: Googlebot
Allow: /
```
Googlebot **能爬全站** —— 它命中了具体分组，`*` 那组对它完全不生效。

### 第二步：在这一组里挑出适用的规则

1. 路径支持两个通配符：`*`（任意长度任意字符）、`$`（URL 结尾）
2. **路径写得越长的规则越优先**
3. 长度相同时，**限制最少的赢**（即 Allow 赢）
4. 一条都没匹配上 → 允许
5. `Disallow:` 后面留空 → 等于不限制

**路径大小写敏感。**

### 路径匹配对照表（官方原表）

| 规则 | 匹配 | 不匹配 |
|---|---|---|
| `/` | 根路径及其下所有 URL | — |
| `/$` | **只有根路径** | 任何下级 URL |
| `/fish` | `/fish`、`/fish.html`、`/fish/salmon.html`、`/fishheads`、`/fish.php?id=anything` | `/Fish.asp`、`/catfish`、`/?id=fish`、`/desert/fish` |
| `/fish/` | `/fish/`、`/fish/?id=anything`、`/fish/salmon.htm` | `/fish`、`/fish.html`、`/animals/fish/`、`/Fish/Salmon.asp` |
| `/*.php` | `/index.php`、`/folder/filename.php`、`/folder/any.php.file.html` | `/`（即使它实际由 index.php 提供）、`/windows.PHP` |
| `/*.php$` | `/filename.php`、`/folder/filename.php` | `/filename.php?parameters`、`/filename.php/`、`/filename.php5` |
| `/fish*.php` | `/fish.php`、`/fishheads/catfish.php?parameters` | `/Fish.PHP` |

注意 `/fish` **匹配 `/fishheads`**（前缀匹配，不是路径段匹配），但 `/fish/` **不匹配 `/fish`**。

### 优先级对照表（官方原表）

| URL | 规则 | 生效的是 |
|---|---|---|
| `/page` | `allow: /p` / `disallow: /` | `allow: /p`（更长） |
| `/folder/page` | `allow: /folder` / `disallow: /folder` | `allow: /folder`（平局 → 限制最少） |
| `/page.htm` | `allow: /page` / `disallow: /*.htm` | **`disallow: /*.htm`**（6 字符 > 5 字符） |
| `/page.php5` | `allow: /page` / `disallow: /*.ph` | `allow: /page`（平局 → 限制最少） |
| `/` | `allow: /$` / `disallow: /` | `allow: /$`（更具体） |
| `/page.htm` | `allow: /$` / `disallow: /` | `disallow: /`（`/$` 只管根路径） |

### robots.txt 的状态码怎么解释

| 状态 | Google 的行为 | 我们报不报 |
|---|---|---|
| **2xx** | 按内容执行 | 按内容判 |
| **3xx** | 最多跟 5 次跳转，之后当 404 处理 | 按最终结果判 |
| **4xx（429 除外）** | **当作没有 robots.txt，不设任何抓取限制** | ❌ **不报**。404 是绝大多数站点的常态，报它就是稳定误报 |
| **429** | 按服务器错误处理 | ✅ 报 |
| **5xx** | 前 12 小时**停止抓取**；之后 30 天用缓存；30 天后才当作没有 | ✅ **必须报** |
| **网络错误**（DNS、超时、连接重置） | 同 5xx | ✅ 报 |

---

## 1 · meta-noindex

| | |
|---|---|
| **判定** | `head` 里的 `<meta name="robots">` 或 `<meta name="<某爬虫>">` 的 content 中，逗号分隔后出现 `noindex` 或 `none` |
| **级别** | 阻断 |
| **detail** | `页面被 meta robots 标记为 noindex，不会被收录` |
| **evidence** | 那个 meta 标签的原文 |

**为什么**：这是最直接的「别收录我」声明。常见成因是测试环境的模板被带上了线，
或者某个页面模板从「暂不发布」状态复制而来 —— 页面看着完全正常，就是搜不到。

**怎么改**：确认是不是有意为之。不是的话删掉这个 meta，或改成 `index, follow`。
改完在 Search Console 里请求重新编入索引，否则要等下一次抓取。

**边界**：
- **只有 `noindex` 和 `none` 算阻断。** `nosnippet`、`noimageindex`、
  `max-image-preview:none` 这些只影响展示形式，不影响收不收录 —— 报它们是误报。
- `<meta name="googlebot" content="noindex">` 只影响 Google，报的时候要说明范围。
- ⚠️ 见上面「陷阱一」：`max-image-preview: none` 的 `none` 是值不是指令。

---

## 2 · x-robots-tag-noindex

| | |
|---|---|
| **判定** | HTTP 响应头 `X-Robots-Tag` 中出现 `noindex` 或 `none`（按逗号切分后逐条判，注意剥掉 user-agent 前缀） |
| **级别** | 阻断 |
| **detail** | `响应头 X-Robots-Tag 把页面标记为 noindex，不会被收录` |
| **evidence** | 完整的响应头原文 |

**为什么**：**这条性价比最高。** 它和 `meta-noindex` 效果完全一样，但**在 HTML 源码里
一个字都看不到** —— 它来自 Nginx 配置、CDN 规则或 API 网关。前端在自己的代码库里
全文搜 `noindex` 搜不到任何东西，于是往死里查前端代码，一查好几天。

**怎么改**：这不是前端代码的问题，去查 Nginx / CDN / 网关配置。常见成因是
预发环境的「禁止收录」配置被复制到了生产。

**边界**：
- 同 `meta-noindex`：只有 `noindex` / `none` 算，展示类指令不算。
- ⚠️ 见「陷阱二」：`X-Robots-Tag: googlebot: nofollow` 的前半截是 user-agent，
  不是指令。判断依据是冒号前面那个词在不在已知指令表里。

---

## 3 · robots-txt-blocked

| | |
|---|---|
| **判定** | 按上面「robots.txt 怎么匹配」执行，当前 URL 的路径命中生效的 `Disallow` |
| **级别** | 阻断 |
| **detail** | `这个 URL 被 robots.txt 挡住了，爬虫根本不会抓` |
| **evidence** | 生效的那条规则原文 + 它在哪个 user-agent 分组下 |

**为什么**：robots.txt 挡的是**抓取**，比 noindex 更靠前 —— 爬虫连页面都不会请求。

**怎么改**：确认这条 `Disallow` 是不是有意针对这批页面。经常是规则写宽了，
比如想挡 `/admin` 结果写成了 `/a`，把 `/about`、`/articles` 一起挡了。

**边界**：
- **必须照上面那套算法判，不要凭感觉。** 尤其是「路径长的赢」和「平局时 Allow 赢」——
  一个看起来被 `Disallow: /` 挡住的 URL，很可能被某条更长的 `Allow` 放行了。
- 只判**当前这个 URL**，不要判「整个目录被挡了」—— 目录下可能有 Allow 例外。
- 路径大小写敏感，`/Fish` 和 `/fish` 是两回事。

---

## 4 · robots-txt-unreachable

| | |
|---|---|
| **判定** | robots.txt 返回 5xx 或 429，或请求失败（超时、DNS、连接重置） |
| **级别** | 阻断 |
| **detail** | `robots.txt 返回 <状态>，Google 会临时按「整站禁止抓取」处理` |
| **evidence** | 状态码或错误信息 |

**为什么**：**一个挂掉的 robots.txt 能让全站掉出索引。** Google 的规定是：
5xx 时前 12 小时直接停止抓取，之后 30 天内用缓存，30 天后才当作没有 robots.txt。
所以这不是「读不到就算了」，是**主动的、全站范围的停抓**。

**怎么改**：先确认是不是偶发。持续 5xx 的话，宁可让它返回 404
（404 等于全站放行）也不要让它 5xx。

**边界**：
- ❌ **404 绝对不报。** 4xx（429 除外）按规范等于**没有任何抓取限制**，
  这是绝大多数站点的常态。把它当错误报会稳定误报，而且方向完全错了。
- 429 要报 —— 它被归类为服务器错误，不是普通 4xx。

---

## 5 · noindex-blocked-by-robots

| | |
|---|---|
| **判定** | 这个 URL 同时满足：① 被 robots.txt 挡住 ② HTML 里有 `noindex` |
| **级别** | 阻断 |
| **detail** | `页面写了 noindex，但同时被 robots.txt 挡住 —— 爬虫读不到这条 noindex，它不会生效` |
| **evidence** | 那条 Disallow 规则 + 那个 noindex 标签 |

**为什么**：这是**最经典的 SEO 反直觉错误**，而且看起来完全合理。Google 的原话是：

> 「如果某个网页被 robots.txt 禁止抓取，那么关于索引编制或提供服务的任何规则
> 都不会被发现，因此会被忽略。」

想让一个页面从搜索结果里消失，很多人的做法是「robots.txt 挡掉 + 加 noindex」——
**双保险，实际上互相抵消**。爬虫被 robots.txt 挡在门外，永远看不到那条 noindex，
于是这个 URL 可能继续以「光秃秃一条网址、没有标题和摘要」的形态留在搜索结果里，
而且你永远删不掉它。

**怎么改**：**二选一，不要同时用。**

| 想达到什么 | 正确做法 |
|---|---|
| 不想让它出现在搜索结果里 | **只留 noindex，把 robots.txt 的 Disallow 去掉** —— 必须让爬虫能抓到，才能读到 noindex |
| 只是不想浪费抓取配额（比如后台接口） | 只留 robots.txt 的 Disallow，别加 noindex（加了也没用） |

**边界**：只有当**两者同时存在**时才报。单独一条各归各的规则管。

---

## 6 · nofollow-all

| | |
|---|---|
| **判定** | meta robots 或 `X-Robots-Tag` 中出现 `nofollow` 或 `none` |
| **级别** | 警告 |
| **detail** | `整页标记为 nofollow，页面上所有链接都不会被跟进` |
| **evidence** | 那条指令的原文 |

**为什么**：这页自己还能被收录，但它指向的所有页面**拿不到这条内链**。如果这是一个
列表页或导航页，等于它下面挂的整批页面失去了一条被发现的路径。

**怎么改**：整页 `nofollow` 极少有正当理由。要控制个别链接，在那个 `<a>` 上写
`rel="nofollow"`，不要整页关掉。

**边界**：单个链接上的 `rel="nofollow"` **不报** —— 那是正常用法（用户生成内容、
付费链接都该这么标）。本条只管整页级别的。

---

## 已知盲区

| 盲区 | 原因 |
|---|---|
| 只看服务端 HTML | 靠 JS 动态插入的 `<meta name="robots">` 看不到。不过这类 noindex 对 Google 的第一波抓取本来也不生效，影响有限 |
| 不知道页面实际收没收录 | 这组查的是「有没有东西挡着」，不是「有没有被收录」。真实收录情况要看 Search Console 的「网页收录状态」报告 |
| 只查了当前这一个 URL | robots.txt 里可能还有别的规则挡着别的页面。要看全站得逐个测 |
| 不查 `<link rel="canonical">` 指向的页面是不是 noindex | canonical 指向一个 noindex 的页面会让两个页面一起消失，但那要多抓一个页面才能判 |
