---
kind: upgrade-guide
description: "Claude kit 使用原生历史及 SDK 运行时，忽略已保存的外部 CLI 路径。"
---

# Claude kit 使用原生会话历史

[English](guide.md) | 中文

## 变更

`hi-buddy-claude-kit` 0.1.0-alpha.2 从 Host 用户的 `~/.claude` 列出项目和会话，设置了 `CLAUDE_CONFIG_DIR` 时使用该目录。早期 alpha 版本将原生会话保存在 `$DSH_HOME/hi-buddy-claude/native`。原文件保留，但不会自动复制到新的默认目录。从 alpha.8 起，插件使用 SDK 平台运行时，忽略已保存的外部 CLI 路径。

## 迁移

1. 升级前停止插件中正在执行的任务，随后重启 Host 并刷新浏览器，确保 Host 与 Client 使用匹配的 Remote 协议。
2. 使用普通终端历史时，不设置 `CLAUDE_CONFIG_DIR`，或将其设为终端使用的同一目录。访问旧版插件历史时，在启动 Host 前将其设为此前 `$DSH_HOME/hi-buddy-claude/native` 目录的绝对路径。保留原文件，不要直接混合目录。
3. 安装插件时保留平台可选依赖。从 alpha.9 起，发送消息时启动运行时，不再提供「运行环境」面板。如果会话提示运行时缺失，重新安装插件及其平台依赖。用户无需另装 CLI，模型凭据仍来自 Host 模型设置。
4. 打开项目和已有会话，核对最近消息；在终端追加消息后，点击「刷新」检查更新。在 app 中继续同一会话前，先结束终端当前执行的任务。
