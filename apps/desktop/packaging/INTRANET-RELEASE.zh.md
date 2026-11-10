---
description: "分别在 Windows 和 Mac 打包 HiBuddy，手动传输发布包，并在内网服务器合并下载记录、验证与切换版本。"
---

# Windows 与 macOS 内网发布

[English](INTRANET-RELEASE.md) | 中文

## 概述

Linux 用于开发；Windows 和 Mac 拉取同一个确认过的提交，在各自电脑上构建。各平台生成 tar.gz 与 SHA-256，手动传到 236.3，再在服务器继承上一版目录并部署。服务器访问与运行约束见 [INTRANET.md](INTRANET.md)。本文命令需在对应机器执行；真实签名、公证、内网下载和安装验收由发布人员完成。

准备当前安装包时，先读取 [Desktop 打包交接](../../../haiercash/haier-upstream-sync/desktop-packaging.zh.md)及其指向的当前版本记录。

## 目录

- [确认版本与源码](#source)
- [在 Windows 上准备](#windows)
- [在 Mac 上准备](#mac)
- [在服务器合并与发布](#server)
- [官网路由与回滚](#routing)

<a id="source"></a>
## 确认版本与源码

打包前与发布负责人确认完整版本号、平台和源码提交；遵循[打包指南的版本规则](README.zh.md#release-versions)。下面的 `VERSION`、`PREVIOUS`、`RELEASE` 均为占位符，执行前替换。安装 Node >=24.9 和项目要求的 pnpm，运行 `git pull --ff-only`、`pnpm install --frozen-lockfile`，确认 `git status --short` 干净并记录 `git rev-parse HEAD`。

同一版本允许同时有 Windows、Mac arm64、Mac x64 记录；同一版本同一平台不能重复发布。同版本应来自同一提交；不同提交使用新版本，不移动已有 `release/<version>` 标签。发布成功后按 [INTRANET.md](INTRANET.md) 对构建提交打标签并推送。禁止用旧版本覆盖新版本的更新 feed。

<a id="windows"></a>
## 在 Windows 上准备

保留已验证的内网配置和压缩等级。`apps/desktop/.env.windows` 使用 [intranet.env.example](../config/intranet.env.example) 中的更新地址。PowerShell 在仓库根目录执行：

```powershell
$version = 'VERSION'
pnpm run package:desktop:win:x64:unsigned --build-version $version
node apps/desktop/scripts/prepare-intranet-release.mjs win-x64 apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts $version "apps/desktop/.desktop-build/lingxi-office-release-$version.tar.gz"
```

新辅助命令核对 `nightly.yml` 的版本和 EXE 哈希，打入 EXE、blockmap、feed、官网和该平台的单条发布记录。它同时准备下载用的 EXE，不再需要服务器重复复制。现有 Windows 发布工具仍可使用；若其 tarball 含完整 `versions/releases.json`，必须与服务器当前列表合并，不能覆盖已经发布的 Mac 记录。

<a id="mac"></a>
## 在 Mac 上准备

Apple Silicon 使用 `mac-arm64`；Intel 使用 `mac-x64`。Apple Silicon 上构建 x64 需要 Rosetta。正式包先按[签名与公证指南](README.zh.md#macos-release-signing)配置 Developer ID Application 证书、私钥、Team ID 和公证凭据；会员身份本身不替代这些配置。

```sh
version='VERSION'
pnpm run package:desktop:mac:arm64 --build-version "$version"
node apps/desktop/scripts/prepare-intranet-release.mjs mac-arm64 apps/desktop/.desktop-build/targets/mac-arm64/artifacts "$version" "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
```

Intel 将两条命令中的 `arm64` 全部替换为 `x64`。本地测试包使用 `package:desktop:mac:arm64:unsigned` 与 `unsigned-artifacts`，可能触发 macOS 来源验证提示。官网发布辅助命令不改变 DMG 内容，也不替代签名验证。

此流程发布 Mac DMG 下载，不发布 Mac 自动更新 feed 或 ZIP。正式打包需要的更新配置仍按打包指南设置；不要把 Windows 的 `/updates/win-x64/` 用作 Mac 更新源。上传到内网不会自动改写包内更新地址。首版 Mac 安装与后续升级均以下载安装为验收范围。

两个平台的辅助命令都会输出 tar.gz 路径与 SHA-256。将 tar.gz 和校验值一起交给服务器操作人员，不传 `.env`、证书或私钥。它不生成整个站点的历史清单；服务器现有 `versions/releases.json` 才是合并依据。

<a id="server"></a>
## 在服务器合并与发布

以下延续既有的“继承目录 → 解压 → 构建 → 测试 → 切换”流程。先查看 `server/.env` 和运行容器的镜像，确认 `PREVIOUS` 是当前线上完整目录。Mac 目录及镜像可用 `VERSION-mac-arm64` 区分同版本的 Windows 部署；它是部署目录标识，不改变应用版本。服务器需已有 `nginx:alpine` 与 `node:22-slim` 镜像，命令不访问外网。

```sh
set -euo pipefail
cd /data/lingxi-office
previous='PREVIOUS'
release='RELEASE'
archive='lingxi-office-release-VERSION-mac-arm64.tar.gz'
expected_sha256='SHA256_FROM_BUILD_MACHINE'
grep '^VERSIONS_IMAGE=' server/.env
docker inspect --format '{{.Config.Image}}' lingxi-office-versions-1
printf '%s  %s\n' "$expected_sha256" "$archive" | sha256sum -c -
```

确认校验成功且两个镜像信息对应 `previous` 后执行下一组。新目录必须不存在。合并工具会验证所有历史安装包存在且大小正确，新安装包额外验证 SHA-256；缺文件时停止并从历史 tarball 恢复，不删记录绕过检查。构建镜像前，先为发布目录生成分层 Dockerfile：历史版本各占一条 COPY 指令，字节不变即可命中 BuildKit 层缓存，此后每次构建只复制新增版本，不随版本累积变慢。先删除继承的硬链接再落位新文件；用重定向原地覆写会通过共享 inode 污染所有历史目录的同名 Dockerfile。

```sh
test ! -e "releases/$release"
cp -a "releases/$previous" "releases/$release"
tar -xzf "$archive" -C "releases/$release"
docker run --rm --network none --pull never \
  -v "$PWD/releases/$previous:/previous:ro" \
  -v "$PWD/releases/$release:/release" \
  node:22-slim node /release/merge-intranet-releases.mjs \
  /previous/versions/releases.json /release/release-records.json /release/versions/releases.json
{
  printf '# Override with an existing server-local Nginx image tag for offline builds.\n'
  printf 'ARG NGINX_IMAGE=nginx:stable-alpine\nFROM ${NGINX_IMAGE}\n\n'
  printf 'COPY intranet-nginx.conf /etc/nginx/conf.d/default.conf\n'
  printf 'COPY site/ /srv/lingxi-office/site/\n'
  for v in $(ls "releases/$release/versions" | sort); do
    printf 'COPY versions/%s /srv/lingxi-office/versions/%s\n' "$v" "$v"
  done
  printf 'COPY updates/ /srv/lingxi-office/updates/\n\n'
  printf 'RUN chmod -R a+rX /srv/lingxi-office\n\nEXPOSE 18765\n'
} > "releases/$release/Dockerfile.new"
rm -f "releases/$release/Dockerfile"
mv "releases/$release/Dockerfile.new" "releases/$release/Dockerfile"
docker build --build-arg NGINX_IMAGE=nginx:alpine \
  -t "lingxi-office-distribution:$release" "$PWD/releases/$release"
docker run -d --name lingxi-office-distribution-test \
  -p 127.0.0.1:18766:18765 "lingxi-office-distribution:$release"
curl -fsS http://127.0.0.1:18766/ -o /dev/null
curl -fsS http://127.0.0.1:18766/versions/releases.json
```

逐条验证合并后的下载地址，包括 Mac 和 Windows；以下使用临时 Node 容器访问主机测试端口，不下载完整安装包：

```sh
docker run --rm --pull never --network host node:22-slim node --input-type=module -e '
const origin="http://127.0.0.1:18766";
const response=await fetch(origin+"/versions/releases.json");
if(!response.ok) throw Error("Release list unavailable");
for(const row of await response.json()) {
  const result=await fetch(origin+row.url,{method:"HEAD"});
  console.log(result.status,row.url);
  if(result.status!==200) throw Error("Installer unavailable");
}'
curl -fsS http://127.0.0.1:18766/updates/win-x64/nightly.yml
```

Windows 发布时 feed 应指向新 Windows 版本；Mac 发布时 Windows feed 应保持原版本。确认测试通过后移除测试容器；首次启用官网先完成下一节的路由配置，再执行切换：

```sh
docker rm -f lingxi-office-distribution-test
cp -p server/.env "server/.env.before-$release"
sed -i "s|^VERSIONS_IMAGE=.*|VERSIONS_IMAGE=lingxi-office-distribution:$release|" server/.env
(cd server && docker compose -p lingxi-office up -d --no-build --force-recreate versions)
```

在线上 `http://172.28.236.3:18765` 重复首页、版本列表、每个安装包和 Windows feed 检查。分别在 Windows、Mac 完成实际安装与 IAM 登录、模型列表、对话验收；Windows 另测旧版自动升级。网页和 HTTP 检查不替代安装验收。

<a id="routing"></a>
## 官网路由与回滚

线上挂载的是 `server/intranet-nginx.conf`。首次官网发布时先备份此文件，只在现有 `server` 块中添加以下两个 location，保留原 `/company-login/exchange`、`/versions/`、`/updates/win-x64/` 和 `/` 的 404 规则。已有同名 location 时先比较，不重复添加，不用打包文件整体覆盖线上配置。

```nginx
location = / {
    add_header Cache-Control "no-store" always;
    try_files /site/index.html =404;
}
location /site/ {
    add_header Cache-Control "no-cache" always;
    try_files $uri =404;
}
```

修改挂载文件后运行 `docker exec lingxi-office-versions-1 nginx -t`，失败时恢复备份，不切换镜像。切换并强制重建 versions 服务会加载新配置。首页仅使用同源静态资源，无外部字体、CDN 或分析脚本；`noindex` 不是访问控制，内网限制依赖现有网络与服务器配置。

回滚时恢复保存的 `.env`，执行相同的 compose 强制重建命令；若退回没有 `site/` 的旧镜像，同时恢复此次备份的 Nginx 配置。历史发布目录和安装包均保留，不停止或重建 company-login、STG 或其他服务。

## 发布纪律（五道闸门）

每次发布按五道闸门顺序执行，闸门不过不继续。feed 只升不降，因此全部闸门都在切换之前完成——切换之后，已升级的客户端无法通过服务端回滚拉回。

1. 校验和：每个发布包用 `sha256sum -c` 验证（完整哈希不便传递时可接受共享的 6 位十六进制前缀；合并步骤仍会对新安装包做全量字节校验）。
2. 基线确认：`grep VERSIONS_IMAGE server/.env` 确认在线的上一版镜像符合预期。
3. 组装与合并：用硬链接继承——`cp -al "releases/$previous" "releases/$release"`（瞬间完成，不重复占磁盘）。**发布目录内的文件绝不原地覆写**（共享 inode 会污染所有历史目录）：先删再拷，或用 `cp --remove-destination`。合并运行会对每个安装包做字节校验。
4. 镜像构建后在临时容器 `127.0.0.1:18766` 上全量验证：首页、`releases.json` 全量 HEAD 循环（每条记录、双平台、全部 200）、Windows feed 仍指向目标版本（仅发 Mac 时绝不能移动它）、company-login 健康检查。
5. 切换前真机验证：一台 Windows（自上一版本升级）+ 一台 Mac 实际安装，通过 IAM 登录 → 模型发现 → 对话 → Office 转 PDF。大合并之后，这道闸门是挡运行时回归的唯一防线。

同版本双平台发布到同一目录：先解包 Windows 归档并合并，再以 `--exclude=release-records.json` 解包 Mac 归档（其记录单独留存），用 Mac 记录对刚合并的目录跑第二趟合并。仅 Mac 的补发使用 `<version>-mac-arm64` 目录后缀。

双平台上线并观察完毕后，清理旧分发镜像（保留最近两到三个 tag 供回滚）：`docker images | grep lingxi-office-distribution` 后 `docker rmi <旧tag>`。版本号一旦可能被任何客户端看到即作废——修复一律换新版本号发布，绝不同号重发。
