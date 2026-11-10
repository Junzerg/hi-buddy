/**
 * Session-backed source: the files a session uploaded, and the files it wrote.
 *
 * The source only derives location identity and the producing `sessionId`.
 * Reading text, hashing, and reuse decisions belong to the index builder, so a
 * rebuild can skip every unchanged file without this module knowing about
 * fingerprints.
 */
import path from 'node:path'
import { comparablePath, isInside, pathKeyOf, relativeWithin } from '../shared/pathKey.js'
import { typeClassOf } from '../shared/typeClass.js'
import { uploadedCandidates } from './attachment-source.js'

/** File name from a path spelled with either separator. */
function baseName(value) {
  const parts = String(value || '').split(/[\\/]/)
  return parts[parts.length - 1] || String(value || '')
}

/** Session titles are truncated fallbacks; prefer the stored title. */
function fallbackTitle(events, id) {
  for (const event of events) {
    if (event?.type !== 'user/message') continue
    const content = event.data?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type !== 'text') continue
      const text = String(block.text || '').replace(/\s+/g, ' ').trim()
      // Runtime-context and skill preambles are not what the user asked.
      if (!text || text.startsWith('Current runtime context')) continue
      if (text.startsWith('<system-reminder>')) continue
      if (text.startsWith('Time sampled')) continue
      if (text.startsWith('Your parent agent id')) continue
      return text.length > 28 ? `${text.slice(0, 28)}…` : text
    }
  }
  return `${String(id).slice(0, 12)}…`
}

/** Paths a write-like tool call touched; `apply_patch` style calls yield none. */
function writtenPaths(name, argumentText, writeTools) {
  if (!writeTools.has(name)) return []
  let args
  try {
    args = JSON.parse(String(argumentText || ''))
  } catch {
    return []
  }
  const out = []
  const consider = (value) => {
    if (typeof value === 'string' && value.trim()) out.push(value.trim())
  }
  if (args && typeof args === 'object') {
    consider(args.file_path)
    consider(args.filePath)
    consider(args.path)
    if (Array.isArray(args.edits)) {
      for (const edit of args.edits) if (edit && typeof edit === 'object') consider(edit.file_path)
    }
  }
  return out
}

/** Files a session wrote, deduped by canonical path; last write wins the time. */
function writtenDocs(events, cwd, writeTools, fallbackCwd) {
  const byPath = new Map()
  for (const event of events) {
    if (event?.type !== 'tool/call') continue
    const data = event.data || {}
    for (const raw of writtenPaths(data.name, data.arguments, writeTools)) {
      const absolute = path.isAbsolute(raw)
        ? path.normalize(raw)
        : path.resolve(cwd || fallbackCwd, raw)
      const key = comparablePath(absolute)
      const previous = byPath.get(key)
      byPath.set(key, {
        absolute,
        updatedAt: Math.max(Number(event.time) || 0, previous ? previous.updatedAt : 0),
      })
    }
  }
  return Array.from(byPath.values())
}

/** Workspace buckets as the registry reports them, in registry order. */
function readWorkspaces(workspaceRegistry) {
  try {
    const listed = typeof workspaceRegistry?.list === 'function' ? workspaceRegistry.list() : []
    return (Array.isArray(listed) ? listed : []).map((entry) => ({
      id: String(entry.id ?? entry.path ?? ''),
      title: String(entry.title || baseName(entry.path || '') || '工作区'),
      path: String(entry.path || ''),
    }))
  } catch {
    return []
  }
}

