/**
 * Write-intent observer: mark a document dirty so the next build re-reads it.
 *
 * `fs/write-intent` and `fs/edit-intent` are single-slot waterfalls: the first
 * listener that returns without calling `next()` owns the decision. This
 * module must therefore be transparent — it prepends, delegates with `next()`,
 * and returns that exact decision. Returning `undefined` instead would silently
 * discard another plugin's version guard.
 */
import { comparablePath, isInside } from '../shared/pathKey.js'

const DEFAULT_DEBOUNCE_MS = 500

export function installDirtyTracking({
  ctx,
  fs,
  roots = [],
  ignored = [],
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  logger,
}) {
  const pending = new Set()
  let timer = null
  let disposed = false

  /** Current watch set; a getter keeps workspace mounts and removals visible. */
  function currentRoots() {
    const value = typeof roots === 'function' ? roots() : roots
    return Array.isArray(value) ? value.filter(Boolean) : []
  }

  function currentIgnored() {
    const value = typeof ignored === 'function' ? ignored() : ignored
    return Array.isArray(value) ? value.filter(Boolean) : []
  }

  async function resolveAll(values) {
    const out = []
    for (const value of values) {
      try {
        out.push(comparablePath((await fs.resolve(value)).targetKey))
      } catch {
        out.push(comparablePath(value))
      }
    }
    return out
  }

  function note(target) {
    if (!target || disposed) return
    const key = String(target.targetKey || '')
    if (!key) return
    Promise.all([resolveAll(currentRoots()), resolveAll(currentIgnored())])
      .then(([watched, skipped]) => {
        if (disposed) return
        const normalized = comparablePath(key)
        if (skipped.some((prefix) => normalized === prefix || isInside(prefix, normalized))) return
        if (!watched.some((prefix) => normalized === prefix || isInside(prefix, normalized))) return
        pending.add(normalized)
        schedule()
      })
      .catch((error) => {
        logger?.warn?.(`doclib: dirty marking failed: ${String(error)}`)
      })
  }

  function schedule() {
    if (timer || disposed) return
    timer = setTimeout(() => {
      timer = null
      if (disposed) return
      const batch = new Set(pending)
      pending.clear()
      if (!batch.size) return
      try {
        onChange?.(batch)
      } catch (error) {
        logger?.warn?.(`doclib: dirty rebuild failed: ${String(error)}`)
      }
    }, debounceMs)
    // Do not keep the host process alive for a pending library refresh.
    timer.unref?.()
  }

  /** One observer shared by both intents; the decision passes through untouched. */
  async function observe(target, _actor, next) {
    const decision = await next()
    note(target)
    return decision
  }

  ctx.effect(() => ctx.on('fs/write-intent', observe, { prepend: true }))
  ctx.effect(() => ctx.on('fs/edit-intent', observe, { prepend: true }))

  return {
    pending: () => new Set(pending),
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
