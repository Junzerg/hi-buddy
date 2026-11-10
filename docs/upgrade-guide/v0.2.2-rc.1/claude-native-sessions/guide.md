---
kind: upgrade-guide
description: "Claude kit uses native history and its SDK runtime, ignoring saved external CLI paths."
---

# Claude kit uses native session history

English | [中文](guide.zh.md)

## Change

`hi-buddy-claude-kit` 0.1.0-alpha.2 lists projects and sessions from the Host user's `~/.claude`, or `CLAUDE_CONFIG_DIR` when set. Earlier alpha builds stored native sessions under `$DSH_HOME/hi-buddy-claude/native`. Those files remain intact but are not automatically copied into the new default directory. From alpha.8, the plugin uses the SDK platform runtime and ignores saved external CLI paths.

## Migration

1. Stop active plugin tasks before upgrading, then restart the Host and reload the browser so Host and Client use the matching Remote protocol.
2. To use the normal terminal history, leave `CLAUDE_CONFIG_DIR` unset or use the same directory as your terminal. To access the earlier plugin history, set it to the absolute path of the previous `$DSH_HOME/hi-buddy-claude/native` directory before starting the Host. Keep the original files; do not merge directories blindly.
3. Retain platform optional dependencies when installing the plugin. Under Environment, confirm the bundled runtime version; if it is missing, reinstall the plugin with its platform dependencies. A separate CLI is not required. Model credentials still come from Host model settings.
4. Open a project and an existing session, confirm its recent messages, and use Refresh after adding messages from the terminal. Finish the terminal's current task before continuing that session in the app.