export function createSessionSource({
  sessionQuery,
  workspaceRegistry,
  writeTools,
  includeImages = true,
  includeSubagentSessions = false,
  maxSessions = 120,
  fallbackCwd = process.cwd(),
  rootPath = '',
}) {
  /**
   * Collect session documents.
   *
   * @returns `null` when the host has no session service, which is the signal
   *   for the builder to fall back to a flat folder index.
   */
  async function collect({ signal } = {}) {
    if (!sessionQuery || typeof sessionQuery.listSessions !== 'function') return null

    const records = await sessionQuery.listSessions(signal)
    const allRecords = Array.isArray(records) ? records : []
    const liveIds = new Set(
      allRecords.filter((record) => record?.live).map((record) => String(record?.header?.id)),
    )

    // Newest first; the cap keeps one rebuild bounded on a long history.
    const eligible = allRecords.filter((record) => {
      const header = record?.header
      if (!header) return false
      if (!includeSubagentSessions && header.origin === 'subagent') return false
      return true
    })
    const truncated = eligible.length > maxSessions
    const picked = eligible.slice(0, maxSessions)

    // Titles in one observation pass instead of one read per session.
    let titles = new Map()
    try {
      const snapshots = await sessionQuery.readTitleSnapshots(
        picked.map((record) => record.header.id),
        signal,
      )
      for (const entry of Array.isArray(snapshots) ? snapshots : []) {
        if (entry?.status === 'fulfilled') titles.set(String(entry.sessionId), entry.value)
      }
    } catch {
      titles = new Map()
    }

    const workspaces = readWorkspaces(workspaceRegistry)
    const byCwd = new Map()
    for (const entry of workspaces) {
      if (entry.path) byCwd.set(comparablePath(entry.path), entry)
    }

    const sessions = []
    const docs = []

    for (const record of picked) {
      const header = record.header
      const id = String(header.id)
      const cwd = typeof header.cwd === 'string' ? header.cwd : ''
      const owner = byCwd.get(comparablePath(cwd)) || null
      const ownerId = owner?.id || ''
      const ownerPath = owner?.path || ''
      const titleEntry = titles.get(id)
      const sessionTitle = titleEntry?.title?.title
      const sessionUpdatedAt = Number(titleEntry?.title?.updatedAt) || Number(header.createdAt) || 0

      let events = []
      let error = null
      try {
        const snapshot = await sessionQuery.readSession(id)
        events = Array.isArray(snapshot?.events) ? snapshot.events : []
      } catch (failure) {
        error = failure && typeof failure === 'object' && 'message' in failure
          ? String(failure.message)
          : String(failure)
      }

      sessions.push({
        id,
        title: String(sessionTitle || fallbackTitle(events, id)),
        createdAt: Number(header.createdAt) || 0,
        updatedAt: sessionUpdatedAt,
        live: liveIds.has(id),
        error,
        workspaceId: ownerId,
      })

      for (const upload of uploadedCandidates(events, { includeImages })) {
        docs.push({
          pathKey: upload.pathKey,
          kind: upload.kind,
          name: upload.name,
          ext: path.extname(upload.name).toLowerCase(),
          typeClass: typeClassOf(upload.name),
          size: upload.size,
          updatedAt: upload.updatedAt || sessionUpdatedAt,
          attachment: upload.attachment,
          sessionId: id,
        })
      }

      for (const written of writtenDocs(events, cwd, writeTools, fallbackCwd)) {
        const insideOwner = Boolean(ownerPath) && isInside(ownerPath, written.absolute)
        const insideRoot = Boolean(rootPath) && isInside(rootPath, written.absolute)
        const rel = insideOwner
          ? relativeWithin(ownerPath, written.absolute)
          : insideRoot ? relativeWithin(rootPath, written.absolute) : ''
        const pathKey = pathKeyOf({
          kind: 'generated',
          absPath: written.absolute,
          rel,
          rootPath,
          workspaceId: ownerId,
          workspacePath: ownerPath,
          workspaces,
        })
        if (!pathKey) continue

        docs.push({
          pathKey,
          kind: 'generated',
          name: baseName(written.absolute),
          ext: path.extname(written.absolute).toLowerCase(),
          typeClass: typeClassOf(written.absolute),
          updatedAt: written.updatedAt || sessionUpdatedAt,
          abs: written.absolute,
          rel,
          outsideWorkspace: !insideOwner,
          sessionId: id,
        })
      }
    }

    return { mode: 'sessions', truncated, workspaces, sessions, docs }
  }

  return { collect }
}
