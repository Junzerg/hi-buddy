// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShortcutCatalogEntry, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ReactNode } from 'react'
import type {
  SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

const t: SidebarRootComponentProps['t'] = makeTranslate({ ...commonEn, ...en })

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.platform
  vi.unstubAllEnvs()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'clipboard')
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SidebarRootComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: SidebarRootComponentProps['useSessionStatus'] = selector => selector(noAttention)

function mountShell({ collapsed = false, width = 236, shortcuts = [] }: {
  collapsed?: boolean
  width?: number
  shortcuts?: readonly ShortcutCatalogEntry[]
} = {}) {
  const startSession = vi.fn()
  const trackEntryClick = vi.fn<SidebarRootComponentProps['trackEntryClick']>()
  let regionOwner: SidebarSectionOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  const brandMark = <span data-testid="custom-brand-mark">M</span>
  const brandName = <span data-testid="custom-brand-name">Custom Brand</span>
  let current = { collapsed, width }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector(shortcuts)}
      useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={startSession} trackEntryClick={trackEntryClick} t={t}
      renderSlot={((
        key: string,
        owner: SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.brand.mark') return brandMark
        if (key === 'sidebar.brand.name') return brandName
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={owner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    trackEntryClick,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('SidebarRoot shell', () => {
  it('advertises the effective new-session binding', () => {
    const shortcut: ShortcutCatalogEntry = { id: 'session.new' as ShortcutCommandId, label: 'New', aliases: [],
      binding: null, modified: true, conflicts: [], issue: null, keys: ['Ctrl', 'N'], aria: 'Control+N' }
    mountShell({ shortcuts: [shortcut] })
    for (const button of screen.getAllByRole('button', { name: 'New task' })) {
      expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+N')
    }
    const expanded = screen.getAllByRole('button', { name: 'New task' }).find(button => button.querySelector('kbd') !== null)!
    fireEvent.pointerEnter(expanded)
    fireEvent.focus(expanded)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(Array.from(expanded.querySelectorAll('kbd'), key => key.textContent)).toEqual(['Ctrl', 'N'])

  })
  it('routes New Session from the capsule and wordmark', () => {
    // Occupied brand slots keep New Session even when the build carries a version.
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
    const b = mountShell()
    expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
    expect(screen.getByTestId('custom-brand-name')).toBeTruthy()
    // Expanded, both the wordmark and the capsule start a session and report a sidebar New Session click first.
    const starters = screen.getAllByRole('button', { name: 'New task' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    expect(b.trackEntryClick.mock.calls).toEqual([
      [{ menu_name: 'new_session', position: 'sidebar' }],
      [{ menu_name: 'new_session', position: 'sidebar' }],
    ])
    expect(b.trackEntryClick.mock.invocationCallOrder[0]).toBeLessThan(b.startSession.mock.invocationCallOrder[0]!)
    expect(b.trackEntryClick).toHaveBeenCalledTimes(2)
  })


  it('offers no New Session control while the access snapshot excludes session/create', () => {
    const startSession = vi.fn()
    const useRemoteAccess = vi.fn((action: string) => action !== 'session/create')
    render(<SidebarRoot
      collapsed={false} width={236}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      useRemoteAccess={useRemoteAccess}
      startSession={startSession} trackEntryClick={vi.fn()} t={t}
      renderSlot={((key: string) => {
        if (key === 'sidebar.brand.mark') return <span data-testid="brand-mark">M</span>
        if (key === 'sidebar.brand.name') return <span data-testid="brand-name">Brand</span>
        return null
      }) as SidebarRootComponentProps['renderSlot']}
    />)

    // Neither the brand row nor the dedicated button starts a Session; the brand still renders.
    expect(useRemoteAccess).toHaveBeenCalledWith('session/create')
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull()
    expect(screen.getByTestId('brand-mark')).toBeTruthy()
    expect(screen.getByTestId('brand-name')).toBeTruthy()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('renders generic brand fallbacks when no package fills the slots', () => {
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3-rc.4')
    const { container } = render(<SidebarRoot
      collapsed={false} width={236}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={vi.fn()} trackEntryClick={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('HiBuddy（内测版）')).toBeTruthy()
    expect(screen.getByText('1.2.3-rc.4').getAttribute('title')).toBe('1.2.3-rc.4-0123456-dirty')
    expect(container.querySelectorAll('svg[viewBox="70 235 1110 780"] path')).toHaveLength(6)
  })

  it.each([
    [{ DSH_CLIENT_VERSION: '1.2.3' }, '1.2.3'],
    [{ DSH_CLIENT_VERSION: '1.2.3-rc.4.20261030.12' }, '1.2.3-rc.4.20261030.12'],
    [{ DSH_CLIENT_COMMIT_HASH: 'abcdef0', DSH_CLIENT_VERSION: '1.2.3' }, '1.2.3-abcdef0'],
  ])('omits unavailable build-version suffixes from %j', (environment, expected) => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value)
    render(<SidebarRoot
      collapsed={false} width={236}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={vi.fn()} trackEntryClick={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('HiBuddy（内测版）')).toBeTruthy()
    expect(screen.getByText(environment.DSH_CLIENT_VERSION).getAttribute('title')).toBe(expected)
  })

  it.each([false, true])('copies the local-build version from the fallback mark and name (darwin=%s)', async (darwin) => {
    if (darwin) document.documentElement.dataset.platform = 'darwin'
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'abcdef0')
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
    const writeText = vi.fn<(text: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const startSession = vi.fn()
    const trackEntryClick = vi.fn<SidebarRootComponentProps['trackEntryClick']>()
    render(<SidebarRoot
      collapsed={false} width={236}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={startSession} trackEntryClick={trackEntryClick} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)
    vi.useFakeTimers()

    const copiedToasts = () => screen.queryAllByRole('alert').map(toast => toast.textContent)
    await act(async () => { fireEvent.click(screen.getByText('HiBuddy（内测版）')) })
    expect(writeText).toHaveBeenLastCalledWith('1.2.3-abcdef0')
    expect(copiedToasts()).toEqual(['Version copied'])
    // The brand itself keeps its title and version.
    expect(screen.getByText('HiBuddy（内测版）')).toBeTruthy()
    expect(screen.getByText('1.2.3').getAttribute('title')).toBe('1.2.3-abcdef0')
    act(() => { vi.advanceTimersByTime(4000) })
    expect(copiedToasts()).toEqual([])

    // A refused write claims no success.
    await act(async () => { fireEvent.click(screen.getByText('1.2.3')) })
    expect(copiedToasts()).toEqual([])

    // The fallback mark copies too, and its click still reaches document.
    const documentClick = vi.fn()
    document.addEventListener('click', documentClick)
    const mark = screen.getByText('HiBuddy（内测版）').closest('[aria-hidden]')!.querySelector('svg')!
    await act(async () => { fireEvent.click(mark) })
    document.removeEventListener('click', documentClick)
    expect(documentClick).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledTimes(3)
    expect(copiedToasts()).toEqual(['Version copied'])
    expect(startSession).not.toHaveBeenCalled()
    // Copying the version is not a New Session click.
    expect(trackEntryClick).not.toHaveBeenCalled()

    // The rest of the brand button still starts and reports a session.
    if (!darwin) {
      fireEvent.click(screen.getAllByRole('button', { name: 'New task' })[0]!)
      expect(startSession).toHaveBeenCalledOnce()
      expect(trackEntryClick).toHaveBeenCalledExactlyOnceWith({ menu_name: 'new_session', position: 'sidebar' })
    }
  })

  it('retains the local-build fallback without complete build metadata', () => {
    render(<SidebarRoot
      collapsed={false} width={236}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={vi.fn()} trackEntryClick={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('HiBuddy（内测版）')).toBeTruthy()
  })

  it('keeps the workspace and footer seats expanded', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    expect(screen.getByTestId('settings-seat').closest('[hidden]')).toBeNull()
    expect(screen.getByTestId('footer-action-seat').closest('[hidden]')).toBeNull()
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.regionOwner().wide).toBe(true)
    expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull()
  })



})

it('keeps the macOS window-drag strip without a sidebar toggle', () => {
  document.documentElement.dataset.platform = 'darwin'
  const shell = mountShell()
  expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull()
  expect(screen.getByTestId('custom-brand-mark').closest('[data-window-drag]')).toBeTruthy()
  // The brand stays part of the logo row's window-drag surface: no button
  // role (the global no-drag rule would subtract it); only the dedicated
  // New Session capsule starts a session.
  expect(screen.getAllByRole('button', { name: 'New task' })).toHaveLength(1)
  expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'New task' }))
  expect(shell.trackEntryClick).toHaveBeenCalledExactlyOnceWith({ menu_name: 'new_session', position: 'sidebar' })
})

describe('Windows caption New Session analytics', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-windows-titlebar') })


  it('reports the expanded brand and New Session button as sidebar clicks', () => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    const b = mountShell()
    const starters = screen.getAllByRole('button', { name: 'New task' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    expect(b.trackEntryClick.mock.calls).toEqual([
      [{ menu_name: 'new_session', position: 'sidebar' }],
      [{ menu_name: 'new_session', position: 'sidebar' }],
    ])
  })
})
