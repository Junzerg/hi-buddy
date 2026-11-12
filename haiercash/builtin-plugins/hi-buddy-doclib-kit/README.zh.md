---
description: "仓库内维护的文档库：客户端源码、构建方式及与兄弟 kit 仓库的职责边界。"
kind: "package-bundle"
---

# 本地文档库

[English](README.md) | 中文

## 概述

本包拥有 Web 和 Desktop 组合使用的文档库，源码在此维护；兄弟 kit 仓库只保留历史设计记录。

## 目录

- [开发](#development)
- [配置与扩展点](#configuration-and-extension-points)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="development"></a>
## 开发

界面逻辑修改 `src/client/index.js`，插件局部样式修改 `src/client/styles.css`。在 hi-buddy 根目录执行 `pnpm run build:doclib-client`；`build` 和 `build:artifacts` 包含此步骤。`client.js` 是提交到仓库的生成 bundle，使私有包可以直接运行和打包；`pnpm run verify:doclib-client` 检查是否过期。`dev:web` 运行期间修改客户端后，重新构建会触发宿主的 bundle 重载。

构建内嵌 CSS，保留现有模块加载入口、样式和行为；不依赖兄弟仓库，也不额外请求运行时样式表。宿主入口 `index.js` 装配现有的索引、搜索、持久化、工具和 HTTP 模块。

<a id="configuration-and-extension-points"></a>
## 配置与扩展点

`packages/bundle/web-app/cordis.patch.yml` 以 `doclib` 挂载本包，workspace 依赖选中本目录。修改 UI 时保持包名、导出入口、HTTP 端点、工具名和槽位注册稳定。主题变量与可复用控件归宿主，业务布局归本客户端。

<a id="model-experience"></a>
## 模型体验

`doc_search`、`doc_list` 和 `doc_status` 工具提供索引文档。客户端样式或布局调整不改变其 schema、结果、提示词内容、token 使用或 KV 缓存行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

客户端保留现有插件前缀 CSS、自定义控件、预览弹窗和 Markdown 渲染器。源码与样式分离不代表已接入公共控件或完成可访问性对齐；后续改版对应区域时，结合真实交互测试迁移这些实现。
