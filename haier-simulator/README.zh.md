---
description: "在本地模拟海尔 IAM、个人 API Key 和模型网关，供真实 Web 应用开发使用。"
---

# 海尔服务模拟器

[English](README.md) | 中文

## 概述

在外网通过模拟海尔账号、个人 API Key、模型发现和流式回复开发真实 Web 应用。Docker 将模拟上游服务与应用现有的公司登录中间服务一起运行。无需真实 IAM 凭据，也不会调用真实模型。

## 目录

- [启动](#start)
- [验证场景](#scenarios)
- [开发数据与边界](#boundaries)
- [检查](#checks)

<a id="start"></a>

## 启动

通过 pnpm 安装仓库依赖，并使用 Node >=24.9。需要可用的 Docker Engine 和 Docker Compose。正常的 Web 开发入口会构建产物并启动源码监听。启动另一组开发进程前先停止已有的仓库监听进程。

在仓库根目录执行：

```sh
pnpm --dir haier-simulator run up
pnpm run dev:web --haier
```

打开第二条命令输出的带认证信息的 Web 地址。IAM 登录成功前，Web 会隐藏工作区并显示强制登录弹窗。点击“登录”打开模拟海尔 IAM 页面，选择模拟账号并确认登录。真实 Host 会交换授权码、保存用户资料、发现并选中模拟模型。通过应用的账号菜单退出，清除应用账号凭据和公司模型。

服务控制台位于 `http://127.0.0.1:18080`。现有登录中间服务监听 `http://127.0.0.1:18081/company-login/exchange`。Web Host 使用 `127.0.0.1:3080`，与模拟器显式配置的回调一致。Desktop 开发版和安装版保留 18743 端口的公司 IAM 回调。端口被占用时启动失败；启动器不会停止其他应用。

浏览器位于另一台机器时，将开发机的 3080 和 18080 端口转发到浏览器所在机器，并保持相同的回环端口。浏览器需要同时能访问 Web 和 IAM 地址。Host 自己通过 18081 端口访问中间服务，这个端口无需向浏览器转发。

如需复用已有产物，添加正常开发入口的 `--skip-build` 选项：

```sh
pnpm run dev:web --haier --skip-build
```

同一时间只运行一组仓库监听进程。Ctrl+C 停止 Web 进程及其监听进程，Docker 服务继续运行。通过以下命令停止这些服务：

```sh
pnpm --dir haier-simulator run down
```

<a id="scenarios"></a>

## 验证场景

IAM 页面提供正常登录、拒绝授权、授权码过期，以及 Token、用户资料、个人 Key、模型列表接口失败的场景。关闭 IAM 标签页，再通过应用的登录控件取消，可验证取消行为。保持尝试未完成，可验证应用现有的登录超时。

两个虚构账号提供不同的姓名、邮箱和部门路径。网关返回一个模型 `haier-simulator`，支持普通 JSON 或 OpenAI 兼容的 SSE，并提供固定格式的中文回复。回复明确标记为模拟内容，不执行推理，也不生成工具调用。Token 用量为固定测试数据。

在服务控制台点击“重置模拟凭据”，可使全部授权码、IAM Token 和个人 Key 失效。下次模型请求收到 HTTP 401。应用在发起请求时发现凭据失效，不会收到模拟器专用的推送通知。

<a id="boundaries"></a>

## 开发数据与边界

模拟服务源码、Compose 配置和开发连接配置位于本目录。生成的中间服务 bundle 位于 `.build/`，独立的 Harness home 和可写 Web profile 位于 `.state/`；两个目录均被 Git 忽略。Web 重启后保留 profile 设置和会话历史。模拟凭据保存在容器内存中；模拟服务重启后，应用下次发现旧 Key 失效时需要重新登录。

模拟器匹配应用实际使用的海尔接口：IAM authorize/token/userInfo、个人 Key getOrCreate、模型列表和聊天补全。company-login 容器运行[现有中间服务](../apps/desktop/scripts/company-login-server.ts)的 bundle。其原有的内网个人 Key 主机名在 Compose 网络内解析到模拟服务。应用密钥均为固定虚构值，不读取生产密钥文件。

正常的 `pnpm run dev:web --haier` 入口读取本目录的开发配置；不带 `--haier` 时使用原来的 Harness home。Windows 打包流程不引用模拟器。它不修改生产接口地址或 IAM 要求。`--haier` profile 会开启 Web 应用的强制 IAM 入口：加载、退出、凭据过期或持有非 IAM 凭据时保留登录弹窗，IAM 登录成功后恢复使用。Desktop 强制 IAM 的窗口仍由 Electron 负责。企业单点登录 Cookie、MFA、真实 IAM 策略、真实模型输出和 Windows 桌面行为仍需内网验收。应用退出会清除本地凭据，不执行 IAM 全局单点退出。

<a id="checks"></a>

## 检查

分别运行 HTTP 协议测试和 Docker 测试：

```sh
pnpm --dir haier-simulator run test
pnpm --dir haier-simulator run test:docker
```

Docker 测试使用独立 Compose 项目和操作系统分配的宿主端口，调用真实中间服务，并在完成后删除自己创建的容器和网络。需要 Docker，首次运行可能下载 Node 基础镜像。

模拟器 Web Host 运行期间，以下命令接收其输出的带认证信息的启动地址，验证真实账号 RPC、授权回调、用户资料、模型发现、取消和退出清理。检查前后都会退出模拟账号：

```sh
node haier-simulator/smoke.mjs 'http://127.0.0.1:3080/?token=<printed-token>'
```

## 开发备注

无。
