/**
 * The context log: append-only facts about who used which document, when, and
 * why. This is the only layer that cannot be rebuilt — the index and the chunk
 * shards are caches, this file is the record.
 *
 * Storage is one JSONL file under `<root>/.doclib/`. Appends are serialized in
 * process and published with an atomic whole-file write; history is never
 * rewritten, only extended.
 */
import { createHash } from 'node:crypto'

export const CONTEXT_EVENT_TYPES = Object.freeze(['captured', 'read', 'cited', 'distilled'])

/** Append-only event log; one JSON object per line. */
export function createContextStore({ fs, filePath, policy, logger }) {
  let queue = Promise.resolve()
  let targetPromise

  function target() {
    if (!targetPromise) targetPromise = fs.resolve(filePath)
    return targetPromise
  }

  async function readRaw() {
    try {
      const resolved = await target()
      const stat = await fs.stat(resolved)
      if (!stat || stat.type !== 'file') return ''
      return await fs.readText(resolved)
    } catch {
      return ''
    }
  }

  function enqueue(task) {
    // A failed append must not poison later appends: the queue continues after
    // the caller observes its own rejection.
    const next = queue.then(task, task)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  /** Append one or more events in a single write, preserving file order. */
  async function appendMany(events) {
    const list = (Array.isArray(events) ? events : [events])
      .filter((event) => event && CONTEXT_EVENT_TYPES.includes(event.type) && event.pathKey)
    if (!list.length) return 0
    return enqueue(async () => {
      const existing = await readRaw()
      const lines = existing ? existing.split('\n').filter((line) => line.trim()) : []
      for (const event of list) {
        lines.push(JSON.stringify({
          t: Number(event.t) || Date.now(),
          type: event.type,
          pathKey: String(event.pathKey),
          sessionId: event.sessionId ? String(event.sessionId) : '',
          actor: ['user', 'agent', 'system'].includes(event.actor) ? event.actor : 'system',
          detail: event.detail && typeof event.detail === 'object' ? event.detail : {},
        }))
      }
      const resolved = await target()
      await fs.writeText(resolved, `${lines.join('\n')}\n`, undefined, undefined, policy)
      return list.length
    })
  }

  function append(event) {
    return appendMany([event])
  }

  /** All parseable events, oldest first. Malformed lines are skipped. */
  async function readAll() {
    // Reads observe every append that was already requested; otherwise a
    // `doc_read` immediately followed by `/context` would look empty.
    await queue
    const raw = await readRaw()
    if (!raw) return []
    const events = []
    for (const line of raw.split('\n')) {
      const text = line.trim()
      if (!text) continue
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object' && parsed.pathKey) events.push(parsed)
      } catch {
        // A torn trailing line from an interrupted write is not a fact.
      }
    }
    return events
  }

  /** Every fact recorded about one document, oldest first. */
  async function documentContext(pathKey) {
    const wanted = String(pathKey || '')
    if (!wanted) return []
    const events = await readAll()
    return events.filter((event) => String(event.pathKey) === wanted)
  }

  /** SHA-256 of the file bytes, used to prove a rebuild did not touch it. */
  async function digest() {
    await queue
    const raw = await readRaw()
    if (!raw) return ''
    return createHash('sha256').update(raw).digest('hex')
  }

  return { append, appendMany, readAll, documentContext, digest, filePath }
}
