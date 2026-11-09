---
kind: upgrade-guide
description: "公司模型路由默认改用网关根地址上的 Anthropic Messages，替代 OpenAI Chat Completions。"
---

# 公司网关使用 Anthropic Messages

[English](guide.md) | 中文

## 变更

内置 `company-gateway` 路由使用 `api: anthropic-messages` 和 `baseURL: http://ai-gateway.haierxj.cn`。模型发现向 `/v1/models?limit=1000` 发送 Anthropic 请求头；推理使用 Anthropic Messages 协议。这替代了以 `/v1` 为基础地址的 OpenAI 路由。

Desktop 启动时会备份已保存的公司连接覆盖，并按内置默认值修复。已有凭据、已保存模型列表和其他提供方保持不变。登录同步服务仍支持显式配置的 OpenAI 公司路由。

## 迁移

1. Desktop 用户无需手动改配置。重启更新后的应用，在模型设置中检查 HaierCash 提供方：协议应为 Anthropic Messages，API 地址应为上述网关根地址。
2. 其他 profile 若保存了 `company-gateway` 覆盖，需显式修改这两个字段以采用新路由。保留已有凭据引用和模型 ID。
3. 在目标网络中验证模型发现、流式对话和一次工具调用。模型目录请求成功不代表推理协议已经兼容。
