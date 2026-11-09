/**
 * The only index build entry.
 *
 * One pass over the sources, one stat per document, one read only when the
 * fingerprint changed (or a write intent marked the path dirty). The result is
 * a v3 index: metadata plus workspace/session skeleton, never document bodies.
 */
import { createDocRecord, mergeDocRecords } from '../shared/doc-record.js'
import { contentHashOf } from '../shared/hash.js'
import { comparablePath, normalizeRel, relOfPathKey } from '../shared/pathKey.js'
import { isTextPath, typeClassOf } from '../shared/typeClass.js'
import { chunkText, countLines } from './chunk.js'
import { attachmentFingerprint, canReuse, fingerprintFromStat } from './fingerprint.js'
import { extractRefCandidates, resolveRefs } from './refs.js'
import { INDEX_VERSION } from '../store/index-store.js'

/** Merge one source candidate into the pending map, keeping every producer. */
function mergePending(pending, candidate) {
  const key = String(candidate.pathKey || '')
  if (!key) return
  const existing = pending.get(key)
  const incoming = {
    pathKey: key,
    rel: normalizeRel(candidate.rel || relOfPathKey(key)),
    name: String(candidate.name || ''),
    ext: String(candidate.ext || ''),
    typeClass: candidate.typeClass || typeClassOf(candidate.name),
    kind: candidate.kind || 'generated',
    abs: candidate.abs || '',
    target: candidate.target || null,
    attachment: candidate.attachment || null,
    size: Number.isFinite(candidate.size) ? Math.max(0, Math.trunc(candidate.size)) : 0,
    updatedAt: Number(candidate.updatedAt) || 0,
    outsideWorkspace: Boolean(candidate.outsideWorkspace),
    sessionIds: [],
    forceRead: Boolean(candidate.forceRead),
    refs: [],
  }
  if (candidate.sessionId) incoming.sessionIds.push({ id: String(candidate.sessionId), at: incoming.updatedAt })

  if (!existing) {
    pending.set(key, incoming)
    return
  }

  // A folder hit is weaker evidence than a session write: it survives only for
  // fields the session record does not carry.
  const newer = incoming.updatedAt >= existing.updatedAt ? incoming : existing
  const sessionIds = [...existing.sessionIds]
  for (const entry of incoming.sessionIds) {
    if (!sessionIds.some((item) => item.id === entry.id)) sessionIds.push(entry)
  }
  sessionIds.sort((a, b) => b.at - a.at)

  pending.set(key, {
    ...newer,
    sessionIds,
    kind: existing.kind === 'folder' ? incoming.kind : incoming.kind === 'folder' ? existing.kind : newer.kind,
    attachment: existing.attachment || incoming.attachment,
    target: existing.target || incoming.target,
    size: Math.max(existing.size, incoming.size),
    forceRead: existing.forceRead || incoming.forceRead,
  })
}

function sessionKey(doc) {
  const first = doc.sessionIds?.[0]
  if (!first) return ''
  return typeof first === 'string' ? first : String(first.id || '')
}

/** Build workspace buckets in registry order, with an orphan bucket last. */
function buildWorkspaces({ mode, rootPath, workspaces, sessions, docsByKey }) {
  if (mode === 'flat') {
    const keys = Array.from(docsByKey.keys())
    return [{
      id: 'flat',
      title: '文档目录',
      path: rootPath,
      sessions: [{
        id: 'flat',
        title: rootPath,
        createdAt: 0,
        updatedAt: 0,
        live: false,
        error: null,
        documents: keys,
      }],
    }]
  }

  const byId = new Map()
  const buckets = workspaces.map((workspace) => {
    const bucket = {
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      sessions: [],
    }
    if (workspace.id) byId.set(workspace.id, bucket)
    return bucket
  })
  const orphan = { id: '', title: '未归属工作区', path: '', sessions: [] }

  for (const session of sessions) {
    const bucket = (session.workspaceId && byId.get(session.workspaceId)) || orphan
    bucket.sessions.push({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      live: session.live,
      error: session.error,
      documents: [],
    })
  }
  if (orphan.sessions.length) buckets.push(orphan)

  const sessionById = new Map()
  for (const bucket of buckets) {
    for (const session of bucket.sessions) sessionById.set(session.id, session)
  }

  // Each document renders once: under its most recent producer. The remaining
  // producers stay visible through `sessionIds`.
  for (const doc of docsByKey.values()) {
    const primary = sessionKey(doc)
    if (!primary) continue
    sessionById.get(primary)?.documents.push(doc.pathKey)
  }

  const byKey = new Map(Array.from(docsByKey.entries()))
  const order = (docList) => docList
    .map((key) => byKey.get(key))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name))
    .map((doc) => doc.pathKey)

  for (const bucket of buckets) {
    bucket.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    for (const session of bucket.sessions) session.documents = order(session.documents)
  }

  return buckets
}

