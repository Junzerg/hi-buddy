/** Assemble static Nginx files from a completed Windows intranet build. */
import { copyFile, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { rcompare, valid } from 'semver'

const [sourceArgument, destinationArgument] = process.argv.slice(2)
if (!sourceArgument || !destinationArgument) throw new Error('Usage: node prepare-intranet-site.mjs <unsigned-artifacts> <site-directory>')
const source = resolve(sourceArgument)
const destination = resolve(destinationArgument)
if (source === destination) throw new Error('Site directory must differ from the artifact directory')
const metadata = await readFile(join(source, 'nightly.yml'), 'utf8')
const feed = load(metadata)
if (!feed || typeof feed !== 'object' || typeof feed.version !== 'string' || !valid(feed.version) || !Array.isArray(feed.files)) {
  throw new Error('nightly.yml must contain a semantic version and files')
}
const file = feed.files.find(item => typeof item?.url === 'string' && item.url.endsWith('.exe'))
if (!file || basename(file.url) !== file.url || !file.url.endsWith('-unsigned.exe')) throw new Error('Feed must reference a local unsigned EXE filename')
const installer = await readFile(join(source, file.url))
if (typeof file.sha512 !== 'string' || createHash('sha512').update(installer).digest('base64') !== file.sha512) {
  throw new Error('Installer SHA-512 does not match nightly.yml')
}
const blockmap = await readFile(join(source, `${file.url}.blockmap`))
if (!blockmap.length) throw new Error('Installer blockmap is empty')
const versions = join(destination, 'versions')
const updates = join(destination, 'updates', 'win-x64')
await mkdir(versions, { recursive: true })
await mkdir(updates, { recursive: true })
let records = []
try { records = JSON.parse(await readFile(join(versions, 'releases.json'), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (!Array.isArray(records) || records.some(item => !item || !valid(item.version) || typeof item.url !== 'string' || !Number.isSafeInteger(item.bytes))) {
  throw new Error('Existing releases.json has invalid release records')
}
const record = { version: feed.version, url: `/versions/${feed.version}/lingxi-office-${feed.version}.exe`, bytes: installer.length }
const previous = records.find(item => item.version === record.version && item.url.endsWith('.exe'))
if (previous) throw new Error('This version is already staged; use a new build version')
await writeFile(join(updates, file.url), installer)
await writeFile(join(updates, `${file.url}.blockmap`), blockmap)
await mkdir(join(versions, feed.version), { recursive: true })
await writeFile(join(versions, feed.version, `lingxi-office-${feed.version}.exe`), installer)
await cp(new URL('../config/intranet-site/', import.meta.url), join(destination, 'site'), { recursive: true })
await copyFile(new URL('../config/intranet-versions.html', import.meta.url), join(versions, 'index.html'))
await copyFile(new URL('../config/intranet-nginx.conf', import.meta.url), join(destination, 'intranet-nginx.conf'))
await copyFile(new URL('../config/intranet.Dockerfile', import.meta.url), join(destination, 'Dockerfile'))
records.push(record)
records.sort((left, right) => rcompare(left.version, right.version))
await writeFile(join(versions, 'releases.json.tmp'), `${JSON.stringify(records, null, 2)}\n`)
await rename(join(versions, 'releases.json.tmp'), join(versions, 'releases.json'))
await writeFile(join(updates, 'nightly.yml.tmp'), metadata)
await rename(join(updates, 'nightly.yml.tmp'), join(updates, 'nightly.yml'))
process.stdout.write(`Intranet site: ${destination}\n`)
