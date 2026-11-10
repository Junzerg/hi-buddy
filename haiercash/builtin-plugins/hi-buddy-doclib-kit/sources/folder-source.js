/**
 * Folder source: a recursive scan of the configured root.
 *
 * This is the fallback index on a bare host and the "unarchived documents"
 * bucket when sessions exist. The absolute path is derived from
 * `path.resolve(rootPath, rel)`; the previous version stored `String(entry.target)`,
 * which is a filesystem handle object and became `"[object Object]"` for every
 * scanned document.
 */
import path from 'node:path'
import { isInside, pathKeyOf, relativeWithin } from '../shared/pathKey.js'
import { isTextPath, typeClassOf } from '../shared/typeClass.js'

const MAX_SCAN_ENTRIES = 20000
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', '.doclib'])

export function createFolderSource({ fs, rootPath, maxBytes, workspaces = () => [] }) {
  /** Recursively index the configured folder. Throws when it does not exist. */
  async function collect({ signal, skip, workspaces: callWorkspaces } = {}) {
    const rootTarget = await fs.resolve(rootPath)
    const stat = await fs.stat(rootTarget)
    if (!stat) {
      throw new Error(
        `文档库目录不存在：${rootPath}。请把插件配置项 root 指向一个已存在的文档目录（profile 的 cordis.patch.yml 里 id: doclib 那一段）。`,
      )
    }
    if (stat.type !== 'directory') throw new Error(`插件配置项 root 指向的不是目录：${rootPath}`)

    const claimed = skip instanceof Set ? skip : new Set()
    const known = Array.isArray(callWorkspaces) && callWorkspaces.length ? callWorkspaces : workspaces()
    const docs = []
    const queue = [{ target: rootTarget, rel: '' }]
    let next = 0
    let visited = 0

    while (next < queue.length) {
      if (visited > MAX_SCAN_ENTRIES) break
      const current = queue[next]
      next += 1
      let entries
      try {
        entries = await fs.listDir(current.target, signal)
      } catch {
        continue
      }
      for (const entry of entries) {
        visited += 1
        if (visited > MAX_SCAN_ENTRIES) break
        if (!entry?.name || entry.name.startsWith('.')) continue
        const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name
        if (entry.type === 'directory') {
          if (SKIPPED_DIRECTORIES.has(entry.name)) continue
          queue.push({ target: entry.target, rel })
          continue
        }
        if (entry.type !== 'file') continue
        if (!isTextPath(entry.name)) continue
        if (typeof entry.size === 'number' && entry.size > maxBytes) continue

        const absolute = path.resolve(rootPath, rel)
        const pathKey = pathKeyOf({
          kind: 'folder',
          absPath: absolute,
          rel,
          rootPath,
          workspaces: known,
        })
        if (!pathKey || claimed.has(pathKey)) continue

        const owner = known.find((workspace) => workspace.path && isInside(workspace.path, absolute))
        const displayRel = owner?.path ? relativeWithin(owner.path, absolute) : rel

        docs.push({
          pathKey,
          kind: 'folder',
          name: entry.name,
          ext: path.extname(entry.name).toLowerCase(),
          typeClass: typeClassOf(entry.name),
          size: typeof entry.size === 'number' ? entry.size : 0,
          updatedAt: 0,
          abs: absolute,
          rel: displayRel,
          target: entry.target,
          sessionId: '',
        })
      }
    }

    docs.sort((a, b) => String(a.rel).localeCompare(String(b.rel)))
    return { docs }
  }

  return { collect }
}
