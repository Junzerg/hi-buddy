/**
 * Session uploads: bytes the user attached, addressed by attachment id.
 *
 * An upload has no location, so its `pathKey` is `attachment:<id>` — the same
 * file referenced from two sessions is one document, not two.
 */

import { pathKeyOf } from '../shared/pathKey.js'

/** Read at most `limit` bytes of an attachment and decode it as UTF-8 text. */
export async function readAttachmentText(attachments, attachment, limit) {
  const stream = attachments.readFileStream(attachment)
  const parts = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    parts.push(Buffer.from(buffer))
    total += buffer.length
    if (total > limit) break
  }
  return Buffer.concat(parts).subarray(0, limit).toString('utf8')
}

/** Pull uploaded documents out of one session's user messages. */
export function uploadedCandidates(events, { includeImages = true } = {}) {
  const found = []
  const seen = new Set()
  for (const event of events) {
    if (event?.type !== 'user/message') continue
    const content = event.data?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const attachment = block?.attachment
      if (!attachment?.attachmentId) continue
      const isImage = block.type === 'image'
      if (block.type !== 'file' && !isImage) continue
      if (isImage && !includeImages) continue
      const attachmentId = String(attachment.attachmentId)
      if (seen.has(attachmentId)) continue
      seen.add(attachmentId)
      found.push({
        kind: isImage ? 'image' : 'upload',
        pathKey: pathKeyOf({ kind: isImage ? 'image' : 'upload', attachmentId }),
        name: String(attachment.name || attachmentId),
        attachment: {
          attachmentId,
          name: String(attachment.name || ''),
          mediaType: attachment.mediaType ? String(attachment.mediaType) : undefined,
          bytes: Number(attachment.bytes) || 0,
        },
        size: Number(attachment.bytes) || 0,
        updatedAt: Number(event.time) || 0,
      })
    }
  }
  return found
}
