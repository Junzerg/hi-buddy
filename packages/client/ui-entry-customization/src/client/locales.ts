/** Copy for the More menu rows: navigation actions, and Creator draft prompts per region. */
export const en = {
  install: 'Browse other plugins',
  create: 'Create your plugin',
  'createPrompt.sidebar': 'Create a Lingxi Office plugin with a left sidebar entry.',
  'createPrompt.conversation': 'Create a Lingxi Office conversation view plugin.',
  'createPrompt.rightbar': 'Create a Lingxi Office plugin with a right sidebar entry.',
} as const

/** Chinese counterpart of the entry-customization dictionary. */
export const zh: Record<keyof typeof en, string> = {
  install: '浏览更多插件',
  create: '创建你的插件',
  'createPrompt.sidebar': '创建一个带左侧栏入口的灵犀办公插件。',
  'createPrompt.conversation': '创建一个灵犀办公会话视图插件。',
  'createPrompt.rightbar': '创建一个带右侧栏入口的灵犀办公插件。',
}
