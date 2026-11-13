/** Navigation and right-panel controls owned by the frame. */
export const zh = {
  'sidebar.collapse': '收起左侧栏',
  'sidebar.expand': '展开左侧栏',
  'sidebar.resize': '调整左侧栏宽度',
  'rightbar.resize': '调整右侧栏宽度',
} as const

/** English labels for the same frame controls. */
export const en: Record<keyof typeof zh, string> = {
  'sidebar.collapse': 'Collapse left sidebar',
  'sidebar.expand': 'Expand left sidebar',
  'sidebar.resize': 'Resize left sidebar',
  'rightbar.resize': 'Resize right sidebar',
}
