/** `doc_search`: keyword retrieval over the library's admitted documents. */
import { clampLimit, textBlock } from '../shared/text.js'

export function createSearchTool({ ensureIndex, searchDocs }) {
  return {
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
  }
}
