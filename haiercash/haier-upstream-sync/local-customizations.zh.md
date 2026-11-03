---
description: "上游同步时需要保留的公司行为、代码入口与验收要求。"
---

# 海尔定制保留清单

[English](local-customizations.md) | 中文

## 概述

基于当前代码整理的审阅草案。各项记录现有定制意图；所列验收尚未针对拟合并的上游版本执行。保留的是行为要求，不是整份文件。

## 目录

- [有效要求](#requirements)
- [维护方式](#maintenance)

<a id="requirements"></a>

## 有效要求

| 编号 | 保留要求 | 代码入口 | 验收方式 |
|---|---|---|---|
| HAIER-001 | HiBuddy／海智伙伴名称、公司图形资源与“内测版”构建标记。 | [桌面文案](../../apps/desktop/src/locale.ts)、[Web 品牌](../../packages/client/ui-brand-official/src/client/index.ts) | 检查两种支持语言下的启动页、窗口及菜单、账号、安装器和更新界面。 |
| HAIER-002 | 公司三栏布局、中间顶栏与当前侧栏控制方式。 | [布局框架](../../packages/client/ui-layout/src/client/AppFrame.tsx) | 检查空白页和会话页、折叠展开、尺寸调整与窄窗口；上游新增操作仍有入口。 |
| HAIER-003 | 当前聊天区、输入区呈现与任务交互。 | [会话区](../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx)、[输入区](../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) | 验证发送、排队、取消与继续，检查工具结果及长会话。 |
| HAIER-004 | 公司 IAM 强制登录与公司账号身份持久化。 | [登录标记](../../packages/client/ui-settings-account/src/login-config.ts)、[公司适配器](../../packages/credentials/deepseek-account-platform/src/company.ts)、[账号菜单](../../packages/client/ui-settings-account/src/client/AccountMenu.tsx) | 在强制登录模式下验证登录前工作区访问、成功登录、失败重试、重启和退出登录。 |
| HAIER-005 | 公司反馈目的地以及有意保留的设置、操作可见性。 | [账号菜单](../../packages/client/ui-settings-account/src/client/AccountMenu.tsx)、[联系配置](../../packages/client/ui-settings-account/src/contact-config.ts) | 验证公司联系流程；逐项审查上游新增入口，不盲目恢复已隐藏入口。 |
| HAIER-006 | 内网更新渠道、版本历史和公司登录路由。 | [内网发布参考](../../apps/desktop/packaging/INTRANET.md) | 沿用其发布检查；内网安装及更新证据由用户在内网执行后提供。 |
| HAIER-007 | 仅发布英文和中文 UI。 | [语言范围定义](../../scripts/shipped-locales.ts) | 检查桌面、安装器和 Web 语言选择、新文案及元数据，不静默恢复不支持的语言。 |
| HAIER-008 | 公司登录模拟器与本地 Web、Desktop 服务隔离。 | [模拟器](../haier-simulator/README.zh.md)、[Web 启动器](../../scripts/dev-web.ts) | 验证本地登录和并行启动，不混用服务或端口。 |
| HAIER-009 | 旧版公司程序名称升级兼容，以及限定安装路径的进程检查。 | [安装器生命周期](../../apps/desktop/installer/lifecycle.nsh) | 在 Windows 验证覆盖旧公司版本升级、安装路径匹配和全新安装。 |

<a id="maintenance"></a>

## 维护方式

产品要求变化时，在同一变更中更新对应编号及验收条件。代码迁移不改变编号。要求存在分歧或调查不完整时，在同步记录中列出，不静默弱化要求。

本清单是首轮审阅范围，不代表已完成穷尽审计。合并中发现其他公司行为时，需先归类，再决定是否移除。
