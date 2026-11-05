import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { load, dump } from 'js-yaml'
import { expect, it } from 'vitest'

it.each(['web-app', 'headless', 'sdk-app', 'acp-app'])('assembles the shipped %s product identity through Loader', async (bundle) => {
  const rows = load(readFileSync(new URL(`../../${bundle}/cordis.patch.yml`, import.meta.url), 'utf8'), { schema: entryListSchema }) as { id: string; config?: object }[]
  const config = rows.find(row => row.id === 'system-prompt')!.config
  const dir = mkdtempSync(join(tmpdir(), 'hibuddy-persona-'))
  const ctx = new Context()
  try {
    writeFileSync(join(dir, 'cordis.yml'), dump([{ name: 'cordis:system-prompt', config }]))
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins['system-prompt'] = SystemPrompt
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
    await ctx.loader.await()
    ctx.systemPrompt.variable('model', () => 'test-model')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === 'harness:identity')).toBe(false)
    expect(renderPrompt(assembly)).toBe('You are 海智伙伴 (HiBuddy), an AI assistant powered by the test-model model. When introducing yourself, use 海智伙伴 in Chinese and HiBuddy in English. You can help with coding, files, documents, and other tasks using the available tools.')
  } finally {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
