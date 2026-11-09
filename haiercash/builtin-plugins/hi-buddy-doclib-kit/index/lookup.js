/**
 * Turning a model-supplied reference into a document.
 *
 * `doc_read` accepts both a key and a path. A path is normalized into every
 * location key it could name, so a folder document can finally be read by path
 * (its stored path used to be `[object Object]`, which no lookup could match).
 */
import path from 'node:path'
import { isPathKey, pathKeyCandidates } from '../shared/pathKey.js'

/** Resolve `{ key, path }` against a runtime view. Returns null when unknown. */
export function resolveDocumentRef({
  key,
  path: wanted,
  byPathKey,
  documents,
  workspaces = [],
  rootPath = '',
  cwd = process.cwd(),
} = {}) {
  const direct = typeof key === 'string' ? key.trim() : ''
  if (direct) {
    const found = byPathKey?.get(direct)
    if (found) return found
    // A well-formed key that is not in the index is a real miss, not a path.
    if (isPathKey(direct)) return null
  }

  const raw = typeof wanted === 'string' ? wanted.trim() : ''
  if (!raw) return null

  const keys = new Set()
  if (isPathKey(raw)) keys.add(raw)

  const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw)
  for (const candidate of pathKeyCandidates({ absPath: absolute, rootPath, workspaces })) {
    keys.add(candidate)
  }

  for (const candidate of keys) {
    const found = byPathKey?.get(candidate)
    if (found) return found
  }

  const normalized = raw.replace(/\\/g, '/')
  return (documents || []).find((doc) => doc.rel === normalized || doc.name === normalized) || null
}
