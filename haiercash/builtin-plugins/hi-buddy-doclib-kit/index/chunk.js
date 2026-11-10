/**
 * Chunking.
 *
 * P1 keeps the existing line-aligned chunks; heading-level boundaries and
 * `endLine` are a later phase. The chunk list is derived data, stored per
 * `contentHash` so two documents with identical bytes share one shard.
 */

/** Cut a document into line-aligned chunks, keeping the 1-based first line. */
export function chunkText(text, chunkLines) {
  const lines = String(text || '').split(/\r?\n/)
  const chunks = []
  for (let i = 0; i < lines.length; i += chunkLines) {
    const body = lines.slice(i, i + chunkLines).join('\n')
    if (body.trim()) chunks.push({ line: i + 1, text: body })
  }
  return chunks
}

/** Line count of a body, matching the pre-v3 accounting. */
export function countLines(text) {
  return text ? String(text).split(/\r?\n/).length : 0
}
