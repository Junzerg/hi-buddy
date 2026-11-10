/**
 * Index persistence and shape migration.
 *
 * The index is a derivative: it may be deleted, rebuilt, or discarded when its
 * shape is unknown. The context log is the opposite, so this store refuses any
 * write that would land on it.
 */
import { docFromLegacy, mergeDocRecords, normalizeStoredDoc } from '../shared/doc-record.js'
import { compactContentHash } from '../shared/hash.js'
import { parsePathKey } from '../shared/pathKey.js'

export const INDEX_VERSION = 3
export const LEGACY_INDEX_VERSION = 2

function stringOr(value, fallback = '') {
  return typeof value === 'string' && value ? value : fallback
}

function normalizeSession(session, documents) {
  return {
    id: String(session?.id ?? ''),
    title: String(session?.title ?? ''),
    createdAt: Number(session?.createdAt) || 0,
    updatedAt: Number(session?.updatedAt) || 0,
    live: Boolean(session?.live),
    error: session?.error ? String(session.error) : null,
    documents,
  }
}

/** Parse a stored index without judging its version; the caller decides. */
async function readJson(fs, filePath) {
  try {
    const target = await fs.resolve(filePath)
    const stat = await fs.stat(target)
    if (!stat || stat.type !== 'file') return null
    return JSON.parse(await fs.readText(target))
  } catch {
    return null
  }
}

/**
 * Migrate a v2 index in memory.
 *
 * v2 documents carry no content hash and (for folder scans) no usable path, so
 * every migrated record is marked unread: `contentHash` stays empty and the
 * first rebuild reads it once. The shape is otherwise complete, which lets the
 * panel stay usable during the upgrade instead of showing an empty library.
 */
export function migrateLegacyIndex(raw, { rootPath = '' } = {}) {
  if (!raw || raw.version !== LEGACY_INDEX_VERSION || !Array.isArray(raw.workspaces)) return null

  const workspaces = []
  const docs = {}

  for (const workspace of raw.workspaces) {
    if (!workspace || !Array.isArray(workspace.sessions)) continue
    const workspaceId = String(workspace.id ?? '')
    const workspacePath = stringOr(workspace.path)
    const sessions = []

    for (const session of workspace.sessions) {
      const isFolderBucket = String(session?.id ?? '') === 'folder'
      const keys = []
      for (const legacy of Array.isArray(session?.documents) ? session.documents : []) {
        const record = docFromLegacy(legacy, {
          workspaceId: isFolderBucket ? '' : workspaceId,
          workspacePath,
          rootPath,
          updatedAt: Number(session?.updatedAt) || 0,
        })
        if (!record) continue
        const withSessionId = {
          ...record,
          sessionIds: isFolderBucket || !session?.id ? [] : [String(session.id)],
        }
        docs[record.pathKey] = mergeDocRecords(docs[record.pathKey], withSessionId)
        if (!keys.includes(record.pathKey)) keys.push(record.pathKey)
      }
      sessions.push(normalizeSession(session, keys))
    }

    workspaces.push({
      id: workspaceId,
      title: String(workspace.title ?? ''),
      path: workspacePath,
      sessions,
    })
  }

  // A key reached from two sessions must render once: keep the first listing,
  // drop later ones, and let `sessionIds` carry the other session.
  const claimed = new Set()
  for (const workspace of workspaces) {
    for (const session of workspace.sessions) {
      session.documents = session.documents.filter((key) => {
        if (claimed.has(key)) return false
        claimed.add(key)
        return true
      })
    }
  }

  for (const key of Object.keys(docs)) {
    docs[key] = normalizeStoredDoc(key, docs[key])
  }

  return {
    version: INDEX_VERSION,
    mode: raw.mode === 'flat' ? 'flat' : 'sessions',
    generatedAt: Number(raw.generatedAt) || 0,
    truncated: Boolean(raw.truncated),
    root: stringOr(raw.root, rootPath),
    workspaces,
    docs,
    migratedFrom: LEGACY_INDEX_VERSION,
  }
}

/**
 * Crop a v3 index to the contract, dropping unknown docs rather than throwing
 * on a hand-edited cache.
 */
