import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { runInNewContext } from 'node:vm'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  Config, apply,
} from '@deepseek-ai/dsh-client-locale'


describe('locale host', () => {
  it('projects the current language before plugins start and removes the projection on disposal', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const collect = (): IndexInjection[] => {
      const table: IndexInjection[] = []
      ctx.emit('webserver/index-inject', table, { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1])
      return table
    }
    const resolve = (languages: string[]): string => {
      const [row] = collect()
      expect(row).toMatchObject({ kind: 'script', placement: 'body' })
      if (row?.kind !== 'script') throw new Error('missing locale bootstrap script')
      const document = { documentElement: { lang: '' } }
      runInNewContext(row.text, { document, navigator: { languages, language: languages[0] ?? '' } })
      return document.documentElement.lang
    }
    try {
      expect(resolve(['zh-CN', 'en-US'])).toBe('zh-CN')
      expect(resolve(['en-US', 'zh-CN'])).toBe('en')
      expect(resolve(['fr-FR', 'zh-TW'])).toBe('zh-CN')
      expect(resolve(['fr-FR'])).toBe('en')
      await configuration.update({ preference: 'en' })
      expect(resolve(['zh-CN'])).toBe('en')
      await configuration.update({ preference: 'zh' })
      expect(resolve(['en-US'])).toBe('zh-CN')
      await configuration.update({ preference: 'pt-BR' })
      expect(resolve(['zh-CN'])).toBe('zh-CN')
    } finally {
      await configuration.fiber.dispose()
    }
    expect(collect()).toEqual([])
  })

  it('registers an open locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({})
    await configuration.update({ preference: 'en' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: 'en' })
    await configuration.update({ preference: 'pt-BR' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: 'pt-BR' })
    await expect(configuration.update({ preference: 'bad locale' })).rejects.toThrow()
    await expect(configuration.update({ preference: '123' })).rejects.toThrow()
    await fiber.dispose()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
