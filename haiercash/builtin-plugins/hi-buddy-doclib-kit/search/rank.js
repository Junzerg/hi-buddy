/**
 * Ranking and result assembly: no I/O, no clock, no configuration reads.
 *
 * The score is the pre-v3 formula (tf × idf, one addend per query token), so a
 * refactor of the surrounding modules cannot silently change order. Admission
 * filtering is a separate decision applied after scoring.
 */
import { uniqueTokens } from './tokenize.js'

/** Bounded snippet around the first token hit in a chunk. */
export function makeSnippet(chunkText, tokens) {
  const flat = String(chunkText || '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const lower = flat.toLowerCase()
  let hit = -1
  for (const token of tokens) {
    const at = lower.indexOf(token)
    if (at >= 0 && (hit < 0 || at < hit)) hit = at
  }
  if (hit < 0) return flat.slice(0, 200)
  const start = Math.max(0, hit - 60)
  const end = Math.min(flat.length, start + 220)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/**
 * Score, filter and shape search results.
 *
 * @param options.query - raw query text.
 * @param options.limit - maximum result count.
 * @param options.postings - token → pathKey → count.
 * @param options.byPathKey - pathKey → document record (already enriched with
 *   `workspaceTitle`, `sessionTitle`, `sessionCount`).
 * @param options.chunksOf - `(pathKey) => chunks`, used only to pick the
 *   snippet line; defaults to no chunks, which yields an empty snippet.
 * @param options.visible - `(doc) => boolean` admission filter.
 */
export function searchDocuments({
  query,
  limit,
  postings,
  byPathKey,
  chunksOf = () => [],
  visible = () => true,
}) {
  const tokens = uniqueTokens(query)
  const empty = { query: String(query ?? ''), results: [], total: 0 }
  if (!tokens.length) return empty

  const total = byPathKey.size
  if (!total) return empty

  const scores = new Map()
  for (const token of tokens) {
    const bucket = postings.get(token)
    if (!bucket) continue
    const idf = Math.log(1 + total / bucket.size)
    for (const [key, n] of bucket) {
      scores.set(key, (scores.get(key) || 0) + (1 + Math.log(n)) * idf)
    }
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1])
  const results = []
  for (const [key, score] of ranked) {
    if (results.length >= limit) break
    const doc = byPathKey.get(key)
    if (!doc) continue
    if (!visible(doc)) continue

    let best = null
    let bestHits = -1
    for (const chunk of chunksOf(key)) {
      const lower = String(chunk?.text || '').toLowerCase()
      let hits = 0
      for (const token of tokens) if (lower.includes(token)) hits += 1
      if (hits > bestHits) {
        bestHits = hits
        best = chunk
      }
    }

    results.push({
      key: doc.pathKey,
      path: doc.rel || doc.name,
      rel: doc.rel || '',
      name: doc.name,
      kind: doc.kind,
      typeClass: doc.typeClass,
      ext: doc.ext || '',
      workspace: doc.workspaceTitle,
      session: doc.sessionTitle,
      sessionId: doc.sessionId || '',
      sessionCount: doc.sessionCount || (doc.sessionIds ? doc.sessionIds.length : 0),
      score: Math.round(score * 100) / 100,
      line: best ? best.line : 1,
      snippet: best ? makeSnippet(best.text, tokens) : '',
      size: doc.size,
      updatedAt: Number(doc.updatedAt) || 0,
    })
  }

  return { query: String(query ?? ''), results, total: scores.size }
}
