/**
 * The only aggregation point.
 *
 * `search/`, the HTTP routes and the client all consume this view; none of them
 * may merge records again. A document appears exactly once: under the session
 * that produced it most recently, carrying `sessionIds` for every other
 * producer.
 */
import { absOfPathKey, parsePathKey, relOfPathKey } from '../shared/pathKey.js'

/**
 * Build the runtime view: a flat document list plus the workspace/session tree
 * the panel renders. Both come from the same records, so their counts cannot
 * disagree.
 */
export function buildRuntimeView(index, { rootPath } = {}) {
  const workspacesSource = Array.isArray(index?.workspaces) ? index.workspaces : []
  const docs = index?.docs && typeof index.docs === 'object' ? index.docs : {}

  const views = []
  const byPathKey = new Map()
  const workspaces = []
  const seen = new Set()

  for (const workspace of workspacesSource) {
    const workspaceView = {
      id: workspace.id,
      title: workspace.title,
      path: workspace.path || '',
      documents: 0,
      sessions: [],
    }
    for (const session of workspace.sessions || []) {
      const sessionView = {
        id: session.id,
        title: session.title,
        createdAt: Number(session.createdAt) || 0,
        updatedAt: Number(session.updatedAt) || 0,
        live: Boolean(session.live),
        error: session.error || null,
        documents: [],
      }
      for (const key of Array.isArray(session.documents) ? session.documents : []) {
        const record = docs[key]
        if (!record || seen.has(key)) continue
        seen.add(key)
        const view = byPathKey.get(key) || {
          ...record,
          key,
          pathKey: key,
          rel: record.rel || relOfPathKey(key),
          sessionIds: Array.isArray(record.sessionIds) ? record.sessionIds : [],
          sessionCount: Array.isArray(record.sessionIds) ? record.sessionIds.length : 0,
          workspaceId: workspace.id,
          workspaceTitle: workspace.title,
          workspacePath: workspace.path || '',
          sessionId: String(session.id),
          sessionTitle: session.title,
          abs: absOfPathKey(key, {
            rootPath,
            workspaces: workspacesSource,
          }),
        }
        byPathKey.set(key, view)
        sessionView.documents.push(view)
        views.push(view)
      }
      workspaceView.documents += sessionView.documents.length
      workspaceView.sessions.push(sessionView)
    }
    workspaces.push(workspaceView)
  }

  // A document that no session lists would be invisible in the panel; keep it
  // reachable from the flat list so search and the tree cannot diverge.
  for (const [key, record] of Object.entries(docs)) {
    if (byPathKey.has(key)) continue
    const parsed = parsePathKey(key)
    const view = {
      ...record,
      key,
      pathKey: key,
      rel: record.rel || relOfPathKey(key),
      sessionIds: Array.isArray(record.sessionIds) ? record.sessionIds : [],
      sessionCount: Array.isArray(record.sessionIds) ? record.sessionIds.length : 0,
      workspaceId: parsed?.workspaceId || '',
      workspaceTitle: '',
      workspacePath: '',
      sessionId: '',
      sessionTitle: '',
      abs: absOfPathKey(key, { rootPath, workspaces: workspacesSource }),
    }
    byPathKey.set(key, view)
    views.push(view)
  }

  return { documents: views, byPathKey, workspaces }
}

/** Minimal tree payload; the client renders exactly these fields. */
export function treePayload(view, { mode, generatedAt, truncated } = {}) {
  return {
    mode,
    generatedAt,
    truncated: Boolean(truncated),
    workspaces: (view?.workspaces || []).map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      documents: workspace.documents,
      sessions: workspace.sessions.map((session) => ({
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
          typeClass: doc.typeClass,
          ext: doc.ext,
          size: doc.size,
          updatedAt: doc.updatedAt,
          rel: doc.rel || '',
          searchable: Boolean(doc.searchable),
          outsideWorkspace: Boolean(doc.outsideWorkspace),
          oversized: Boolean(doc.oversized),
          sessionCount: doc.sessionCount,
        })),
      })),
    })),
  }
}
