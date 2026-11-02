// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskNotifications } from '../src/client/TaskNotifications.tsx'
import { zh, en } from '../src/client/locales.ts'

afterEach(cleanup)
const sid = (value: string) => value as SessionId
const row = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, blank: false, running: false, updatedAt: 1, retainedBy: {}, ...extra,
})

function mount(rows: SessionSummary[], unread: string[], copy: typeof zh | typeof en = zh) {
  const sessions = createSnapshotStore<SessionListState>({
    ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])), phase: 'ready', projectionsBySession: {},
  })
  const statuses = createSnapshotStore<SessionStatusSnapshot>(new Map(rows.map(row => [row.id, {
    running: false, pendingInteraction: undefined, completionUnread: unread.includes(row.id),
  }])))
  const workspaces = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  const openSession = vi.fn()
  const props: ComponentProps<typeof TaskNotifications> = {
    ...({} as GlobalStandardProps), openSession,
    useSessions: bindSnapshotSelector(sessions), useSessionStatus: bindSnapshotSelector(statuses),
    useWorkspaces: bindSnapshotSelector(workspaces), t: makeTranslate(copy),
  }
  render(<TaskNotifications {...props} />)
  return { statuses, workspaces, openSession }
}

it.each([zh, en])('shows an empty notification menu and dismisses it with Escape', (copy) => {
  mount([row('old task')], [], copy)
  fireEvent.click(screen.getByRole('button', { name: copy['notifications.title'] }))
  expect(screen.getByText(copy['notifications.empty'])).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('opening notifications keeps them unread; opening a task delegates acknowledgement to navigation', () => {
  const b = mount([row('完成的任务'), row('其他任务', { updatedAt: 2 })], ['完成的任务', '其他任务'])
  fireEvent.click(screen.getByRole('button', { name: '通知，2 条未读' }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
    '其他任务任务已结束，点击查看', '完成的任务任务已结束，点击查看',
  ])
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('button', { name: '通知，2 条未读' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '通知，2 条未读' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /完成的任务/ }))
  expect(b.openSession).toHaveBeenCalledExactlyOnceWith(sid('完成的任务'))
  expect(screen.queryByRole('menu')).toBeNull()
  act(() => { b.statuses.set(new Map([[sid('其他任务'), { running: false, pendingInteraction: undefined, completionUnread: true }]])) })
  expect(screen.getByRole('button', { name: '通知，1 条未读' })).toBeTruthy()
})

it('omits archived, blank and subagent rows and updates when a task disappears', () => {
  const b = mount([row('task'), row('archived'), row('blank', { blank: true }), row('child', { origin: 'subagent' })], ['task', 'archived', 'blank', 'child'])
  act(() => { b.workspaces.set({ ...b.workspaces.getSnapshot(), archivedSessionIds: [sid('archived')] }) })
  expect(screen.getByRole('button', { name: '通知，1 条未读' })).toBeTruthy()
  act(() => { b.statuses.set(new Map()) })
  fireEvent.click(screen.getByRole('button', { name: '通知' }))
  expect(screen.getByText('暂无未读通知')).toBeTruthy()
})

it('caps the badge while keeping the complete unread count accessible', () => {
  const rows = Array.from({ length: 100 }, (_, index) => row(String(index)))
  mount(rows, rows.map(row => row.id))
  expect(screen.getByRole('button', { name: '通知，100 条未读' }).textContent).toBe('99+')
})
