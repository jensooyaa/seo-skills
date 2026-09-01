# lib/vendor/

这个目录下的 `.js` 全部是 `tools/build.mjs` 用 esbuild 生成的**构建产物**，
不要手改 —— 下一次 `npm run build` 会原样覆盖。

之所以把三方库打成单文件提交，是因为 FocusWork 导入时先 `npm install` 再扫描，
扫描有 500 文件硬上限；声明依赖会装出上千个文件直接导入失败。
所以 `seo-doctor/package.json` 永远不声明 `dependencies`。

要改版本，改仓库根的 `devDependencies` 后重新 `npm run build`。
