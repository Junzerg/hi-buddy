/** Desktop migration removes the legacy company-login connection row so the
 *  bundled Hi-Buddy account chain applies; user data and unrelated rows stay. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { migrateCompanyProfile } from '../src/company-profile-upgrade.ts'
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
  const home = join(root, 'home')
  const paths = resolveDesktopPaths(home)
  mkdirSync(paths.profile, { recursive: true })
  const file = join(paths.profile, 'cordis.patch.yml')
  writeFileSync(file, original)
  const credentials = join(home, '.credentials.yaml')
  writeFileSync(credentials, 'legacy-personal-key: fixture-private-value\n')
  return { runtime, paths, file, credentials }
}

const legacy = '# preserve my settings\n- id: locale\n  config:\n    preference: zh\n'
  + '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: !!js ctx.webStartup.port ?? 3080\n    compression: gzip\n'
  + '- id: llm-pi-ai\n  config:\n    providers:\n      custom:\n        models: [{id: custom-model}]\n'
  + '- id: deepseek-account\n  config:\n    companyLogin: false\n    platformOrigin: https://platform.deepseek.com\n    requestTimeoutMs: 12345\n'
  + '- id: llm-deepseek\n  disabled: false\n'

it('migrates via applyRelease: the company-connection row is removed, everything else survives', async () => {
  const f = fixture(legacy)
  const manager = new DesktopProjectManager(f.paths, { dsh: f.runtime })
  await manager.applyRelease()
  const after = readFileSync(f.file, 'utf8')
  // 机器写入的 company 连接行整体删除；其余行与用户数据原样保留。
  expect(after).not.toContain('companyLogin')
  expect(after).not.toContain('deepseek-account')
  expect(after).toContain('preference: zh')
  expect(after).toContain('custom-model')
  expect(after).toContain('!!js')
  expect(rows(after).some(row => row.id === 'locale')).toBe(true)
  expect(readFileSync(f.credentials, 'utf8')).toBe('legacy-personal-key: fixture-private-value\n')
  const backups = readdirSync(f.paths.profile).filter(name => name.includes('.before-company-upgrade-'))
  expect(backups).toHaveLength(1)
  expect(readFileSync(join(f.paths.profile, backups[0]!), 'utf8')).toBe(legacy)
})

it('migrates directly and is idempotent: a patch without the legacy row stays byte-identical', async () => {
  const f = fixture(legacy)
  await migrateCompanyProfile(f.paths.profile)
  const once = readFileSync(f.file, 'utf8')
  expect(once).not.toContain('companyLogin')
  await migrateCompanyProfile(f.paths.profile)
  expect(readFileSync(f.file, 'utf8')).toBe(once)
})

it('a deepseek-account row without companyLogin is user-authored and stays', async () => {
  const original = '- id: deepseek-account\n  config:\n    requestTimeoutMs: 12345\n'
  const f = fixture(original)
  await migrateCompanyProfile(f.paths.profile)
  expect(readFileSync(f.file, 'utf8')).toBe(original)
  expect(readdirSync(f.paths.profile).filter(name => name.includes('.before-company-upgrade-'))).toHaveLength(0)
})

it('invalid profile YAML throws and the original file is preserved', async () => {
  const original = '- id: deepseek-account\n  config: [unclosed\n'
  const f = fixture(original)
  await expect(migrateCompanyProfile(f.paths.profile)).rejects.toThrow(/invalid profile YAML/)
  expect(readFileSync(f.file, 'utf8')).toBe(original)
})

function rows(text: string): { id: string; config?: Record<string, unknown>; disabled?: boolean }[] {
  return yaml.load(text, { schema: entryListSchema }) as { id: string; config?: Record<string, unknown>; disabled?: boolean }[]
}
