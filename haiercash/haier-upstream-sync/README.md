---
description: "Maintain company customizations while integrating upstream capabilities."
---

# Haier upstream synchronization

English | [中文](README.zh.md)

## Summary

This workflow serves maintainers of the company fork. Integrate upstream capabilities and fixes while preserving the approved company behaviors in the customization register. Changes to implementation are allowed; changes to product requirements need a recorded decision.

## Contents

- [Documents and versions](#documents)
- [Integration workflow](#workflow)
- [Conflict rules](#conflicts)
- [Acceptance and recovery](#acceptance)

<a id="documents"></a>

## Documents and versions

The [customization register](local-customizations.md) describes current company requirements. Each file under `records/` describes one integration attempt; see the [current rc.1 record](records/2026-11-05-rc.1.md) and the [earlier alpha.3 assessment](records/2026-11-03-alpha.3.md). These internal documents are not added to the public documentation website.

Git commits version the workflow and register; do not create v1/v2 copies. Keep stable `HAIER-xxx` identifiers. Update behavior, source links and acceptance criteria in the same change as a customization. Mark retired requirements explicitly and never reuse their identifiers.

Each record includes status, local branch and starting SHA, common ancestor, upstream tag and resolved SHA, register commit, integration branch, decisions by customization ID, checks, remaining gaps and final integration commit. Record the register commit after it exists; do not invent a self-referencing commit ID.

Upstream baseline versions and intranet release versions are separate. Release tags and distribution rules remain owned by the [intranet reference](../../apps/desktop/packaging/INTRANET.md); a completed merge is not a deployment.

<a id="workflow"></a>

## Integration workflow

Proceed interactively in batches: baseline and isolated workspace; metadata, dependencies and languages; core and IAM; desktop and intranet distribution; individual UI regions; integrated acceptance and landing. Define each batch before starting and deliver its results, validation evidence and open decisions afterward; advance only after user confirmation. A preview does not resolve conflicts, and checks without a runnable environment remain pending.

1. Inspect the worktree and refresh remote references. `dev/junzerg` is the intranet development branch. Other `dev/*` branches require separate authorization; `origin/master` and non-`dev/*` branches may be consulted or merged when relevant. Preserve unrelated work.

2. Pin the local start, upstream target and register revision. Read upstream release and upgrade notes, including data formats, configuration, plugin dependencies and UI entry points. Run a merge preview and classify actual conflicts.

3. Create an `integrate/haier-upstream-<target>` branch in a separate worktree from the pinned local start. Merge the pinned target there. Keep upstream ancestry; do not squash the upstream integration or use routine cherry-picking as its replacement.

4. Resolve metadata and dependencies, then runtime and enterprise integration, then UI regions. Inspect automatically merged critical paths too. Record exceptional decisions and deferred upstream capabilities with their impact.

5. Validate upstream capabilities and company requirements using the affected checks in the [testing policy](../../docs/testing.md). Provide a runnable preview or screenshot for each reviewed UI region before advancing to the next region.

6. Recheck `dev/junzerg` before landing. If it advanced, integrate the new local commits and rerun affected checks. Follow [pre-push checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md), retain the merge history and complete the record. Publication remains a separate task.

<a id="conflicts"></a>

## Conflict rules

| Area | Rule |
|---|---|
| Core capabilities and APIs | Incorporate upstream evolution and adapt local callers. Document any deferred capability. |
| UI | Preserve approved visual and interaction requirements; integrate new logic, accessibility and bug fixes. |
| Branding | Preserve company branding at the current upstream ownership point; keep technical identities and compatibility identifiers unless explicitly migrated. |
| IAM and intranet distribution | Preserve company constraints and adapt to upstream lifecycle changes. |
| Locales | Preserve the supported language set and update its new strings; review newly introduced locale resources. |
| Dependencies and generated files | Resolve source configuration first, then regenerate using repository tooling. |

Never apply a global “ours” or “theirs” policy. File paths are navigation aids, not ownership rules: upstream may move behavior into another package. Conflict-free text does not prove compatible behavior.

<a id="acceptance"></a>

## Acceptance and recovery

Acceptance covers session creation and history, sending and cancellation, tool execution and the upstream capabilities changed in this upgrade, plus the applicable customization IDs. Record exact commands, environment, results and manual evidence. Do not refresh snapshots merely to hide a regression.

An unresolved core regression or a required check without evidence blocks landing. If an unrelated failure appears, record it separately and assess whether it blocks this integration; do not silently expand repair scope.

Before landing, recovery means retaining the original branch and abandoning or repairing the isolated integration worktree after preserving useful work. After landing, use a reviewed revert or forward fix without rewriting shared history. Code rollback does not reverse data migrations; verify data compatibility separately before running a new build against valuable user data. Deployment rollback follows the intranet reference.
