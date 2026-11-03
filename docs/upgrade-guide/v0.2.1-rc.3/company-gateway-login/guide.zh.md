---
kind: upgrade-guide
description: "Desktop 在打开工作区前要求通过公司 IAM 登录。"
---

# 公司网关登录

[English](guide.md) | 中文

## 变更

原登录入口通过现有账号 provider 连接公司 IAM STG，Desktop 只接受 IAM 签发的公司授权，API Key 与跳过入口移除。现有手工授权或缺少已验证 IAM 资料的授权需要重新通过 IAM 登录。IAM 登录成功后在内置公司网关发现模型并选择可用默认值，无需配置 provider。参见[账号 provider 部署要求](../../../../packages/credentials/deepseek-account-platform/README.zh.md#use-this-package)。

Desktop 未登录用户停留在登录页。退出和凭证失效时隐藏工作区，取消或登录失败不能重新打开工作区。登录后仍可使用已保存的会话和设置。退出会删除已同步的公司 Key、模型和默认模型，并中断运行中的公司模型任务。遗留 Key 或环境中的 Key 不能打开 Desktop 工作区。启动时删除没有账号授权的公司 Key，需重新登录恢复访问。

## 迁移

未打包 Desktop 本地开发使用 3080 端口，安装版 Desktop 保留 18743，两者都连接公司 IAM。开发版登录需要部署更新后的 company-login 接口，并由 IAM 管理员确认 APP176 允许 `http://127.0.0.1:3080/oauth/callback`；客户端不能自行登记该回调。

1. 安装测试包前备份现有 Harness 主目录，包括凭证、设置和配置覆盖。保留 .3 安装包；回滚需恢复与它对应的数据备份，降级兼容性尚未验证。
2. Desktop 在启动 Host 前自动修复旧连接覆盖，并在 profile 配置旁保留备份；凭证、已保存模型和其他设置保留，无需客户端修复脚本。
3. 管理员在现有 versions 服务器部署登录接口并填写两个应用密钥；Windows 用户只需安装应用后点击登录按钮，无需修改文件、执行脚本或配置环境变量。
4. 在公司内网验证 IAM 登录，确认模型发现与默认模型，然后退出并检查登录页阻止进入工作区。确认已保存的 provider Key 不能绕过登录页，取消和失败时登录页保持可见，IAM 登录后恢复访问。本地模拟测试不代表真实 IAM 或网关联调已通过。
