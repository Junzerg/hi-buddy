/**
 * Tokenization: ASCII words plus CJK character bigrams.
 *
 * Kept byte-for-byte compatible with the pre-v3 implementation so a pure
 * refactor does not move ranking; stop words and query budgets are a later
 * phase with their own measurements.
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/** Split text into search tokens. */
export function tokenize(text) {
  const lower = String(text || '').toLowerCase()
  const tokens = []
  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) tokens.push(match[0])
  const chars = Array.from(lower)
  for (let i = 0; i < chars.length - 1; i += 1) {
    const a = chars[i]
    const b = chars[i + 1]
    if (CJK.test(a) && CJK.test(b)) tokens.push(a + b)
  }
  return tokens
}

/** Distinct tokens in first-seen order. */
export function uniqueTokens(text) {
  return Array.from(new Set(tokenize(text)))
}
