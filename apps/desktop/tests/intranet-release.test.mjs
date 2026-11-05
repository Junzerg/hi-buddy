import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { extract } from 'tar'
import { mergeReleases, compareVersions } from '../scripts/merge-intranet-releases.mjs'

const version = '0.2.1-rc.3.20261105.1'
const win = { version, url: `/versions/${version}/HiBuddy-${version}.exe`, bytes: 3 }
const mac = { version, url: `/versions/${version}/lingxi-office-${version}-mac-arm64.dmg`, bytes: 3, arch: 'arm64' }

test('merge preserves Windows and Mac at one version and refuses replacement or downgrade', () => {
  assert.deepEqual(new Set(mergeReleases([win], [mac]).map(row => row.url)), new Set([win.url, mac.url]))
  assert.throws(() => mergeReleases([win], [win]), /already exists/)
  const older = { ...win, version: '0.2.1-rc.3.20261104.4', url: '/versions/0.2.1-rc.3.20261104.4/app.exe' }
  assert.throws(() => mergeReleases([win], [older]), /downgrade/)
  assert.throws(() => mergeReleases([win], [{ ...mac, arch: undefined }]), /architecture/)
  assert.throws(() => mergeReleases([win], [{ ...mac, url: '/versions/../../evil.dmg' }]), /URL/)
  assert.throws(() => mergeReleases([win], [{ ...mac, bytes: -1 }]), /Invalid/)
  assert.equal(compareVersions('0.2.1-rc.10', '0.2.1-rc.9'), 1)
  assert.equal(compareVersions('0.2.1', '0.2.1-rc.10'), 1)
  assert.equal(compareVersions('0.2.1-alpha', '0.2.1-beta'), -1)
})

for (const prefix of ['HiBuddy', 'lingxi-office']) test(`real overlay accepts ${prefix}, merges both platforms, and detects missing installers`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'hibuddy-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'artifacts'), site = join(root, 'site')
  await mkdir(source); await mkdir(site)
  const bytes = Buffer.from('installer fixture')
  const filename = `${prefix}-${version}-win-x64-unsigned.exe`
  await writeFile(join(source, filename), bytes)
  await writeFile(join(source, `${filename}.blockmap`), 'blockmap fixture')
  const feed = `version: ${version}\nfiles:\n  - url: ${filename}\n    sha512: ${createHash('sha512').update(bytes).digest('base64')}\n`
  await writeFile(join(source, 'nightly.yml'), feed)
  const pack = (target, file) => execFileSync(process.execPath, ['apps/desktop/scripts/prepare-intranet-release.mjs', target, source, version, file], { encoding: 'utf8', stdio: 'pipe' })
  const legacySite = join(root, 'legacy-site')
  execFileSync(process.execPath, ['apps/desktop/scripts/prepare-intranet-site.mjs', source, legacySite], { stdio: 'pipe' })
  assert.match(await readFile(join(legacySite, 'site/index.html'), 'utf8'), /HiBuddy/)
  const winTar = join(root, 'win.tar.gz')
  assert.match(pack('win-x64', winTar), /SHA-256: [a-f0-9]{64}/)
  await extract({ file: winTar, cwd: site })
  const winRecords = JSON.parse(await readFile(join(site, 'release-records.json'), 'utf8'))
  const previous = join(root, 'previous.json'); await writeFile(previous, JSON.stringify(winRecords))
  await writeFile(join(source, `lingxi-office-${version}-mac-arm64.dmg`), bytes)
  const macTar = join(root, 'mac.tar.gz'); pack('mac-arm64', macTar)
  await extract({ file: macTar, cwd: site })
  assert.equal(await readFile(join(site, 'updates/win-x64/nightly.yml'), 'utf8'), feed)
  const merge = () => execFileSync(process.execPath, [join(site, 'merge-intranet-releases.mjs'), previous, join(site, 'release-records.json'), join(site, 'versions/releases.json')], { encoding: 'utf8', stdio: 'pipe' })
  assert.match(merge(), /Merged 2 releases/)
  assert.equal(JSON.parse(await readFile(join(site, 'versions/releases.json'), 'utf8')).length, 2)
  assert.match(await readFile(join(site, 'site/index.html'), 'utf8'), /HiBuddy/)
  const macInstaller = join(site, 'versions', version, `lingxi-office-${version}-mac-arm64.dmg`)
  await writeFile(macInstaller, Buffer.alloc(bytes.length))
  assert.throws(merge, /SHA-256 mismatch/)
  await writeFile(macInstaller, bytes)
  await rm(join(site, 'versions', version, `HiBuddy-${version}.exe`))
  assert.throws(merge, /ENOENT/)
  assert.throws(() => pack('mac-arm64', macTar), /Output already exists/)
})
