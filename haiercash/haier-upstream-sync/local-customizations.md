---
description: "Company behaviors, source entry points and acceptance criteria for upstream integration."
---

# Haier customization register

English | [中文](local-customizations.zh.md)

## Summary

This register captures the company customization principles confirmed through review; their acceptance steps have not been executed for the proposed upstream integration. Preserve behavior rather than entire files.

## Contents

- [Active requirements](#requirements)
- [HAIER-002: layout integration principles](#layout)
- [HAIER-003: conversation integration principles](#conversation)
- [HAIER-004: identity integration principles](#identity)
- [HAIER-005: company service entry principles](#company-services)
- [HAIER-006: intranet distribution integration principles](#distribution)
- [HAIER-007: language integration principles](#languages)
- [HAIER-008: development verification integration principles](#development)
- [HAIER-009: upgrade compatibility integration principles](#upgrade)
- [Maintenance](#maintenance)

<a id="requirements"></a>

## Active requirements

| ID | Preserve | Source entry | Acceptance |
|---|---|---|---|
| HAIER-001 | HiBuddy / 海智伙伴 names, company artwork and 内测版 build labels. | [Desktop strings](../../apps/desktop/src/locale.ts), [Web brand](../../packages/client/ui-brand-official/src/client/index.ts) | Inspect startup, window/menu, account, installer and update surfaces in both supported languages. |
| HAIER-002 | Company three-column layout, center top bar and overall visual style, allowing evaluation of upstream narrow-screen improvements. | [Frame](../../packages/client/ui-layout/src/client/AppFrame.tsx) | Inspect blank and active sessions, collapse/expand, resizing and narrow windows; new upstream actions remain reachable. |
| HAIER-003 | Company chat and composer presentation, with continued integration of upstream session and task capabilities. | [Conversation](../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx), [input](../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) | Send, queue, cancel and resume messages; inspect tool results and long conversations. |
| HAIER-004 | Required company IAM login and persisted company account identity. | [Login flag](../../packages/client/ui-settings-account/src/login-config.ts), [company adapter](../../packages/credentials/deepseek-account-platform/src/company.ts), [account menu](../../packages/client/ui-settings-account/src/client/AccountMenu.tsx) | In required-login mode, verify workspace access before login, successful login, failure/retry, restart and sign-out. |
| HAIER-005 | Company feedback destination and intentional visibility of settings/actions. | [Account menu](../../packages/client/ui-settings-account/src/client/AccountMenu.tsx), [contact configuration](../../packages/client/ui-settings-account/src/contact-config.ts) | Verify company contact flow; review new upstream entries individually without blindly restoring hidden entries. |
| HAIER-006 | Intranet update channels, release history and company-login routing. | [Intranet reference](../../apps/desktop/packaging/INTRANET.md) | Follow its release checks; intranet installation/update evidence comes from the user on the intranet. |
| HAIER-007 | English and Chinese as the shipped UI language set. | [Language authority](../../scripts/shipped-locales.ts) | Check desktop, installer and Web language selection, new strings and metadata; no unsupported language is silently restored. |
| HAIER-008 | Company login simulator and separate local Web/Desktop development services. | [Simulator](../haier-simulator/README.md), [Web launcher](../../scripts/dev-web.ts) | Verify local login flow and concurrent launch without service/port confusion. |
| HAIER-009 | Upgrade compatibility with legacy company executable names and path-scoped process checks. | [Installer lifecycle](../../apps/desktop/installer/lifecycle.nsh) | On Windows, verify upgrade over the previous company build, correct installation-path matching and fresh installation. |

<a id="layout"></a>

## HAIER-002: layout integration principles

- Preserve the company three-column layout, center top bar and overall visual style.
- Incorporate upstream capabilities, accessibility improvements and layout fixes, keeping adopted capabilities accessible.
- Evaluate upstream automatic collapse and drawers for narrow screens while preserving the wide-screen desktop layout; preview substantial layout or interaction changes for confirmation.

<a id="conversation"></a>

## HAIER-003: conversation integration principles

- Preserve the overall company chat and composer presentation without fixing the current component structure or control placement.
- Continuously incorporate upstream session, message input, attachment, tool execution and task control capabilities and fixes; local presentation changes must not weaken permissions, status feedback or error recovery.
- Prefer adapting to upstream interfaces and state models and integrating company presentation into the new implementation. Record the impact and tradeoff when a capability conflicts with existing product requirements; preview substantial interaction changes for confirmation.

<a id="identity"></a>

## HAIER-004: identity integration principles

- Preserve company IAM login, company account identity and model gateway integration. In company-required-login mode, upstream account or configuration changes must not bypass login or silently switch services.
- Adapt company login to upstream authentication interfaces, credential management and session lifecycle changes; preserve authentication validation, credential protection and sign-out semantics, keeping application secrets on the server.
- When upgrades affect saved identity, credentials or company configuration, define and verify compatibility or migration; clearing user data is not a substitute for adaptation.

<a id="company-services"></a>

## HAIER-005: company service entry principles

- Feedback and contact entries in the company distribution lead to company support channels; upstream integration must not restore upstream default destinations.
- Preserve company product decisions about settings and service entries without fixing the current menu structure or treating hidden entries as missing features that must be restored.
- Evaluate entries for new upstream capabilities against company use cases; hiding an entry does not prohibit its underlying capability. Record impacts and confirm tradeoffs when adoption requires changing an existing company policy.

<a id="distribution"></a>

## HAIER-006: intranet distribution integration principles

- Preserve company intranet distribution, update channels and release history while incorporating upstream installation and update fixes; default configuration changes must not redirect installed clients to upstream distribution services.
- Track the upstream baseline and company release version separately so builds, releases and rollbacks remain traceable. The [intranet reference](../../apps/desktop/packaging/INTRANET.md) owns deployment rules; validate code integration and intranet publication separately.

<a id="languages"></a>

## HAIER-007: language integration principles

- Continue shipping Chinese and English, including the strings and metadata required by newly adopted upstream features.
- Language pruning must not obstruct upstream capabilities or internationalization infrastructure; resource organization may change without automatically expanding the shipped language set.

<a id="development"></a>

## HAIER-008: development verification integration principles

- Preserve the ability to verify company login and gateway integration outside the intranet; update the simulator with the interfaces the application uses and continue verifying through real application entry points.
- Keep development configuration, credentials and data isolated from production. Passing simulator checks does not establish real IAM, model or desktop installation compatibility; perform the corresponding intranet acceptance checks.

<a id="upgrade"></a>

## HAIER-009: upgrade compatibility integration principles

- Incorporate upstream installer and migration fixes while preserving upgrades from released company versions, compatibility with legacy product identifiers, and existing user data and configuration.
- Limit upgrade operations to the target installation; matching a legacy executable name must not affect other installations. When technical identifiers or data formats must change, define migration and recovery and verify both upgrades and fresh installations.

<a id="maintenance"></a>

## Maintenance

The register captures company customization principles and preservation boundaries without fixing individual buttons, dimensions or state behavior. Code and tests define interaction details; record product tradeoffs in the integration record when they arise.

When product requirements change, update the affected ID and its acceptance criteria in the same change. Source paths may move without changing the ID. Record disagreements or incomplete discoveries in the integration record instead of silently weakening a requirement.

This register is the first review scope, not a claim of exhaustive audit. Newly discovered company behavior needs classification before an upstream merge removes it.
