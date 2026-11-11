import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigSourceOwnershipViolations } from './verify-config-source-ownership.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('configuration source ownership gate', () => {
  it('rejects environment inlines while allowing literal profile defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-config-source-ownership-'))
    roots.push(root)
    const directory = join(root, 'packages/subagent/subagent-claude-code')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'cordis.patch.yml'),
      [
        '- id: direct',
        '  config:',
        '    baseURL: !!js process.env.DEEPSEEK_SEARCH_BASE_URL',
        '- id: by-profile',
        '  config:',
        '    apiKeyEnv: !!js "ctx.get(\'profileContext\')?.name === \'desktop\' ? \'COMPANY_GATEWAY_API_KEY\' : \'DEEPSEEK_API_KEY\'"',
        '    baseURL: !!js "ctx.get(\'profileContext\')?.name === \'desktop\' ? process.env.ENDPOINT : \'https://example.test\'"',
        '',
      ].join('\n'),
    )

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([3, 7].map(line =>
      'packages/subagent/subagent-claude-code/cordis.patch.yml:' + String(line) + ': inlines a credential or endpoint from the environment.'
      + ' The adapter resolves apiKeyEnv through ctx.credentials and the endpoint through the'
      + ' environment snapshot; inlining here bypasses both ladders.',
    ))
  })
})
