// @vitest-environment jsdom
/** Mandatory Web IAM entry keeps the existing workspace hidden across account transitions. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AccountSnapshot } from '../src/client/AccountSection.tsx'
import { RequiredSignIn } from '../src/client/RequiredSignIn.tsx'
import { en, zh, type AccountKey } from '../src/client/locales.ts'
import type { SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'

afterEach(() => { cleanup(); document.body.replaceChildren() })

function mount(copy: typeof en | typeof zh = en) {
  const root = document.createElement('div')
  root.id = 'root'
  root.style.opacity = '0.75'
  root.inert = false
  document.body.append(root)
  let account: AccountSnapshot = { view: undefined, details: undefined, avatar: undefined, failed: false }
  const theme: ThemeSnapshot = { preference: 'light', active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [],
    fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' }, revision: 0 }
  const props = {
    ...({} as GlobalStandardProps),
    start: vi.fn(async () => {}), cancel: vi.fn(async (_id: SignInAttemptId) => {}),
    useAccount: <T,>(selector: (value: AccountSnapshot) => T): T => selector(account),
    useTheme: <T,>(selector: (value: ThemeSnapshot) => T): T => selector(theme),
    t: (key: string): string => key in copy ? copy[key as AccountKey] : key,
  }
  const view = render(<RequiredSignIn {...props} />, { container: root })
  const update = (value: Partial<AccountSnapshot>): void => {
    account = { ...account, ...value }
    view.rerender(<RequiredSignIn {...props} />)
  }
  return { root, props, update, ...view }
}
const links = { usageUrl: 'http://127.0.0.1:18080/usage', topUpUrl: 'http://127.0.0.1:18080/top_up' }
const signedOut = { status: 'signed-out' as const, links, attempt: null }

it.each([en, zh])('shows the mandatory IAM entry without starting browser authorization', async (copy) => {
  const view = mount(copy)
  expect(view.root.inert).toBe(true)
  expect(view.root.style.opacity).toBe('0')
  expect(screen.getByRole('button', { name: copy.signIn }).hasAttribute('disabled')).toBe(true)
  view.update({ view: signedOut })
  expect(screen.queryByRole('button', { name: copy.addApiKey })).toBeNull()
  expect(screen.queryByRole('button', { name: copy.close })).toBeNull()
  expect(view.props.start).not.toHaveBeenCalled()
  await expect(`${screen.getByRole('dialog').textContent}\n`)
    .toMatchFileSnapshot(`./expected/login-required-${copy === en ? 'en' : 'zh'}.txt`)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(view.root.inert).toBe(true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.signIn })) })
  expect(view.props.start).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('accepts only IAM grants and returns to the login entry after sign-out or expiry', () => {
  const view = mount()
  view.update({ view: { ...signedOut, status: 'credential-stored', authenticationMethod: 'api-key' } })
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(view.root.inert).toBe(true)
  view.update({ view: { ...signedOut, status: 'credential-stored', authenticationMethod: 'iam' } })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(view.root.inert).toBe(false)
  expect(view.root.style.opacity).toBe('0.75')
  view.update({ view: signedOut })
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(view.root.inert).toBe(true)
  expect(view.root.style.opacity).toBe('0')
  view.unmount()
  expect(view.root.inert).toBe(false)
  expect(view.root.style.opacity).toBe('0.75')
})

it('cancels authorization while retaining the login barrier', async () => {
  const view = mount()
  const id = 'mandatory-login' as SignInAttemptId
  view.update({ view: { ...signedOut, attempt: { id, phase: 'waiting-browser',
    authorizeUrl: 'http://127.0.0.1:18080/sso/oauth2/authorize' } } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.cancel })) })
  expect(view.props.cancel).toHaveBeenCalledExactlyOnceWith(id)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(view.root.inert).toBe(true)
  view.update({ view: signedOut })
  expect(screen.getByRole('button', { name: en.signIn })).toBeTruthy()
  expect(view.root.inert).toBe(true)
})

it('retains the login barrier and offers retry after IAM failure', async () => {
  const view = mount()
  view.update({ view: { ...signedOut, attempt: { id: 'failed-login' as SignInAttemptId, phase: 'failed', errorCode: 'network' } } })
  expect(screen.queryByRole('button', { name: en.addApiKey })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.retry })) })
  expect(view.props.start).toHaveBeenCalledOnce()
  expect(view.root.inert).toBe(true)
  expect(screen.getByRole('dialog')).toBeTruthy()
})
