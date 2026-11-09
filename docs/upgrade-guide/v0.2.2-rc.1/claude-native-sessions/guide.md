---
kind: upgrade-guide
description: "Claude kit alpha.2 reads native Claude Code history instead of the earlier isolated plugin history."
---

# Claude kit uses native session history

English | [中文](guide.zh.md)

## Change

`hi-buddy-claude-kit` 0.1.0-alpha.2 lists projects and sessions from the Host user's `~/.claude`, or `CLAUDE_CONFIG_DIR` when set. Earlier alpha builds stored native sessions under `$DSH_HOME/hi-buddy-claude/native`. Those files remain intact but are not automatically copied into the new default directory. The new runtime store also does not inherit the earlier saved CLI path.

## Migration

1. Stop active plugin tasks before upgrading, then restart the Host and reload the browser so Host and Client use the matching Remote protocol.
2. To use the normal terminal history, leave `CLAUDE_CONFIG_DIR` unset or use the same directory as your terminal. To access the earlier plugin history, set it to the absolute path of the previous `$DSH_HOME/hi-buddy-claude/native` directory before starting the Host. Keep the original files; do not merge directories blindly.
3. If Claude CLI 2.1.218 is not on PATH, set its absolute path again under the page's Environment section. Model credentials still come from Host model settings.
4. Open a project and an existing session, confirm its recent messages, and use Refresh after adding messages from the terminal. Finish the terminal's current task before continuing that session in the app.
