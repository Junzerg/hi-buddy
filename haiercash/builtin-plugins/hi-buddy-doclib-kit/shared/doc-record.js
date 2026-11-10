/**
 * The one document shape.
 *
 * Every source produces these fields and every consumer reads them, so a field
 * added here is added everywhere. `sessionIds` is an array of the producing
 * sessions, not a primary key: a file written by three sessions is still one
 * document.
 */
import path from 'node:path'
import { normalizeRel, pathKeyOf, relOfPathKey } from './pathKey.js'
import { extensionOf, isTextPath, normalizeTypeClass } from './typeClass.js'

/** Kinds a document can have; `folder` means "found by scanning the root". */
export const DOC_KINDS = Object.freeze(['generated', 'folder', 'upload', 'image'])

function text(value) {
  return typeof value === 'string' ? value : ''
}

function nonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function uniqueStrings(values) {
  const out = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const item = String(value ?? '')
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

function baseName(value) {
  const parts = String(value || '').split(/[\\/]/)
  return parts[parts.length - 1] || String(value || '')
}

/**
 * Fill defaults and derive the display fields a record implies.
 *
 * `pathKey` is required: a record without a location identity cannot be
 * deduplicated, and deduplication is the entire point of the model.
 */
export function createDocRecord(input = {}) {
  const pathKey = text(input.pathKey)
  if (!pathKey) throw new Error('doclib: a document record requires a pathKey')

  const name = text(input.name) || baseName(input.rel) || baseName(input.abs)
  const rel = normalizeRel(input.rel)
  const ext = text(input.ext) || extensionOf(name)

  return {
    pathKey,
    rel,
    name,
    ext,
    typeClass: normalizeTypeClass(input.typeClass, name),
    size: nonNegative(input.size),
    lines: nonNegative(input.lines),
    chunkCount: nonNegative(input.chunkCount),
    contentHash: text(input.contentHash),
    fingerprint: text(input.fingerprint),
    kind: DOC_KINDS.includes(input.kind) ? input.kind : 'generated',
    sessionIds: uniqueStrings(input.sessionIds),
    refs: uniqueStrings(input.refs),
    searchable: Boolean(input.searchable),
    oversized: Boolean(input.oversized),
    outsideWorkspace: Boolean(input.outsideWorkspace),
    updatedAt: nonNegative(input.updatedAt),
    ...(input.attachment ? { attachment: normalizeAttachment(input.attachment) } : {}),
  }
}

function normalizeAttachment(value) {
  return {
    attachmentId: String(value?.attachmentId ?? ''),
    name: String(value?.name ?? ''),
    ...(value?.mediaType ? { mediaType: String(value.mediaType) } : {}),
    ...(Number.isFinite(value?.bytes) ? { bytes: Math.max(0, Math.trunc(value.bytes)) } : {}),
  }
}

/**
 * Merge a freshly collected record into an existing one, keeping every
 * `sessionIds` entry. The most recent producer supplies the visible fields.
 */
export function mergeDocRecords(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing
  const newer = (incoming.updatedAt || 0) >= (existing.updatedAt || 0) ? incoming : existing
  const kind = incoming.kind === 'folder' ? existing.kind : incoming.kind === existing.kind
    ? existing.kind
    : [existing.kind, incoming.kind].includes('generated') ? 'generated' : newer.kind

  return {
    ...newer,
    kind,
    // Incoming first: the fresh candidates are already ordered newest-first,
    // and the primary session (index 0) decides where the row renders.
    sessionIds: uniqueStrings([...(incoming.sessionIds || []), ...(existing.sessionIds || [])]),
    refs: uniqueStrings([...(existing.refs || []), ...(incoming.refs || [])]),
    updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0),
    searchable: Boolean(existing.searchable || incoming.searchable),
    oversized: Boolean(existing.oversized || incoming.oversized),
    ...(existing.attachment || incoming.attachment
      ? { attachment: existing.attachment || incoming.attachment }
      : {}),
  }
}

/** Crop a stored record back to the contract, tolerating older indexes. */
export function normalizeStoredDoc(pathKey, raw = {}) {
  const rel = raw.rel || relOfPathKey(pathKey)
  // Attachments have no relative path; their original file name is the only
  // source, and it is persisted inside the attachment descriptor.
  const name = raw.name || baseName(rel) || raw.attachment?.name || baseName(pathKey)
  return createDocRecord({
    ...raw,
    pathKey,
    rel,
    name,
    ext: raw.ext || extensionOf(name),
    typeClass: raw.typeClass,
  })
}

/**
 * Migrate one v2 record. v2 used `path` as a mutable absolute string, and the
 * folder scanner wrote `String(FsTarget)` into it — `[object Object]` for every
 * scanned document. The repair derives the real path from `rel` when the value
 * is missing or fake, so a migrated index is usable before its first rebuild.
 */
export function docFromLegacy(record, context = {}) {
  const { workspaceId = '', workspacePath = '', rootPath = '', updatedAt = 0 } = context
  const rawPath = text(record?.path)
  const fake = !rawPath || rawPath === '[object Object]' || rawPath.startsWith('[object ')
  const rel = normalizeRel(record?.rel)
  const name = text(record?.name) || baseName(rel) || baseName(rawPath)

  let absPath = fake ? '' : rawPath
  if (!absPath && rel) {
    if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) absPath = rel
    else if (workspacePath) absPath = path.join(workspacePath, rel)
    else if (rootPath) absPath = path.join(rootPath, rel)
  }

  const attachmentId = text(record?.attachment?.attachmentId)
  const kind = DOC_KINDS.includes(record?.kind) ? record.kind : 'generated'
  const pathKey = pathKeyOf({
    kind,
    attachmentId,
    absPath,
    rel,
    rootPath,
    workspaceId,
    workspacePath,
  })
  if (!pathKey) return null

  return createDocRecord({
    pathKey,
    rel: rel || relOfPathKey(pathKey),
    name,
    ext: text(record?.ext) || extensionOf(name),
    typeClass: record?.typeClass,
    size: record?.size,
    lines: record?.lines,
    chunkCount: 0,
    // Empty content identity marks the record as unread: the first rebuild
    // re-reads it without needing a separate "stale" flag.
    contentHash: '',
    fingerprint: '',
    kind,
    sessionIds: record?.sessionIds,
    refs: [],
    searchable: Boolean(record?.searchable) && isTextPath(name),
    oversized: Boolean(record?.oversized),
    updatedAt: record?.updatedAt || updatedAt || 0,
    ...(record?.attachment ? { attachment: record.attachment } : {}),
  })
}
