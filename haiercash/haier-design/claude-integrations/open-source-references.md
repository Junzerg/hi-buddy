---
description: "可用于 Claude 本机 CLI 插件的开源项目比较、源码发现及复用建议。"
status: research
date: 2026-11-09
---

# Claude CLI 图形界面的开源项目调研

## 摘要

已有开源项目实现了“Claude CLI／SDK + 图形会话界面”，无需从空白设计所有交互。建议 kit 优先评估 **Happy 的 MIT 许可适配模块**，以 **CloudCLI 的交互流程与测试场景**作完整性参照，再把所需能力接入 DSH 现有宿主。没有发现可直接当作 DSH 插件安装、且已证明满足本次全部验收条件的现成项目。

本次核查了四个原始项目仓库、根 LICENSE、README、GitHub 仓库状态，并对关键适配源码作定点检查；未进行项目运行验证。调查日期为 2026-11-09，维护状态与源码行为可能继续变化。

## 目录

- [候选比较](#候选比较)
- [源码中的关键差异](#源码中的关键差异)
- [复用建议](#复用建议)
- [Dev Note](#dev-note)

## 候选比较

以下项目均有公开源码和明确许可证。判断针对当前“本机 CLI、独立插件、已有 DSH 桌面壳”的需求，不是通用产品排名。

| 项目 | 已核对许可证 | 项目形态与维护观察 | 本次适用性 |
|---|---|---|---|
| [CloudCLI / Claude Code UI](https://github.com/siteboon/claudecodeui) | [AGPL-3.0](https://github.com/siteboon/claudecodeui/blob/main/LICENSE) | Web UI 与本地服务，覆盖多个 coding agent；未归档，API 显示最近 push 为 2026-11-07 | 与目标产品流程最接近；可参考会话、审批和错误场景。直接改造须处理许可证和独立服务架构 |
| [Happy](https://github.com/slopus/happy) | [MIT](https://github.com/slopus/happy/blob/main/LICENSE) | 当前仓库含移动／Web app、CLI 和 relay server；未归档，API 显示最近 push 为 2026-11-09 | 优先评估其 CLI 适配、权限请求与恢复模块；不整套引入远程同步体系 |
| [Opcode](https://github.com/winfunc/opcode) | [AGPL-3.0](https://github.com/winfunc/opcode/blob/main/LICENSE) | Tauri 2 桌面程序，Rust 执行层和前端；未归档，API 显示最近 push 为 2026-11-06 | 适合参考桌面会话组织；不是 Electron／Cordis 的直接插件底座，且权限实现有重大差异 |
| [Claude Code Web UI](https://github.com/sugyan/claude-code-webui) | [MIT](https://github.com/sugyan/claude-code-webui/blob/main/LICENSE) | Web 聊天界面；2026-05-29 归档，README 明确不再积极维护 | 可作较小实现的学习或抽取候选，不宜默认承担最新 CLI 兼容维护 |

最近 push 只说明仓库有变动，不代表最近成功发行、质量可靠或兼容当前 CLI。

## 源码中的关键差异

以下观察是选择复用范围的依据。项目功能说明不能代替目标平台实测，也不能保证其所有执行路径都满足本插件要求。

### CloudCLI：结构接近，但运行时策略不同

[Claude runtime provider](https://github.com/siteboon/claudecodeui/blob/main/server/modules/providers/list/claude/claude-runtime.provider.ts) 使用官方 Agent SDK，并含任务中止、会话和交互处理。[CLI path resolver](https://github.com/siteboon/claudecodeui/blob/main/server/shared/claude-cli-path.ts) 对用户配置的路径做处理，但在未指定时可把选择交回 SDK 内置二进制。

我们的目标明确是使用本机 CLI，缺失就提示。因此即使采用该项目代码，也必须改变并测试 fallback 行为，不能认为“现成 GUI”天然满足运行时选择要求。其 provider 目录还有 elicitation、session、runtime hold 与环境相关测试，可作为场景核对入口；本次只检查到测试文件存在，没有运行这些测试。

### Happy：适配模块值得优先评估

[SDK query adapter](https://github.com/slopus/happy/blob/main/packages/happy-cli/src/claude/sdk/query.ts) 包装官方 SDK，并映射 resume、permission mode、abort 和工具审批回调。[PermissionHandler](https://github.com/slopus/happy/blob/main/packages/happy-cli/src/claude/utils/permissionHandler.ts) 维护交互请求及回答状态。

这些模块贴近本插件的难点，但仍耦合 Happy 自己的会话、消息和服务结构。MIT 许可使按条件复用代码较容易，不意味着直接复制两个文件就能运行。当前仓库与桌面仓库的分工见[官方 README](https://github.com/slopus/happy/blob/main/README.md)；本次没有进一步审计其独立桌面仓库。

只抽取本地执行和交互所需部分，通信与存储改接 DSH。不要引入非必要的 relay、账号、移动端加密同步或整个多 agent 平台。项目宣称可以使用已有订阅，不作为我们产品认证与分发方式已获许可的证据。

### Opcode：不能照搬默认执行参数

[Claude commands](https://github.com/winfunc/opcode/blob/main/src-tauri/src/commands/claude.rs) 的已检查启动、继续及 resume 路径包含 `--dangerously-skip-permissions`。这与我们的“页面接通原生审批、默认不绕过权限”验收条件冲突。

因此不能把它的可视化会话能力等同于已有完整审批闭环。加上 Rust／Tauri 与当前 Host／Client 架构差异，它更适合桌面信息组织参照，不作为首选执行适配底座。

### sugyan 项目：许可适合复用，但维护已停止

[README](https://github.com/sugyan/claude-code-webui/blob/main/README.md) 明确说明归档与停止积极维护，仓库也标记为 archive。代码中存在前端流式聊天及权限 hooks，但本次没有验证其当前 CLI 兼容性或完整 Host 审批实现。

若开发方选择抽取较小模块，应同时承担升级协议和修复恢复路径的维护成本，不能将原项目演示视为当前版本验收结果。

## 复用建议

建议采用“现成模块评估 + DSH 原生插件接入”，不默认 fork 整个独立应用。

1. **优先评估 Happy 的局部实现。**重点是原生调用、审批关联、取消与恢复。确认依赖范围和文件许可证后，保留相应版权及许可声明。
2. **CloudCLI 用于完整交互与测试场景参照。**若希望直接复制或改造其代码，再按具体代码边界核对 AGPL 对修改、分发及网络交互的适用义务；它不是禁止商用，也不是可按 MIT 随意并入的代码。
3. **Opcode 不作为默认执行底座。**桌面技术栈不同，且已发现权限旁路参数与需求不符。
4. **归档项目只作有边界的参考。**对其当前 SDK／CLI 兼容性不作预设。

MIT 与 AGPL 的判断依据是各仓库本次读取的 LICENSE；实际抽取还需检查选定文件与第三方依赖的声明。独立进程、iframe 或“仅内网使用”不应被当作自动免除许可证义务的结论。具体许可义务需按实际复用与分发方式确定。

复用代码需记录来源版本、文件、许可证和修改范围，并保留必要声明。集成仍需满足[宿主接入设计的验收门槛](host-integration-design.md#验收门槛)；原项目测试通过不能替代插件在 DSH 中的验证。

## Dev Note

上游实现尚未选定；Happy 是优先评估候选。
