---
description: "Build the current confirmed HiBuddy installers from one version record on Windows x64 and Apple Silicon macOS."
---

# Desktop packaging handoff

English | [中文](desktop-packaging.zh.md)

## Summary

Use this stable runbook after pulling the repository on each packaging machine. [The current pointer](current-desktop-build.json) selects one version record; historical records remain available. Packaging must produce both the installer and `lingxi-office-release-*.tar.gz`; installation acceptance and server cutover stay separately authorized. Linux cannot generate the Windows or signed Mac installers in this procedure.

## Contents

- [Prepare both machines](#prepare)
- [Windows x64](#windows)
- [Mac arm64](#mac)
- [Acceptance and failures](#acceptance)
- [Coordinate the joint release](#joint-release)
- [Hand off the next version](#next)

<a id="prepare"></a>
## Prepare both machines

Pull `dev/junzerg` into a clean checkout before reading the current record. If the worktree has changes or a fast-forward pull fails, stop; do not reset, clean, or overwrite them. Use Node >=24.9 and pnpm 11.28.5. Keep this runbook available: the commands capture the record before switching to its pinned source commit, which may predate this page.

```sh
git status --short
git switch dev/junzerg
git pull --ff-only origin dev/junzerg
node --version
pnpm --version
```

Read [current-desktop-build.json](current-desktop-build.json), then the record it names. The version, source commit, target modes, plugin defaults, and acceptance status come from that record. Both machines must print the same version and commit; if they differ, stop rather than combining builds. Do not substitute the newest commit, `auto`, or a version guessed from local artifacts. Ignore unrelated stale chat instructions.

The pinned host checkout carries the packaged Claude, glossary, and session-pool kits in `haiercash/builtin-plugins/`. `packages/bundle/web-app/package.json` selects their archives and `pnpm-lock.yaml` pins their integrity. Check those versions and SHA-256 values against the selected record before building. Kit UI changes must reach these archives before the source pin is confirmed; both builders install the committed archives with `pnpm install --frozen-lockfile`. `prepare-package-set` scans every `.tgz` in this directory and requires unique package names. Keep one current archive per package; historical archives remain available in Git. The package-set regression tests check uniqueness, host archive pins, and copying the current kits for both target platforms.

<a id="windows"></a>
## Windows x64

Use Windows x64 PowerShell. Preserve `apps/desktop/.env.windows`; if absent, copy [the intranet template](../../apps/desktop/config/intranet.env.example) there. Verify its update URL is `http://172.28.236.3:18765/updates/win-x64/`. Do not select a different packaging preset or a signing command for this build. The preflight checks the local packaging tools; resolve its reported missing tools before continuing.

Windows packages bundle the VC++ runtime from `apps/desktop/resources/portable-crt/` beside the LibreOffice engine automatically; intranet hosts with an old system MSVCP140.dll crash Office previews without it (0xC0000005). Packaging fails when those DLLs are missing, so no environment variable is required. `DSH_DESKTOP_PORTABLE_CRT_DIR` may name an alternative directory in the session environment only — never write it into `.env.windows`, which rejects unknown settings.

```powershell
$ErrorActionPreference = 'Stop'
$pointer = Get-Content haiercash/haier-upstream-sync/current-desktop-build.json -Raw | ConvertFrom-Json
$record = Get-Content ("haiercash/haier-upstream-sync/" + $pointer.record) -Raw | ConvertFrom-Json
$version = $record.version
$commit = $record.sourceCommit
if ($record.targets.'win-x64'.signing -ne 'unsigned') { throw 'This runbook requires an unsigned Windows target' }
Write-Host "Version: $version; source: $commit"
if (git status --porcelain) { throw 'Worktree must be clean' }
git fetch origin dev/junzerg
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
git switch --detach $commit
if ($LASTEXITCODE -ne 0) { throw 'Source checkout failed' }
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
if (git status --porcelain) { throw 'Worktree must be clean' }
pnpm run package:desktop:win:x64:unsigned --build-version $version --check
if ($LASTEXITCODE -ne 0) { throw 'Packaging preflight failed' }
pnpm run package:desktop:win:x64:unsigned --build-version $version
if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
Get-Item "apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/HiBuddy-$version-win-x64-unsigned.exe"
Get-FileHash "apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/HiBuddy-$version-win-x64-unsigned.exe" -Algorithm SHA256
$engineBin = 'apps/desktop/.desktop-build/targets/win-x64/dsh/node_modules/@deepseek-ai/libreoffice-kit-win32-x64/bin'
if (-not ((Test-Path (Join-Path $engineBin 'msvcp140.dll')) -and (Test-Path (Join-Path $engineBin 'vcruntime140.dll')))) { throw 'Portable VC++ runtime DLLs are missing beside the LibreOffice engine; Office previews would fail on intranet hosts' }
Write-Host "Portable CRT DLLs beside the engine: $((Get-ChildItem $engineBin -Filter '*.dll').Count)"
node apps/desktop/scripts/prepare-intranet-release.mjs win-x64 apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts $version "apps/desktop/.desktop-build/lingxi-office-release-$version.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Intranet release archive failed' }
Get-Item "apps/desktop/.desktop-build/lingxi-office-release-$version.tar.gz"
Get-FileHash "apps/desktop/.desktop-build/lingxi-office-release-$version.tar.gz" -Algorithm SHA256
```

The EXE is the installable Windows file. `lingxi-office-release-<version>.tar.gz` is the archive handed to the server operator; stopping after the EXE alone does not finish this handoff. Keep the adjacent build record, blockmap, and update metadata. An unsigned installer is not a signed release artifact, and producing the tar.gz does not switch the live server.

<a id="mac"></a>
## Mac arm64

Use an Apple Silicon Mac. Preserve `apps/desktop/.env.macos`; if absent, copy [the Mac intranet template](../../apps/desktop/config/intranet-mac.env.example) there and have the signing owner fill its certificate, private-key, Team ID, and notarization credentials. Verify its update URL is `http://172.28.236.3:18765/updates/mac-arm64/`. Follow [signing prerequisites](../../apps/desktop/packaging/README.md#macos-release-signing). Do not print or commit credentials. Missing signing access is a blocker; do not substitute `--unsigned` or `--skip-notarization`.

```sh
(
set -e
record=$(node -p "require('./haiercash/haier-upstream-sync/current-desktop-build.json').record")
version=$(node -p "require('./haiercash/haier-upstream-sync/' + process.argv[1]).version" "$record")
commit=$(node -p "require('./haiercash/haier-upstream-sync/' + process.argv[1]).sourceCommit" "$record")
node -e "const r=require('./haiercash/haier-upstream-sync/'+process.argv[1]);if(r.targets['mac-arm64']?.signing!=='signed-notarized')process.exit(1)" "$record"
printf 'Version: %s; source: %s\n' "$version" "$commit"
test -z "$(git status --porcelain)"
git fetch origin dev/junzerg
git switch --detach "$commit"
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)"
pnpm run package:desktop:mac:arm64 --build-version "$version" --check
pnpm run package:desktop:mac:arm64 --build-version "$version"
ls -lh "apps/desktop/.desktop-build/targets/mac-arm64/artifacts/HiBuddy-$version-mac-arm64.dmg"
shasum -a 256 "apps/desktop/.desktop-build/targets/mac-arm64/artifacts/HiBuddy-$version-mac-arm64.dmg"
node apps/desktop/scripts/prepare-intranet-release.mjs mac-arm64 apps/desktop/.desktop-build/targets/mac-arm64/artifacts "$version" "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
ls -lh "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
shasum -a 256 "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
)
```

The DMG is the first-install file. `lingxi-office-release-<version>-mac-arm64.tar.gz` is the archive handed to the server operator; stopping after the DMG/ZIP alone does not finish this handoff. Keep the signed ZIP, blockmap, update metadata, and build record. A successful `--check` verifies configuration and tools, not actual signing or notarization, and producing the tar.gz does not switch the live server.

<a id="acceptance"></a>
## Acceptance and failures

For Haier blue UI acceptance, check both light and dark themes on the installed client. Verify the original gradient H logo, pointer-following logo and brothers on a new conversation, eye tracking, rotated H belt marks, and progressive leg blur. After sending a message, check the blurred brothers at the lower right in Chat and Trajectory; Settings places them at the lower left. Check the middle columns of Claude and glossary, the sidebar gradient and drag-to-resize handle, one conversation title row, and the transparent Default trigger with its normal popup surface. Include a narrow window and the system reduced-motion preference.

Read the selected record's `checks` before building; unresolved failures are not passing evidence. After success, report the actual commit, clean-worktree state, version, installer path, byte size, SHA-256, signing/notarization result where applicable, and the `lingxi-office-release-*.tar.gz` path with its SHA-256. Do not claim packaging is complete without that archive. Install on the target system and verify startup, company login, model discovery and conversation, Office document preview (for example a .pptx), configured plugin defaults, and persistence after restart. Existing profiles may retain user settings. A file's existence alone is not installation acceptance.

On failure, stop and retain `apps/desktop/.desktop-build/packaging-runs/` and the failing command's log. Report the first failing stage without secrets; do not delete credentials, bypass validation, or publish partial artifacts. Server merge, image cutover, and rollback still require separate publication authorization before following the server steps in [the intranet release guide](../../apps/desktop/packaging/INTRANET-RELEASE.md).

<a id="joint-release"></a>
## Coordinate the joint release

Windows and Mac build independently, using the same record's `version` and `sourceCommit`. The release coordinator confirms those values, target signing modes, acceptance requirements, required server changes, and any previous builds still in progress with the user before preparing the handoff. The coordinator commits and pushes the selected record before either machine starts. Both machines report that record's version and source pin before building; a branch HEAD or an installer from another version cannot replace them.

Each builder records `status` under its own `targets` entry: `pending`, `building`, `built`, `verified`, `failed`, or `blocked`. Push `building` before starting; once either target starts, the source pin and signing modes are fixed. Record the installer name, byte size, SHA-256, release archive name and SHA-256, actual build commit and clean-worktree state, signing/notarization evidence where applicable, and installation acceptance under that same target. `built` requires both installer and archive; `verified` additionally requires installation acceptance. A failed or blocked target records its first failing stage and next required action without secrets. No target inherits another target's success.

Before updating results, pull the latest handoff branch and preserve the other platform's fields. Commit only the owned target results; on a concurrent push, incorporate the remote update and reapply only those fields. Do not replace the whole record with a stale local copy, force-push another builder's results, or change the current pointer from a packaging machine. The coordinator owns the shared checks, server prerequisites, pointer, and publication state.

The joint release is ready only when both targets have installer and archive hashes, the same clean source pin, their required signing evidence, and `installationVerified: true`; all required server prerequisites must also be verified. The selected version evidence page owns the exact feature acceptance and server upgrade requirements. Verify them on both installed clients; local source checks do not establish target-network acceptance.

After separate publication authorization, the server operator verifies both archive checksums, inherits the previous live directory once, and merges both platform overlays into one staging release. Preserve each archive's `release-records.json` separately, combine the two arrays, and pass the combined array to `merge-intranet-releases.mjs` with the live catalog as the baseline; sequential extraction must not discard the first platform's record. Preserve historical installers, the Windows update feed and the Mac distribution metadata. Verify both new installers and applicable update feeds in the test container, then switch the versions service once. Keep `published: false` until that joint cutover and live verification succeed; a completed Windows or Mac build alone is not a published release. Follow the [server constraints](../../apps/desktop/packaging/INTRANET.md) and [existing server procedure](../../apps/desktop/packaging/INTRANET-RELEASE.md#server).

<a id="next"></a>
## Hand off the next version

Before each new build, confirm a previously unused full version and target platforms with the user. Commit the intended code, then create a new `records/<version>.json` naming that exact commit, target modes, plugin defaults, checks, and pending installer acceptance. Add its bilingual evidence record and update only `current-desktop-build.json` to select it. Commit and push this handoff before either platform pulls. Keep ordinary commands here; do not copy version-specific commands into multiple guides.

A prepared record may update its source commit only after the user confirms that neither platform has started building. Once either platform starts, do not change that version's source commit or target modes. Append actual artifact hashes and acceptance results to the matching target after verification; never copy a previous build's success. Publication is separate and must update the existing release process and tags. Before moving the current pointer, confirm neither platform is still building the previous version; an in-progress build continues with the version and commit captured when it started.

The recorded source pin takes precedence over branch HEAD. Do not package the newer documentation commit merely because it is newest. If source code or plugin archives change after either platform starts building, create a newly confirmed version instead. Operators must report missing configuration or machine access as blockers rather than claiming installers were generated.
