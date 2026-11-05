/**
 * `schedule.catalog` namespace dictionaries: the Session header catalog and the
 * Sidebar row mark with its hover-card task section.
 */
import { frequencyEn, frequencyZh } from './frequency-locales.ts'

/** Dictionary namespace owned by this plugin. */
export const NS = 'schedule.catalog'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.label': '自动化任务',
  'list.loading': '正在加载自动化任务…',
  'list.error': '无法加载自动化任务。',
  'list.retry': '重试',
  'delete.action': '删除',
  'delete.pending': '正在删除…',
  'delete.label': '删除自动化任务：{title}',
  'list.open': '打开自动化任务详情：{title}',
  'trigger.one': '{count} 个自动化任务',
  'trigger.other': '{count} 个自动化任务',
  'list.aria': '已开启的自动化任务',
  'list.nextRun': '下次运行',
  'frequency.once': '单次',
  'frequency.every': '{value}{unit}一次',
  ...frequencyZh,
  'mark.aria': '{count} 个自动化任务',
  'hover.more': '另有 {count} 个任务',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<ScheduleCatalogKey, string> = {
  'trigger.label': 'Automation tasks',
  'list.loading': 'Loading automation tasks…',
  'list.error': 'Could not load automation tasks.',
  'list.retry': 'Retry',
  'delete.action': 'Delete',
  'delete.pending': 'Deleting…',
  'delete.label': 'Delete automation task: {title}',
  'list.open': 'Open automation task details: {title}',
  'trigger.one': '{count} automation task',
  'trigger.other': '{count} automation tasks',
  'list.aria': 'Enabled automation tasks',
  'list.nextRun': 'Next run',
  'frequency.once': 'Once',
  'frequency.every': 'Every {value} {unit}',
  ...frequencyEn,
  'mark.aria': '{count} automation tasks',
  'hover.more': '{count} more',
}

/** Key domain of the Schedule catalog namespace. */
export type ScheduleCatalogKey = keyof typeof zh
