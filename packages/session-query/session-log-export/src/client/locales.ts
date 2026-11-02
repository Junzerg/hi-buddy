/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'

/** Simplified-Chinese Session export strings. */
export const zh = {
  'header.more': '更多操作',
  'menu.copyMarkdown': '复制会话为 Markdown',
  'menu.download': '下载 Session 日志',
  'toast.copied': 'Session 已复制为 Markdown',
  'toast.preparationFailed': '无法读取 Session 进行复制，请重试',
  'toast.clipboardFailed': '无法写入剪贴板，请检查剪贴板权限后重试',
  'dialog.preparingTitle': '正在导出 Session',
  'dialog.preparingDescription': '正在准备包含当前会话、子会话和附件的日志包。',
  'dialog.successTitle': 'Session 导出已开始下载',
  'dialog.successDescription': '浏览器正在下载会话日志包。',
  'dialog.encryptedSuccessDescription': '浏览器正在下载加密日志包，请交由管理员解密。',
  'dialog.errorTitle': 'Session 导出失败',
  'dialog.close': '关闭',
  'dialog.commandFailed': '无法启动 Session 导出。',
} as const

/** English Session export strings. */
export const en: Record<keyof typeof zh, string> = {
  'header.more': 'More actions',
  'menu.copyMarkdown': 'Copy Session as Markdown',
  'menu.download': 'Download session log',
  'toast.copied': 'Session copied as Markdown.',
  'toast.preparationFailed': 'Could not read the Session for copying. Try again.',
  'toast.clipboardFailed': 'Could not write to the clipboard. Check clipboard permission and try again.',
  'dialog.preparingTitle': 'Exporting Session',
  'dialog.preparingDescription': 'Preparing an archive containing this session, its sub-sessions, and attachments.',
  'dialog.successTitle': 'Session download started',
  'dialog.successDescription': 'The browser is downloading the session archive.',
  'dialog.encryptedSuccessDescription': 'The browser is downloading an encrypted archive. Give it to an administrator to decrypt.',
  'dialog.errorTitle': 'Session export failed',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the Session export.',
}

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof zh
