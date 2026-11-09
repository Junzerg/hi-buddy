---
kind: upgrade-guide
description: "Claude kit alpha.2 读取原生 Claude Code 历史，不再默认读取旧版插件的独立历史目录。"
---

# Claude kit 使用原生会话历史

[English](guide.md) | 中文

## 变更

`hi-buddy-claude-kit` 0.1.0-alpha.2 从 Host 用户的 `~/.claude` 列出项目和会话，设置了 `CLAUDE_CONFIG_DIR` 时使用该目录。早期 alpha 版本将原生会话保存在 `$DSH_HOME/hi-buddy-claude/native`。原文件保留，但不会自动复制到新的默认目录。新版运行时存储也不继承此前保存的 CLI 路径。

## 迁移

1. 升级前停止插件中正在执行的任务，随后重启 Host 并刷新浏览器，确保 Host 与 Client 使用匹配的 Remote 协议。
2. 使用普通终端历史时，不设置 `CLAUDE_CONFIG_DIR`，或将其设为终端使用的同一目录。访问旧版插件历史时，在启动 Host 前将其设为此前 `$DSH_HOME/hi-buddy-claude/native` 目录的绝对路径。保留原文件，不要直接混合目录。
3. 如果 PATH 中没有 Claude CLI 2.1.218，在页面的「运行环境」中重新设置其绝对路径。模型凭据仍来自 Host 模型设置。
4. 打开项目和已有会话，核对最近消息；在终端追加消息后，点击「刷新」检查更新。在 app 中继续同一会话前，先结束终端当前执行的任务。
