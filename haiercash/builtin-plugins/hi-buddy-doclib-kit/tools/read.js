/** `doc_read`: paged body text for one library document. */
import { clampLimit, textBlock } from '../shared/text.js'

export function createReadTool({ ensureIndex, documentByRef, loadDocumentText, recordRead }) {
  return {
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
      const doc = documentByRef({ key: args?.key, path: args?.path })
      if (!doc) {
        throw new Error('没有找到该文档：请先用 doc_search 或 doc_list 取到它的 key，再调用 doc_read。')
      }

      const loaded = await loadDocumentText(doc, Math.max(offset + maxChars + 1, 400 * 1024))
      const text = loaded.text.slice(offset, offset + maxChars)
      const totalChars = loaded.text.length
      recordRead?.(doc, { offset, sessionId: exec?.agent?.sessionId })
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
  }
}
