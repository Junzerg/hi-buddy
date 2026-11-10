/**
 * `ctx.fs` shaped just enough by `node:fs` for the eval and check scripts.
 *
 * The production modules only use resolve / stat / readText / listDir /
 * writeText / deleteFile, so a small adapter lets them run unchanged outside
 * the harness — no duplicated index or search code in the scripts.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export function createNodeFsPort({ onReadText } = {}) {
  function resolvePath(value, cwd) {
    return path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd || process.cwd(), value)
  }

  function targetOf(abs) {
    return { targetKey: abs, displayPath: abs }
  }

  async function stat(abs) {
    try {
      const info = await fs.stat(abs)
      return {
        version: `${info.dev}:${info.ino}:${info.size}:${Math.trunc(info.mtimeMs)}:${Math.trunc(info.ctimeMs)}`,
        type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
        size: info.size,
      }
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return undefined
      throw error
    }
  }

  return {
    async resolve(value, opts) {
      return targetOf(resolvePath(String(value), opts?.cwd))
    },
    async stat(target) {
      return stat(target.targetKey)
    },
    async readText(target) {
      onReadText?.(target.targetKey)
      return fs.readFile(target.targetKey, 'utf8')
    },
    async listDir(target) {
      let entries
      try {
        entries = await fs.readdir(target.targetKey, { withFileTypes: true })
      } catch (error) {
        if (error?.code === 'ENOENT') return []
        throw error
      }
      const out = []
      for (const entry of entries) {
        const abs = path.join(target.targetKey, entry.name)
        const info = await stat(abs).catch(() => undefined)
        out.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          target: targetOf(abs),
          ...(info?.size !== undefined ? { size: info.size } : {}),
        })
      }
      out.sort((a, b) => a.name.localeCompare(b.name))
      return out
    },
    async writeText(target, content) {
      await fs.mkdir(path.dirname(target.targetKey), { recursive: true })
      await fs.writeFile(target.targetKey, content, 'utf8')
      const info = await stat(target.targetKey)
      return { operation: 'update', version: info?.version, before: null, after: content }
    },
    async deleteFile(target) {
      await fs.unlink(target.targetKey)
      return { before: null }
    },
  }
}
