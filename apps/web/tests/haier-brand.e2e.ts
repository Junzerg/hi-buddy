/** The workbench ships local official artwork and keeps sidebar colors out of body surfaces. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { openSettings } from './support.ts'

it('loads local Haier artwork, responds to home interactions, and respects reduced motion and the dark palette', async () => {
  const kitRoot = process.env.DSH_LOCAL_KIT_ROOT
  const scaffold = await launchWebScaffold(kitRoot === undefined ? {} : { profile: { packages: [
    { dir: join(kitRoot, 'hi-buddy-glossary-kit') },
    { dir: join(kitRoot, 'hi-buddy-claude-kit') },
  ] } })
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Haier background preview')
  const started = await seedSession(scaffold, await readFile(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url), 'utf8'), 'haier-background-started')
  await workspace.attachSession(started)
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'no-preference' })
  const previewRoot = new URL('../../../.artifacts/haier-blue/', import.meta.url).pathname
  await mkdir(previewRoot, { recursive: true })
  const screenshots = await mkdtemp(join(previewRoot, 'interaction-'))
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const title = page.getByTestId('hero-headline')
  await title.waitFor()
  const divider = page.getByRole('separator', { name: '调整左侧栏宽度', exact: true })
  const edge = await divider.boundingBox()
  if (edge === null) throw new Error('Sidebar divider is missing')
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2)
  await page.mouse.down()
  await page.mouse.move(edge.x + edge.width / 2 + 100, edge.y + edge.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('336')
  await divider.press('Home')
  await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('220')
  await divider.press('ArrowRight')
  await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('236')
  expect(await page.locator('[data-workbench-topbar]').count()).toBe(0)
  const navigation = page.locator('[data-conversation-header-navigation]')
  expect(await navigation.getByRole('button', { name: '任务概览', exact: true }).count()).toBe(1)
  const background = page.locator('[data-brand-background]')
  const mark = page.getByTestId('hero-brand-mark')
  const artwork = await background.evaluate(node => getComputedStyle(node, '::before').backgroundImage)
  const imageUrl = /url\("?([^"\)]+)"?\)/.exec(artwork)?.[1]
  if (imageUrl === undefined) throw new Error(`Hero artwork is missing: ${artwork}`)
  expect(new URL(imageUrl).origin).toBe(new URL(scaffold.authenticatedUrl).origin)
  const image = await page.request.get(imageUrl)
  expect(image.status(), imageUrl).toBe(200)
  const source = await readFile(new URL('../../../packages/client/ui-theme/src/client/assets/haier-brothers.png', import.meta.url))
  expect(createHash('sha256').update(await image.body()).digest('hex')).toBe(createHash('sha256').update(source).digest('hex'))

  const welcome = page.getByRole('button', { name: '继续', exact: true })
  if (await welcome.isVisible()) await welcome.click()
  const home = page.locator('[data-conversation-content][data-content-phase="hero"]')
  const mascotTransform = () => mark.evaluate(node => getComputedStyle(node).transform)
  const homeBounds = await home.boundingBox()
  if (homeBounds === null) throw new Error('Blank home is missing')
  await page.mouse.move(homeBounds.x + homeBounds.width * 0.2, homeBounds.y + homeBounds.height * 0.25)
  await expect.poll(() => home.getAttribute('data-hero-pointer')).toBe('')
  const gaze = () => page.locator('[data-brand-eye]').evaluateAll(nodes => nodes.map(node => ({
    x: Number.parseFloat((node as HTMLElement).style.getPropertyValue('--dsh-eye-gaze-x')),
    y: Number.parseFloat((node as HTMLElement).style.getPropertyValue('--dsh-eye-gaze-y')),
  })))
  await expect.poll(async () => (await gaze()).filter(eye => eye.x < 0 && eye.y < 0).length).toBe(4)
  await expect.poll(mascotTransform).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
  await expect.poll(() => background.evaluate(node => getComputedStyle(node).transform)).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
  expect(await background.evaluate(node => getComputedStyle(node).opacity)).toBe('0.7')
  await page.screenshot({ path: join(screenshots, 'home-pointer.png') })
  const leftTransform = await mascotTransform()
  await page.mouse.move(homeBounds.x + homeBounds.width * 0.99, homeBounds.y + homeBounds.height * 0.98)
  await expect.poll(async () => (await gaze()).filter(eye => eye.x > 0 && eye.y > 0).length).toBe(4)
  await page.screenshot({ path: join(screenshots, 'home-look-right.png') })
  await page.mouse.move(homeBounds.x + homeBounds.width * 0.8, homeBounds.y + homeBounds.height * 0.25)
  await expect.poll(mascotTransform).not.toBe(leftTransform)
  const editor = page.locator('textarea, [contenteditable="true"]').first()
  const modelTrigger = page.getByRole('button', { name: /^选择模型/ })
  await modelTrigger.hover()
  expect(await modelTrigger.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await modelTrigger.click()
  expect(await modelTrigger.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  const modelMenu = page.getByRole('group', { name: '模型与推理等级', exact: true })
  await modelMenu.waitFor()
  expect(await modelMenu.locator(':scope > div[aria-hidden="true"]').first().evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await page.keyboard.press('Escape')
  await editor.focus()
  await expect.poll(() => mark.evaluate(node => getComputedStyle(node).getPropertyValue('--hero-attention-y').trim())).toBe('4px')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => home.getAttribute('data-hero-pointer')).toBeNull()
  await expect.poll(mascotTransform).toBe('none')
  await expect.poll(() => background.evaluate(node => getComputedStyle(node).transform)).toBe('none')
  expect(await page.locator('[data-brand-eye][style*="gaze"]').count()).toBe(0)
  await page.mouse.move(homeBounds.x + homeBounds.width * 0.3, homeBounds.y + homeBounds.height * 0.5)
  await expect.poll(() => home.getAttribute('data-hero-pointer')).toBeNull()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.mouse.move(homeBounds.x + homeBounds.width * 0.7, homeBounds.y + homeBounds.height * 0.5)
  await expect.poll(() => home.getAttribute('data-hero-pointer')).toBe('')
  await page.mouse.move(0, 0)
  await expect.poll(() => home.getAttribute('data-hero-pointer')).toBeNull()
  await expect.poll(async () => (await gaze()).filter(eye => eye.x < 0 && eye.y < 0).length).toBe(4)

  await expect.poll(() => mark.locator('stop').evaluateAll(nodes => nodes.map(node => node.getAttribute('stop-color')))).toEqual(['#004890', '#0E9F6E'])
  expect(await page.locator('[data-brand-buckle] svg').count()).toBe(2)
  const frost = await background.evaluate(node => ({
    mask: getComputedStyle(node, '::after').maskImage,
    blur: getComputedStyle(node, '::after').filter,
  }))
  expect(frost.mask).toContain('linear-gradient')
  expect(frost.blur).toBe('blur(14px)')

  const alpha = await page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Image inspection is unavailable')
    context.drawImage(image, 0, 0)
    return [context.getImageData(0, 0, 1, 1).data[3], context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3]]
  }, imageUrl)
  expect(alpha).toEqual([0, 0])
  await editor.blur()
  await page.screenshot({ path: join(screenshots, 'home.png') })

  await page.locator(`[data-row-key="session:${started}"]`).click()
  const active = page.locator('[data-conversation-content][data-content-phase="active"]')
  await active.waitFor()
  expect(await page.locator('[data-workbench-topbar]').count()).toBe(0)
  expect(await page.locator('[data-conversation-header-navigation]').getByRole('button', { name: '任务概览', exact: true }).count()).toBe(1)
  expect(await navigation.locator('..').getByText('Use the read tool twice', { exact: true }).count()).toBe(1)
  await navigation.getByRole('button', { name: '任务概览', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Use the read tool twice', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await navigation.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await expect.poll(() => navigation.getByRole('button', { name: '收起侧栏', exact: true }).count()).toBe(1)
  await navigation.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await expect.poll(() => navigation.getByRole('button', { name: '展开侧栏', exact: true }).count()).toBe(1)
  await expect.poll(() => background.evaluate(node => getComputedStyle(node, '::after').filter)).toBe('blur(12px)')
  await page.screenshot({ path: join(screenshots, 'conversation.png') })
  await page.getByRole('tab', { name: '轨迹', exact: true }).click()
  const trajectory = page.locator('[data-trajectory-scroll]')
  await trajectory.waitFor()
  expect(await trajectory.evaluate(node => getComputedStyle(node.parentElement!).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  expect(await page.locator('[data-conversation-composer-overlay]').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({ path: join(screenshots, 'trajectory.png') })
  await page.getByRole('tab', { name: '对话', exact: true }).click()
  await page.getByRole('button', { name: '文档库', exact: true }).click()
  const pageBar = page.locator('[data-workbench-topbar]')
  await pageBar.waitFor()
  expect(await pageBar.getByText('文档库', { exact: true }).count()).toBe(1)
  expect(await background.getAttribute('data-brand-background')).toBe('blurred')
  await page.screenshot({ path: join(screenshots, 'documents-header.png') })
  if (kitRoot !== undefined) {
    await page.getByRole('button', { name: '海消术语表', exact: true }).click()
    await page.getByRole('heading', { name: '海消术语表', exact: true }).waitFor()
    expect(await page.locator('[data-brand-background="blurred"]').count()).toBe(1)
    await page.screenshot({ path: join(screenshots, 'glossary.png') })
    await page.getByRole('button', { name: 'Claude', exact: true }).click()
    await page.getByRole('main', { name: '聊天', exact: true }).locator('[data-brand-background="blurred"]').waitFor()
    await page.screenshot({ path: join(screenshots, 'claude.png') })
  }
  await pageBar.getByRole('button', { name: '任务概览', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Use the read tool twice', exact: true }).click()
  await active.waitFor()
  await openSettings(page, 'zh')
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.waitFor()
  const settingsArtwork = await settings.locator('[data-brand-background]').evaluate(node => ({ image: getComputedStyle(node, '::after').backgroundImage, blur: getComputedStyle(node, '::after').filter, left: getComputedStyle(node).left }))
  expect(settingsArtwork.image).toContain('haier-brothers')
  expect(settingsArtwork.blur).toBe('blur(12px)')
  expect(settingsArtwork.left).toBe('12px')
  await page.screenshot({ path: join(screenshots, 'settings.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /收起左侧栏|折叠左侧栏/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: join(screenshots, 'mobile.png') })
  await page.getByRole('button', { name: '展开左侧栏', exact: true }).click()
  await page.getByRole('button', { name: '新建任务', exact: true }).filter({ hasText: '新建任务' }).click()
  await title.waitFor()
  await page.getByRole('button', { name: '收起左侧栏', exact: true }).click()
  const mobileArtwork = await background.evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }))
  expect(Math.abs(mobileArtwork.width / mobileArtwork.height - 1281 / 1227)).toBeLessThan(0.01)
  expect(await page.locator('[data-brand-eye]').count()).toBe(4)
  await page.screenshot({ path: join(screenshots, 'home-mobile.png') })
  console.log(`Haier UI previews: ${screenshots}`)

  const palette = () => page.evaluate(() => {
    const body = getComputedStyle(document.body)
    const sidebar = document.querySelector('[class*="_sidebarCol"]')
    if (sidebar === null) throw new Error('Sidebar column is missing')
    const canvas = document.createElement('canvas').getContext('2d')
    if (canvas === null) throw new Error('Browser color normalization is unavailable')
    const normalized = (value: string): string => {
      canvas.fillStyle = value
      return canvas.fillStyle
    }
    return {
      body: normalized(body.getPropertyValue('--dsw-alias-label-primary').trim()),
      base: normalized(body.getPropertyValue('--dsw-alias-bg-base').trim()),
      sidebar: normalized(getComputedStyle(sidebar).getPropertyValue('--dsw-alias-label-primary').trim()),
    }
  })
  await expect.poll(palette).toEqual({ body: '#1a202c', base: '#eef4fb', sidebar: '#f4f8ff' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(palette).toEqual({ body: '#f9fafb', base: '#151517', sidebar: '#f9fafb' })
  expect(tripwire.pageErrors).toEqual([])
})
