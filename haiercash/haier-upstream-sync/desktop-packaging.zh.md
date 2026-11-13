---
description: "Windows x64 和 Apple Silicon macOS 从同一版本记录构建当前确认的 HiBuddy 安装包。"
---

# Desktop 打包交接

[English](desktop-packaging.md) | 中文

## 概述

在每台打包机器拉取仓库后，使用这份固定操作指南。[当前入口](current-desktop-build.json)只选择一份版本记录；历史记录继续保留。打包必须同时产出安装包与 `lingxi-office-release-*.tar.gz`；安装验收和服务器切换仍分别授权。本流程不能在 Linux 上生成 Windows 或已签名 Mac 安装包。

## 目录

- [两端共同准备](#prepare)
- [Windows x64](#windows)
- [Mac arm64](#mac)
- [验收与失败处理](#acceptance)
- [联合发布协作](#joint-release)
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

固定提交中的 `haiercash/builtin-plugins/` 包含 Claude、术语表和任务池插件归档，`packages/bundle/web-app/package.json` 选择归档，`pnpm-lock.yaml` 固定其完整性。构建前将版本与 SHA-256 同选定记录核对。确认源码提交前，kit 的 UI 修改须已进入这些归档；两台机器均通过 `pnpm install --frozen-lockfile` 安装已提交的归档。 `prepare-package-set` 扫描该目录全部 `.tgz`，要求包名唯一。每个包保留一份当前归档，历史归档可从 Git 取回。package-set 回归测试检查包名唯一性、宿主归档钉点，以及两种目标平台对当前 kit 的复制。

<a id="windows"></a>
## Windows x64

使用 Windows x64 PowerShell。保留 `apps/desktop/.env.windows`；文件不存在时，将[内网模板](../../apps/desktop/config/intranet.env.example)复制到该位置。核对更新地址为 `http://172.28.236.3:18765/updates/win-x64/`。本次不要另选打包 preset 或签名命令。预检会检查本机打包工具，先按其错误提示补齐缺少的工具再继续。

Windows 包会自动把 `apps/desktop/resources/portable-crt/` 里的 VC++ 运行库捆绑到 LibreOffice 引擎旁；内网机器系统 MSVCP140.dll 过旧时，缺少这些 DLL 会让 Office 预览崩溃（0xC0000005）。DLL 缺失时打包直接失败，正常打包不需要任何环境变量。`DSH_DESKTOP_PORTABLE_CRT_DIR` 只能在会话环境中指定替代目录——绝不能写进 `.env.windows`（未知变量名会被拒绝）。

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

EXE 就是可安装的 Windows 文件。`lingxi-office-release-<version>.tar.gz` 是交给服务器的发布归档；只打出 EXE 不算本交接完成。保留同目录的构建记录、blockmap 和更新元数据。未签名安装包不是已签名发布产物；生成 tar.gz 也不等于已在服务器切换上线。

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
node apps/desktop/scripts/prepare-intranet-release.mjs mac-arm64 apps/desktop/.desktop-build/targets/mac-arm64/artifacts "$version" "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
ls -lh "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
shasum -a 256 "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
)
```

DMG 是首次安装使用的文件。`lingxi-office-release-<version>-mac-arm64.tar.gz` 是交给服务器的发布归档；只打出 DMG／ZIP 不算本交接完成。保留已签名 ZIP、blockmap、更新元数据和构建记录。`--check` 成功只表示配置和工具通过检查，不代表已实际签名或公证；生成 tar.gz 也不等于已在服务器切换上线。

<a id="acceptance"></a>
## 验收与失败处理

海尔蓝 UI 验收在安装后的客户端分别检查浅色和深色主题。核对原有渐变 H 标识、新会话中标识和海尔兄弟随鼠标晃动、眼睛跟随鼠标、随人物姿势旋转的 H 腰带标记，以及腿部渐进模糊。发送消息后，检查对话和轨迹页面右下角的朦胧海尔兄弟，设置页检查左下角背景。核对 Claude 和术语表中间栏、侧栏渐变及拖动调宽、单排会话标题，以及透明的 Default 触发按钮和正常弹层。覆盖窄窗口及系统减少动态效果设置。

打包前读取所选记录的 `checks`，不得把未解决的失败当作通过。成功后报告实际提交号、工作区干净状态、版本号、安装文件路径、字节数、SHA-256、适用的签名／公证结果，以及 `lingxi-office-release-*.tar.gz` 路径与 SHA-256。缺少发布归档时不得声称打包完成。在目标系统安装，验证启动、公司登录、模型发现与对话、Office 文档预览（例如 .pptx）、配置的插件默认状态及重启后的数据保留。已有 profile 可以保留用户设置。仅有安装文件不能代表安装验收通过。

失败时停止，保留 `apps/desktop/.desktop-build/packaging-runs/` 和失败命令的日志。报告第一个失败阶段，不暴露秘密；不要删除凭据、绕过验证或发布不完整产物。服务器合并、镜像切换与回滚仍须单独发布授权后，才执行[内网发布指南](../../apps/desktop/packaging/INTRANET-RELEASE.md)中的服务器步骤。

<a id="joint-release"></a>
## 联合发布协作

Windows 与 Mac 独立构建，使用同一记录中的 `version` 和 `sourceCommit`。交接负责人在准备交接前，一次性向用户确认版本、源码、两端签名模式、验收要求、必要的服务端变更，以及上一版是否仍有构建进行中。负责人在任一机器开始构建前提交并推送所选记录。两端开始前均报告记录中的版本和源码；不得改用分支 HEAD 或其他版本的安装包。

每个平台只在自己的 `targets` 条目中记录 `status`：`pending`、`building`、`built`、`verified`、`failed` 或 `blocked`。开始前先推送 `building`；任一端开始后，源码与签名模式即固定。安装包名称、字节数、SHA-256、发布归档名称与 SHA-256、实际构建提交及工作区干净状态、适用的签名／公证证据和安装验收结果均回填到同一平台条目。`built` 要求安装包和归档齐全；`verified` 还要求安装验收通过。失败或阻塞时记录第一个失败阶段和下一步所需操作，不记录秘密。不得把另一端的成功作为本端成功。

更新结果前拉取交接分支的最新内容，保留另一平台的字段，只提交本平台结果。并发推送时，先合入远端更新，再仅重放本平台字段；不得用旧副本覆盖整份记录、强推覆盖另一端结果，或由打包机器切换当前指针。共用检查、服务端前置条件、当前指针及发布状态由交接负责人维护。

只有两端均有安装包和归档哈希、固定且相同的干净源码、所需签名证据，且 `installationVerified: true`，同时所有必要服务端前置条件均已验证，才可进入联合发布。具体功能验收与服务端升级要求以所选版本的证据页为准，须在两端安装后的客户端验证；本地源码检查不代表目标网络验收通过。

取得单独发布授权后，服务器操作人员校验两份归档哈希，只继承一次线上旧目录，将两个平台的覆盖归档合入同一待发布目录。分别保留两份归档的 `release-records.json`，合并两个数组，再以线上目录清单为基线交给 `merge-intranet-releases.mjs`；不得连续解压后丢失第一个平台的记录。保留历史安装包、Windows 更新 feed 和 Mac 分发元数据，在测试容器中验证两端新安装包及适用的更新 feed，再只切换一次 versions 服务。联合切换和线上验证成功前保持 `published: false`；Windows 或 Mac 单独打包完成不代表已发布。遵循[服务器约束](../../apps/desktop/packaging/INTRANET.md)和[现有服务器流程](../../apps/desktop/packaging/INTRANET-RELEASE.md#server)。

<a id="next"></a>
## 交接下一版本

每次新打包前，先向用户确认未使用过的完整版本号和目标平台。提交准备打包的代码，再新建 `records/<version>.json`，固定准确提交号、目标模式、插件默认状态、检查结果及待完成的安装验收。增加对应中英文证据记录，仅更新 `current-desktop-build.json` 指向新记录。在两端拉取前提交并推送此次交接。通用命令只维护在本页，不把具体版本命令复制到多个指南。

仅在用户确认两个平台均未开始打包后，才能更新准备中记录的源码提交。任一平台开始打包后，不得更改该版本的源码提交或目标模式。实际验证后，在对应目标记录中补充产物哈希与验收结果，不得复制上一版的成功状态。发布是独立操作，按既有发布流程维护记录和标签。切换当前入口前，确认两端没有仍在构建上一版；已开始的构建继续使用启动时读取的版本和提交。

记录中的源码提交优先于分支 HEAD。不要因为文档提交更新，就改用最新文档提交打包。任一平台开始打包后如源码或插件安装包变化，应重新确认新版本。缺少配置或机器访问能力时，操作人员必须报告阻塞，不能声称已生成安装包。
