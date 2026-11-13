---
description: "Claude 插件的宿主扩展点、功能归属、分发边界与验收要求。"
status: design
date: 2026-11-09
---

# Claude 插件宿主接入设计

## 当前决定

采用方案一：由本机 Claude Code 执行，hi-buddy 中的独立插件承载交互。[路线比较](claude-integration-comparison.md)和[调研证据](claude-integration-evidence.md)保留为选型背景，不再以方案二作为实施建议。

## 默认网关与模型来源

默认模型服务为 `http://ai-gateway.haierxj.cn`，使用 Anthropic Messages 协议；地址与协议由产品方确认。插件默认复用 app 同步得到的该网关 Anthropic Messages 模型目录，保留模型原始 ID，不按 Claude 模型名称过滤，也不把显示名称作为请求模型 ID。“Anthropic”在这里表示接口协议，不表示模型来自 Anthropic；DeepSeek、GLM 等模型的 Claude Code 兼容性需要逐项验证。

插件在 Host 侧读取选定服务、模型和凭据引用，再向所启动的 Claude 子进程显式传递配置。app 设置不是 Claude CLI 的配置文件，不能依赖 CLI 自动读取。

| app 配置 | Claude 执行配置 |
|---|---|
| 网关根地址 | `ANTHROPIC_BASE_URL=http://ai-gateway.haierxj.cn`，不追加消息接口路径 |
| 所选模型原始 ID | SDK 的显式 `model` 或 CLI 的显式模型参数；环境方式对应 `ANTHROPIC_MODEL` |
| 网关认证方式与凭据引用 | Host 解析凭据后，按实际认证方式传递 `ANTHROPIC_AUTH_TOKEN`（Bearer）或 `ANTHROPIC_API_KEY`（x-api-key），不猜测、不同时混用 |

凭据不经过 Client、不写入会话或日志，也不自动复制用户 Claude OAuth token。配置只作用于插件拥有的子进程，不改全局 Claude 设置。网关模式以网关请求结果判断可用性，不要求个人 claude.ai 登录成功作为前置条件；缺少网关凭据时提示配置缺失，不退回其他账号或服务。认证方式和凭据来源仍需按实际网关配置接线。

模型同步成功仅证明目录可读；验收还需覆盖所选模型的流式响应、工具调用与结果回传、多轮续聊、审批和取消，以及执行器可能使用的辅助模型路由。不得让默认辅助模型别名落到网关不存在的模型或静默回退到公网。官方支持网关配置，但不承诺通过网关使用非 Claude 模型，因此这部分是本产品需要实测的兼容范围。参见[官方网关接入](https://code.claude.com/docs/en/llm-gateway-connect)与[支持边界](https://code.claude.com/docs/en/llm-gateway)。

## 宿主扩展点

插件通过现有宿主扩展点接入独立页面、通信、进程与存储。下表描述接入设计，不代表插件已实现或通过集成验收。

| 需求 | 现有接入点 | 负责方 |
|---|---|---|
| 独立导航与页面 | [sidebar.panellist](../../../packages/client/ui-sidebar/README.md#global-panel-entries) + [layout main slot](../../../packages/client/ui-layout/README.md) | kit 注册同 id `hi-buddy-claude` 的入口与页面，宿主集成验收 |
| Host／Client 通信 | [Typert Remote](../../../docs/cookbook/adding-a-remote-api.md)、[Client modules](../../../docs/subsystems/client-modules.md) | kit 提供服务与生成产物，宿主复用现有载入机制 |
| 本机 CLI 与进程管理 | [subprocess](../../../docs/subsystems/subprocess.md) 的 executable lookup、管道和进程管理 | kit 适配 Claude 协议与生命周期；具体跨平台行为待实测 |
| 插件自己的数据 | [storage-domain](../../../docs/subsystems/storage.md) | kit 声明版本化领域数据，不修改 DSH Session 格式 |
| 启用／禁用与安装 | [plugin-manager](../../../packages/boot/plugin-manager/README.md) 的 bundle 管理 | kit 提供 bundle；宿主核对安装与兼容性 |
| 已有外部插件格式 | [glossary kit](../../builtin-plugins/hi-buddy-glossary-kit-0.3.0-rc.2.tgz) | kit 参考；宿主接收 `.tgz` 与校验和 |

现有 Claude 子代理包锁定 Agent SDK `0.3.263`。本地安装的 SDK 类型声明含 `pathToClaudeCodeExecutable`，省略时使用内置 executable。因此新插件必须显式绑定已检测的本机路径；该类型存在不证明任意 CLI／SDK 组合兼容，kit 需要先提供真实验证证据。

## 功能归属

kit 拥有完整 Claude 专属功能：页面、CLI 发现、协议、审批与问题应答、会话记录、恢复、取消、进程清理和失败提示。宿主提供通用扩展点，不维护另一套 Claude agent 状态。

插件以独立 profile bundle 分发，包含 Host 服务、Client 页面及生成的 Remote 产物。是否预置和默认启用由应用分发配置决定；bundle 选择与直接 Host 行注册只采用一种接入路径，避免重复挂载。停用插件保留用户数据，数据删除须有独立明确操作。

## 验收门槛

可安装和界面出现只是第一步。完整接入须满足：

- DSH 无需启动父 agent 就能创建 Claude 会话；原有 DSH 聊天正常使用。
- 实际运行用户选定 CLI，没有内置运行时静默 fallback。
- 原生审批与用户问题可完整往返；拒绝不执行，过期审批不生效。
- 连续聊天与重启续聊正确，恢复不会重复执行结果未知的动作。
- 离开页面保留任务，禁用插件及退出 Host 可释放插件资源。
- 错误反馈清晰，未认证与版本不支持不会导致整个 app 无法启动。
- 真实 CLI 与目标平台验证证据齐全，未验证项显式保留。

## Dev Note

正式显示名称、是否预置及默认是否启用尚未确定。
