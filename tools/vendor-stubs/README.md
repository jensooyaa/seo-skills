# vendor-stubs/

给 `tools/build.mjs` 用的桩模块，**替换掉 cheerio 里只服务 `fromURL()` / `loadBuffer()`
的那几个重量级依赖**。

## 为什么不用 esbuild 的 external

external 会在 bundle 里留下 `require("undici")`。本地这几个包就躺在 node_modules 里
（是 cheerio 的依赖），怎么试都是绿的；但平台上它们不存在，而 cheerio 的 index 是在
**顶层**require 它们的 —— 结果是 bundle 连 require 都过不去，直接
`Cannot find module 'encoding-sniffer'`。

`tools/verify-vendor.mjs` 会把 bundle 复制到没有 node_modules 的临时目录再 require，
就是为了让这类问题在本地就暴露出来。

## 为什么不用 cheerio/slim

slim 确实不带这些依赖，但它同时把 parse5 换成了 htmlparser2 —— 丢掉 HTML5 规范的
建树纠错（`<p>` 自动闭合、表格 foster parenting 等）。而「能正确解析真实世界的烂
HTML」正是我们放弃自写 tokenizer 换 cheerio 的理由，不能拿它换体积。

## 桩的约定

导出名必须齐全且**取值时不能抛** —— esbuild 生成的 `__toESM()` 会枚举并拷贝一遍
所有导出，用会抛的 getter 会在加载时就炸。所以桩一律是「函数/类存在，被调用时才抛」。
