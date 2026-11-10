/**
 * Freshness decisions: whether a document can be reused without reading it.
 *
 * Only two observations are available from the filesystem seam — byte size and
 * an opaque backend version — so the fingerprint is exactly those two facts.
 * Anything richer would require reading the file, which is what this module
 * exists to avoid.
 */
import { fingerprintOf } from '../shared/hash.js'

/** Fingerprint from an `FsInfo` (or a plain `{ size, version }`). */
export function fingerprintFromStat(stat) {
  if (!stat) return ''
  return fingerprintOf({ size: stat.size, version: stat.version })
}

/**
 * Whether the previous document can be reused untouched.
 *
 * A reuse also requires a content hash: a migrated or oversized record has no
 * shard to search, so it must be read even when the file did not change.
 */
export function canReuse(previous, fingerprint, { dirty = false } = {}) {
  if (!previous) return false
  if (dirty) return false
  if (!previous.contentHash) return false
  if (!previous.fingerprint) return false
  return previous.fingerprint === fingerprint
}

/** Attachments have no filesystem version; their byte count is the only witness. */
export function attachmentFingerprint(bytes) {
  return fingerprintOf({ size: bytes, version: 'attachment' })
}
