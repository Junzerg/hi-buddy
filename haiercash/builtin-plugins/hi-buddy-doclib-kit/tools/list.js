/** `doc_list`: bounded listing with the two-level filters the panel uses. */
import { clampLimit, textBlock } from '../shared/text.js'

function kindLabel(kind) {
  if (kind === 'generated') return '生成'
  if (kind === 'image') return '图片'
  if (kind === 'folder') return '目录'
  return '上传'
}

export function createListTool({ ensureIndex, listDocuments }) {
  return {
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
          lines.push(`    - [${kindLabel(doc.kind)}] ${doc.path}（${doc.lines} 行，${doc.size} 字节）`)
        }
        return textBlock(lines.join('\n'))
      },
    },
    async execute(args, exec) {
      await ensureIndex(exec?.signal)
      return listDocuments({
        workspace: args?.workspace,
        session: args?.session,
        prefix: args?.prefix,
        limit: clampLimit(args?.limit, 30, 200),
      })
    },
  }
}
