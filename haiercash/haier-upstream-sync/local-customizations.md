---
description: "Company behaviors, source entry points and acceptance criteria for upstream integration."
---

# Haier customization register

English | [中文](local-customizations.zh.md)

## Summary

Review draft based on the current checkout. These entries capture existing customization intent; their acceptance steps have not been executed for the proposed upstream integration. Preserve behavior rather than entire files.

## Contents

- [Active requirements](#requirements)
- [Maintenance](#maintenance)

<a id="requirements"></a>

## Active requirements

| ID | Preserve | Source entry | Acceptance |
|---|---|---|---|
| HAIER-001 | HiBuddy / 海智伙伴 names, company artwork and 内测版 build labels. | [Desktop strings](../../apps/desktop/src/locale.ts), [Web brand](../../packages/client/ui-brand-official/src/client/index.ts) | Inspect startup, window/menu, account, installer and update surfaces in both supported languages. |
| HAIER-002 | Company three-column layout, center top bar and current sidebar controls. | [Frame](../../packages/client/ui-layout/src/client/AppFrame.tsx) | Inspect blank and active sessions, collapse/expand, resizing and narrow windows; new upstream actions remain reachable. |
| HAIER-003 | Current chat/composer presentation and task interaction. | [Conversation](../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx), [input](../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) | Send, queue, cancel and resume messages; inspect tool results and long conversations. |
| HAIER-004 | Required company IAM login and persisted company account identity. | [Login flag](../../packages/client/ui-settings-account/src/login-config.ts), [company adapter](../../packages/credentials/deepseek-account-platform/src/company.ts), [account menu](../../packages/client/ui-settings-account/src/client/AccountMenu.tsx) | In required-login mode, verify workspace access before login, successful login, failure/retry, restart and sign-out. |
| HAIER-005 | Company feedback destination and intentional visibility of settings/actions. | [Account menu](../../packages/client/ui-settings-account/src/client/AccountMenu.tsx), [contact configuration](../../packages/client/ui-settings-account/src/contact-config.ts) | Verify company contact flow; review new upstream entries individually without blindly restoring hidden entries. |
| HAIER-006 | Intranet update channels, release history and company-login routing. | [Intranet reference](../../apps/desktop/packaging/INTRANET.md) | Follow its release checks; intranet installation/update evidence comes from the user on the intranet. |
| HAIER-007 | English and Chinese as the shipped UI language set. | [Language authority](../../scripts/shipped-locales.ts) | Check desktop, installer and Web language selection, new strings and metadata; no unsupported language is silently restored. |
| HAIER-008 | Company login simulator and separate local Web/Desktop development services. | [Simulator](../haier-simulator/README.md), [Web launcher](../../scripts/dev-web.ts) | Verify local login flow and concurrent launch without service/port confusion. |
| HAIER-009 | Upgrade compatibility with legacy company executable names and path-scoped process checks. | [Installer lifecycle](../../apps/desktop/installer/lifecycle.nsh) | On Windows, verify upgrade over the previous company build, correct installation-path matching and fresh installation. |

<a id="maintenance"></a>

## Maintenance

When product requirements change, update the affected ID and its acceptance criteria in the same change. Source paths may move without changing the ID. Record disagreements or incomplete discoveries in the integration record instead of silently weakening a requirement.

This register is the first review scope, not a claim of exhaustive audit. Newly discovered company behavior needs classification before an upstream merge removes it.
