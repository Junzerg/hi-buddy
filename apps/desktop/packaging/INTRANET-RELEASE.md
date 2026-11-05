---
description: "Build HiBuddy separately on Windows and Mac, transfer release archives manually, and merge, verify, and switch releases on the intranet server."
---

# Windows and macOS intranet releases

English | [中文](INTRANET-RELEASE.zh.md)

## Summary

Use Linux for development. Pull the same confirmed commit on Windows and Mac and build on each machine. Each platform produces a tar.gz and SHA-256 for manual transfer to 236.3; inherit the previous server directory before deploying. See [INTRANET.md](INTRANET.md) for server access and operating constraints. Run these commands on their respective machines; release operators must verify real signing, notarization, intranet downloads, and installed applications.

## Contents

- [Confirm version and source](#source)
- [Prepare on Windows](#windows)
- [Prepare on Mac](#mac)
- [Merge and publish on the server](#server)
- [Homepage routing and rollback](#routing)

<a id="source"></a>
## Confirm version and source

Confirm the full version, platform, and source commit with the release owner before packaging; follow the [packaging version rules](README.md#release-versions). Replace the `VERSION`, `PREVIOUS`, and `RELEASE` placeholders below before execution. Install Node >=24.9 and the required pnpm version, run `git pull --ff-only` and `pnpm install --frozen-lockfile`, confirm a clean `git status --short`, and record `git rev-parse HEAD`.

One version may have Windows, Mac arm64, and Mac x64 records; publishing the same platform and version twice is forbidden. Matching versions should use the same commit; use a new version for a different commit and never move an existing `release/<version>` tag. After publication, tag and push the build commit as specified in [INTRANET.md](INTRANET.md). Never replace a newer update feed with an older version.

<a id="windows"></a>
## Prepare on Windows

Keep the verified intranet configuration and compression level. Set the update address in `apps/desktop/.env.windows` from [intranet.env.example](../config/intranet.env.example). Run PowerShell from the repository root:

```powershell
$version = 'VERSION'
pnpm run package:desktop:win:x64:unsigned --build-version $version
node apps/desktop/scripts/prepare-intranet-release.mjs win-x64 apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts $version "apps/desktop/.desktop-build/lingxi-office-release-$version.tar.gz"
```

The helper checks the version and EXE hash in `nightly.yml`, then includes the EXE, blockmap, feed, website, and one platform release record. It also prepares the downloadable EXE, so no additional server copy is needed. Existing Windows release tools remain usable; if their archive contains a complete `versions/releases.json`, merge it with the current server list instead of overwriting published Mac records.

<a id="mac"></a>
## Prepare on Mac

Use `mac-arm64` for Apple Silicon and `mac-x64` for Intel. Building x64 on Apple Silicon requires Rosetta. Before a release build, configure the Developer ID Application certificate, private key, Team ID, and notarization credentials following the [signing and notarization guide](README.md#macos-release-signing); membership alone does not provide this configuration.

```sh
version='VERSION'
pnpm run package:desktop:mac:arm64 --build-version "$version"
node apps/desktop/scripts/prepare-intranet-release.mjs mac-arm64 apps/desktop/.desktop-build/targets/mac-arm64/artifacts "$version" "apps/desktop/.desktop-build/lingxi-office-release-$version-mac-arm64.tar.gz"
```

For Intel, replace every `arm64` in both commands with `x64`. Local test builds use `package:desktop:mac:arm64:unsigned` and `unsigned-artifacts` and may trigger macOS source-verification prompts. The website release helper does not modify the DMG or replace signature verification.

This workflow publishes Mac DMG downloads, not Mac automatic-update feeds or ZIP files. Configure the update settings required by signed packaging using the packaging guide; never use the Windows `/updates/win-x64/` address for Mac updates. Uploading to the intranet does not rewrite the packaged update address. Initial Mac installation and subsequent upgrades are qualified through downloaded installers.

Both platform helpers print the tar.gz path and SHA-256. Give the archive and checksum to the server operator without transferring `.env` files, certificates, or private keys. The helper does not generate a complete historical catalog; the existing server `versions/releases.json` is the merge baseline.

<a id="server"></a>
## Merge and publish on the server

Keep the established sequence: inherit directory → extract → build → test → switch. Inspect `server/.env` and the running container image to confirm that `PREVIOUS` is the complete live directory. A Mac directory and image may use `VERSION-mac-arm64` to distinguish a Windows deployment of the same version; this deployment identifier does not change the application version. The server must already have `nginx:alpine` and `node:22-slim`; these commands do not access the public internet.

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

Proceed only after checksum verification succeeds and both image references correspond to `previous`. The new directory must not exist. The merge tool verifies every historical installer exists with its recorded size, and additionally checks SHA-256 for new installers. Restore missing files from historical archives instead of removing records to bypass validation.

```sh
test ! -e "releases/$release"
cp -a "releases/$previous" "releases/$release"
tar -xzf "$archive" -C "releases/$release"
docker run --rm --network none --pull never \
  -v "$PWD/releases/$previous:/previous:ro" \
  -v "$PWD/releases/$release:/release" \
  node:22-slim node /release/merge-intranet-releases.mjs \
  /previous/versions/releases.json /release/release-records.json /release/versions/releases.json
docker build --build-arg NGINX_IMAGE=nginx:alpine \
  -t "lingxi-office-distribution:$release" "$PWD/releases/$release"
docker run -d --name lingxi-office-distribution-test \
  -p 127.0.0.1:18766:18765 "lingxi-office-distribution:$release"
curl -fsS http://127.0.0.1:18766/ -o /dev/null
curl -fsS http://127.0.0.1:18766/versions/releases.json
```

Verify every merged download address, including both Mac and Windows. The temporary Node container below accesses the host test port without downloading complete installers:

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

A Windows release must update the feed to the new Windows version; a Mac release must retain the previous Windows feed. Remove the test container after verification. For the first homepage deployment, complete the routing section below before switching:

```sh
docker rm -f lingxi-office-distribution-test
cp -p server/.env "server/.env.before-$release"
sed -i "s|^VERSIONS_IMAGE=.*|VERSIONS_IMAGE=lingxi-office-distribution:$release|" server/.env
(cd server && docker compose -p lingxi-office up -d --no-build --force-recreate versions)
```

Repeat homepage, release list, individual installer, and Windows feed checks against the live `http://172.28.236.3:18765`. Verify installation, IAM login, model discovery, and conversation on both Windows and Mac; also verify an automatic upgrade from an older Windows build. Website and HTTP checks do not replace installed-app qualification.

<a id="routing"></a>
## Homepage routing and rollback

The live service mounts `server/intranet-nginx.conf`. Back it up before the first homepage deployment, then add only these two locations inside its existing `server` block. Preserve `/company-login/exchange`, `/versions/`, `/updates/win-x64/`, and the fallback `/` 404 rule. Compare existing matching locations instead of duplicating them, and never overwrite the live configuration with the packaged file.

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

After editing the mounted file, run `docker exec lingxi-office-versions-1 nginx -t`. Restore the backup on failure without switching images. Switching and forcibly recreating the versions service loads the configuration. The homepage uses only same-origin static assets, with no external fonts, CDN, or analytics scripts; `noindex` is not access control, and intranet restrictions depend on the existing network and server setup.

To roll back, restore the saved `.env` and run the same compose force-recreation command. When reverting to an old image without `site/`, also restore the Nginx configuration saved for this deployment. Retain historical release directories and installers; do not stop or recreate company-login, STG, or other services.
