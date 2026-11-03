/** Public questionnaire options are emitted in the page bootstrap. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config } from '../src/index.ts'
import { CONTACT_CONFIG_GLOBAL } from '../src/contact-config.ts'

/** The Peer an index render speaks for; this listener reads no field of it. */
const PAGE_PEER = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]

it('injects configured contact options and removes the listener on disposal', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const config: Config = Config({ feedbackDestination: 'internal-team', contactSource: 'harness', bonusAckRetryDelayMs: 25, bonusAckRetryMaxDelayMs: 100 })
  await ctx.plugin({ Config, apply }, { feedbackDestination: 'internal-team', contactSource: 'harness', bonusAckRetryDelayMs: 25, bonusAckRetryMaxDelayMs: 100 })
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table, PAGE_PEER)
  expect(table).toEqual([{ kind: 'global', name: CONTACT_CONFIG_GLOBAL, value: {
    feedbackDestination: 'internal-team',
    contactFormUrl: config.contactFormUrl, contactSource: config.contactSource,
    bonusAckRetryDelayMs: 25, bonusAckRetryMaxDelayMs: 100,
  } }])
  await ctx.fiber.dispose()
  table.length = 0
  ctx.emit('webserver/index-inject', table, PAGE_PEER)
  expect(table).toEqual([])
})

it('hides the generated account form and releases its policy on disposal', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const release = vi.fn()
  const configure = vi.fn(() => release)
  ctx.provide('settings', { configure } as never)
  const fiber = await ctx.plugin({ Config, apply })
  await ctx.fiber.await()
  expect(configure).toHaveBeenCalledWith({ auto: false }, fiber)
  await fiber.dispose()
  expect(release).toHaveBeenCalledOnce()
})

it('publishes mandatory IAM only when the deployment enables it', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const fiber = await ctx.plugin({ Config, apply }, { requireIamLogin: true })
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table, PAGE_PEER)
  expect(table).toContainEqual({ kind: 'global', name: '__DSH_REQUIRE_IAM_LOGIN__', value: true })
  await fiber.dispose()
  table.length = 0
  ctx.emit('webserver/index-inject', table, PAGE_PEER)
  expect(table).toEqual([])
})
