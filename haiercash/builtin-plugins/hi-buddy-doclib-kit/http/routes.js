/**
 * The panel's HTTP surface: seven routes the client already calls, plus the
 * context reverse lookup that has no model-facing tool.
 */
import { clampLimit } from '../shared/text.js'
import { json } from './json.js'

const DEFAULT_TEXT_LIMIT = 400 * 1024

/** Reject cross-site browser requests; this route has no page authentication. */
function crossSite(req) {
  if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return true
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || !/^https?:\/\//i.test(origin)) return false
  const host = req.headers?.host
  try {
    return !(typeof host === 'string' && new URL(origin).host === host)
  } catch {
    return true
  }
}

export function createDoclibHandler({
  ensureIndex,
  summarize,
  isBuilding,
  treePayload,
  searchDocs,
  documentByKey,
  documentChunks,
  loadDocumentText,
  reindex,
  contextFor,
  attachmentsOf,
  maxBytes,
}) {
  return async function handler(req, res) {
    // The Desktop shell serves its page from a custom scheme (`dsh-app://app`),
    // whose origin has no host to compare — those requests are admitted and
    // cross-site ones are caught by `sec-fetch-site`.
    if (crossSite(req)) {
      json(res, 403, { error: '跨站请求被拒绝' })
      return
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
        json(res, 200, { ...summarize(), building: isBuilding(), error: failure })
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
        json(res, 200, await searchDocs(query, limit))
        return
      }

      if (route === '/doc') {
        await ensureIndex()
        const doc = documentByKey(url.searchParams.get('key') || '')
        if (!doc) {
          json(res, 404, { error: '文档不在索引中' })
          return
        }
        const { chunks, more } = await documentChunks(doc)
        json(res, 200, {
          key: doc.key,
          name: doc.name,
          kind: doc.kind,
          typeClass: doc.typeClass,
          size: doc.size,
          updatedAt: doc.updatedAt,
          workspace: doc.workspaceTitle,
          session: doc.sessionTitle,
          rel: doc.rel || '',
          path: doc.abs || '',
          searchable: Boolean(doc.searchable),
          oversized: Boolean(doc.oversized),
          refs: Array.isArray(doc.refs) ? doc.refs : [],
          chunks: chunks.slice(0, 40),
          more: more || chunks.length > 40,
        })
        return
      }

      if (route === '/raw') {
        await ensureIndex()
        const attachments = attachmentsOf()
        const doc = documentByKey(url.searchParams.get('key') || '')
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
        const doc = documentByKey(url.searchParams.get('key') || '')
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
          path: doc.abs || '',
          kind: doc.kind,
          typeClass: doc.typeClass,
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

      if (route === '/context') {
        await ensureIndex()
        const pathKey = url.searchParams.get('pathKey') || ''
        if (!pathKey) {
          json(res, 400, { error: '缺少 pathKey' })
          return
        }
        json(res, 200, { pathKey, events: await contextFor(pathKey) })
        return
      }

      if (route === '/reindex' && req.method === 'POST') {
        json(res, 200, await reindex())
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
}
