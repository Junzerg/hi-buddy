// @vitest-environment jsdom
/** Frame interactions with a real store and explicitly driven browser measurements. */
import type { GlobalStandardProps, RenderOpts } from '@deepseek-ai/dsh-client-ui-slots'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { AppFrame } from '../src/client/AppFrame.tsx'
import type { AppFrameProps } from '../src/client/AppFrame.tsx'
import type { MainPanelId, RightbarOwnerProps, SidebarOwnerProps } from '../src/client/index.ts'
import { createLayoutStore } from '../src/client/stores.ts'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']
let selectedSession: SessionId | undefined
let selectedSessionTitle: string | undefined
let workspacesReady = true
type AttentionSnapshot = Parameters<Parameters<AppFrameProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: AppFrameProps['useSessionStatus'] = selector => selector(noAttention)

let observers: ResizeObserverStub[]
class ResizeObserverStub {
  disconnected = false
  constructor(private callback: ResizeObserverCallback) { observers.push(this) }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void { this.disconnected = true }
  fire(): void { this.callback([], this) }
}

let frameWidth: number
let animationFrames: Map<number, FrameRequestCallback>
let nextFrame: number
let originalTitle: string
/** Flush one browser frame without depending on the worker's timer cadence. */
function flushFrames(): void {
  for (const [id, callback] of [...animationFrames]) {
    if (!animationFrames.delete(id)) continue
    callback(0)
  }
}

function resize(width: number): void {
  frameWidth = width
  act(() => {
    for (const observer of observers) if (!observer.disconnected) observer.fire()
    flushFrames()
  })
}

/** Pointer input with explicit identity, without changing the worker's DOM prototypes. */
function pointer(handle: HTMLElement, type: string, x: number,
  options: { id?: number; button?: number; primary?: boolean } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: options.button ?? 0 })
  Object.defineProperties(event, {
    pointerId: { value: options.id ?? 1 },
    isPrimary: { value: options.primary ?? true },
  })
  fireEvent(handle, event)
}

