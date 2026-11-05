/** Merge platform releases on the server without replacing the other platform's history. */
import { readFile, writeFile, rename, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** Compare build versions using semantic-version prerelease ordering. */
export function compareVersions(left, right) {
  const a = versionPattern.exec(left), b = versionPattern.exec(right)
  if (!a || !b) throw new Error('Release versions must be semantic versions without build metadata')
  for (let i = 1; i <= 3; i++) { const difference = BigInt(a[i]) - BigInt(b[i]); if (difference) return difference > 0n ? 1 : -1 }
  if (!a[4] || !b[4]) return a[4] ? -1 : b[4] ? 1 : 0
  const ap = a[4].split('.'), bp = b[4].split('.')
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined) return -1
    if (bp[i] === undefined) return 1
    if (ap[i] === bp[i]) continue
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i])
    if (an && bn) return BigInt(ap[i]) > BigInt(bp[i]) ? 1 : -1
    if (an !== bn) return an ? -1 : 1
    return ap[i] > bp[i] ? 1 : -1
  }
  return 0
}

function releaseTarget(item) {
  if (!item || typeof item.version !== 'string' || !versionPattern.test(item.version)
    || item.version.split('-').slice(1).join('-').split('.').some(part => /^0\d+$/.test(part))
    || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || typeof item.url !== 'string') throw new Error('Invalid release record')
  const parts = item.url.split('/')
  if (parts.length !== 4 || parts[1] !== 'versions' || parts[2] !== item.version || !/^[a-zA-Z0-9.-]+\.(exe|dmg)$/.test(parts[3])) throw new Error(`Invalid release URL: ${item.url}`)
  if (item.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid installer SHA-256')
  if (item.url.endsWith('.exe')) return 'win-x64'
  if (!['arm64', 'x64'].includes(item.arch)) throw new Error('DMG record requires arm64 or x64 architecture')
  return `mac-${item.arch}`
}

/** Keep published records immutable; permit the same version on different platforms. */
export function mergeReleases(previous, incoming) {
  if (!Array.isArray(previous) || !Array.isArray(incoming) || !incoming.length) throw new Error('Expected release arrays and at least one incoming record')
  const keys = new Set()
  for (const item of previous) {
    const key = `${item.version}:${releaseTarget(item)}`
    if (keys.has(key)) throw new Error(`Duplicate published release: ${key}`)
    keys.add(key)
  }
  for (const item of incoming) {
    const target = releaseTarget(item), key = `${item.version}:${target}`
    if (keys.has(key)) throw new Error(`Release already exists: ${key}; choose a new version`)
    if (previous.some(record => releaseTarget(record) === target && compareVersions(record.version, item.version) >= 0)) throw new Error(`Release would downgrade ${target}`)
    keys.add(key)
  }
  return [...previous, ...incoming].sort((a, b) => compareVersions(b.version, a.version) || releaseTarget(a).localeCompare(releaseTarget(b)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [previousPath, incomingPath, outputPath] = process.argv.slice(2)
  if (!previousPath || !incomingPath || !outputPath) throw new Error('Usage: node merge-intranet-releases.mjs <previous-releases.json> <release-records.json> <site>/versions/releases.json')
  const records = mergeReleases(JSON.parse(await readFile(previousPath, 'utf8')), JSON.parse(await readFile(incomingPath, 'utf8')))
  const root = resolve(dirname(outputPath), '..')
  for (const record of records) {
    const filename = resolve(root, record.url.slice(1))
    if ((await stat(filename)).size !== record.bytes) throw new Error(`Missing or incorrect installer size: ${record.url}`)
    if (record.sha256 && createHash('sha256').update(await readFile(filename)).digest('hex') !== record.sha256) throw new Error(`Installer SHA-256 mismatch: ${record.url}`)
  }
  await writeFile(`${outputPath}.tmp`, `${JSON.stringify(records, null, 2)}\n`, { flag: 'wx' })
  await rename(`${outputPath}.tmp`, outputPath)
  console.log(`Merged ${records.length} releases; installer sizes and recorded hashes verified`)
}
