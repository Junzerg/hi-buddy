/**
 * Host half of the local document library — assembly only.
 *
 * A document's identity is its location (`pathKey`), its version is its
 * content hash, and its provenance is an array of sessions. The index keeps
 * metadata, chunk text lives in content-addressed shards, and the context log
 * records facts that must survive every rebuild.
 *
 * Where the data comes from (all optional at runtime, resolved lazily so a
 * service that mounts late is still picked up):
 *   - ctx.workspaceRegistry : durable workspaces (id / title / path / sessionIds)
 *   - ctx.sessionQuery      : session headers, titles and full event logs
 *   - ctx.attachments       : bytes of files the user uploaded into a session
 *   - ctx.fs                : text of files a session wrote into its workspace
 *
 * When none of those services is present the plugin falls back to the flat
 * folder scan configured by `root`, so it still works on a bare host.
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { comparablePath } from './shared/pathKey.js'
import { isVisiblyDefault } from './shared/typeClass.js'
import { buildRuntimeView, treePayload as treePayloadOf } from './index/aggregate.js'
import { createIndexBuilder } from './index/build-index.js'
import { installDirtyTracking } from './index/dirty.js'
import { resolveDocumentRef } from './index/lookup.js'
import { buildPostings } from './search/postings.js'
import { searchDocuments } from './search/rank.js'
import { readAttachmentText } from './sources/attachment-source.js'
import { createFolderSource } from './sources/folder-source.js'
import { createSessionSource } from './sources/session-source.js'
import { createChunkStore } from './store/chunk-store.js'
import { createContextStore } from './store/context-store.js'
import { createIndexStore, INDEX_VERSION } from './store/index-store.js'
import { createTools } from './tools/index.js'
import { createDoclibHandler } from './http/routes.js'

const DEFAULT_ROOT = 'docs'
const DEFAULT_INDEX_FILE = '.doclib-index.json'
const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_CHUNK_LINES = 24
const DEFAULT_MAX_SESSIONS = 120
// 0: freshness comes from write intents and fingerprints, not from a clock.
const DEFAULT_TTL_SECONDS = 0
const DEFAULT_TEXT_LIMIT = 400 * 1024
const DEFAULT_WRITE_TOOLS = ['write', 'edit', 'multi_edit']
const STORE_DIRECTORY = '.doclib'

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
 * patch supplies never reaches `apply`.
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
      ttlSeconds: Schema.number()
        .description('索引多少秒后视为过期并自动重建；0 表示只按写事件与文件指纹失效。')
        .default(DEFAULT_TTL_SECONDS),
      writeTools: Schema.array(Schema.string()).description('被视为「生成文档」的工具名。'),
      includeImages: Schema.boolean().description('是否把会话里粘贴的图片也登记为文档。').default(true),
      includeSubagentSessions: Schema.boolean().description('是否包含子代理会话（通常不是用户对话）。').default(false),
      includeLibraryFolder: Schema.boolean()
        .description('是否把 root 目录里不属于任何会话的文件，作为一个「本地文档目录」分组并列显示。')
        .default(true),
      includeCode: Schema.boolean()
        .description('检索是否包含源码类文档（默认隐藏，避免源码稀释资料）。')
        .default(false),
    })
  } catch {
    return undefined
  }
})()

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

  const storeDir = path.join(rootPath, STORE_DIRECTORY)
  const chunkDir = path.join(storeDir, 'chunks')
  const contextPath = path.join(storeDir, 'context.jsonl')

  // Writes are fenced by an explicit policy. The index may live outside the
  // library root when `indexFile` says so, so each destination gets its own.
  const indexPolicy = { mode: 'workspace-write', workspaceRoot: path.dirname(indexPath) }
  const dataPolicy = { mode: 'workspace-write', workspaceRoot: rootPath }

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
  const includeCode = settings.includeCode === true

  const logger = ctx.logger

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

  let index = {
    version: INDEX_VERSION,
    mode: 'sessions',
    generatedAt: 0,
    truncated: false,
    root: rootPath,
    workspaces: [],
    docs: {},
  }
  let runtime = buildRuntimeView(index, { rootPath })
  let searchCache = null
  let repairTimer = null
  let reindexRun = null
  let loadAttempted = false
  let migratedIndex = false

  const indexStore = createIndexStore({
    fs: ctx.fs,
    indexPath,
    policy: indexPolicy,
    contextPath,
    rootPath,
    logger,
  })
  const chunkStore = createChunkStore({ fs: ctx.fs, directory: chunkDir, policy: dataPolicy, logger })
  const contextStore = createContextStore({ fs: ctx.fs, filePath: contextPath, policy: dataPolicy, logger })

  const builder = createIndexBuilder({
    fs: ctx.fs,
    chunkStore,
    rootPath,
    maxBytes,
    chunkLines,
    readAttachment: (attachment, limit) => {
      const attachments = services().attachments
      if (!attachments) return Promise.resolve('')
      return readAttachmentText(attachments, attachment, limit)
    },
    logger,
  })

  /** Optional services; absent on a bare host, so they are resolved per build. */
  function services() {
    return {
      sessionQuery: ctx.get('sessionQuery'),
      workspaceRegistry: ctx.get('workspaceRegistry'),
      attachments: ctx.get('attachments'),
    }
  }

  /** Registry snapshot in its own order; used before an index exists. */
  function registryWorkspaces() {
    try {
      const registry = ctx.get('workspaceRegistry')
      const listed = typeof registry?.list === 'function' ? registry.list() : []
      return (Array.isArray(listed) ? listed : []).map((entry) => ({
        id: String(entry.id ?? entry.path ?? ''),
        title: String(entry.title || ''),
        path: String(entry.path || ''),
      }))
    } catch {
      return []
    }
  }

  /** Workspaces for path identity: the index is authoritative once built. */
  function workspacesFor() {
    const fromIndex = (index.workspaces || [])
      .filter((entry) => entry.id && entry.path && entry.id !== 'folder' && entry.id !== 'flat')
      .map((entry) => ({ id: entry.id, title: entry.title, path: entry.path }))
    return fromIndex.length ? fromIndex : registryWorkspaces()
  }

  function refreshRuntime() {
    runtime = buildRuntimeView(index, { rootPath })
    searchCache = null
  }

  async function loadIndex() {
    if (loadAttempted) return
    loadAttempted = true
    try {
      const loaded = await indexStore.read()
      if (loaded.index) {
        index = loaded.index
        migratedIndex = loaded.migrated
      }
    } catch (error) {
      logger?.warn?.(`doclib: index load failed: ${String(error)}`)
    }
    refreshRuntime()
  }

  function summarize() {
    let sessions = 0
    let chunks = 0
    let uploads = 0
    let generated = 0
    let folder = 0
    const documents = runtime.documents.length
    for (const doc of runtime.documents) {
      chunks += Number(doc.chunkCount) || 0
      if (doc.kind === 'generated') generated += 1
      else if (doc.kind === 'folder') folder += 1
      else uploads += 1
    }
    for (const workspace of runtime.workspaces) sessions += workspace.sessions.length
    return {
      mode: index.mode,
      root: rootPath,
      indexPath,
      workspaces: runtime.workspaces.length,
      sessions,
      documents,
      chunks,
      uploads,
      generated,
      folder,
      truncated: index.truncated,
      lastIndexedAt: index.generatedAt || null,
      indexVersion: index.version,
      contextFile: contextPath,
      received: receivedConfig,
    }
  }

  async function reindex(options = {}) {
    if (reindexRun) return reindexRun
    const run = (async () => {
      const { sessionQuery, workspaceRegistry } = services()
      const sessionSource = sessionQuery
        ? createSessionSource({
            sessionQuery,
            workspaceRegistry,
            writeTools,
            includeImages,
            includeSubagentSessions,
            maxSessions,
            fallbackCwd: workspace,
            rootPath,
          })
        : null
      const folderSource = createFolderSource({
        fs: ctx.fs,
        rootPath,
        maxBytes,
        workspaces: workspacesFor,
      })

      const result = await builder.build({
        sessionSource,
        folderSource,
        includeFolder: includeLibraryFolder,
        previous: index,
        dirtyPaths: options.dirtyPaths ?? null,
        signal: options.signal,
        now: Date.now(),
      })

      index = result.index
      migratedIndex = false
      await indexStore.write(index)

      // Facts, not derivations: a document entering the library is recorded
      // once and never rewritten.
      if (result.stats.added.length) {
        await contextStore.appendMany(result.stats.added.map((pathKey) => ({
          type: 'captured',
          pathKey,
          sessionId: index.docs[pathKey]?.sessionIds?.[0] || '',
          actor: 'system',
          detail: { kind: index.docs[pathKey]?.kind || '' },
        })))
      }

      refreshRuntime()
      logger?.info?.(
        `doclib: indexed ${Object.keys(index.docs).length} docs (reused ${result.stats.reused}, read ${result.stats.reread}, shards ${result.stats.shards}, ${result.stats.durationMs}ms)`,
      )
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
    if (!index.generatedAt) return reindex({ signal })
    const stale = ttlSeconds > 0 && Date.now() - index.generatedAt > ttlSeconds * 1000
    if (stale) return reindex({ signal })
    return summarize()
  }

  // ---- search over lazily hydrated chunks ---------------------------------

  const repairPending = new Set()
  let repairFull = false

  function scheduleChunkRepair(docs) {
    // Accumulate every missing shard; an upload has no path, so it can only be
    // repaired by a full pass. Dropping a batch would leave that document
    // permanently unsearchable.
    for (const doc of docs) {
      if (doc.abs) repairPending.add(comparablePath(doc.abs))
      else repairFull = true
    }
    if (repairTimer) return
    if (!repairPending.size && !repairFull) return
    repairTimer = setTimeout(() => {
      repairTimer = null
      const dirty = new Set(repairPending)
      const full = repairFull
      repairPending.clear()
      repairFull = false
      reindex(full ? {} : { dirtyPaths: dirty }).catch((error) => {
        logger?.warn?.(`doclib: chunk repair failed: ${String(error)}`)
      })
    }, 1000)
    repairTimer.unref?.()
  }

  async function ensureSearch() {
    if (searchCache && searchCache.generatedAt === index.generatedAt) return searchCache
    const documents = runtime.documents.filter((doc) => doc.searchable && doc.chunkCount > 0)
    const chunks = new Map()
    const missing = []
    for (const doc of documents) {
      const payload = doc.contentHash ? await chunkStore.read(doc.contentHash) : null
      if (!payload) {
        missing.push(doc)
        continue
      }
      chunks.set(doc.key, payload.chunks)
    }
    const { postings, byPathKey } = buildPostings(documents, (key) => chunks.get(key) || [])
    searchCache = { generatedAt: index.generatedAt, postings, byPathKey, chunks }
    if (missing.length) {
      logger?.warn?.(`doclib: ${missing.length} documents lost their chunk shard; scheduling a re-read`)
      scheduleChunkRepair(missing)
    }
    return searchCache
  }

  async function searchDocs(query, limit) {
    const cache = await ensureSearch()
    return searchDocuments({
      query,
      limit,
      postings: cache.postings,
      byPathKey: cache.byPathKey,
      chunksOf: (key) => cache.chunks.get(key) || [],
      // Admission is a read-time decision: the document stays reachable by
      // key, it just does not crowd out prose in default search.
      visible: (doc) => includeCode || isVisiblyDefault(doc.typeClass),
    })
  }

  // ---- read models --------------------------------------------------------

  function documentByKey(key) {
    return runtime.byPathKey.get(String(key || '')) || null
  }

  /** Resolve a model-supplied path to a document, normalizing to its key. */
  function documentByRef({ key, path: wanted } = {}) {
    return resolveDocumentRef({
      key,
      path: wanted,
      byPathKey: runtime.byPathKey,
      documents: runtime.documents,
      workspaces: workspacesFor(),
      rootPath,
      cwd: workspace,
    })
  }

  function listDocuments({ workspace: workspaceFilter, session: sessionFilter, prefix, limit } = {}) {
    const match = (haystack, needle) =>
      !needle || String(haystack || '').toLowerCase().includes(String(needle).toLowerCase())
    let scoped = runtime.documents
    if (workspaceFilter) scoped = scoped.filter((doc) => match(doc.workspaceTitle, workspaceFilter))
    if (sessionFilter) scoped = scoped.filter((doc) => match(doc.sessionTitle, sessionFilter))
    if (prefix) scoped = scoped.filter((doc) => match(`${doc.rel || ''} ${doc.name}`, prefix))
    const page = scoped.slice(0, limit).map((doc) => ({
      path: doc.rel || doc.name,
      name: doc.name,
      kind: doc.kind,
      workspace: doc.workspaceTitle,
      session: doc.sessionTitle,
      size: doc.size,
      lines: Number(doc.lines) || 0,
    }))
    return { documents: page, total: scoped.length, shown: page.length }
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
        const raw = await readAttachmentText(attachments, doc.attachment, cap + 1)
        const truncated = raw.length > cap
        return { text: truncated ? raw.slice(0, cap) : raw, truncated }
      }
      if (!doc.abs) return { text: '', truncated: false }
      const target = await ctx.fs.resolve(doc.abs)
      const info = await ctx.fs.stat(target)
      if (!info || info.type !== 'file') return { text: '', truncated: false }
      const text = await ctx.fs.readText(target)
      const truncated = text.length > cap
      return { text: truncated ? text.slice(0, cap) : text, truncated }
    } catch {
      return { text: '', truncated: false }
    }
  }

  async function documentChunks(doc) {
    if (!doc.contentHash) return { chunks: [], more: false }
    const payload = await chunkStore.read(doc.contentHash)
    const chunks = payload?.chunks || []
    return { chunks, more: chunks.length > 40 }
  }

  function recordRead(doc, detail = {}) {
    const sessionId = detail.sessionId ? String(detail.sessionId) : ''
    void contextStore.append({
      type: 'read',
      pathKey: doc.key,
      sessionId,
      actor: sessionId ? 'agent' : 'system',
      detail: { offset: Number(detail.offset) || 0 },
    }).catch((error) => {
      logger?.warn?.(`doclib: context append failed: ${String(error)}`)
    })
  }

  function treePayload() {
    return treePayloadOf(runtime, {
      mode: index.mode,
      generatedAt: index.generatedAt,
      truncated: index.truncated,
    })
  }

  // ---- model-facing tools -------------------------------------------------

  const tools = createTools({
    ensureIndex,
    searchDocs,
    documentByRef,
    loadDocumentText,
    recordRead,
    listDocuments,
    summarize,
  })
  for (const definition of tools) {
    ctx.effect(() => ctx.tools.register(definition))
  }

  // ---- write intents mark documents dirty ---------------------------------

  const dirtyWatcher = installDirtyTracking({
    ctx,
    fs: ctx.fs,
    roots: () => [rootPath, ...workspacesFor().map((entry) => entry.path)],
    ignored: () => [storeDir, indexPath],
    onChange: (dirty) => {
      reindex({ dirtyPaths: dirty }).catch((error) => {
        logger?.warn?.(`doclib: incremental rebuild failed: ${String(error)}`)
      })
    },
    logger,
  })
  ctx.effect(() => () => dirtyWatcher.dispose())

  // ---- Web panel endpoint -------------------------------------------------

  // Optional: the carrier may mount after this plugin activates, so the route
  // is registered whenever the service appears instead of being probed once.
  ctx.inject(['webServer'], (webCtx) => {
    const handler = createDoclibHandler({
      ensureIndex: () => ensureIndex(),
      summarize,
      isBuilding: () => Boolean(reindexRun),
      treePayload,
      searchDocs,
      documentByKey,
      documentChunks,
      loadDocumentText,
      reindex: () => reindex(),
      contextFor: (pathKey) => contextStore.documentContext(pathKey),
      attachmentsOf: () => services().attachments,
      maxBytes,
    })
    webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: '/doclib', handler }))
  })

  // Warm the index in the background; failures surface on first use.
  ctx.effect(() => {
    let alive = true
    Promise.resolve()
      .then(() => loadIndex())
      .then(() => {
        if (!alive) return undefined
        // A migrated v2 index is readable but has no chunk shards yet.
        if (!index.generatedAt || migratedIndex) return reindex()
        return undefined
      })
      .catch((error) => {
        logger?.warn?.(`doclib: warm-up failed: ${String(error)}`)
      })
    return () => {
      alive = false
    }
  })
}
