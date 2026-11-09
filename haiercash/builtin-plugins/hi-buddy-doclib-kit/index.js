/**
 * Host half of the local document library.
 *
 * The library is TWO-LEVEL, mirroring how the harness already organizes work:
 *
 *     workspace  ->  session  ->  the documents that session uploaded or produced
 *
 * Where the data comes from (all optional at runtime, resolved lazily so a
 * service that mounts late is still picked up):
 *   - ctx.workspaceRegistry : durable workspaces (id / title / path / sessionIds)
 *   - ctx.sessionQuery      : session headers, titles and full event logs
 *   - ctx.attachments       : bytes of files the user uploaded into a session
 *   - ctx.fs                : text of files a session wrote into its workspace
 *
 * A document is attributed to a session when:
 *   - the user uploaded it there  (user/message file or image block), or
 *   - the session wrote it there  (write / edit / multi_edit tool call)
 *
 * When none of those services is present the plugin falls back to the flat
 * folder scan configured by `root`, so it still works on a bare host.
 *
 * The index is a rebuildable derivative cached as JSON; the documents on disk
 * remain the source of truth.
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const INDEX_VERSION = 2
const DEFAULT_ROOT = 'docs'
const DEFAULT_INDEX_FILE = '.doclib-index.json'
const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_CHUNK_LINES = 24
const DEFAULT_MAX_SESSIONS = 120
const DEFAULT_TTL_SECONDS = 120
const DEFAULT_TEXT_LIMIT = 400 * 1024
const DEFAULT_WRITE_TOOLS = ['write', 'edit', 'multi_edit']
const MAX_SCAN_ENTRIES = 20000

/**
 * Locate the host's schemastery.
 *
 * This package is normally installed as a link into the profile, so a bare
 * specifier resolves from the *real* workspace directory and misses the
 * profile's node_modules. The Host process does not guarantee DSH_PROFILE_DIR,
 * so profiles are also enumerated under $DSH_HOME.
 */
