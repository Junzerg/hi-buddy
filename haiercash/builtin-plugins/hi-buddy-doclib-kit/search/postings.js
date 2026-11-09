/**
 * Inverted-index construction.
 *
 * Pure in the sense that matters for testing: the caller supplies the chunk
 * text provider, so this module never touches the filesystem and the same
 * function serves the live index, a v2 index migration, and the eval script.
 */
import { tokenize } from './tokenize.js'

/**
 * Build postings for every searchable document.
 *
 * @param documents - records with `pathKey` and `searchable`.
 * @param chunksOf - `(pathKey) => Array<{ line: number, text: string }>`.
 * @returns `{ postings, byPathKey, total }`, where `postings` maps a token to
 *   `pathKey -> count` and `total` is the number of documents that had chunks.
 */
export function buildPostings(documents, chunksOf) {
  const postings = new Map()
  const byPathKey = new Map()
  let total = 0

  for (const doc of documents) {
    if (!doc?.searchable) continue
    const chunks = chunksOf(doc.pathKey)
    if (!Array.isArray(chunks) || !chunks.length) continue
    byPathKey.set(doc.pathKey, doc)
    total += 1
    for (const chunk of chunks) {
      const counts = new Map()
      for (const token of tokenize(chunk.text)) {
        counts.set(token, (counts.get(token) || 0) + 1)
      }
      for (const [token, n] of counts) {
        let bucket = postings.get(token)
        if (!bucket) postings.set(token, (bucket = new Map()))
        bucket.set(doc.pathKey, (bucket.get(doc.pathKey) || 0) + n)
      }
    }
  }

  return { postings, byPathKey, total }
}
