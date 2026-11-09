/**
 * Content-addressed chunk shards.
 *
 * The index holds metadata only; chunk text lives beside it keyed by
 * `contentHash`, so identical bytes share one shard and deleting the index
 * never loses a document. This store is a cache: a missing shard is rebuilt by
 * the next index pass, never treated as data loss.
 */
import path from 'node:path'
import { contentKeyOf } from '../shared/hash.js'

const SHARD_VERSION = 1

/** Two-level path: `<dir>/<first two hex>/<key>.json`. */
function shardParts(directory, contentHash) {
  const key = contentKeyOf(contentHash)
  if (!key) return null
  return { key, dir: path.join(directory, key.slice(0, 2)), file: path.join(directory, key.slice(0, 2), `${key}.json`) }
}

export function createChunkStore({ fs, directory, policy, logger }) {
  async function read(contentHash) {
    const parts = shardParts(directory, contentHash)
    if (!parts) return null
    try {
      const target = await fs.resolve(parts.file)
      const stat = await fs.stat(target)
      if (!stat || stat.type !== 'file') return null
      const parsed = JSON.parse(await fs.readText(target))
      if (parsed?.version !== SHARD_VERSION || !Array.isArray(parsed.chunks)) return null
      return parsed
    } catch {
      return null
    }
  }

  async function write(contentHash, { chunks, chunkLines }) {
    const parts = shardParts(directory, contentHash)
    if (!parts) return false
    try {
      const target = await fs.resolve(parts.file)
      // Identical content is already sharded; rewriting it would only move IO.
      const stat = await fs.stat(target)
      if (stat?.type === 'file') return false
      const payload = JSON.stringify({
        version: SHARD_VERSION,
        contentHash,
        chunkLines,
        chunks,
      })
      await fs.writeText(target, payload, undefined, undefined, policy)
      return true
    } catch (error) {
      logger?.warn?.(`doclib: chunk shard write failed for ${contentHash}: ${String(error)}`)
      return false
    }
  }

  /**
   * Delete shards no document references. Runs after a full rebuild only: an
   * incremental pass cannot know that an unrelated shard became unreachable.
   */
  async function gc(usedContentHashes) {
    const used = new Set()
    for (const hash of usedContentHashes || []) {
      const key = contentKeyOf(hash)
      if (key) used.add(key)
    }
    let removed = 0
    let root
    try {
      root = await fs.resolve(directory)
      const stat = await fs.stat(root)
      if (!stat || stat.type !== 'directory') return removed
    } catch {
      return removed
    }
    try {
      for (const shard of await fs.listDir(root)) {
        if (shard.type !== 'directory') continue
        try {
          for (const entry of await fs.listDir(shard.target)) {
            if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
            if (used.has(entry.name.slice(0, -'.json'.length))) continue
            try {
              await fs.deleteFile(entry.target)
              removed += 1
            } catch {
              // A concurrent rebuild may have claimed it; the next GC retries.
            }
          }
        } catch {
          // Unreadable shard directory: leave it for the next pass.
        }
      }
    } catch (error) {
      logger?.warn?.(`doclib: chunk gc failed: ${String(error)}`)
    }
    return removed
  }

  return { read, write, gc }
}
