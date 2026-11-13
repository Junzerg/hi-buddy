---
description: "Web GUI 的外壳布局：三栏 AppFrame（右栏作为贴边面板的轨道）、面板几何服务与主题呈现；供窗口外壳的使用者与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

## 概述

本包提供 Web GUI 的三栏 AppFrame、左右栏宽度与 `ctx.layout` 呈现控制。右栏先让步以保护中栏空间，全屏由占用方呈现，框架保留宽屏底层轨道。主题呈现器负责配色、别名 token、字号、字体列表与 document 元数据；布局状态在刷新后重置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本插件在 root slot 中组合默认宽 236px、可在可用空间内拖动至 220px–420px 的侧边栏、自适应主内容和初始宽度为 336px 的右侧面板。窗口宽度大于 1180px 时，展开的右侧面板独占一列；宽度不超过 1180px 时，右侧面板覆盖主内容，不压缩主内容宽度。列宽与面板的过渡时间为 180ms；调整宽度立即生效。

拖动右侧面板的左边缘可调整宽度。空间允许时，最小宽度为 280px。宽窗口至少为主内容保留 360px；浮层在面板旁保留 24px 边缘。聚焦手柄后，左右方向键每次调整 16px，Home 和 End 分别选择最小和最大宽度。关闭面板或进入全屏会保留偏好宽度；全屏时隐藏手柄。刷新页面后宽度重置。

全局面板占据 root 作用域的 `main` keyed slot；`conversation` 是为会话界面保留的 key。`ctx.layout.selectPanel(id)` 选中已注册面板，`null` 则选中会话界面，但不改变当前会话。Plugins 页面是默认组合中的一个全局面板。

root 作用域的单一 `shell.bottom` slot 横跨三列下方的整行。占用方控制自身高度与显隐；三列按该高度缩短，空内容不预留空间。切换主面板时保留底部组件。`shell.overlay` 仍覆盖整个框架。默认组合不占用此 slot。

<a id="window-chrome-seat"></a>
### 窗口 chrome 座

在 macOS 桌面（`html[data-platform='darwin']`，仅由桌面 preload 设置）下，左侧栏始终展开，顶部条避开 hiddenInset 红绿灯。框架在根元素上发布 `--dsh-frame-top-clearance`（48px），供主面板中的入口型页面预留顶部空间。每个 chrome 行给自身打上 `data-window-drag`，ui-web base.css 将该标记映射为 darwin drag 规则；行内空白区域可拖动窗口，控件保持可点击。框架的 drag 规则仅用于 Windows 标题栏行。

Windows Electron 的 `data-windows-titlebar` 标记在所有列上方预留顶栏高度。内容区仅左上角保留 16px 圆角，其余角和内部交界处保持直角。框架发布 `--dsh-windows-content-radius` 和 `--dsh-windows-sidebar-width`，供 ui-sidebar-right 的全屏圆角及侧栏避让使用。普通 Web 文档不会获得该标记；macOS 保留其独立布局。

根元素通过 `--dsh-frame-top-clearance` 发布顶栏占用量（macOS 为 48px，Windows 为标题栏高度），通过 `--dsh-frame-overlay-top` 为弹窗和菜单再留出 20px。原生全屏时浮层起点降为 20px；弹窗仍保留自身 24px 的最小边距。`--dsh-frame-chrome-top` 让模态遮罩不绘制 Windows 顶栏区域，全屏时归零。覆盖整个视口的模态层仍阻挡背景点击。普通浏览器文档不发布这些值。

### 主题呈现

呈现器消费解析后的主题快照，并投影到 document：`html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，把主题的别名 token、`--dsh-content-font-size`、`--dsh-code-font-size`、`--dsh-terminal-font-size` 以及每个非空的 `--dsh-font-family-<role>` 列表设为 body 上的内联变量，并持有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新。对呈现器执行 dispose（资源释放）时，它会连同其他全局写入一起移除自己的元数据节点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`selectPanel(id)` 在改变选中态前检查实时 `main` 注册表；缺失的 key 会抛错并保留当前面板。`beginNavigation()` 为异步 UI 导航返回 abort signal。后续调用、有效面板选择（包括重复选择）或布局释放会中止该 signal，但不取消底层会话创建。消费方在提交导航或搬移草稿前检查 signal。

一次注册声明框架的子 slot，并绑定 `ctx.layout` 的 `selectPanel`、`openRightbar(track, fullscreen)` 与 `closeRightbar`。同一个 root 存储把 `panelInfo` 选中态与 `layoutInfo` 测量、呈现报告分开。`ctx.layout.panelInfo` 与标准 `usePanelInfo` hook 共用同一个选中态来源；AppFrame 订阅引用稳定的布局对象。`rightbar` owner 提供解析后的 `width`、当前 `viewportWidth` 和表示能否打开面板的 `canShow`。窄窗口以浮层方式保留面板。显式全屏在宽窗口中保留普通轨道。AppFrame 保持各列容器挂载。右栏的 root 控制器仅在选中会话界面时，经 `SessionProvider` 渲染 `rightbar.session`；内容卸载时的报告释放轨道。独立的标题组件仅在会话界面可见时使用所选会话标题，以构建配置的产品标题或本地化 `common.brand.localBuild` 为回退值；语言变化会更新该回退值。主题呈现器是第二个 effect：从解析后的快照做纯 DOM 写入——初始状态经 getter 读取一次，此后仅事件驱动，不经过 React。它先应用调色板、字号、字体列表与 token 变量，再把渲染出的背景测量为唯一的颜色依据。全屏呈现禁用网格过渡；占用方完全覆盖框架后才报告新的列布局。退出全屏时，框架先保持无过渡并安装目标布局：关闭移除右轨道，恢复保留右轨道。后续普通几何操作恢复正常过渡。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当布局面不够用时阅读以下页面。它们从框架进入它所渲染的栏与它所呈现的主题。

- [ui-sidebar](../ui-sidebar/README.zh.md)——占据 `sidebar` 栏及其座位。
- [ui-conversation](../ui-conversation/README.zh.md)——占据 `main` 中的 `conversation` key。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md)——以每会话一个停靠面占据 `rightbar` 栏。
- [ui-theme](../ui-theme/README.zh.md)——呈现器消费其解析快照的主题 seam。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前布局行为。它们是当前包约束，不是通用窗口管理器对比或任务积压。

- **面板几何是瞬时状态**——右侧面板使用所选 Session 保存的展开状态；框架测量和偏好宽度不持久化。
- **窄窗口**——右侧浮层覆盖部分主内容，并根据可用空间限制宽度。
- **列宽与面板共用过渡参数**——框架发布 `--dsh-layout-transition-duration` 和 `--dsh-layout-transition-easing`，值为 180ms 和 `ease`。列宽与面板过渡共用这两个变量；显式全屏的几何变化立即生效。
- **挤压重排期间无滚动锚定**——布局变化可能移动读者的视口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
