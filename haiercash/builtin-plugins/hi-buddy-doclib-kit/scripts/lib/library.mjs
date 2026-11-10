/**
 * Script-side composition of the production modules.
 *
 * The scripts deliberately import the real `index/`, `search/`, and `store/`
 * code so an eval result describes shipped behavior, not a re-implementation.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildRuntimeView } from '../../index/aggregate.js'
import { createIndexBuilder } from '../../index/build-index.js'
import { buildPostings } from '../../search/postings.js'
import { searchDocuments } from '../../search/rank.js'
import { createFolderSource } from '../../sources/folder-source.js'
import { createChunkStore } from '../../store/chunk-store.js'
import { createContextStore } from '../../store/context-store.js'
import { createIndexStore } from '../../store/index-store.js'
import { typeClassOf } from '../../shared/typeClass.js'
import { createNodeFsPort } from './node-fs-port.mjs'

const silent = { info() {}, warn() {} }

export function openLibrary({
  root,
  indexPath = path.join(root, '.doclib-index.json'),
  chunkDir = path.join(root, '.doclib', 'chunks'),
  contextPath = path.join(root, '.doclib', 'context.jsonl'),
  maxBytes = 256 * 1024,
  chunkLines = 24,
  workspaces = [],
  logger = silent,
  onReadText,
} = {}) {
  const fs = createNodeFsPort({ onReadText })
  const indexStore = createIndexStore({
    fs,
    indexPath,
    policy: { mode: 'workspace-write', workspaceRoot: path.dirname(indexPath) },
    contextPath,
    rootPath: root,
    logger,
  })
  const chunkStore = createChunkStore({
    fs,
    directory: chunkDir,
    policy: { mode: 'workspace-write', workspaceRoot: root },
    logger,
  })
  const contextStore = createContextStore({
    fs,
    filePath: contextPath,
    policy: { mode: 'workspace-write', workspaceRoot: root },
    logger,
  })
  const builder = createIndexBuilder({
    fs,
    chunkStore,
    rootPath: root,
    maxBytes,
    chunkLines,
    readAttachment: async () => '',
    logger,
  })
  const folderSource = createFolderSource({ fs, rootPath: root, maxBytes, workspaces: () => workspaces })

  return {
    fs,
    indexStore,
    chunkStore,
    contextStore,
    builder,
    folderSource,
    async load() {
      return indexStore.read()
    },
    async build(options = {}) {
      const result = await builder.build({ folderSource, ...options })
      return result
    },
  }
}

/** Flatten a v2 index into the corpus shape, keeping its inline chunks. */
export function legacyCorpus(raw) {
  const documents = []
  const chunks = new Map()
  for (const workspace of raw?.workspaces || []) {
    for (const session of workspace?.sessions || []) {
      for (const doc of session?.documents || []) {
        const key = String(doc.key || `${workspace.id}/${session.id}/${doc.rel || doc.name}`)
        documents.push({
          pathKey: key,
          key,
          rel: String(doc.rel || ''),
          name: String(doc.name || ''),
          kind: doc.kind,
          ext: doc.ext || '',
          typeClass: typeClassOf(doc.name),
          size: Number(doc.size) || 0,
          updatedAt: Number(doc.updatedAt) || 0,
          searchable: Boolean(doc.searchable),
          chunkCount: Array.isArray(doc.chunks) ? doc.chunks.length : 0,
          sessionIds: [String(session.id)],
          sessionCount: 1,
          workspaceTitle: String(workspace.title || workspace.id || ''),
          sessionTitle: String(session.title || session.id || ''),
          sessionId: String(session.id || ''),
        })
        chunks.set(key, Array.isArray(doc.chunks) ? doc.chunks : [])
      }
    }
  }
  return { documents, chunks }
}

/** Hydrate a v3 index into the same corpus shape, reading chunk shards. */
export async function indexCorpus(index, chunkStore, { rootPath } = {}) {
  const view = buildRuntimeView(index, { rootPath })
  const chunks = new Map()
  for (const doc of view.documents) {
    if (!doc.contentHash) continue
    const payload = await chunkStore.read(doc.contentHash)
    if (payload) chunks.set(doc.key, payload.chunks)
  }
  return { documents: view.documents, chunks, view }
}

/**
 * Load a corpus from an index file, or build a throwaway one when the cache is
 * absent. The throwaway index lives in the OS temp directory so an eval run
 * never writes into the corpus it measures.
 */
export async function corpusAt({ root, indexPath = path.join(root, '.doclib-index.json') } = {}) {
  let raw = null
  try {
    raw = JSON.parse(await fs.readFile(indexPath, 'utf8'))
  } catch {
    raw = null
  }

  if (raw?.version === 2) return { corpus: legacyCorpus(raw), shape: 'v2' }
  if (raw?.version === 3) {
    const library = openLibrary({ root, indexPath })
    const loaded = await library.load()
    if (!loaded.index) throw new Error(`unreadable index: ${indexPath}`)
    return { corpus: await indexCorpus(loaded.index, library.chunkStore, { rootPath: root }), shape: 'v3' }
  }

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'doclib-corpus-'))
  const library = openLibrary({
    root,
    indexPath: path.join(temp, 'index.json'),
    chunkDir: path.join(temp, 'chunks'),
    contextPath: path.join(temp, 'context.jsonl'),
  })
  const built = await library.build({ sessionSource: null })
  return {
    corpus: await indexCorpus(built.index, library.chunkStore, { rootPath: root }),
    shape: 'v3-built',
  }
}

/** Prepare a query runner over one corpus; postings are built once. */
export function prepareSearch(corpus) {
  const { postings, byPathKey } = buildPostings(corpus.documents, (key) => corpus.chunks.get(key) || [])
  return (query, limit, { includeCode = true } = {}) => searchDocuments({
    query,
    limit,
    postings,
    byPathKey,
    chunksOf: (key) => corpus.chunks.get(key) || [],
    visible: (doc) => includeCode || doc.typeClass !== 'code',
  })
}
