---
description: "Windows x64 和 Apple Silicon macOS 从同一版本记录构建当前确认的 HiBuddy 安装包。"
---

# Desktop 打包交接

[English](desktop-packaging.md) | 中文

## 概述

在每台打包机器拉取仓库后，使用这份固定操作指南。[当前入口](current-desktop-build.json)只选择一份版本记录；历史记录继续保留。打包、安装验收和发布分别记录状态。本流程不能在 Linux 上生成 Windows 或已签名 Mac 安装包。

## 目录

- [两端共同准备](#prepare)
- [Windows x64](#windows)
- [Mac arm64](#mac)
- [验收与失败处理](#acceptance)
- [交接下一版本](#next)

<a id="prepare"></a>
## 两端共同准备

在干净的仓库中拉取 `dev/junzerg` 后，再读取当前记录。工作区有改动或无法快进拉取时停止，不得重置、清理或覆盖。使用 Node >=24.9 和 pnpm 11.28.5。保留本操作指南：下面的命令先读取记录再切换到固定源码提交，该提交可能早于本页。

```sh
git status --short
git switch dev/junzerg
git pull --ff-only origin dev/junzerg
node --version
pnpm --version
```

读取 [current-desktop-build.json](current-desktop-build.json)，再读取其中指向的记录。版本号、源码提交、目标模式、插件默认状态和验收状态均以该记录为准。两台机器必须显示同一版本和提交；不同就停止，不得拼成同一版。不得替换成最新提交、`auto` 或根据本地产物猜出的版本，也不要沿用无关的旧对话指令。

<a id="windows"></a>
## Windows x64

使用 Windows x64 PowerShell。保留 `apps/desktop/.env.windows`；文件不存在时，将[内网模板](../../apps/desktop/config/intranet.env.example)复制到该位置。核对更新地址为 `http://172.28.236.3:18765/updates/win-x64/`。本次不要另选打包 preset 或签名命令。预检会检查本机打包工具，先按其错误提示补齐缺少的工具再继续。

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
```

EXE 就是可安装的 Windows 文件。保留同目录的构建记录、blockmap 和更新元数据，供另行授权的发布使用。未签名安装包不是已签名发布产物。

<a id="mac"></a>
## Mac arm64

使用 Apple Silicon Mac。保留 `apps/desktop/.env.macos`；文件不存在时，将 [Mac 内网模板](../../apps/desktop/config/intranet-mac.env.example)复制到该位置，由签名负责人填写证书、私钥、Team ID 和公证凭据。核对更新地址为 `http://172.28.236.3:18765/updates/mac-arm64/`。遵循[签名前置要求](../../apps/desktop/packaging/README.zh.md#macos-release-signing)。不要输出或提交凭据。缺少签名权限就停止，不得擅自改用 `--unsigned` 或 `--skip-notarization`。

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
)
```

DMG 是首次安装使用的文件。保留已签名 ZIP、blockmap、更新元数据和构建记录，供另行授权的发布使用。`--check` 成功只表示配置和工具通过检查，不代表已实际签名或公证。

<a id="acceptance"></a>
## 验收与失败处理

打包前读取所选记录的 `checks`，不得把未解决的失败当作通过。成功后报告实际提交号、工作区干净状态、版本号、安装文件路径、字节数、SHA-256 和适用的签名／公证结果。在目标系统安装，验证启动、公司登录、模型发现与对话、配置的插件默认状态及重启后的数据保留。已有 profile 可以保留用户设置。仅有安装文件不能代表安装验收通过。

失败时停止，保留 `apps/desktop/.desktop-build/packaging-runs/` 和失败命令的日志。报告第一个失败阶段，不暴露秘密；不要删除凭据、绕过验证或发布不完整产物。只有得到单独发布授权后，才执行[内网发布指南](../../apps/desktop/packaging/INTRANET-RELEASE.md)。

<a id="next"></a>
## 交接下一版本

每次新打包前，先向用户确认未使用过的完整版本号和目标平台。提交准备打包的代码，再新建 `records/<version>.json`，固定准确提交号、目标模式、插件默认状态、检查结果及待完成的安装验收。增加对应中英文证据记录，仅更新 `current-desktop-build.json` 指向新记录。在两端拉取前提交并推送此次交接。通用命令只维护在本页，不把具体版本命令复制到多个指南。

不得修改旧记录的版本号、源码提交或目标模式来复用版本身份。实际验证后，在对应目标记录中补充产物哈希与验收结果，不得复制上一版的成功状态。发布是独立操作，按既有发布流程维护记录和标签。切换当前入口前，确认两端没有仍在构建上一版；已开始的构建继续使用启动时读取的版本和提交。

记录中的源码提交优先于分支 HEAD。不要因为文档提交更新，就改用最新文档提交打包。固定提交后如源码或插件安装包变化，应重新确认新版本。缺少配置或机器访问能力时，操作人员必须报告阻塞，不能声称已生成安装包。
