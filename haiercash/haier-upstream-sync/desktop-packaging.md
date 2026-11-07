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

<a id="windows"></a>
## Windows x64

Use Windows x64 PowerShell. Preserve `apps/desktop/.env.windows`; if absent, copy [the intranet template](../../apps/desktop/config/intranet.env.example) there. Verify its update URL is `http://172.28.236.3:18765/updates/win-x64/`. Do not select a different packaging preset or a signing command for this build. The preflight checks the local packaging tools; resolve its reported missing tools before continuing.

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

Read the selected record's `checks` before building; unresolved failures are not passing evidence. After success, report the actual commit, clean-worktree state, version, installer path, byte size, SHA-256, signing/notarization result where applicable, and the `lingxi-office-release-*.tar.gz` path with its SHA-256. Do not claim packaging is complete without that archive. Install on the target system and verify startup, company login, model discovery and conversation, configured plugin defaults, and persistence after restart. Existing profiles may retain user settings. A file's existence alone is not installation acceptance.

On failure, stop and retain `apps/desktop/.desktop-build/packaging-runs/` and the failing command's log. Report the first failing stage without secrets; do not delete credentials, bypass validation, or publish partial artifacts. Server merge, image cutover, and rollback still require separate publication authorization before following the server steps in [the intranet release guide](../../apps/desktop/packaging/INTRANET-RELEASE.md).

<a id="next"></a>
## Hand off the next version

Before each new build, confirm a previously unused full version and target platforms with the user. Commit the intended code, then create a new `records/<version>.json` naming that exact commit, target modes, plugin defaults, checks, and pending installer acceptance. Add its bilingual evidence record and update only `current-desktop-build.json` to select it. Commit and push this handoff before either platform pulls. Keep ordinary commands here; do not copy version-specific commands into multiple guides.

A prepared record may update its source commit only after the user confirms that neither platform has started building. Once either platform starts, do not change that version's source commit or target modes. Append actual artifact hashes and acceptance results to the matching target after verification; never copy a previous build's success. Publication is separate and must update the existing release process and tags. Before moving the current pointer, confirm neither platform is still building the previous version; an in-progress build continues with the version and commit captured when it started.

The recorded source pin takes precedence over branch HEAD. Do not package the newer documentation commit merely because it is newest. If source code or plugin archives change after either platform starts building, create a newly confirmed version instead. Operators must report missing configuration or machine access as blockers rather than claiming installers were generated.
