---
name: seo-doctor
description: "检测网页 SEO 规范：语义化标签、HTML 元信息、结构化数据。Use when: 用户要检查网页的 SEO、查 meta 标签是否规范、验证结构化数据、体检网站 SEO。NOT for: 页面性能与 Core Web Vitals 检测、关键词研究、外链分析、排名查询。"
metadata:
  openclaw:
    emoji: "🩺"
    requires:
      bins: [node]
---

# SEO Doctor

检测网页的 SEO 规范问题：语义化标签、HTML 元信息、结构化数据。

> 当前为 P0 验证版本，仅用于确认平台能力，尚未实现检测逻辑。

## Usage

运行以下命令：

```
node "<CUSTOM>/seo-doctor/run.js" --url "{用户提供的URL}"
```

把命令的输出原样展示给用户。

## 规则说明

详细的检查规则见 `references/test.md`，需要时读取该文件。
