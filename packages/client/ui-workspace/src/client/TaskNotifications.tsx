/** Sidebar notifications for unread task completions. */
import { useMemo, useState } from 'react'
import { Menu, MenuItemButton, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TaskNotifications.module.css'

export interface TaskNotificationsInjected {
  openSession: (id: SessionId) => void
}

type TaskNotificationsProps = PropsRuntime<'settings.launcher.notifications'>
  & PropsLocale<'workspace'> & InjectFace<TaskNotificationsInjected>

/** Opening the list leaves acknowledgements with the existing main-view owner. */
export function TaskNotifications({ useSessions, useSessionStatus, useWorkspaces, openSession, t }: TaskNotificationsProps) {
  const sessions = useSessions(value => value)
  const statuses = useSessionStatus(value => value)
  const archived = useWorkspaces(value => value.archivedSessionIds)
  const tasks = useMemo(() => sessions.ids.flatMap((id) => {
    const row = sessions.byId[id]
    return row !== undefined && !row.blank && row.origin !== 'subagent' && !archived.includes(id)
      && statuses.get(id)?.completionUnread === true ? [row] : []
  }).sort((left, right) => right.updatedAt - left.updatedAt), [sessions, statuses, archived])
  const [open, setOpen] = useState(false)
  const label = tasks.length === 0 ? t('notifications.title') : t('notifications.unread', { n: tasks.length })
  return <Menu open={open} onClose={() => { setOpen(false) }} side="top" align="end" portal autoFocus
    listClassName={css.panel} anchor={(
      <Tooltip label={label} side="top" disabled={open}>
        <button type="button" className={css.button} aria-label={label} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6.5 9.5a5.5 5.5 0 1 1 11 0c0 4.5 1.8 5.6 1.8 5.6H4.7s1.8-1.1 1.8-5.6M10 18.6a2 2 0 0 0 4 0" />
          </svg>
          {tasks.length > 0 && <span className={css.badge} aria-hidden="true">{tasks.length > 99 ? t('notifications.many') : tasks.length}</span>}
        </button>
      </Tooltip>
    )}>
    <div className={css.heading}>{t('notifications.title')}</div>
    {tasks.length === 0 ? <div className={css.empty} role="status">{t('notifications.empty')}</div>
      : tasks.map(task => <MenuItemButton key={task.id} onSelect={() => { setOpen(false); openSession(task.id) }}>
        <span className={css.entry}>
          <span className={css.title}>{task.displayTitle}</span>
          <span className={css.description}>{t('notifications.ended')}</span>
        </span>
      </MenuItemButton>)}
  </Menu>
}