function summarizeStats(startedAt, previousKeys, nextKeys, counters) {
  const added = Array.from(nextKeys).filter((key) => !previousKeys.has(key))
  const removed = Array.from(previousKeys).filter((key) => !nextKeys.has(key))
  return {
    ...counters,
    added,
    removed,
    durationMs: Date.now() - startedAt,
  }
}

export function createIndexBuilder({
  fs,
  chunkStore,
  rootPath,
  maxBytes,
  chunkLines,
  readAttachment,
  logger,
}) {
  async function build({
    sessionSource = null,
    folderSource = null,
    includeFolder = true,
    previous = null,
    dirtyPaths = null,
    signal,
    now = Date.now(),
  } = {}) {
    const startedAt = Date.now()
    const previousDocs = previous?.docs || {}
    const previousKeys = new Set(Object.keys(previousDocs))
    const dirty = dirtyPaths instanceof Set ? dirtyPaths : null
    const pending = new Map()

    let sessionResult = null
    if (sessionSource) {
      sessionResult = await sessionSource.collect({ signal })
    }

    const mode = sessionResult ? 'sessions' : 'flat'
    const workspaces = sessionResult?.workspaces || []
    const sessions = sessionResult?.sessions || []
    const truncated = Boolean(sessionResult?.truncated)

    for (const candidate of sessionResult?.docs || []) mergePending(pending, candidate)

    if (folderSource && (includeFolder || mode === 'flat')) {
      try {
        const folder = await folderSource.collect({
          signal,
          skip: new Set(pending.keys()),
          workspaces,
        })
        for (const candidate of folder.docs) mergePending(pending, candidate)
      } catch (error) {
        // A missing root is only fatal when it is the whole index.
        if (mode === 'flat') throw error
        logger?.warn?.(`doclib: folder scan skipped: ${String(error)}`)
      }
    } else if (mode === 'flat') {
      throw new Error('doclib: no document source is available')
    }

    const docs = new Map()
    const refCandidates = new Map()
    const counters = { reused: 0, reread: 0, shards: 0 }

    for (const candidate of pending.values()) {
      const prior = previousDocs[candidate.pathKey] || null
      let stat = null
      let target = candidate.target
      try {
        if (!target && candidate.abs) target = await fs.resolve(candidate.abs)
        if (target) stat = await fs.stat(target, signal)
      } catch {
        stat = null
      }

      if (candidate.attachment) {
        const fingerprint = attachmentFingerprint(candidate.size)
        const textLike = isTextPath(candidate.name)
        if (prior && prior.fingerprint === fingerprint) {
          docs.set(candidate.pathKey, mergeDocRecords(prior, createDocRecord({
            ...candidate,
            sessionIds: candidate.sessionIds.map((entry) => entry.id),
            contentHash: prior.contentHash,
            fingerprint,
            chunkCount: prior.chunkCount,
            lines: prior.lines,
            size: prior.size,
            searchable: prior.searchable,
            refs: prior.refs,
          })))
          counters.reused += 1
          continue
        }
        if (!textLike) {
          docs.set(candidate.pathKey, createDocRecord({
            ...candidate,
            sessionIds: candidate.sessionIds.map((entry) => entry.id),
            fingerprint,
            chunkCount: 0,
            searchable: false,
            oversized: false,
          }))
          counters.reread += 1
          continue
        }
        let text = ''
        try {
          text = await readAttachment(candidate.attachment, maxBytes)
        } catch {
          text = ''
        }
        const oversized = text.length >= maxBytes
        const chunks = oversized ? [] : chunkText(text, chunkLines)
        const contentHash = oversized ? '' : contentHashOf(text)
        if (contentHash) {
          await chunkStore.write(contentHash, { chunks, chunkLines })
          counters.shards += 1
        }
        docs.set(candidate.pathKey, createDocRecord({
          ...candidate,
          sessionIds: candidate.sessionIds.map((entry) => entry.id),
          size: candidate.size || Buffer.byteLength(text, 'utf8'),
          lines: countLines(text),
          chunkCount: chunks.length,
          contentHash,
          fingerprint,
          searchable: chunks.length > 0,
          oversized,
        }))
        counters.reread += 1
        if (!oversized) refCandidates.set(candidate.pathKey, extractRefCandidates(text))
        continue
      }

      if (!stat || stat.type !== 'file') continue

      const fingerprint = fingerprintFromStat(stat)
      const abs = target ? target.targetKey : candidate.abs
      const isDirty = Boolean(dirty && (dirty.has(comparablePath(abs)) || dirty.has(target?.targetKey ?? '')))
      const textLike = isTextPath(candidate.name)

      if (canReuse(prior, fingerprint, { dirty: isDirty || candidate.forceRead })) {
        docs.set(candidate.pathKey, mergeDocRecords(prior, createDocRecord({
          ...candidate,
          sessionIds: candidate.sessionIds.map((entry) => entry.id),
          size: Number.isFinite(stat.size) ? stat.size : prior.size,
          fingerprint,
          contentHash: prior.contentHash,
          chunkCount: prior.chunkCount,
          lines: prior.lines,
          searchable: prior.searchable,
          oversized: prior.oversized,
          refs: prior.refs,
        })))
        counters.reused += 1
        continue
      }

      const size = Number.isFinite(stat.size) ? stat.size : 0
      if (!textLike) {
        docs.set(candidate.pathKey, createDocRecord({
          ...candidate,
          sessionIds: candidate.sessionIds.map((entry) => entry.id),
          size,
          fingerprint,
          contentHash: '',
          chunkCount: 0,
          lines: 0,
          searchable: false,
          oversized: false,
        }))
        counters.reread += 1
        continue
      }
      if (size > maxBytes) {
        docs.set(candidate.pathKey, createDocRecord({
          ...candidate,
          sessionIds: candidate.sessionIds.map((entry) => entry.id),
          size,
          fingerprint,
          contentHash: '',
          chunkCount: 0,
          lines: 0,
          searchable: false,
          oversized: true,
        }))
        counters.reread += 1
        continue
      }

      let text = ''
      try {
        text = await fs.readText(target, signal)
      } catch {
        // Unreadable files stay listed with metadata only.
        docs.set(candidate.pathKey, createDocRecord({
          ...candidate,
          sessionIds: candidate.sessionIds.map((entry) => entry.id),
          size,
          fingerprint,
          contentHash: '',
          chunkCount: 0,
          searchable: false,
        }))
        counters.reread += 1
        continue
      }

      const chunks = chunkText(text, chunkLines)
      const contentHash = contentHashOf(text)
      await chunkStore.write(contentHash, { chunks, chunkLines })
      counters.shards += 1
      refCandidates.set(candidate.pathKey, extractRefCandidates(text))
      docs.set(candidate.pathKey, createDocRecord({
        ...candidate,
        sessionIds: candidate.sessionIds.map((entry) => entry.id),
        size: size || Buffer.byteLength(text, 'utf8'),
        lines: countLines(text),
        chunkCount: chunks.length,
        contentHash,
        fingerprint,
        searchable: chunks.length > 0,
        oversized: false,
      }))
      counters.reread += 1
    }

    // Second refs pass: a reference only counts when it resolves to a document
    // that actually exists in this build.
    const knownRels = new Set()
    for (const doc of docs.values()) if (doc.rel) knownRels.add(doc.rel)
    for (const doc of docs.values()) {
      const candidates = refCandidates.get(doc.pathKey)
      if (candidates) doc.refs = resolveRefs(candidates, { docRel: doc.rel, knownRels })
      else if (doc.refs.length) doc.refs = doc.refs.filter((ref) => knownRels.has(ref))
    }

    const workspacesOut = buildWorkspaces({ mode, rootPath, workspaces, sessions, docsByKey: docs })

    // Unclaimed root documents keep their own group rather than disappearing
    // when the session-backed mode takes over. Flat mode already lists them.
    const unclaimed = mode === 'flat'
      ? []
      : Array.from(docs.values()).filter((doc) => !doc.sessionIds.length)
    if (unclaimed.length && includeFolder) {
      workspacesOut.push({
        id: 'folder',
        title: '本地文档目录',
        path: rootPath,
        sessions: [{
          id: 'folder',
          title: '未归档文档',
          createdAt: 0,
          updatedAt: 0,
          live: false,
          error: null,
          documents: unclaimed
            .sort((a, b) => a.rel.localeCompare(b.rel))
            .map((doc) => doc.pathKey),
        }],
      })
    }

    if (!dirty) {
      await chunkStore.gc(Array.from(docs.values()).map((doc) => doc.contentHash).filter(Boolean))
    }

    const docsObject = Object.fromEntries(Array.from(docs.entries()).sort(([a], [b]) => a.localeCompare(b)))
    const index = {
      version: INDEX_VERSION,
      mode,
      generatedAt: now,
      truncated,
      root: rootPath,
      workspaces: workspacesOut,
      docs: docsObject,
    }

    return {
      index,
      stats: summarizeStats(startedAt, previousKeys, new Set(Object.keys(docsObject)), counters),
    }
  }

  return { build }
}
