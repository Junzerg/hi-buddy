---
kind: upgrade-guide
description: "Desktop requires company IAM login before opening the workspace."
---

# Company gateway login

English | [中文](guide.zh.md)

## Change

The original sign-in entry uses company IAM STG through the existing account provider. Desktop accepts only IAM-issued company grants; API-key and skip entry points are removed. Existing manual grants or grants without a verified IAM profile require IAM sign-in. Successful IAM login discovers models and selects an available default on the built-in company gateway, without configuring a provider. See the [account provider deployment requirements](../../../../packages/credentials/deepseek-account-platform/README.md#use-this-package).

Signed-out Desktop users remain on the login page. Sign-out and credential expiry hide the workspace, and cancellation or failed login cannot reopen it. Saved sessions and settings remain available after login. Sign-out removes the synchronized company key, models and default selection, and interrupts running company-model tasks. A retained or ambient key cannot open the Desktop workspace. Startup removes company keys left without an account grant; sign in again to restore access.

## Migration

1. Back up the existing Harness home, including credentials, settings and profile overrides, before installing the test build. Retain the .3 installer; rollback requires restoring its matching data backup because downgrade compatibility has not been qualified.
2. Desktop automatically repairs legacy connection overrides before starting the Host and retains a backup beside the profile patch. Credentials, saved models and unrelated settings are preserved; no client repair script is required.
3. Administrators deploy the login endpoint and configure both application secrets on the existing versions server. Windows users only install the application and use the login button, without editing files, running scripts or configuring environment variables.
4. Test IAM login inside the company network. Confirm model discovery and the default model, then sign out and check that the login page blocks the workspace. Confirm that saved provider keys cannot bypass it, cancellation and failure keep it visible, and IAM sign-in restores access. Local fixture tests do not qualify real IAM or gateway services.
