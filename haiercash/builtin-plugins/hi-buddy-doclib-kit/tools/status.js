/** `doc_status`: index shape, counts, and the last build time. */
import { textBlock } from '../shared/text.js'

export function createStatusTool({ ensureIndex, summarize }) {
  return {
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
  }
}
