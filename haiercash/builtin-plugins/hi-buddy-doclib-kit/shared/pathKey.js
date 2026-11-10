/**
 * The single implementation of a document's location identity.
 *
 * Four schemes, most specific first:
 *
 *   wb:<workspaceId>/<rel>   a file inside a registered workspace
 *   attachment:<id>          a file uploaded into a session (no path at all)
 *   folder:<rel>             a file under the library root but outside every workspace
 *   abs:<absolute path>      a workspace-external path a session wrote
 *
 * The workspace id + relative path are used instead of an absolute path on
 * purpose: absolute paths change with the machine and the checkout directory,
 * while location identity must not. No other module may build this string.
 */
import path from 'node:path'

/** Normalize a relative path to forward slashes without leading/trailing junk. */
export function normalizeRel(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/** Comparable form for containment tests; case-folded only on Windows. */
export function comparablePath(value) {
  if (typeof value !== 'string' || !value) return ''
  let out = path.normalize(value).replace(/\\/g, '/').replace(/\/+$/, '')
  // Keep a root directory ("/" or "C:/") from collapsing to an empty string.
  if (!out) out = '/'
  if (process.platform === 'win32') out = out.toLowerCase()
  return out
}

/** True when `child` is `parent` or a descendant of it. */
export function isInside(parent, child) {
  const base = comparablePath(parent)
  const target = comparablePath(child)
  if (!base || !target) return false
  if (target === base) return true
  return target.startsWith(base === '/' ? '/' : `${base}/`)
}

/** Path of `child` relative to `parent`, normalized; '' when not contained. */
export function relativeWithin(parent, child) {
  if (!isInside(parent, child)) return ''
  const rel = path.relative(parent, child)
  return normalizeRel(rel)
}

function normalizeAbs(value) {
  const resolved = path.resolve(String(value))
  return resolved.replace(/\\/g, '/')
}

/** Workspace entry lookup for containment, tolerating missing paths. */
function owningWorkspace(absolute, workspaces) {
  if (!Array.isArray(workspaces)) return null
  for (const entry of workspaces) {
    if (!entry?.path || !entry?.id) continue
    if (!isInside(entry.path, absolute)) continue
    return { id: String(entry.id), rel: relativeWithin(entry.path, absolute) }
  }
  return null
}

/**
 * Build the location identity for one document.
 *
 * Callers pass whatever they know; the function decides the scheme. Attachment
 * identity wins because an upload has no location, and a file inside a
 * workspace outranks the library root because the same physical file found by
 * a session scan and by a folder scan must land on the same key.
 */
export function pathKeyOf(input = {}) {
  const {
    kind,
    absPath,
    rel,
    rootPath,
    workspaceId,
    workspacePath,
    workspaces,
    attachmentId,
  } = input

  if (attachmentId) return `attachment:${String(attachmentId)}`
  if (kind === 'upload' || kind === 'image') return ''

  const absolute = typeof absPath === 'string' && absPath ? normalizeAbs(absPath) : ''

  if (absolute && workspaceId && workspacePath && isInside(workspacePath, absolute)) {
    const within = relativeWithin(workspacePath, absolute)
    if (within) return `wb:${String(workspaceId)}/${within}`
  }

  if (absolute) {
    const owner = owningWorkspace(absolute, workspaces)
    if (owner?.rel) return `wb:${owner.id}/${owner.rel}`
  }

  if (absolute && rootPath && isInside(rootPath, absolute)) {
    const within = relativeWithin(rootPath, absolute)
    if (within) return `folder:${within}`
  }

  if (absolute) return `abs:${absolute}`

  if (rel) {
    if (workspaceId) return `wb:${String(workspaceId)}/${normalizeRel(rel)}`
    return `folder:${normalizeRel(rel)}`
  }

  return ''
}

/**
 * Every scheme one absolute path could be addressed by, most specific first.
 * Used by lookups (a caller supplies a path, not a key) so the schemes stay in
 * this module instead of being re-spelled at each call site.
 */
export function pathKeyCandidates({ absPath, rootPath, workspaces } = {}) {
  if (typeof absPath !== 'string' || !absPath) return []
  const absolute = normalizeAbs(absPath)
  const out = []
  const owner = owningWorkspace(absolute, workspaces)
  if (owner?.rel) out.push(`wb:${owner.id}/${owner.rel}`)
  if (rootPath && isInside(rootPath, absolute)) {
    const within = relativeWithin(rootPath, absolute)
    if (within) out.push(`folder:${within}`)
  }
  out.push(`abs:${absolute}`)
  return out
}

const PATH_KEY_RE = /^(wb|attachment|folder|abs):(.+)$/

/** True when the value is already a location key rather than a user path. */
export function isPathKey(value) {
  return typeof value === 'string' && PATH_KEY_RE.test(value)
}

/** Split a key into its scheme and payload; null for a non-key value. */
export function parsePathKey(value) {
  const match = PATH_KEY_RE.exec(String(value || ''))
  if (!match) return null
  const [, scheme, payload] = match
  if (scheme === 'attachment') return { scheme, attachmentId: payload }
  if (scheme === 'abs') return { scheme, abs: payload }
  if (scheme === 'folder') return { scheme, rel: normalizeRel(payload) }
  const slash = payload.indexOf('/')
  if (slash <= 0) return { scheme, workspaceId: payload, rel: '' }
  return {
    scheme,
    workspaceId: payload.slice(0, slash),
    rel: normalizeRel(payload.slice(slash + 1)),
  }
}

/** Display-relative path carried by a key, or '' for attachments. */
export function relOfPathKey(value) {
  const parsed = parsePathKey(value)
  if (!parsed) return ''
  if (parsed.scheme === 'attachment') return ''
  if (parsed.scheme === 'abs') return normalizeRel(parsed.abs.split('/').slice(-1)[0] || '')
  return parsed.rel || ''
}

/**
 * Best-effort absolute path for a document record. Used for reading and for
 * matching dirty write targets; never used as identity.
 */
export function absOfPathKey(value, { rootPath, workspaces } = {}) {
  const parsed = parsePathKey(value)
  if (!parsed) return ''
  if (parsed.scheme === 'abs') return parsed.abs
  if (parsed.scheme === 'attachment') return ''
  if (parsed.scheme === 'folder') {
    return rootPath ? normalizeAbs(path.join(rootPath, parsed.rel || '')) : ''
  }
  const entry = Array.isArray(workspaces)
    ? workspaces.find((item) => String(item?.id) === parsed.workspaceId)
    : null
  if (entry?.path) return normalizeAbs(path.join(entry.path, parsed.rel || ''))
  return ''
}
