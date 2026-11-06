/** Assemble Mac intranet update files from a completed signed macOS build. */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { rcompare, valid } from 'semver'

const [sourceArgument, destinationArgument, archArgument = 'arm64'] = process.argv.slice(2)
if (!sourceArgument || !destinationArgument) {
  throw new Error('Usage: node prepare-intranet-mac-site.mjs <signed-artifacts> <site-directory> [arm64|x64]')
}
if (archArgument !== 'arm64' && archArgument !== 'x64') {
  throw new Error('Mac intranet staging supports arm64 or x64 only')
}
const source = resolve(sourceArgument)
const destination = resolve(destinationArgument)
if (source === destination) throw new Error('Site directory must differ from the artifact directory')

const metadataName = 'nightly-mac.yml'
const metadata = await readFile(join(source, metadataName), 'utf8')
const feed = load(metadata)
if (!feed || typeof feed !== 'object' || typeof feed.version !== 'string' || !valid(feed.version) || !Array.isArray(feed.files)) {
  throw new Error('nightly-mac.yml must contain a semantic version and files')
}
const file = feed.files.find(item => typeof item?.url === 'string' && item.url.endsWith('.zip'))
if (!file || basename(file.url) !== file.url || file.url.includes('-unsigned')) {
  throw new Error('Feed must reference a local signed ZIP filename')
}
const zip = await readFile(join(source, file.url))
if (typeof file.sha512 !== 'string' || createHash('sha512').update(zip).digest('base64') !== file.sha512) {
  throw new Error('ZIP SHA-512 does not match nightly-mac.yml')
}
const blockmap = await readFile(join(source, `${file.url}.blockmap`))
if (!blockmap.length) throw new Error('ZIP blockmap is empty')

const dmgCandidates = [
  `HiBuddy-${feed.version}-mac-${archArgument}.dmg`,
  `lingxi-office-${feed.version}-mac-${archArgument}.dmg`,
]
let dmg
for (const candidate of dmgCandidates) {
  try {
    const bytes = await readFile(join(source, candidate))
    if (bytes.length) { dmg = bytes; break }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
if (!dmg?.length) throw new Error(`Missing or empty Mac DMG for ${feed.version} ${archArgument}`)

const versions = join(destination, 'versions')
const updates = join(destination, 'updates', `mac-${archArgument}`)
await mkdir(versions, { recursive: true })
await mkdir(updates, { recursive: true })

let records = []
try { records = JSON.parse(await readFile(join(versions, 'releases.json'), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (!Array.isArray(records) || records.some(item => !item || !valid(item.version) || typeof item.url !== 'string' || !Number.isSafeInteger(item.bytes))) {
  throw new Error('Existing releases.json has invalid release records')
}

const publishedName = `HiBuddy-${feed.version}-mac-${archArgument}.dmg`
const record = { version: feed.version, url: `/versions/${feed.version}/${publishedName}`, bytes: dmg.length }
const previous = records.find(item => item.version === record.version && item.url === record.url)
if (previous) throw new Error('This Mac version is already staged; use a new build version')

await writeFile(join(updates, file.url), zip)
await writeFile(join(updates, `${file.url}.blockmap`), blockmap)
await mkdir(join(versions, feed.version), { recursive: true })
await writeFile(join(versions, feed.version, publishedName), dmg)
await copyFile(new URL('../config/intranet-versions.html', import.meta.url), join(versions, 'index.html'))
await copyFile(new URL('../config/intranet-nginx.conf', import.meta.url), join(destination, 'intranet-nginx.conf'))
await copyFile(new URL('../config/intranet.Dockerfile', import.meta.url), join(destination, 'Dockerfile'))

records.push(record)
records.sort((left, right) => rcompare(left.version, right.version))
await writeFile(join(versions, 'releases.json.tmp'), `${JSON.stringify(records, null, 2)}\n`)
await rename(join(versions, 'releases.json.tmp'), join(versions, 'releases.json'))
await writeFile(join(updates, `${metadataName}.tmp`), metadata)
await rename(join(updates, `${metadataName}.tmp`), join(updates, metadataName))
process.stdout.write(`Intranet Mac site: ${destination}\n`)
