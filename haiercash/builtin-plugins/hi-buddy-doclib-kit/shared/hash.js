/**
 * Content and freshness identities.
 *
 * Two distinct hashes, deliberately kept apart:
 *   - `contentHash` identifies bytes of a document; it names the chunk file and
 *     is the invalidation key for everything derived from the text.
 *   - `fingerprint` identifies a cheap stat observation (size + backend
 *     version); equal fingerprints mean "do not read this file again".
 */
import { createHash } from 'node:crypto'

/** Full SHA-256 of a document body, prefixed so the algorithm is visible. */
export function contentHashOf(text) {
  return `sha256:${createHash('sha256').update(String(text ?? '')).digest('hex')}`
}

/** Short hex digest, used where a full 64-character value would bloat the index. */
export function shortHash(value, length = 16) {
  const digest = createHash('sha256').update(String(value ?? '')).digest('hex')
  return digest.slice(0, Math.max(1, Math.trunc(length)))
}

/**
 * Compact form stored in the index: 128 bits is far past any realistic
 * collision budget for a local library, and 32 hex characters per document
 * matter when the corpus is ~1000 files.
 */
export function compactContentHash(contentHash) {
  const hex = String(contentHash || '').replace(/^sha256:/, '')
  if (!hex) return ''
  return `sha256:${hex.slice(0, 32)}`
}

/**
 * Reduce an opaque backend version to a compact, stable token.
 *
 * `FsVersion` is documented as uninterpretable by consumers, so it is hashed
 * rather than parsed. `size` stays outside the hash: it keeps the fingerprint
 * legible in the index and detects truncation even if a backend reuses a
 * version token.
 */
export function fingerprintOf({ size, version } = {}) {
  const bytes = Number.isFinite(size) ? Math.max(0, Math.trunc(size)) : -1
  if (version === undefined || version === null || version === '') return `${bytes}:`
  return `${bytes}:${shortHash(version, 16)}`
}

/**
 * File name for a content-addressed chunk shard. Truncated to 128 bits: enough
 * to make an accidental collision irrelevant, short enough to keep a
 * 962-document index under budget. The full hash stays in the document record
 * and inside the shard's own payload.
 */
export function contentKeyOf(contentHash) {
  const hex = String(contentHash || '').replace(/^sha256:/, '')
  return hex.slice(0, 32)
}
