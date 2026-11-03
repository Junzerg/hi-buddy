/** Desktop upgrades repair legacy connection overrides without changing user data or unrelated settings. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { upgradeCompanyProfile } from '../src/company-profile-upgrade.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(original: string) {
  const root = mkdtempSync(join(tmpdir(), 'lingxi-office-upgrade-'))
  roots.push(root)
  const runtime = join(root, 'runtime')
  runtimeFixture(runtime)
  for (const [name, source] of [['dsh-base', 'base'], ['dsh-web-app', 'web-app']]) {
    writeFileSync(join(runtime, 'node_modules/@deepseek-ai', name!, 'bundle.yml'),
      readFileSync(fileURLToPath(new URL(`../../../packages/bundle/${source}/cordis.patch.yml`, import.meta.url)), 'utf8'))
  }
  const home = join(root, 'home')
  const paths = resolveDesktopPaths(home)
  mkdirSync(paths.profile, { recursive: true })
  const file = join(paths.profile, 'cordis.patch.yml')
  writeFileSync(file, original)
  const credentials = join(home, '.credentials.yaml')
  writeFileSync(credentials, 'legacy-personal-key: fixture-private-value\n')
  return { runtime, paths, file, credentials }
}

const legacy = '# preserve my settings\n- id: locale\n  config:\n    preference: zh\n- id: webserver\n  config:\n    host: 127.0.0.1\n    port: !!js ctx.webStartup.port ?? 3080\n    compression: gzip\n- id: llm-pi-ai\n  config:\n    providers:\n      custom:\n        models: [{id: custom-model}]\n      company-gateway:\n        models: [{id: saved-model}]\n- id: deepseek-account\n  config:\n    companyLogin: false\n    platformOrigin: https://platform.deepseek.com\n    requestTimeoutMs: 12345\n- id: llm-deepseek\n  disabled: false\n'

it('upgrades .3 settings automatically during release preparation and preserves keys, custom providers and saved models', async () => {
  const f = fixture(legacy)
  const manager = new DesktopProjectManager(f.paths, { dsh: f.runtime })
  await manager.applyRelease()
  const after = readFileSync(f.file, 'utf8')
  expect(after.startsWith(legacy.trimEnd())).toBe(true)
  const rows = yaml.load(after, { schema: entryListSchema }) as { id: string; config?: Record<string, unknown>; disabled?: boolean }[]
  expect(rows.findLast(row => row.id === 'webserver')?.config).toMatchObject({ port: 18743, compression: 'gzip' })
  expect(rows.findLast(row => row.id === 'deepseek-account')?.config).toMatchObject({
    companyLogin: true, platformOrigin: 'https://iam-stg.haierxj.com', requestTimeoutMs: 12345,
    inferenceOrigin: 'http://ai-gateway.haierxj.cn', companyLoginEndpoint: 'http://172.28.236.3:18765/company-login/exchange',
  })
  expect(rows.findLast(row => row.id === 'llm-pi-ai')?.config).toMatchObject({ providers: {
    custom: { models: [{ id: 'custom-model' }] },
    'company-gateway': { displayName: 'HaierCash', api: 'openai-completions',
      apiKeyEnv: 'COMPANY_GATEWAY_API_KEY', baseURL: 'http://ai-gateway.haierxj.cn/v1', models: [{ id: 'saved-model' }] },
  } })
  expect(rows.findLast(row => row.id === 'llm-deepseek')?.disabled).toBe(true)
  expect(rows.find(row => row.id === 'locale')?.config).toEqual({ preference: 'zh' })
  expect(readFileSync(f.credentials, 'utf8')).toBe('legacy-personal-key: fixture-private-value\n')
  const backups = readdirSync(f.paths.profile).filter(name => name.includes('.before-company-upgrade-'))
  expect(backups).toHaveLength(1)
  expect(readFileSync(join(f.paths.profile, backups[0]!), 'utf8')).toBe(legacy)
  await manager.applyRelease()
  expect(readFileSync(f.file, 'utf8')).toBe(after)
  expect(readdirSync(f.paths.profile).filter(name => name.includes('.before-company-upgrade-'))).toHaveLength(1)
})

it.each(['[]\n', '# fresh profile\n[]\n', '- id: locale\n  config:\n    preference: en\n'])
('uses built-in company defaults without rewriting profiles with no legacy connections: %s', async (original) => {
  const f = fixture(original)
  await upgradeCompanyProfile(f.runtime, f.paths.profile)
  expect(readFileSync(f.file, 'utf8')).toBe(original)
  expect(readdirSync(f.paths.profile)).toEqual(['cordis.patch.yml'])
})

it('reads the ordered patch array declared by the bundled Web application', async () => {
  const f = fixture(legacy)
  const manifest = join(f.runtime, 'node_modules/@deepseek-ai/dsh-web-app/package.json')
  const value = JSON.parse(readFileSync(manifest, 'utf8')) as { dsh: { bundle: { patch: string[] } } }
  value.dsh.bundle.patch = ['./bundle.yml']
  writeFileSync(manifest, JSON.stringify(value))
  await upgradeCompanyProfile(f.runtime, f.paths.profile)
  expect(readFileSync(f.file, 'utf8')).toContain('HaierCash')
})

it.each(['[{id: llm-pi-ai, config: {providers: {}}}]\n', '[{id: llm-pi-ai, config: {providers: {}}},]\n'])
('adds the built-in company route to legacy provider overrides in flow YAML: %s', async (original) => {
  const f = fixture(original)
  await upgradeCompanyProfile(f.runtime, f.paths.profile)
  const rows = yaml.load(readFileSync(f.file, 'utf8'), { schema: entryListSchema }) as { config: { providers: Record<string, { displayName: string }> } }[]
  expect(rows.at(-1)?.config.providers['company-gateway']?.displayName).toBe('HaierCash')
})

it.each([': invalid fixture-private-value', '- id: llm-pi-ai\n  config:\n    providers: invalid\n'])
('preserves invalid user settings and refuses a partial rewrite: %s', async (original) => {
  const f = fixture(original)
  await expect(upgradeCompanyProfile(f.runtime, f.paths.profile)).rejects.toThrow('Desktop company upgrade:')
  expect(readFileSync(f.file, 'utf8')).toBe(original)
  expect(readdirSync(f.paths.profile)).toEqual(['cordis.patch.yml'])
})

it.each([legacy, '[]\n'])('uses 3080 for unpackaged Desktop development while retaining company IAM: %s', async (original) => {
  const f = fixture(original)
  const development = new DesktopProjectManager(f.paths, { dsh: f.runtime, development: true })
  await development.applyRelease()
  const rows = yaml.load(readFileSync(f.file, 'utf8'), { schema: entryListSchema }) as { id: string; config?: Record<string, unknown> }[]
  expect(rows.findLast(row => row.id === 'webserver')?.config).toMatchObject({ port: 3080 })
  const baseAccount = original === legacy ? rows.findLast(row => row.id === 'deepseek-account')?.config : undefined
  if (baseAccount !== undefined) expect(baseAccount).toMatchObject({
    companyLogin: true, platformOrigin: 'https://iam-stg.haierxj.com',
    companyLoginEndpoint: 'http://172.28.236.3:18765/company-login/exchange',
  })
  const prepared = readFileSync(f.file, 'utf8')
  await development.applyRelease()
  expect(readFileSync(f.file, 'utf8')).toBe(prepared)
  await new DesktopProjectManager(f.paths, { dsh: f.runtime }).applyRelease()
  const packaged = yaml.load(readFileSync(f.file, 'utf8'), { schema: entryListSchema }) as { id: string; config?: Record<string, unknown> }[]
  expect(packaged.findLast(row => row.id === 'webserver')?.config).toMatchObject({ port: 18743 })
})
