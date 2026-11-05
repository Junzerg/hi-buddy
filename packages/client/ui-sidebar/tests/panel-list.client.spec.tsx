// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRenderSlots, PropsRuntime, SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { apply, inject } from '../src/client/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'sidebar-panel-test': 'alpha' }
}
const PLUGINS = 'plugins' as MainPanelId
const SCHEDULES = 'schedules' as MainPanelId
const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => {
  for (const runtime of runtimes) await runtime.dispose()
  runtimes.clear()
  cleanup()
  localStorage.clear()
})

async function bench(track?: TrackProductEvent) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const layout = {
    panelInfo: runtime.panelInfo,
    beginNavigation: vi.fn(() => new AbortController().signal),
    selectPanel: vi.fn((activePanelId: MainPanelId | null) => { runtime.panelInfo.set({ activePanelId }) }),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  } satisfies ILayout
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never)
      ctx.provide('layout', layout)
      ctx.provide('uiWorkspace', { startSession: vi.fn() } as never)
      ctx.provide('locale', locale)
      if (track !== undefined) ctx.provide('productAnalytics', { track } as never)
      ctx.effect(() => locale.register('common', { zh: commonZh, en: commonEn }), 'panel test: common locale')
      ctx.effect(() => locale.register('sidebar-panel-test', {
        zh: { alpha: '甲面板' }, en: { alpha: 'Alpha panel' },
      }), 'panel test: panel locale')
      ctx.slots.installLocale(locale)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'conversation' }, () => (
        <p>Conversation content</p>
      )))
    },
  })
  function Frame({ usePanelInfo, renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'sidebar' | 'main'>) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    return (
      <>
        <aside>{renderSlot('sidebar', { collapsed: false, width: 236, drawer: false })}</aside>
        <main>{renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })}</main>
      </>
    )
  }
  await runtime.root.declare({
    sidebar: { kind: 'single', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  }, Frame)
  const sidebar = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, locale, layout, sidebar, view }
}

interface TestPanel {
  id: MainPanelId
  heading: string
  order?: number
  label?: SlotLabel
}

async function mountPanel(runtime: SlotTestRuntime, { heading, ...metadata }: TestPanel) {
  function Icon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
    return (
      <span data-testid={`${metadata.id}-icon`} data-active={active}>
        <IconGlobeOutlineRegular size={size} />
      </span>
    )
  }
  function Body() {
    return (
      <section>
        <h1>{heading}</h1>
        <input aria-label={`${heading} input`} />
        <button type="button">{heading} action</button>
      </section>
    )
  }
  return runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: metadata.id }, Body))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', ...metadata }, Icon))
    },
  })
}

describe('sidebar task navigation', () => {
  it('hides plugin entries while retaining their registered panels', async () => {
    const { runtime, view } = await bench()
    await mountPanel(runtime, { id: PLUGINS, heading: 'Plugins content', label: 'Plugins' })
    await mountPanel(runtime, { id: SCHEDULES, heading: 'Schedule content', label: 'Automation' })
    const navigation = view.getByRole('navigation', { name: 'Global panels' })
    expect(within(navigation).getAllByRole('button').map(button => button.textContent)).toEqual(['Scheduled tasks'])
    expect(runtime.slots.entries('main').some(entry => entry.options.key === PLUGINS)).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Scheduled tasks' }))
    expect(view.getByRole('heading', { name: 'Schedule content' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Scheduled tasks' }).getAttribute('aria-current')).toBe('page')
  })

  it('retains hidden placeholder pages and updates their copy when the locale changes', async () => {
    const { runtime, view, locale, sidebar, layout } = await bench()
    act(() => { layout.selectPanel('sidebar-more' as MainPanelId) })
    expect(view.getByRole('heading', { name: 'More · Coming soon' })).toBeTruthy()
    act(() => { locale.setLocale('zh') })
    expect(view.getByRole('heading', { name: '更多 · 敬请期待' })).toBeTruthy()
    expect(view.getByText('第一版聚焦核心能力：发起任务、单个专家与多个 Skill 协同完成工作。更多应用将在后续版本开放。')).toBeTruthy()
    expect(view.getByRole('main')).toMatchSnapshot()
    for (const [id, title] of [
      ['sidebar-experts', '专家 · 技能 · 连接器 · 敬请期待'],
      ['sidebar-library', '资料库 · 规划中'],
      ['sidebar-assistant', '助理（远程任务） · 功能敬请期待'],
      ['sidebar-project', '项目工作台 · 第二版规划中'],
    ] as const) {
      act(() => { layout.selectPanel(id as MainPanelId) })
      expect(view.getByRole('heading', { name: title })).toBeTruthy()
    }
    await sidebar.dispose()
    expect(runtime.slots.entries('main').some(entry => entry.options.key === 'sidebar-more')).toBe(false)
  })
})