export function normalizeIndex(raw, { rootPath = '' } = {}) {
  if (!raw || raw.version !== INDEX_VERSION) return null
  const docs = {}
  if (raw.docs && typeof raw.docs === 'object') {
    for (const [key, record] of Object.entries(raw.docs)) {
      if (!parsePathKey(key)) continue
      try {
        docs[key] = normalizeStoredDoc(key, record)
      } catch {
        // A malformed record is dropped; the source scan recreates it.
      }
    }
  }

  const workspaces = (Array.isArray(raw.workspaces) ? raw.workspaces : []).map((workspace) => ({
    id: String(workspace?.id ?? ''),
    title: String(workspace?.title ?? ''),
    path: String(workspace?.path ?? ''),
    sessions: (Array.isArray(workspace?.sessions) ? workspace.sessions : []).map((session) => normalizeSession(
      session,
      (Array.isArray(session?.documents) ? session.documents : [])
        .map((value) => (typeof value === 'string' ? value : String(value?.pathKey ?? '')))
        .filter((key) => Boolean(key) && Boolean(docs[key])),
    )),
  }))

  // A key listed by two sessions renders once; the extra session ids stay in
  // `sessionIds`. Hand-edited or duplicated indexes are cropped here rather
  // than trusted downstream.
  const claimed = new Set()
  for (const workspace of workspaces) {
    for (const session of workspace.sessions) {
      session.documents = session.documents.filter((key) => {
        if (claimed.has(key)) return false
        claimed.add(key)
        return true
      })
    }
  }

  return {
    version: INDEX_VERSION,
    mode: raw.mode === 'flat' ? 'flat' : 'sessions',
    generatedAt: Number(raw.generatedAt) || 0,
    truncated: Boolean(raw.truncated),
    root: stringOr(raw.root, rootPath),
    workspaces,
    docs,
    ...(raw.migratedFrom ? { migratedFrom: Number(raw.migratedFrom) } : {}),
  }
}

/**
 * Persisted form: the pathKey is the map key, and `rel` / `name` / `ext` are
 * derived on read. Dropping fields a key already carries keeps a 962-document
 * index in the hundreds of kilobytes instead of the megabytes.
 */
function compactDoc(doc) {
  const {
    pathKey: _pathKey,
    rel: _rel,
    name: _name,
    ext: _ext,
    ...rest
  } = doc
  const out = {
    ...rest,
    contentHash: compactContentHash(rest.contentHash),
  }
  // Defaults are restored by `normalizeStoredDoc`; persisting `false`, `0`, and
  // `[]` costs ~40 KB across a thousand documents for no information.
  if (!out.outsideWorkspace) delete out.outsideWorkspace
  if (!out.oversized) delete out.oversized
  if (!out.searchable) delete out.searchable
  if (!Array.isArray(out.refs) || !out.refs.length) delete out.refs
  if (!Array.isArray(out.sessionIds) || !out.sessionIds.length) delete out.sessionIds
  if (!out.lines) delete out.lines
  if (!out.chunkCount) delete out.chunkCount
  if (!out.updatedAt) delete out.updatedAt
  return out
}

export function createIndexStore({ fs, indexPath, policy, contextPath, rootPath, logger }) {
  let contextTarget
  let indexTarget

  async function contextIdentity() {
    if (contextTarget !== undefined) return contextTarget
    try {
      contextTarget = await fs.resolve(contextPath)
    } catch {
      contextTarget = null
    }
    return contextTarget
  }

  /** Throwing guard: the context log must never be rewritten by index code. */
  async function assertNotContext(target) {
    const guarded = await contextIdentity()
    if (!guarded || !target) return
    if (target.targetKey !== guarded.targetKey) return
    throw new Error('doclib: refusing to overwrite context.jsonl from index persistence')
  }

  async function read() {
    const raw = await readJson(fs, indexPath)
    if (!raw) return { index: null, migrated: false }
    if (raw.version === INDEX_VERSION) {
      return { index: normalizeIndex(raw, { rootPath }), migrated: false }
    }
    if (raw.version === LEGACY_INDEX_VERSION) {
      const migrated = migrateLegacyIndex(raw, { rootPath })
      logger?.info?.('doclib: migrated a v2 index in memory; a rebuild will re-read its documents')
      return { index: migrated, migrated: Boolean(migrated) }
    }
    return { index: null, migrated: false }
  }

  async function write(index) {
    if (!indexTarget) indexTarget = await fs.resolve(indexPath)
    await assertNotContext(indexTarget)
    const payload = {
      version: INDEX_VERSION,
      mode: index.mode,
      generatedAt: index.generatedAt,
      truncated: Boolean(index.truncated),
      root: index.root,
      workspaces: index.workspaces,
      docs: Object.fromEntries(
        Object.entries(index.docs || {}).map(([key, doc]) => [key, compactDoc(doc)]),
      ),
      ...(index.migratedFrom ? { migratedFrom: index.migratedFrom } : {}),
    }
    await fs.writeText(indexTarget, JSON.stringify(payload), undefined, undefined, policy)
    return payload
  }

  return { read, write, assertNotContext, indexPath }
}
