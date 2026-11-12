---
description: "Claude 集成路线比较的源码证据、官方资料、分析方法与验证边界。"
status: research
date: 2026-11-09
---

# Claude 集成调研记录

## 摘要

本记录支持[路线比较与建议](claude-integration-comparison.md)，区分源码与文档事实、工程判断以及尚未验证的部署条件。调查日期为 2026-11-09，依据源码与文档，不包含 Claude 实机调用或基准测试。当前采用方案一，见[宿主接入设计](host-integration-design.md)。

## 目录

- [比较方法](#比较方法)
- [本地证据](#本地证据)
- [官方资料](#官方资料)
- [结论如何形成](#结论如何形成)
- [验证边界](#验证边界)
- [Dev Note](#dev-note)

## 比较方法

调查先确定执行循环、权限和会话的归属，再比较用户体验、迁移资产、内网依赖和维护成本。这个顺序可以避免把“能调用模型”“能启动 CLI”“能持续交互”当成同一项能力。

1. 阅读仓库架构、桌面入口、测试政策与文档规范，确定既有产品边界。
2. 搜索 Claude、指令、技能、计划、子代理、MCP、压缩与权限相关包，检查关键源码和组合配置。
3. 查询并直接打开 Claude 官方程序化调用、SDK、权限、配置、桌面和产品集成说明；不使用论坛推测作为技术结论。
4. 按相同用户目标比较两条路线，单列已有能力与新增集成工作。
5. 将任务效果、操作系统表现、认证适用性与内网连通性保留为待实测或确认项，不用功能清单替代验收。

## 本地证据

以下证据说明当前源码或维护文档提供的机制，不代表当前桌面安装已启用全部相关包。

| 证据 | 观察 | 对结论的约束 |
|---|---|---|
| [架构](../../../docs/architecture.md)、[桌面说明](../../../apps/desktop/README.md) | Electron 启动 Desktop Host，后者运行 DSH Web 应用；核心能力可由 Cordis 插件组合 | 可保留 app 框架，不必复制新的桌面壳 |
| [Claude 子代理说明](../../../packages/subagent/subagent-claude-code/README.md)、[包依赖](../../../packages/subagent/subagent-claude-code/package.json) | 已有官方 SDK 子代理，SDK 固定为 `0.3.263` | 方案一已有参考实现，但有明确版本依赖 |
| [Claude 执行源码](../../../packages/subagent/subagent-claude-code/src/run.ts) | `claudeQueryOptions` 设置 `persistSession: false`；禁用 `AskUserQuestion`；非 bypass 模式的 `canUseTool` 返回拒绝 | 现有插件不具备人工交互与持久续聊条件 |
| [Claude 子代理限制](../../../packages/subagent/subagent-claude-code/README.md#known-limitations-and-deferred-work) | 固定 SDK 平台 payload，无本机 CLI fallback；仅最终结果，没有子任务进度流 | “使用本机已有 CLI”是新增运行时选择能力 |
| [基础组合](../../../packages/bundle/base/cordis.patch.yml)、[Web 组合](../../../packages/bundle/web-app/cordis.patch.yml) | 可见审批、技能、计划、子代理、压缩及 UI 配置；Web 会将部分能力交由 preset 负责 | 包已存在不等于每个 preset 默认具备全部能力 |
| [指令配置源码](../../../packages/context/agent-instructions/src/config.ts)、[指令说明](../../../packages/context/agent-instructions/README.md) | 默认候选包含 `AGENTS.md`、`CLAUDE.md` 及 local 文件 | 有指令迁移基础；未证明完整 `.claude` 配置兼容 |
| [技能发现说明](../../../packages/skill/skill-filesystem/README.md#roots-and-priority) | 默认发现 `.dsh/skills`、`.agents/skills` 及用户根，支持自定义目录 | `.claude/skills` 需要明确配置或迁移入口 |
| [计划模式说明](../../../packages/plan/plan-mode/README.md) | 计划指导与审阅流程已存在，但工具仍可调用 | 不能把计划模式称为强制只读沙箱 |
| [审批](../../../packages/interaction/user-approval/README.md)、[MCP](../../../packages/mcp/mcp-client/README.md) | 已有独立能力包 | 企业交互可复用机制，但跨执行器接线需实现 |
| [模型适配](../../../packages/llm/llm-pi-ai/README.md) | 支持多 provider 和自定义网关配置 | 可选择模型服务，不代表任意网关都已验证 |
| [Claude hooks 兼容桥](../../../packages/experimental/hooks-claude-code/README.md) | 支持部分命令 hooks；不支持完整事件、处理器和字段语义 | 必须发布兼容子集；不能说 hooks 原样全部迁移 |
| [Claude mods 兼容桥](../../../packages/experimental/claude-code-mods/README.md) | 存在实验性兼容实现及差异说明 | 可参考复用，不等于原生插件市场可直接安装 |
| [会话 checkpoint](../../../packages/session/session-checkpoint-policy/README.md) | 负责模型请求和工具副作用前后的日志持久化时机 | 不能与文件系统回滚混为一谈 |
| [实验性 worktree](../../../packages/experimental/worktree/README.md) | 存在工作区隔离相关包 | 完整桌面工作区体验仍需单独检查和验收 |

## 官方资料

以下页面均在本次调查中直接打开，访问日期为 2026-11-09。官方站点会更新内容，实施时应以锁定 SDK／CLI 版本及其实际行为为准。

| 来源 | 用于本次决策的事实 |
|---|---|
| [程序化运行 Claude Code](https://code.claude.com/docs/en/headless) | 官方支持非交互 CLI 及结构化输出；完整程序控制另有 SDK |
| [Agent SDK 概览](https://code.claude.com/docs/en/agent-sdk/overview) | 提供原生执行循环及工具、权限、会话等能力；不是可直接嵌入的桌面 UI |
| [SDK 权限](https://code.claude.com/docs/en/agent-sdk/permissions) | 原生权限决策与运行时审批回调有自己的执行顺序，不能假设 DSH 审批自动覆盖 |
| [SDK 中的 Claude Code 功能](https://code.claude.com/docs/en/agent-sdk/claude-code-features) | 文件系统设置加载由 SDK 配置控制；CLI、SDK 版本和加载策略需要明确 |
| [桌面应用](https://code.claude.com/docs/en/desktop) | 桌面包含工作区、预览、diff 和多会话等体验，不能由 CLI 接入自动获得 |
| [产品集成与凭据说明](https://code.claude.com/docs/en/legal-and-compliance) | 未修改二进制中的用户自行登录，与第三方 app 收集／中转账号凭据是不同情形 |

调查时产品集成说明明确允许特定条件下运行未修改的 Claude Code，并区分最终用户自行登录与第三方提供登录、中转凭据的行为；SDK 概览仍强调第三方集成的认证要求。本文保留这个区别，不把个人 CLI 使用条件直接外推到企业产品，也不作最终法律适用性判断。

## 结论如何形成

选型时推荐方案二主线的逻辑来自三个条件：hi-buddy 当前定位包含内网分发；仓库已有完整 agent 基础机制；企业工具、权限和会话由 DSH 统一拥有更便于长期演进。模型选择空间是潜在优势，实际质量和成本仍需评测。

推荐保留方案一入口，则来自另一组需求：用户可能依赖原生 Claude 行为和既有生态；SDK 能复用原生执行系统；DSH 已有一次性子代理参考实现。这些因素支持按需建设入口，不支持立刻并行开发两套完整产品。

以下情况会改变优先级：

- 首批用户强依赖原生 Claude 特定行为或插件，且能使用合适服务与认证方式：优先方案一。
- 必须使用仅内网可达的其他模型服务：方案二优先，原生 CLI 不解决模型可达性。
- 实测 DSH 无法达到关键任务质量，而原生执行能达到：增加方案一投入，保留产品与模型评测数据。
- 核心需求是 Cowork 或完整电脑操作而非代码工作流：重新定义范围后比较，不能沿用当前工作量判断。

## 验证边界

本次完成的是静态源码检查、维护文档核对和官方资料调查，没有执行安装、登录、Claude 调用、跨平台桌面验证、用户资产迁移或任务基准。因此文中不提供真实延迟、成功率、价格节省或可靠工期数字。

实现验收应按[测试政策](../../../docs/testing.md)验证实际产品入口。

## Dev Note

任务效果与网络可达性需要代表性项目、任务样本和目标环境验证。
