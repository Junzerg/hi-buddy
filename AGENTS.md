# AGENTS.md

hi-buddy is a DeepSeek Harness fork for the desktop application and intranet distribution.

## Working agreements

- Keep each iteration within the user's confirmed scope and acceptance criteria. Make the smallest complete change; defer unrelated refactoring, cleanup, and fixes.
- Apply a reference design only to the region and behaviors being discussed. Preserve existing capabilities whose removal or redesign the user has not confirmed; list unresolved product choices separately.
- Complete authorized work autonomously. Ask only for a real blocker, a material product or risk decision, overlapping user work, or missing authorization. Explain the concrete dependency and impact before expanding scope.
- Prefer one owner. Add planning phases, subagents, review rounds, or process documents only when requested or required by the change's risk.
- Read the applicable instructions and source needed for the change; reuse already-read guidance while it remains current.
- For user-led UI iterations, discuss, implement, and verify one region at a time. Provide a runnable preview or screenshot as soon as the change is reviewable; complete necessary verification, then hand off for user review before starting another region.

## Conventions

- Before changing `packages/` or `vendor/`, read [architecture](docs/architecture.md) and the applicable subtree instructions. For vendored updates, follow [vendor/README.md](vendor/README.md).
- Desktop credentials belong in git-ignored `apps/desktop/.env.windows`. Files end with exactly one trailing newline.

## Commands

Use pnpm and Node >=24.9. [package.json](package.json) owns the commands; `dev:desktop` builds then launches, while `start:*` skips the build.

<a id="run-relevant-checks-locally"></a>

## Verification

- Use [testing policy](docs/testing.md) to select the smallest checks covering the changed behavior and risk, together with required project checks; do not default to the full suite. Reuse passing results unless later changes, failures, or unresolved concerns invalidate them.
- Report unrelated check failures separately; do not automatically expand the repair scope. If a failure blocks the agreed outcome, explain why and identify the necessary fix.
- When a required check is costly, state its purpose and expected cost. Report the result, validation, and remaining limitations concisely; once acceptance criteria and necessary checks are satisfied, hand off without starting additional work.
- Before pushing, follow [pre-push checks](.agents/skills/dsh-pre-push-checks/SKILL.md).

## Desktop and intranet work

Read the [packaging guide](apps/desktop/packaging/README.zh.md) for builds and [intranet release reference](apps/desktop/packaging/INTRANET.md) before release preparation, diagnosis, publishing, or rollback. This machine cannot reach the intranet server: do not probe it or assume SSH access; provide commands for the user to run there.

For Desktop packaging, start with [the packaging handoff](haiercash/haier-upstream-sync/desktop-packaging.md) and its current version record. Follow that runbook through the installer and the `lingxi-office-release-*.tar.gz` step; do not stop after the DMG/EXE alone. Each new version needs a confirmed source pin and fresh acceptance state; update and push the handoff before platform builds, and retain earlier records.

Before entering push and packaging, confirm the version, source pin, target platforms, acceptance requirements, and previous builds still in progress with the user together. Windows and Mac build separately against one shared version record; each builder updates only its own target results. Prepare both platform archives and verify both installations before one coordinated publication; neither platform publishes independently.
