/** Small text helpers shared by tools and read models. */

/** One text block, the harness tool-output shape. */
export function textBlock(text) {
  return [{ type: 'text', text }]
}

/** Clamp a user/model supplied number to `[1, max]`, falling back when absent. */
export function clampLimit(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}
