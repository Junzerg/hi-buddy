/** Create a platform overlay for manual transfer to the intranet distribution server. */
import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { create } from 'tar'
import { load } from 'js-yaml'
import { valid } from 'semver'

const [target, sourceArgument, version, outputArgument] = process.argv.slice(2)
if (!['win-x64', 'mac-arm64', 'mac-x64'].includes(target) || !sourceArgument || !version || !outputArgument) {
  throw new Error('Usage: node prepare-intranet-release.mjs <win-x64|mac-arm64|mac-x64> <artifacts> <version> <new-output.tar.gz>')
}
if (valid(version) !== version || version.includes('+')) throw new Error('Use the confirmed semantic build version without metadata')
const source = resolve(sourceArgument), output = resolve(outputArgument)
try { await stat(output); throw new Error('Output already exists; never replace a published archive') }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (!output.endsWith('.tar.gz')) throw new Error('Output must end in .tar.gz')
const work = await mkdtemp(join(tmpdir(), 'hibuddy-release-'))
try {
  const arch = target.endsWith('arm64') ? 'arm64' : 'x64'
  let filename, metadata, feed
  if (target === 'win-x64') {
    metadata = await readFile(join(source, 'nightly.yml'), 'utf8'); feed = load(metadata)
    if (feed?.version !== version || !Array.isArray(feed.files)) throw new Error('nightly.yml does not match the requested version')
    filename = feed.files.find(item => typeof item.url === 'string' && item.url.endsWith('-win-x64-unsigned.exe'))?.url
    if (!filename || basename(filename) !== filename) throw new Error('Feed must reference a local unsigned Windows installer')
    if (filename !== `lingxi-office-${version}-win-x64-unsigned.exe`) throw new Error('Windows filename does not match the requested version')
  } else {
    const names = await readdir(source)
    const matches = names.filter(name => name === `lingxi-office-${version}-mac-${arch}.dmg` || name === `lingxi-office-${version}-mac-${arch}-unsigned.dmg`)
    if (matches.length !== 1) throw new Error('Expected exactly one signed or unsigned DMG matching the version and architecture')
    filename = matches[0]
  }
  const installer = await readFile(join(source, filename))
  if (!installer.length) throw new Error('Installer is empty')
  const publishedName = target === 'win-x64' ? `lingxi-office-${version}.exe` : filename
  const record = { version, url: `/versions/${version}/${publishedName}`, bytes: installer.length,
    ...(target !== 'win-x64' ? { arch } : {}), sha256: createHash('sha256').update(installer).digest('hex') }
  await mkdir(join(work, 'versions', version), { recursive: true })
  await mkdir(join(work, 'updates'), { recursive: true })
  await writeFile(join(work, 'versions', version, publishedName), installer)
  if (target === 'win-x64') {
    const digest = createHash('sha512').update(installer).digest('base64')
    if (feed.files.find(item => item.url === filename)?.sha512 !== digest) throw new Error('Windows installer SHA-512 differs from nightly.yml')
    const blockmap = await readFile(join(source, `${filename}.blockmap`))
    if (!blockmap.length) throw new Error('Windows blockmap is empty')
    const updates = join(work, 'updates', target); await mkdir(updates, { recursive: true })
    await link(join(work, 'versions', version, publishedName), join(updates, filename))
    await writeFile(join(updates, `${filename}.blockmap`), blockmap)
    await writeFile(join(updates, 'nightly.yml'), metadata)
  }
  await writeFile(join(work, 'release-records.json'), `${JSON.stringify([record], null, 2)}\n`)
  await cp(new URL('../config/intranet-site/', import.meta.url), join(work, 'site'), { recursive: true })
  await cp(new URL('../config/intranet-versions.html', import.meta.url), join(work, 'versions/index.html'))
  await cp(new URL('../config/intranet-nginx.conf', import.meta.url), join(work, 'intranet-nginx.conf'))
  await cp(new URL('../config/intranet.Dockerfile', import.meta.url), join(work, 'Dockerfile'))
  await cp(new URL('./merge-intranet-releases.mjs', import.meta.url), join(work, 'merge-intranet-releases.mjs'))
  await mkdir(dirname(output), { recursive: true })
  await create({ gzip: true, file: output, cwd: work, portable: true }, await readdir(work))
  console.log(`Archive: ${output}\nSHA-256: ${createHash('sha256').update(await readFile(output)).digest('hex')}\nTarget: ${target}\nVersion: ${version}`)
} finally { await rm(work, { recursive: true, force: true }) }
