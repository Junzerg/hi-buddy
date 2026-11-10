/**
 * The reference graph: which library documents a document's text points at.
 *
 * Only references that resolve to a known library path are kept, so `refs`
 * answers "which of these files exist here" rather than "which strings look
 * like paths". Built after chunking and before the index is written; docs are
 * filtered in a second pass once every document's location is known.
 */
import path from 'node:path'
import { normalizeRel } from '../shared/pathKey.js'

const MAX_CANDIDATES = 400

/** Reject URLs, template fragments, and prose that merely contains dots. */
function looksLikePath(value) {
  const text = String(value || '').trim()
  if (!text || text.length > 240) return false
  if (/\s/.test(text)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return false
  if (text.startsWith('#') || text.startsWith('/') || text.startsWith('~')) return false
  if (text.includes('<') || text.includes('>') || text.includes('${') || text.includes('*')) return false
  if (!text.includes('/') && !/\.[a-z0-9]{1,8}$/i.test(text)) return false
  return true
}

/**
 * Raw candidates in a document body: Markdown link targets plus backticked
 * tokens that look like paths. Comments and diagrams are covered by the
 * backtick arm, which is where most cross-references in this repository live.
 */
export function extractRefCandidates(text) {
  const out = new Set()
  const source = String(text || '')

  for (const match of source.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    if (looksLikePath(match[1])) out.add(match[1])
    if (out.size >= MAX_CANDIDATES) return Array.from(out)
  }

  for (const match of source.matchAll(/`([^`\n]{2,240})`/g)) {
    const value = match[1].trim()
    if (looksLikePath(value)) out.add(value)
    if (out.size >= MAX_CANDIDATES) break
  }

  return Array.from(out)
}

/**
 * Resolve candidates against the library, relative to the referring document.
 *
 * `docRel` is the referral's library-relative display path (for `wb:` docs this
 * is relative to the workspace). The result keeps only paths present in
 * `knownRels`.
 */
export function resolveRefs(candidates, { docRel = '', knownRels } = {}) {
  if (!(knownRels instanceof Set) || !knownRels.size) return []
  const base = normalizeRel(docRel)
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : ''
  const out = new Set()

  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const trimmed = String(raw).split('#')[0].split('?')[0].trim()
    if (!trimmed) continue
    const direct = normalizeRel(trimmed)
    if (direct && knownRels.has(direct)) out.add(direct)
    if (!dir) continue
    const joined = path.posix.normalize(path.posix.join(dir, direct))
    if (!joined || joined.startsWith('..')) continue
    const normalized = normalizeRel(joined)
    if (knownRels.has(normalized)) out.add(normalized)
  }

  return Array.from(out).sort()
}