function mountFrame(windowWidth = frameWidth) {
  vi.stubGlobal('innerWidth', windowWidth)
  const instance = createLayoutStore().create()
  const slotCalls: { key: string; props: object; options: RenderOpts | undefined }[] = []
  const renderSlot: AppFrameProps['renderSlot'] = (key, owner, options) => {
    slotCalls.push({ key, props: owner, options })
    return <div data-testid={`${key}-content`} data-entry-key={options?.entryKey} />
  }
  const useSessions: AppFrameProps['useSessions'] = sel => sel({
    ids: selectedSession === undefined ? [] : [selectedSession],
    byId: selectedSession === undefined ? {} : {
      [selectedSession]: {
        id: selectedSession, displayTitle: 'Test', running: false, retainedBy: { mainView: 1 }, blank: false, updatedAt: 1,
        ...(selectedSessionTitle === undefined ? {} : { title: selectedSessionTitle }),
      },
    },
    phase: 'ready',
    projectionsBySession: {},
  })
  const workspaceState: WorkspaceSnapshot = {
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    ...(workspacesReady ? {} : { state: 'loading' as const, phase: 'pending' as const }),
  }
  const useStore = bindSnapshotSelector(instance)
  const usePanelInfo = bindSnapshotSelector({
    getSnapshot: () => instance.getSnapshot().panelInfo,
    subscribe: listener => instance.subscribe(listener),
  })
  const element = () => (
    <AppFrame
      useStore={useStore}
      actions={instance.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useRightbarShown={selector => selector(false)}
      usePanelInfo={usePanelInfo}
      useSessionStatus={useSessionStatus}
      useSessionRetainInfo={() => undefined}
      useResource={useResource}
      useContextMenu={contextMenuHook()}
      useWorkspaces={sel => sel(workspaceState)}
      {...allowAllAccess}
      t={key => key === 'brand.localBuild' ? 'LXO（内测版）' : key}
    />
  )
  const utils = render(element())
  const frame = utils.container.firstElementChild as HTMLElement
  return {
    ...utils, instance, frame, slotCalls,
    rerenderFrame: () => { utils.rerender(element()) },
    rightOwner: () => slotCalls.findLast(c => c.key === 'rightbar')!.props as RightbarOwnerProps,
    sidebarOwner: () => slotCalls.findLast(c => c.key === 'sidebar')!.props as SidebarOwnerProps,
  }
}

beforeEach(() => {
  originalTitle = document.title
  frameWidth = 1440
  selectedSession = 's-test' as SessionId
  selectedSessionTitle = undefined
  workspacesReady = true
  observers = []
  animationFrames = new Map()
  nextFrame = 1
  vi.stubEnv('DSH_CLIENT_TITLE', undefined)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { animationFrames.delete(id) })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: frameWidth, height: 900, top: 0, left: 0, right: frameWidth, bottom: 900,
    x: 0, y: 0, toJSON: () => ({}),
  }))
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.platform
  document.documentElement.removeAttribute('data-windows-titlebar')
  document.title = originalTitle
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('AppFrame', () => {
  it('resizes the sidebar from a frozen pointer origin and restores its width after collapsing', () => {
    const view = mountFrame()
    const handle = view.getByRole('separator', { name: 'sidebar.resize' })
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => true)
    handle.releasePointerCapture = vi.fn()
    const main = view.getByTestId('main-content')
    pointer(handle, 'pointerdown', 236)
    pointer(handle, 'pointermove', 276)
    pointer(handle, 'pointermove', 306)
    expect(view.sidebarOwner().width).toBe(236)
    act(flushFrames)
    expect(view.sidebarOwner().width).toBe(306)
    pointer(handle, 'pointermove', 326)
    act(flushFrames)
    expect(view.sidebarOwner().width).toBe(326)
    pointer(handle, 'pointerup', 336)
    expect(view.sidebarOwner().width).toBe(336)
    expect(view.frame.dataset.dragging).toBeUndefined()
    expect(animationFrames.size).toBe(0)
    fireEvent.click(view.getByRole('button', { name: 'sidebar.collapse' }))
    expect(view.queryByRole('separator', { name: 'sidebar.resize' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'sidebar.expand' }))
    expect(view.sidebarOwner().width).toBe(336)
    const restored = view.getByRole('separator', { name: 'sidebar.resize' })
    fireEvent.keyDown(restored, { key: 'Home' })
    expect(view.sidebarOwner().width).toBe(220)
    fireEvent.keyDown(restored, { key: 'End' })
    expect(view.sidebarOwner().width).toBe(420)
    expect(view.getByTestId('main-content')).toBe(main)
  })

  it('cancels a pending sidebar frame and releases capture when the sidebar closes during a drag', () => {
    const view = mountFrame()
    const handle = view.getByRole('separator', { name: 'sidebar.resize' })
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => true)
    const releasePointer = vi.fn()
    handle.releasePointerCapture = releasePointer
    pointer(handle, 'pointerdown', 236)
    pointer(handle, 'pointermove', 336)
    expect(animationFrames.size).toBe(1)
    fireEvent.click(view.getByRole('button', { name: 'sidebar.collapse' }))
    expect(animationFrames.size).toBe(0)
    expect(releasePointer).toHaveBeenCalledWith(1)
    act(flushFrames)
    expect(view.instance.getSnapshot().layoutInfo.sidebarWidth).toBe(236)
    expect(view.frame.dataset.dragging).toBeUndefined()
  })
  it('localizes the title without a configured build title', () => {
    mountFrame()
    expect(document.title).toBe('LXO（内测版）')
  })

  it('follows the selected durable Session title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    selectedSessionTitle = 'First'
    const { rerenderFrame } = mountFrame()
    expect(document.title).toBe('First — Product')
    selectedSessionTitle = 'Revised'
    rerenderFrame()
    expect(document.title).toBe('Revised — Product')
    selectedSession = undefined
    rerenderFrame()
    expect(document.title).toBe('Product')
  })

  it('keeps the right panel available at its initial width beside a closed track', () => {
    const { frame, sidebarOwner, rightOwner } = mountFrame()
    expect(sidebarOwner()).toEqual({ collapsed: false, width: 236, drawer: false })
    expect(rightOwner()).toEqual({ width: 336, viewportWidth: 1440, canShow: true })
    expect(frame.style.getPropertyValue('--dsh-rightbar-track-width')).toBe('0px')
    expect(frame.querySelector('[data-side]')).toBeNull()
  })

  it('reserves the normal right width only while the occupant reports a track', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(frame.style.getPropertyValue('--dsh-rightbar-track-width')).toBe('336px')
    expect(frame.dataset.rightbarOpen).toBe('true')
    act(() => { instance.actions.closeRightbar() })
    expect(frame.style.getPropertyValue('--dsh-rightbar-track-width')).toBe('0px')
    expect(frame.dataset.rightbarOpen).toBeUndefined()
  })

  it('hides the left column completely and restores it to 236px using its button', () => {
    const { frame, instance, getByRole, sidebarOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    const geometry = instance.getSnapshot().layoutInfo
    const sidebar = frame.firstElementChild
    fireEvent.click(getByRole('button', { name: 'sidebar.collapse' }))
    expect(frame.style.getPropertyValue('--dsh-sidebar-track-width')).toBe('0px')
    expect(frame.dataset.sidebarCollapsed).toBe('true')
    expect(getByRole('button', { name: 'sidebar.expand' }).getAttribute('aria-expanded')).toBe('false')
    expect(instance.getSnapshot().layoutInfo).toBe(geometry)
    resize(390)
    expect(frame.style.getPropertyValue('--dsh-sidebar-track-width')).toBe('0px')
    fireEvent.click(getByRole('button', { name: 'sidebar.expand' }))
    expect(frame.style.getPropertyValue('--dsh-sidebar-track-width')).toBe('236px')
    expect(frame.dataset.sidebarCollapsed).toBeUndefined()
    expect(sidebarOwner()).toEqual({ collapsed: false, width: 236, drawer: false })
    expect(frame.firstElementChild).toBe(sidebar)
  })

  it.each([1181, 1180, 1024, 768, 390])('retains both panel widths at a %ipx frame', (width) => {
    const { frame, instance, sidebarOwner, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    resize(width)
    expect(sidebarOwner()).toEqual({ collapsed: false, width: 236, drawer: false })
    expect(rightOwner()).toEqual({ width: 336, viewportWidth: width, canShow: true })
    expect(frame.dataset.rightbarCollapsed).toBe(width <= 1180 ? 'true' : undefined)
    expect(frame.dataset.rightbarOpen).toBe('true')
  })


  it.each(['darwin', 'win32'])('keeps a fixed navigation column on %s', (platform) => {
    document.documentElement.dataset.platform = platform
    if (platform === 'win32') document.documentElement.setAttribute('data-windows-titlebar', '')
    const { frame, sidebarOwner, queryByTestId } = mountFrame()
    resize(390)
    expect(sidebarOwner()).toEqual({ collapsed: false, width: 236, drawer: false })
    expect(queryByTestId('shell.leading-content')).toBeNull()
    expect(frame.style.getPropertyValue('--dsh-sidebar-track-width')).toBe('236px')
    if (platform === 'win32') expect(frame.style.getPropertyValue('--dsh-windows-sidebar-width')).toBe('236px')
  })

  it('keeps explicit fullscreen reports separate from the normal track', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    expect(frame.dataset.rightbarFullscreen).toBe('true')
    expect(frame.style.getPropertyValue('--dsh-rightbar-track-width')).toBe('336px')
    act(() => { instance.actions.openRightbar(true, false) })
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    expect(frame.dataset.rightbarInstant).toBe('true')
  })

  it('selects global panels without removing the current main or right slots', () => {
    const { instance, slotCalls, getByTestId } = mountFrame()
    act(() => { instance.actions.selectPanel('plugins' as MainPanelId) })
    expect(slotCalls.findLast(c => c.key === 'main')?.options?.entryKey).toBe('plugins')
    expect(getByTestId('rightbar-content')).toBeTruthy()
    expect(getByTestId('shell.bottom-content')).toBeTruthy()
    expect(getByTestId('shell.overlay-content')).toBeTruthy()
  })

  it('coalesces measurements and cancels the pending frame at teardown', () => {
    const { instance, unmount } = mountFrame(1920)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1440)
    frameWidth = 1000
    act(() => { observers[0]!.fire(); observers[0]!.fire() })
    expect(animationFrames.size).toBe(1)
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1000)
    act(() => { observers[0]!.fire() })
    unmount()
    expect(observers[0]!.disconnected).toBe(true)
    expect(animationFrames.size).toBe(0)
    observers[0]!.fire()
    expect(animationFrames.size).toBe(0)
  })

  it('ignores zero-width frame measurements', () => {
    const { instance } = mountFrame()
    resize(0)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1440)
  })

  it('resizes both the panel and its reserved track with the keyboard, without remounting main content', () => {
    const { instance, frame, getByRole, getByTestId, rightOwner, queryByRole } = mountFrame()
    expect(queryByRole('separator', { name: 'rightbar.resize' })).toBeNull()
    act(() => { instance.actions.openRightbar(true, false) })
    const handle = getByRole('separator', { name: 'rightbar.resize' })
    const main = getByTestId('main-content')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(rightOwner().width).toBe(352)
    expect(frame.style.getPropertyValue('--dsh-rightbar-track-width')).toBe('352px')
    expect(frame.dataset.rightbarInstant).toBe('true')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(rightOwner().width).toBe(336)
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(rightOwner().width).toBe(280)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(rightOwner().width).toBe(280)
    fireEvent.keyDown(handle, { key: 'End' })
    expect(rightOwner().width).toBe(844)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'Escape' })
    expect(rightOwner().width).toBe(844)
    expect(getByTestId('main-content')).toBe(main)
  })

  it('retains the preferred width when the window shrinks and after closing the panel', () => {
    const { instance, rightOwner, getByRole, queryByRole } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false); instance.actions.setRightbarWidth(800) })
    resize(1300)
    expect(rightOwner().width).toBe(704)
    resize(390)
    expect(rightOwner().width).toBe(366)
    expect(getByRole('separator', { name: 'rightbar.resize' }).getAttribute('aria-valuemax')).toBe('366')
    expect(instance.getSnapshot().layoutInfo.rightbarWidth).toBe(800)
    act(() => { instance.actions.closeRightbar() })
    expect(queryByRole('separator', { name: 'rightbar.resize' })).toBeNull()
    resize(1440)
    act(() => { instance.actions.openRightbar(true, false) })
    expect(rightOwner().width).toBe(800)
    fireEvent.click(getByRole('button', { name: 'sidebar.collapse' }))
    fireEvent.keyDown(getByRole('separator', { name: 'rightbar.resize' }), { key: 'End' })
    expect(rightOwner().width).toBe(1080)
    fireEvent.click(getByRole('button', { name: 'sidebar.expand' }))
    expect(rightOwner().width).toBe(844)
  })

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
    'ends only the captured gesture on %s', (endEvent) => {
      const { instance, getByRole, rightOwner } = mountFrame()
      act(() => { instance.actions.openRightbar(true, false) })
      const handle = getByRole('separator', { name: 'rightbar.resize' })
      const capturePointer = vi.fn()
      handle.setPointerCapture = capturePointer
      pointer(handle, 'pointermove', 1000)
      pointer(handle, 'pointerdown', 1104, { button: 2 })
      pointer(handle, 'pointerdown', 1104, { primary: false })
      expect(handle.dataset.resizing).toBeUndefined()
      pointer(handle, 'pointerdown', 1104)
      pointer(handle, 'pointerdown', 1000)
      expect(capturePointer).toHaveBeenCalledExactlyOnceWith(1)
      expect(handle.dataset.resizing).toBe('true')
      pointer(handle, 'pointermove', 1004, { id: 2 })
      expect(rightOwner().width).toBe(336)
      pointer(handle, 'pointermove', 1004)
      expect(rightOwner().width).toBe(436)
      pointer(handle, endEvent, 1004, { id: 2 })
      expect(handle.dataset.resizing).toBe('true')
      pointer(handle, endEvent, 1004)
      expect(handle.dataset.resizing).toBeUndefined()
      pointer(handle, 'pointermove', 900)
      expect(rightOwner().width).toBe(436)
    },
  )

  it('removes a captured handle in fullscreen and restores the chosen normal width', () => {
    const { instance, getByRole, queryByRole, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    const handle = getByRole('separator', { name: 'rightbar.resize' })
    handle.setPointerCapture = vi.fn()
    pointer(handle, 'pointerdown', 1104)
    pointer(handle, 'pointermove', 900)
    expect(rightOwner().width).toBe(540)
    act(() => { instance.actions.openRightbar(true, true) })
    expect(queryByRole('separator', { name: 'rightbar.resize' })).toBeNull()
    expect(handle.isConnected).toBe(false)
    act(() => { instance.actions.openRightbar(true, false) })
    expect(rightOwner().width).toBe(540)
    expect(getByRole('separator', { name: 'rightbar.resize' }).dataset.resizing).toBeUndefined()
  })
})