function loadSchema() {
  const require = createRequire(import.meta.url)
  const anchors = []
  const seen = new Set()

  const addAnchor = (anchor) => {
    if (!anchor || seen.has(anchor)) return
    seen.add(anchor)
    anchors.push(anchor)
  }

  const addSchemaFile = (file) => {
    try {
      if (fs.existsSync(file)) addAnchor(file)
    } catch {
      // unreadable location: skip
    }
  }

  if (process.env.DSH_PROFILE_DIR) addAnchor(path.join(process.env.DSH_PROFILE_DIR, 'noop.cjs'))

  // Any profile that has the schema installed works as a resolution anchor.
  try {
    const home = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh')
    const profilesDir = path.join(home, 'profiles')
    for (const name of fs.readdirSync(profilesDir)) {
      addAnchor(path.join(profilesDir, name, 'noop.cjs'))
    }
  } catch {
    // no profiles directory
  }

  // Host installations keep a copy next to the runner.
  const globalPrefix = process.env.DSH_GLOBAL_PREFIX
  if (globalPrefix) {
    addSchemaFile(path.join(globalPrefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
  }
  addSchemaFile(path.join(os.homedir(), '.local', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
  try {
    addSchemaFile(path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs'))
  } catch {
    // not an Electron layout
  }

  for (const anchor of anchors) {
    try {
      return createRequire(anchor)('@deepseek-ai/schemastery')
    } catch {
      // try the next anchor
    }
  }
  try {
    return require('@deepseek-ai/schemastery')
  } catch {
    return null
  }
}

/**
 * Settings-visible configuration.
 *
 * These are ordinary (non-volatile) fields on purpose: a volatile scalar is
 * replaced by a placeholder object in the resolved config, so the value a
 * patch supplies never reaches `apply`. Ordinary fields keep the declared
 * type, the defaults, and the patch value, and the same schema is what the
 * plugin row shows.
 */
export const Config = (() => {
  try {
    const Schema = loadSchema()
    if (!Schema) return undefined
    return Schema.object({
      root: Schema.string().description('扁平回退模式下的文档库目录（仅当工作区/会话服务不可用时使用）。'),
      indexFile: Schema.string().description('索引缓存文件路径。留空则写在文档库目录内的 .doclib-index.json。'),
      maxBytes: Schema.number()
        .description('单个文件参与全文索引的最大字节数，超出则只登记元数据。')
        .default(DEFAULT_MAX_BYTES),
      chunkLines: Schema.number().description('每个检索块包含的行数。').default(DEFAULT_CHUNK_LINES),
      maxSessions: Schema.number()
        .description('一次重建最多读取的会话数（按创建时间从新到旧）。')
        .default(DEFAULT_MAX_SESSIONS),
      ttlSeconds: Schema.number().description('索引多少秒后视为过期并自动重建。').default(DEFAULT_TTL_SECONDS),
      writeTools: Schema.array(Schema.string()).description('被视为「生成文档」的工具名。'),
      includeImages: Schema.boolean().description('是否把会话里粘贴的图片也登记为文档。').default(true),
      includeSubagentSessions: Schema.boolean().description('是否包含子代理会话（通常不是用户对话）。').default(false),
      includeLibraryFolder: Schema.boolean()
        .description('是否把 root 目录里不属于任何会话的文件，作为一个「本地文档目录」分组并列显示。')
        .default(true),
    })
  } catch {
    return undefined
  }
})()

const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.text', '.log', '.rst', '.adoc', '.org',
  '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.ini', '.csv', '.tsv',
  '.html', '.htm', '.xml', '.svg', '.css', '.scss',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.py', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.sql', '.go', '.rs', '.java', '.c', '.h', '.cpp',
])

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/** Split text into search tokens: ASCII words plus CJK character bigrams. */
function tokenize(text) {
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

function uniqueTokens(text) {
  return Array.from(new Set(tokenize(text)))
}

/** Cut a document into line-aligned chunks, keeping the 1-based first line. */
function chunkText(text, chunkLines) {
  const lines = String(text || '').split(/\r?\n/)
  const chunks = []
  for (let i = 0; i < lines.length; i += chunkLines) {
    const body = lines.slice(i, i + chunkLines).join('\n')
    if (body.trim()) chunks.push({ line: i + 1, text: body })
  }
  return chunks
}

function clampLimit(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

function makeSnippet(chunkText, tokens) {
  const flat = String(chunkText || '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const lower = flat.toLowerCase()
  let hit = -1
  for (const token of tokens) {
    const at = lower.indexOf(token)
    if (at >= 0 && (hit < 0 || at < hit)) hit = at
  }
  if (hit < 0) return flat.slice(0, 200)
  const start = Math.max(0, hit - 60)
  const end = Math.min(flat.length, start + 220)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

function textBlock(text) {
  return [{ type: 'text', text }]
}

/** Normalize a path for comparing a session cwd with a workspace directory. */
function cwdKey(value) {
  if (typeof value !== 'string' || !value) return ''
  let key = value.replace(/\//g, '\\').replace(/\\+$/, '')
  if (process.platform === 'win32') key = key.toLowerCase()
  return key
}

function isTextPath(name) {
  return TEXT_EXTENSIONS.has(path.extname(String(name || '')).toLowerCase())
}

function docKeyOf(...parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16)
}

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

export const inject = ['tools', 'fs']

export function apply(ctx, config = {}) {
  const workingDirectory = ctx.get('workingDirectory')
  const workspace = workingDirectory?.defaultDirectory ?? process.cwd()
  const settings = config && typeof config === 'object' ? config : {}

  const rootSetting = typeof settings.root === 'string' && settings.root.trim()
    ? settings.root.trim()
    : DEFAULT_ROOT
  const rootPath = path.isAbsolute(rootSetting) ? rootSetting : path.resolve(workspace, rootSetting)

  const indexSetting = typeof settings.indexFile === 'string' && settings.indexFile.trim()
    ? settings.indexFile.trim()
    : ''
  const indexPath = indexSetting
    ? (path.isAbsolute(indexSetting) ? indexSetting : path.resolve(workspace, indexSetting))
    : path.join(rootPath, DEFAULT_INDEX_FILE)
  // Writes are fenced by an explicit policy: the index lives beside the
  // documents, so that directory is the authority for this plugin's writes.
  const indexPolicy = { mode: 'workspace-write', workspaceRoot: path.dirname(indexPath) }

  const maxBytes = Number.isFinite(settings.maxBytes) && settings.maxBytes > 0
    ? Math.floor(settings.maxBytes)
    : DEFAULT_MAX_BYTES
  const chunkLines = Number.isFinite(settings.chunkLines) && settings.chunkLines > 0
    ? Math.floor(settings.chunkLines)
    : DEFAULT_CHUNK_LINES
  const maxSessions = Number.isFinite(settings.maxSessions) && settings.maxSessions > 0
    ? Math.floor(settings.maxSessions)
    : DEFAULT_MAX_SESSIONS
  const ttlSeconds = Number.isFinite(settings.ttlSeconds) && settings.ttlSeconds >= 0
    ? Math.floor(settings.ttlSeconds)
    : DEFAULT_TTL_SECONDS
  const writeTools = Array.isArray(settings.writeTools) && settings.writeTools.length
    ? new Set(settings.writeTools.map((value) => String(value)))
    : new Set(DEFAULT_WRITE_TOOLS)
  const includeImages = settings.includeImages !== false
  const includeSubagentSessions = settings.includeSubagentSessions === true
  const includeLibraryFolder = settings.includeLibraryFolder !== false

  // What `apply` actually received, surfaced by /status so a wrong config is
  // explainable from the panel instead of silently falling back.
  const describeValue = (value) => {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    return typeof value === 'string' ? `string:${value}` : `${typeof value}:${JSON.stringify(value)}`
  }
  const receivedConfig = {
    keys: Object.keys(settings),
    root: describeValue(settings.root),
    indexFile: describeValue(settings.indexFile),
  }

  /**
   * @type {{
   *   version: number,
   *   mode: 'sessions' | 'flat',
   *   generatedAt: number,
   *   truncated: boolean,
   *   workspaces: Array<any>,
   * }}
   */
  let index = { version: INDEX_VERSION, mode: 'sessions', generatedAt: 0, truncated: false, workspaces: [] }
  /** Every document across every workspace, for search. */
  let documentCache = []
  let searchCache = null
  let reindexRun = null
  let loadAttempted = false

  /** Optional services; absent on a bare host, so they are resolved per build. */
  function services() {
    return {
      sessionQuery: ctx.get('sessionQuery'),
      workspaceRegistry: ctx.get('workspaceRegistry'),
      attachments: ctx.get('attachments'),
    }
  }

  function summarize() {
    let sessions = 0
    let documents = 0
    let chunks = 0
    let uploads = 0
    let generated = 0
    let folder = 0
    for (const workspaceEntry of index.workspaces) {
      for (const session of workspaceEntry.sessions) {
        sessions += 1
        for (const doc of session.documents) {
          documents += 1
          chunks += doc.chunks.length
          if (doc.kind === 'generated') generated += 1
          else if (doc.kind === 'folder') folder += 1
          else uploads += 1
        }
      }
    }
    return {
      mode: index.mode,
      root: rootPath,
      indexPath,
      workspaces: index.workspaces.length,
      sessions,
      documents,
      chunks,
      uploads,
      generated,
      folder,
      truncated: index.truncated,
      lastIndexedAt: index.generatedAt || null,
      indexVersion: index.version,
      received: receivedConfig,
    }
  }

  async function loadIndex() {
    loadAttempted = true
    try {
      const target = await ctx.fs.resolve(indexPath)
      const stat = await ctx.fs.stat(target)
      if (!stat) return
      const text = await ctx.fs.readText(target)
      const parsed = JSON.parse(text)
      // A cache from another shape or root is discarded, not migrated.
      if (parsed?.version !== INDEX_VERSION || parsed?.root !== rootPath) return
      index = {
        version: INDEX_VERSION,
        mode: parsed.mode === 'flat' ? 'flat' : 'sessions',
        generatedAt: Number(parsed.generatedAt) || 0,
        truncated: Boolean(parsed.truncated),
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      }
      rebuildDocumentCache()
    } catch {
      // A missing or unreadable cache is not fatal: the index is a derivative.
    }
  }

  async function saveIndex() {
    const target = await ctx.fs.resolve(indexPath)
    await ctx.fs.writeText(
      target,
      JSON.stringify({ ...index, root: rootPath }),
      undefined,
      undefined,
      indexPolicy,
    )
  }

  function rebuildDocumentCache() {
    const documents = []
    for (const workspaceEntry of index.workspaces) {
      for (const session of workspaceEntry.sessions) {
        for (const doc of session.documents) {
          documents.push({
            ...doc,
            workspaceId: workspaceEntry.id,
            workspaceTitle: workspaceEntry.title,
            workspacePath: workspaceEntry.path,
            sessionId: session.id,
            sessionTitle: session.title,
          })
        }
      }
    }
    documentCache = documents
    searchCache = null
  }

  // ---- building the session-backed index ----------------------------------

  /** Read at most `limit` bytes of an attachment and decode it as UTF-8 text. */
  async function attachmentText(attachments, ref, limit) {
    const stream = attachments.readFileStream(ref)
    const parts = []
    let total = 0
    for await (const chunk of stream) {
      const buffer = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      parts.push(Buffer.from(buffer))
      total += buffer.length
      if (total > limit) break
    }
    return Buffer.concat(parts).subarray(0, limit).toString('utf8')
  }

  /** Pull uploaded documents out of one session's user messages. */
  function uploadedDocs(events) {
    const found = []
    const seen = new Set()
    for (const event of events) {
      if (event?.type !== 'user/message') continue
      const content = event.data?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        const attachment = block?.attachment
        if (!attachment?.attachmentId) continue
        const isImage = block.type === 'image'
        if (block.type !== 'file' && !isImage) continue
        if (isImage && !includeImages) continue
        const identity = `attachment:${attachment.attachmentId}`
        if (seen.has(identity)) continue
        seen.add(identity)
        found.push({
          kind: isImage ? 'image' : 'upload',
          identity,
          name: String(attachment.name || attachment.attachmentId),
          attachment: {
            attachmentId: String(attachment.attachmentId),
            name: String(attachment.name || ''),
            mediaType: attachment.mediaType ? String(attachment.mediaType) : undefined,
            bytes: Number(attachment.bytes) || 0,
          },
          size: Number(attachment.bytes) || 0,
          updatedAt: Number(event.time) || 0,
        })
      }
    }
    return found
  }

  /** Paths a write-like tool call touched; `apply_patch` style calls yield none. */
  function writtenPaths(name, argumentText) {
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

  /** Pull files a session wrote out of its tool calls, deduped by path. */
  function writtenDocs(events, cwd) {
    const byPath = new Map()
    for (const event of events) {
      if (event?.type !== 'tool/call') continue
      const data = event.data || {}
      for (const raw of writtenPaths(data.name, data.arguments)) {
        const absolute = path.isAbsolute(raw)
          ? path.normalize(raw)
          : path.resolve(cwd || workspace, raw)
        const key = cwdKey(absolute)
        const previous = byPath.get(key)
        // Last write wins for the timestamp; the path is the identity.
        byPath.set(key, {
          absolute,
          updatedAt: Math.max(Number(event.time) || 0, previous ? previous.updatedAt : 0),
        })
      }
    }
    return Array.from(byPath.values())
  }

  /** Read a text file into chunks, or return null when it is absent/unreadable. */
  async function readDocument(target, signal) {
    let info
    try {
      info = await ctx.fs.stat(target, signal)
    } catch {
      return null
    }
    if (!info || info.type !== 'file') return null
    const size = typeof info.size === 'number' ? info.size : 0
    if (size > maxBytes) return { size, chunks: [], lines: 0, oversized: true }
    try {
      const text = await ctx.fs.readText(target, signal)
      return {
        size: size || text.length,
        chunks: chunkText(text, chunkLines),
        lines: text ? text.split(/\r?\n/).length : 0,
        oversized: false,
      }
    } catch {
      return { size, chunks: [], lines: 0, oversized: false, unreadable: true }
    }
  }

  /**
   * Full text of one indexed document, bounded by `limit`.
   *
   * Uploads are replayed from the attachment stream (they have no filesystem
   * path), so the read is capped at `limit + 1` bytes purely to detect
   * truncation without buffering a whole spreadsheet.
   */
  async function loadDocumentText(doc, limit) {
    const cap = limit > 0 ? Math.floor(limit) : DEFAULT_TEXT_LIMIT
    try {
      if (doc.attachment) {
        const { attachments } = services()
        if (!attachments) return { text: '', truncated: false }
        const raw = await attachmentText(attachments, doc.attachment, cap + 1)
        const truncated = raw.length > cap
        return { text: truncated ? raw.slice(0, cap) : raw, truncated }
      }
      if (!doc.path) return { text: '', truncated: false }
      const target = await ctx.fs.resolve(doc.path)
      const info = await ctx.fs.stat(target)
      if (!info || info.type !== 'file') return { text: '', truncated: false }
      const text = await ctx.fs.readText(target)
      const truncated = text.length > cap
      return { text: truncated ? text.slice(0, cap) : text, truncated }
    } catch {
      return { text: '', truncated: false }
    }
  }

  /** Skip noise that would otherwise flood the library. */
  function worthwhile(relative) {
    const normalized = relative.replace(/\\/g, '/')
    if (!normalized) return false
    if (normalized.split('/').some((part) => part === '.git' || part === 'node_modules' || part === '.venv')) return false
    return true
  }

  async function buildFromSessions(signal) {
    const { sessionQuery, workspaceRegistry, attachments } = services()
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

    // Group sessions under their workspace; the registry is authoritative when
    // it exists, and any cwd that no workspace owns lands in its own bucket.
    let workspaces = []
    try {
      const listed = typeof workspaceRegistry?.list === 'function' ? workspaceRegistry.list() : []
      workspaces = (Array.isArray(listed) ? listed : []).map((entry) => ({
        id: String(entry.id ?? entry.path ?? ''),
        title: String(entry.title || baseName(entry.path || '') || '工作区'),
        path: String(entry.path || ''),
        sessions: [],
      }))
    } catch {
      workspaces = []
    }

    const byCwd = new Map()
    for (const entry of workspaces) byCwd.set(cwdKey(entry.path), entry)

    const orphan = { id: '', title: '未归属工作区', path: '', sessions: [] }

    const results = []
    for (const record of picked) {
      const header = record.header
      const cwd = typeof header.cwd === 'string' ? header.cwd : ''
      const owner = byCwd.get(cwdKey(cwd)) || orphan
      results.push({ header, cwd, owner })
    }

    // Read each log once and extract both kinds of document.
    for (const item of results) {
      const id = String(item.header.id)
      const titleEntry = titles.get(id)
      const sessionTitle = titleEntry?.title?.title
      const sessionUpdatedAt = Number(titleEntry?.title?.updatedAt) || Number(item.header.createdAt) || 0

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

      const documents = []

      for (const upload of uploadedDocs(events)) {
        const doc = {
          // The session is part of the identity: the same upload referenced from
          // two sessions is two library entries, one per session.
          key: docKeyOf(id, 'attachment', upload.attachment.attachmentId),
          name: upload.name,
          kind: upload.kind,
          ext: path.extname(upload.name).toLowerCase(),
          size: upload.size,
          lines: 0,
          updatedAt: upload.updatedAt || sessionUpdatedAt,
          attachment: upload.attachment,
          searchable: false,
          chunks: [],
        }
        if (upload.kind !== 'image' && isTextPath(upload.name) && attachments) {
          try {
            const text = await attachmentText(attachments, upload.attachment, maxBytes)
            doc.chunks = chunkText(text, chunkLines)
            doc.lines = text ? text.split(/\r?\n/).length : 0
            doc.searchable = doc.chunks.length > 0
          } catch {
            // An unreadable attachment stays listed without searchable text.
          }
        }
        documents.push(doc)
      }

      for (const written of writtenDocs(events, item.cwd)) {
        let relative = ''
        try {
          relative = item.owner.path ? path.relative(item.owner.path, written.absolute) : written.absolute
        } catch {
          relative = written.absolute
        }
        const escaped = relative.startsWith('..') || path.isAbsolute(relative)
        if (!escaped && !worthwhile(relative)) continue
        const entry = {
          key: docKeyOf(id, 'file', cwdKey(written.absolute)),
          name: baseName(written.absolute),
          kind: 'generated',
          ext: path.extname(written.absolute).toLowerCase(),
          size: 0,
          lines: 0,
          updatedAt: written.updatedAt || sessionUpdatedAt,
          path: written.absolute,
          rel: escaped ? '' : relative.replace(/\\/g, '/'),
          outsideWorkspace: escaped,
          searchable: false,
          chunks: [],
        }
        if (isTextPath(entry.name)) {
          try {
            const target = await ctx.fs.resolve(written.absolute)
            const content = await readDocument(target, signal)
            // A file the session mentioned but later deleted is not a document.
            if (!content) continue
            entry.size = content.size
            entry.lines = content.lines
            entry.chunks = content.chunks
            entry.searchable = content.chunks.length > 0
            if (content.oversized) entry.oversized = true
          } catch {
            continue
          }
        } else {
          try {
            const target = await ctx.fs.resolve(written.absolute)
            const info = await ctx.fs.stat(target, signal)
            if (!info || info.type !== 'file') continue
            entry.size = typeof info.size === 'number' ? info.size : 0
          } catch {
            continue
          }
        }
        documents.push(entry)
      }

      documents.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))

      item.owner.sessions.push({
        id,
        title: String(sessionTitle || fallbackTitle(events, id)),
        createdAt: Number(item.header.createdAt) || 0,
        updatedAt: sessionUpdatedAt,
        live: liveIds.has(id),
        error,
        documents,
      })
    }

    const buckets = workspaces.length ? workspaces : []
    if (orphan.sessions.length) buckets.push(orphan)

    // Files that no session accounts for stay visible as their own group rather
    // than silently dropping out of search when the two-level mode took over.
    if (includeLibraryFolder) {
      let folderDocs = []
      try {
        folderDocs = await scanFolderDocs(signal)
      } catch {
        folderDocs = []
      }
      if (folderDocs.length) {
        const claimed = new Set()
        for (const bucket of buckets) {
          for (const session of bucket.sessions) {
            for (const doc of session.documents) {
              if (doc.path) claimed.add(cwdKey(doc.path))
            }
          }
        }
        const unclaimed = folderDocs.filter((doc) => !claimed.has(cwdKey(doc.path)))
        if (unclaimed.length) {
          buckets.push({
            id: 'folder',
            title: '本地文档目录',
            path: rootPath,
            documents: unclaimed.length,
            sessions: [
              {
                id: 'folder',
                title: '未归档文档',
                createdAt: 0,
                updatedAt: 0,
                live: false,
                error: null,
                documents: unclaimed,
              },
            ],
          })
        }
      }
    }

    for (const entry of buckets) {
      entry.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
      entry.documents = entry.sessions.reduce((total, session) => total + session.documents.length, 0)
    }
    // Workspaces in registry order keep the sidebar's mental model; empty ones
    // still show so the tree mirrors the sidebar rather than hiding rows.
    return { mode: 'sessions', truncated, workspaces: buckets }
  }

  // ---- folder scanning (fallback mode and the unarchived bucket) -----------

  /** Recursively index the configured folder. Throws when it does not exist. */
  async function scanFolderDocs(signal) {
    const rootTarget = await ctx.fs.resolve(rootPath)
    const stat = await ctx.fs.stat(rootTarget)
    if (!stat) {
      throw new Error(
        `文档库目录不存在：${rootPath}。请把插件配置项 root 指向一个已存在的文档目录（profile 的 cordis.patch.yml 里 id: doclib 那一段）。`,
      )
    }
    if (stat.type !== 'directory') {
      throw new Error(`插件配置项 root 指向的不是目录：${rootPath}`)
    }

    const documents = []
    const queue = [{ target: rootTarget, rel: '' }]
    let next = 0
    let visited = 0

    while (next < queue.length) {
      if (visited > MAX_SCAN_ENTRIES) break
      const current = queue[next]
      next += 1
      let entries
      try {
        entries = await ctx.fs.listDir(current.target, signal)
      } catch {
        continue
      }
      for (const entry of entries) {
        visited += 1
        if (visited > MAX_SCAN_ENTRIES) break
        if (!entry?.name || entry.name.startsWith('.')) continue
        const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name
        if (entry.type === 'directory') {
          queue.push({ target: entry.target, rel })
          continue
        }
        if (entry.type !== 'file') continue
        if (!isTextPath(entry.name)) continue
        if (typeof entry.size === 'number' && entry.size > maxBytes) continue
        try {
          const text = await ctx.fs.readText(entry.target, signal)
          if (text.length > maxBytes) continue
          documents.push({
            key: docKeyOf('folder', rel),
            name: entry.name,
            kind: 'folder',
            ext: path.extname(entry.name).toLowerCase(),
            size: typeof entry.size === 'number' ? entry.size : text.length,
            lines: text ? text.split(/\r?\n/).length : 0,
            updatedAt: 0,
            path: entry.target ? String(entry.target) : '',
            rel,
            searchable: true,
            chunks: chunkText(text, chunkLines),
          })
        } catch {
          // Unreadable or non-text files are skipped rather than failing the scan.
        }
      }
    }

    documents.sort((a, b) => String(a.rel).localeCompare(String(b.rel)))
    return documents
  }

  async function scanFlat(signal) {
    const documents = await scanFolderDocs(signal)
    return {
      mode: 'flat',
      truncated: false,
      workspaces: [
        {
          id: 'flat',
          title: '文档目录',
          path: rootPath,
          documents: documents.length,
          sessions: [
            {
              id: 'flat',
              title: rootPath,
              createdAt: 0,
              updatedAt: 0,
              live: false,
              error: null,
              documents,
            },
          ],
        },
      ],
    }
  }

  // ---- rebuild ------------------------------------------------------------

  async function reindex(signal) {
    if (reindexRun) return reindexRun
    const run = (async () => {
      let built = null
      try {
        built = await buildFromSessions(signal)
      } catch {
        built = null
      }
      if (!built) built = await scanFlat(signal)
      index = {
        version: INDEX_VERSION,
        mode: built.mode,
        generatedAt: Date.now(),
        truncated: built.truncated,
        workspaces: built.workspaces,
      }
      rebuildDocumentCache()
      await saveIndex()
      return summarize()
    })()
    reindexRun = run
    try {
      return await run
    } finally {
      if (reindexRun === run) reindexRun = null
    }
  }

  async function ensureIndex(signal) {
    if (!loadAttempted) await loadIndex()
    const stale = ttlSeconds > 0 && index.generatedAt && Date.now() - index.generatedAt > ttlSeconds * 1000
    if (!index.generatedAt || stale) return reindex(signal)
    return summarize()
  }

  // ---- search -------------------------------------------------------------

  function getSearchIndex() {
    if (searchCache) return searchCache
    const documents = documentCache.filter((doc) => doc.searchable && doc.chunks.length)
    const postings = new Map()
    for (const doc of documents) {
      for (const chunk of doc.chunks) {
        const counts = new Map()
        for (const token of tokenize(chunk.text)) {
          counts.set(token, (counts.get(token) || 0) + 1)
        }
        for (const [token, n] of counts) {
          let bucket = postings.get(token)
          if (!bucket) postings.set(token, (bucket = new Map()))
          bucket.set(doc.key, (bucket.get(doc.key) || 0) + n)
        }
      }
    }
    searchCache = {
      postings,
      byKey: new Map(documents.map((doc) => [doc.key, doc])),
      total: documents.length,
    }
    return searchCache
  }

  function searchDocs(query, limit) {
    const tokens = uniqueTokens(query)
    if (!tokens.length) return { query: String(query ?? ''), results: [], total: 0 }
    const { postings, byKey, total } = getSearchIndex()
    if (!total) return { query: String(query ?? ''), results: [], total: 0 }

    const scores = new Map()
    for (const token of tokens) {
      const bucket = postings.get(token)
      if (!bucket) continue
      const idf = Math.log(1 + total / bucket.size)
      for (const [key, n] of bucket) {
        scores.set(key, (scores.get(key) || 0) + (1 + Math.log(n)) * idf)
      }
    }

    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    const results = []
    for (const [key, score] of ranked) {
      const doc = byKey.get(key)
      if (!doc) continue
      let best = null
      let bestHits = -1
      for (const chunk of doc.chunks) {
        const lower = chunk.text.toLowerCase()
        let hits = 0
        for (const token of tokens) if (lower.includes(token)) hits += 1
        if (hits > bestHits) {
          bestHits = hits
          best = chunk
        }
      }
      results.push({
        key: doc.key,
        path: doc.rel || doc.name,
        name: doc.name,
        kind: doc.kind,
        ext: doc.ext || '',
        workspace: doc.workspaceTitle,
        session: doc.sessionTitle,
        sessionId: doc.sessionId,
        score: Math.round(score * 100) / 100,
        line: best ? best.line : 1,
        snippet: best ? makeSnippet(best.text, tokens) : '',
        size: doc.size,
        updatedAt: Number(doc.updatedAt) || 0,
      })
    }
    return { query: String(query ?? ''), results, total: scores.size }
  }

  // ---- read models --------------------------------------------------------

  function documentByKey(key) {
    return documentCache.find((doc) => doc.key === key) || null
  }

  function treePayload() {
    return {
      mode: index.mode,
      generatedAt: index.generatedAt,
      truncated: index.truncated,
      workspaces: index.workspaces.map((entry) => ({
        id: entry.id,
        title: entry.title,
        path: entry.path,
        documents: entry.documents ?? 0,
        sessions: entry.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          live: session.live,
          error: session.error,
          documents: session.documents.map((doc) => ({
            key: doc.key,
            name: doc.name,
            kind: doc.kind,
            ext: doc.ext,
            size: doc.size,
            updatedAt: doc.updatedAt,
            rel: doc.rel || '',
            searchable: Boolean(doc.searchable),
            outsideWorkspace: Boolean(doc.outsideWorkspace),
            oversized: Boolean(doc.oversized),
          })),
        })),
      })),
    }
  }

  function listDocs(documents, limit) {
    const page = documents.slice(0, limit).map((doc) => ({
      path: doc.rel || doc.name,
      name: doc.name,
      kind: doc.kind,
      workspace: doc.workspaceTitle,
      session: doc.sessionTitle,
      size: doc.size,
      lines: Number(doc.lines) || 0,
    }))
    return { documents: page, total: documents.length, shown: page.length }
  }

  // ---- model-facing tools -------------------------------------------------

  const tools = [
    {
      name: 'doc_search',
      description:
        '在本地文档库中检索关键词或短语。文档库按「工作区 → 会话 → 文档」组织：文档是某个会话里用户上传或该会话生成的产物。中文按二元组匹配，英文按单词匹配；返回命中的文件、所属工作区与会话、行号和有界片段。需要看上下文或全文时，用 read 工具打开返回的路径。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词或短语；中文无需分词。' },
          limit: { type: 'number', description: '返回条数，默认 5，最大 20。' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            total: { type: 'number' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  name: { type: 'string' },
                  kind: { type: 'string' },
                  workspace: { type: 'string' },
                  session: { type: 'string' },
                  line: { type: 'number' },
                  score: { type: 'number' },
                  snippet: { type: 'string' },
                },
              },
            },
          },
        },
        render(_args, value) {
          const data = value || {}
          if (!data.results || !data.results.length) {
            return textBlock(`文档库中没有命中「${data.query ?? ''}」的文档。`)
          }
          const lines = [`文档库命中 ${data.results.length} 条（共 ${data.total} 篇相关）：`]
          for (const hit of data.results) {
            lines.push(`- ${hit.workspace} › ${hit.session} › ${hit.path}:${hit.line}（score ${hit.score}）`)
            if (hit.snippet) lines.push(`  ${hit.snippet}`)
          }
          return textBlock(lines.join('\n'))
        },
      },
      async execute(args, exec) {
        await ensureIndex(exec?.signal)
        return searchDocs(args?.query ?? '', clampLimit(args?.limit, 5, 20))
      },
    },
    {
      name: 'doc_read',
      description:
        '读取文档库中某篇文档的正文。key 取自 doc_search / doc_list 的结果，也可直接给 path（文件路径）。用 offset / maxChars 分页读取长文档；上传的附件没有路径，只能用 key 读取。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '文档 key（doc_search / doc_list 返回）。与 path 二选一。' },
          path: { type: 'string', description: '文档路径；可以是绝对路径、相对工作区路径，或 doc_search 返回的相对路径。' },
          offset: { type: 'number', description: '从第几个字符开始读，默认 0。' },
          maxChars: { type: 'number', description: '本次最多返回多少字符，默认 12000，最大 80000。' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            name: { type: 'string' },
            path: { type: 'string' },
            kind: { type: 'string' },
            totalChars: { type: 'number' },
            offset: { type: 'number' },
            text: { type: 'string' },
            truncated: { type: 'boolean' },
          },
        },
        render(_args, value) {
          const data = value || {}
          if (!data.text) {
            return textBlock(`《${data.name || data.path || '该文档'}》没有可读的文本内容（可能是二进制文件或读取失败）。`)
          }
          const head = `《${data.name || data.path}》${data.kind === 'upload' ? '（上传）' : ''} 第 ${data.offset} 字符起，共 ${data.totalChars} 字符：`
          const tail = data.truncated ? `\n\n（内容被截断，继续读取请用 offset=${data.nextOffset}）` : ''
          return textBlock(`${head}\n\n${data.text}${tail}`)
        },
      },
      async execute(args, exec) {
        await ensureIndex(exec?.signal)
        const maxChars = clampLimit(args?.maxChars, 12000, 80000)
        const offset = Number.isFinite(args?.offset) && args.offset > 0 ? Math.floor(args.offset) : 0

        let doc = null
        const key = typeof args?.key === 'string' ? args.key.trim() : ''
        if (key) {
          doc = documentByKey(key)
        } else if (typeof args?.path === 'string' && args.path.trim()) {
          const wanted = args.path.trim()
          const absolute = path.isAbsolute(wanted) ? path.normalize(wanted) : path.resolve(workspace, wanted)
          doc =
            documentCache.find((entry) => entry.path && cwdKey(entry.path) === cwdKey(absolute)) ||
            documentCache.find((entry) => (entry.rel || entry.name) === wanted.replace(/\\/g, '/')) ||
            null
        }
        if (!doc) {
          throw new Error('没有找到该文档：请先用 doc_search 或 doc_list 取到它的 key，再调用 doc_read。')
        }

        const loaded = await loadDocumentText(doc, Math.max(offset + maxChars + 1, DEFAULT_TEXT_LIMIT))
        const text = loaded.text.slice(offset, offset + maxChars)
        const totalChars = loaded.text.length
        return {
          key: doc.key,
          name: doc.name,
          path: doc.rel || doc.path || doc.name,
          kind: doc.kind,
          totalChars,
          offset,
          text,
          truncated: offset + maxChars < totalChars || (loaded.truncated && loaded.text.length <= offset + maxChars),
          nextOffset: offset + text.length,
        }
      },
    },
    {
      name: 'doc_list',
      description:
        '列出本地文档库的文档，按「工作区 → 会话」两级归属展示：每个会话下列出该会话中用户上传的文档和该会话生成的文档。可用 workspace / session 参数只看某一层。',
      parameters: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: '可选：工作区标题或路径的片段过滤。' },
          session: { type: 'string', description: '可选：会话标题的片段过滤。' },
          prefix: { type: 'string', description: '可选：文件名或相对路径的片段过滤。' },
          limit: { type: 'number', description: '返回条数，默认 30，最大 200。' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            documents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  kind: { type: 'string' },
                  workspace: { type: 'string' },
                  session: { type: 'string' },
                  lines: { type: 'number' },
                  size: { type: 'number' },
                },
              },
            },
          },
        },
        render(_args, value) {
          const data = value || {}
          if (!data.documents || !data.documents.length) return textBlock('文档库中没有符合条件的文档。')
          const lines = [`文档库共 ${data.total} 篇，显示 ${data.documents.length} 篇：`]
          let lastWorkspace = ''
          let lastSession = ''
          for (const doc of data.documents) {
            if (doc.workspace !== lastWorkspace) {
              lines.push(`【${doc.workspace}】`)
              lastWorkspace = doc.workspace
              lastSession = ''
            }
            if (doc.session !== lastSession) {
              lines.push(`  · ${doc.session}`)
              lastSession = doc.session
            }
            const kind = doc.kind === 'generated'
              ? '生成'
              : doc.kind === 'image'
                ? '图片'
                : doc.kind === 'folder'
                  ? '目录'
                  : '上传'
            lines.push(`    - [${kind}] ${doc.path}（${doc.lines} 行，${doc.size} 字节）`)
          }
          return textBlock(lines.join('\n'))
        },
      },
      async execute(args, exec) {
        await ensureIndex(exec?.signal)
        const match = (haystack, needle) =>
          !needle || String(haystack || '').toLowerCase().includes(String(needle).toLowerCase())
        let scoped = documentCache
        if (args?.workspace) scoped = scoped.filter((doc) => match(doc.workspaceTitle, args.workspace))
        if (args?.session) scoped = scoped.filter((doc) => match(doc.sessionTitle, args.session))
        if (args?.prefix) scoped = scoped.filter((doc) => match(`${doc.rel || ''} ${doc.name}`, args.prefix))
        return listDocs(scoped, clampLimit(args?.limit, 30, 200))
      },
    },
    {
      name: 'doc_status',
      description:
        '查看本地文档库的索引状态：组织结构模式（工作区→会话 或 扁平目录）、工作区数、会话数、文档数、以及上次索引时间。索引为空或过期时可据此判断是否需要重建。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
            root: { type: 'string' },
            workspaces: { type: 'number' },
            sessions: { type: 'number' },
            documents: { type: 'number' },
            chunks: { type: 'number' },
            uploads: { type: 'number' },
            generated: { type: 'number' },
            folder: { type: 'number' },
            lastIndexedAt: { type: 'string', description: 'ISO 时间，未索引时为空字符串。' },
          },
        },
        render(_args, value) {
          const data = value || {}
          const when = data.lastIndexedAt
            ? new Date(data.lastIndexedAt).toLocaleString()
            : '从未索引'
          const shape = data.mode === 'sessions' ? '工作区 → 会话 → 文档' : '扁平目录'
          const parts = [`上传 ${data.uploads}`, `生成 ${data.generated}`]
          if (data.folder) parts.push(`目录 ${data.folder}`)
          return textBlock(
            [
              `文档库结构：${shape}`,
              `根目录：${data.root}`,
              `工作区：${data.workspaces} 个 · 会话：${data.sessions} 个`,
              `文档：${data.documents} 篇（${parts.join(' / ')}）/ ${data.chunks} 个检索块`,
              `上次索引：${when}`,
            ].join('\n'),
          )
        },
      },
      async execute(_args, exec) {
        await ensureIndex(exec?.signal)
        const summary = summarize()
        return {
          mode: summary.mode,
          root: summary.root,
          workspaces: summary.workspaces,
          sessions: summary.sessions,
          documents: summary.documents,
          chunks: summary.chunks,
          uploads: summary.uploads,
          generated: summary.generated,
          folder: summary.folder,
          lastIndexedAt: summary.lastIndexedAt ? new Date(summary.lastIndexedAt).toISOString() : '',
        }
      },
    },
  ]

  for (const definition of tools) {
    ctx.effect(() => ctx.tools.register(definition))
  }

  // ---- Web panel endpoint -------------------------------------------------

  // Optional: the carrier may mount after this plugin activates, so the route
  // is registered whenever the service appears instead of being probed once.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    const handler = async (req, res) => {
      // This route is not behind the carrier's page authentication, so refuse
      // cross-site browser requests. The Desktop shell serves its page from a
      // custom scheme (`dsh-app://app`), whose origin has no host to compare —
      // those requests are admitted and cross-site ones are caught by
      // `sec-fetch-site` and by an http(s) origin whose host differs.
      if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
        json(res, 403, { error: '跨站请求被拒绝' })
        return
      }
      const origin = req.headers?.origin
      if (typeof origin === 'string' && /^https?:\/\//i.test(origin)) {
        const host = req.headers?.host
        let sameOrigin = false
        try {
          sameOrigin = typeof host === 'string' && new URL(origin).host === host
        } catch {
          sameOrigin = false
        }
        if (!sameOrigin) {
          json(res, 403, { error: '跨站请求被拒绝' })
          return
        }
      }
      const url = new URL(req.url || '/doclib', 'http://localhost')
      let route = url.pathname
      if (route.startsWith('/doclib')) route = route.slice('/doclib'.length) || '/'
      if (!route.startsWith('/')) route = `/${route}`
      try {
        if (route === '/status') {
          // Diagnostics stay available even when the configured root is unusable,
          // so the panel can explain the problem instead of showing bare 500s.
          let failure = null
          try {
            await ensureIndex()
          } catch (error) {
            failure = error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error)
          }
          json(res, 200, {
            ...summarize(),
            building: Boolean(reindexRun),
            error: failure,
          })
          return
        }
        if (route === '/tree') {
          await ensureIndex()
          json(res, 200, treePayload())
          return
        }
        if (route === '/search') {
          await ensureIndex()
          const query = url.searchParams.get('q') || ''
          const limit = clampLimit(url.searchParams.get('limit'), 20, 50)
          json(res, 200, searchDocs(query, limit))
          return
        }
        if (route === '/doc') {
          await ensureIndex()
          const key = url.searchParams.get('key') || ''
          const doc = documentByKey(key)
          if (!doc) {
            json(res, 404, { error: '文档不在索引中' })
            return
          }
          json(res, 200, {
            key: doc.key,
            name: doc.name,
            kind: doc.kind,
            size: doc.size,
            updatedAt: doc.updatedAt,
            workspace: doc.workspaceTitle,
            session: doc.sessionTitle,
            rel: doc.rel || '',
            path: doc.path || '',
            searchable: Boolean(doc.searchable),
            oversized: Boolean(doc.oversized),
            chunks: doc.chunks.slice(0, 40),
            more: doc.chunks.length > 40,
          })
          return
        }
        if (route === '/raw') {
          await ensureIndex()
          const { attachments } = services()
          const key = url.searchParams.get('key') || ''
          const doc = documentByKey(key)
          if (!doc) {
            json(res, 404, { error: '文档不在索引中' })
            return
          }
          if (doc.attachment && attachments) {
            const stream = attachments.readFileStream(doc.attachment)
            const parts = []
            let total = 0
            const cap = Math.max(maxBytes, 8 * 1024 * 1024)
            for await (const chunk of stream) {
              const buffer = Buffer.from(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
              parts.push(buffer)
              total += buffer.length
              if (total > cap) break
            }
            res.statusCode = 200
            res.setHeader('content-type', doc.attachment.mediaType || 'application/octet-stream')
            res.setHeader('cache-control', 'no-store')
            res.end(Buffer.concat(parts))
            return
          }
          json(res, 404, { error: '该文档没有可直接读取的原始内容' })
          return
        }
        if (route === '/text') {
          await ensureIndex()
          const key = url.searchParams.get('key') || ''
          const doc = documentByKey(key)
          if (!doc) {
            json(res, 404, { error: '文档不在索引中' })
            return
          }
          const cap = clampLimit(url.searchParams.get('maxChars'), DEFAULT_TEXT_LIMIT, 800 * 1024)
          const loaded = await loadDocumentText(doc, cap)
          json(res, 200, {
            key: doc.key,
            name: doc.name,
            rel: doc.rel || '',
            path: doc.path || '',
            kind: doc.kind,
            ext: doc.ext,
            size: doc.size,
            lines: doc.lines,
            updatedAt: doc.updatedAt,
            oversized: Boolean(doc.oversized),
            searchable: Boolean(doc.searchable),
            truncated: loaded.truncated,
            text: loaded.text,
          })
          return
        }
        if (route === '/reindex' && req.method === 'POST') {
          const summary = await reindex()
          json(res, 200, summary)
          return
        }
        json(res, 404, { error: `未知接口：${route}` })
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error)
        json(res, 500, { error: message })
      }
    }

    webCtx.effect(() => webServer.register({ kind: 'prefix', path: '/doclib', handler }))
  })

  // Warm the index in the background; failures surface on first use.
  ctx.effect(() => {
    let alive = true
    Promise.resolve()
      .then(() => loadIndex())
      .then(() => {
        if (alive && !index.generatedAt) return reindex()
        return undefined
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  })
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}
