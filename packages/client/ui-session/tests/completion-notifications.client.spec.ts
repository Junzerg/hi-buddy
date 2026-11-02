import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CompletionNotifications } from '../src/client/completion-notifications.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const id = 'task' as SessionId

it('writes settled changes once, restores them, and removes deleted tasks', () => {
  const data = new Map<string, string>()
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value) })
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem })
  const saved = new CompletionNotifications()
  saved.set(id, true, false)
  saved.set(id, false, true)
  saved.flush()
  saved.set(id, false, true)
  saved.flush()
  expect(setItem).toHaveBeenCalledTimes(1)
  const restored = new CompletionNotifications()
  expect(restored.get(id)).toEqual({ id, running: false, unread: true })
  restored.retain(new Set([id]))
  restored.flush()
  expect(setItem).toHaveBeenCalledTimes(1)
  restored.retain(new Set())
  restored.flush()
  expect([...new CompletionNotifications().ids()]).toEqual([])
})

it.each(['broken JSON', '{}', '[null]', '[{"id":"task","running":false,"unread":"yes"}]'])('discards invalid saved state: %s', (value) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('localStorage', { getItem: () => value })
  expect([...new CompletionNotifications().ids()]).toEqual([])
  expect(error).toHaveBeenCalled()
})

it('keeps notification state usable when local storage cannot be read or written', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('read unavailable') },
    setItem: () => { throw new Error('write unavailable') },
  })
  const saved = new CompletionNotifications()
  saved.set(id, false, true)
  saved.flush()
  expect(saved.get(id)?.unread).toBe(true)
  expect(error).toHaveBeenCalledTimes(2)
})
