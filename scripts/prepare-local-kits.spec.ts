import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { LOCAL_KITS, prepareLocalKits } from './prepare-local-kits.ts'

/** Kits without a `dsh.client` half are Host-only: no client export and no client artifact, mirroring hi-buddy-account-platform. */
const hiBuddyKits = ['hi-buddy-connector-kit', 'hi-buddy-account-platform']

async function fixture(withHiBuddy = false) {
  const root = await mkdtemp(join(tmpdir(), 'local-kits-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const kitRoot = join(root, 'kit sources')
  const names = LOCAL_KITS.map(kit => kit.name)
  for (const name of withHiBuddy ? [...names, ...hiBuddyKits] : names) {
    const directory = join(kitRoot, name)
    const hostOnly = name === 'hi-buddy-account-platform'
    await mkdir(join(directory, 'lib'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name, main: 'lib/index.js',
      ...(hostOnly ? {} : { exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } } }),
    }))
    await writeFile(join(directory, 'lib/index.js'), 'export function apply() {}\n')
    if (!hostOnly) await writeFile(join(directory, 'lib/client.js'), '// built client\n')
  }
  return { repositoryRoot: join(root, 'host'), kitRoot, build: false }
}

it('links local artifacts and retains the profile config and disabled state across rebuilds', async () => {
  const options = await fixture()
  const home = await prepareLocalKits(options)
  const profile = join(home, 'profiles/web')
  const patch = join(profile, 'cordis.patch.yml')
  const config = '- id: session-pool\n  disabled: true\n  config:\n    sentinel: keep\n'
  await writeFile(patch, config)
  await prepareLocalKits(options)
  expect(await readFile(patch, 'utf8')).toBe(config)
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
    dsh: { profile: { bundles: string[] } }
    dependencies: Record<string, string>
  }
  expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  for (const kit of LOCAL_KITS) {
    expect(await realpath(join(profile, 'node_modules', kit.name))).toBe(await realpath(join(options.kitRoot, kit.name)))
    expect(manifest.dependencies[kit.name]).toBe(`link:${join(options.kitRoot, kit.name)}`)
  }
  expect(manifest.dependencies['hi-buddy-appearance-kit']).toBeUndefined()
})

it('leaves the last profile manifest intact when an artifact is missing', async () => {
  const options = await fixture()
  const home = await prepareLocalKits(options)
  const manifest = join(home, 'profiles/web/package.json')
  const before = await readFile(manifest, 'utf8')
  await rm(join(options.kitRoot, LOCAL_KITS[1].name, 'lib/client.js'))
  await expect(prepareLocalKits(options)).rejects.toThrow('ENOENT')
  expect(await readFile(manifest, 'utf8')).toBe(before)
})

it('rejects a mismatched kit manifest before linking a profile', async () => {
  const options = await fixture()
  await writeFile(join(options.kitRoot, LOCAL_KITS[0].name, 'package.json'), '{}')
  await expect(prepareLocalKits(options)).rejects.toThrow('must declare hi-buddy-claude-kit')
})

it('links and activates only the login bundles in the separate Hi-Buddy home', async () => {
  const options = await fixture(true)
  const webHome = await prepareLocalKits(options)
  const webManifest = await readFile(join(webHome, 'profiles/web/package.json'), 'utf8')
  const companyHome = await prepareLocalKits({ ...options, loginMode: 'company' })
  const home = await prepareLocalKits({ ...options, loginMode: 'hi-buddy' })
  expect(new Set([home, webHome, companyHome]).size).toBe(3)

  const profile = join(home, 'profiles/web')
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
    dsh: { profile: { bundles: string[] } }
  }
  expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...hiBuddyKits])
  for (const name of hiBuddyKits) {
    expect(await realpath(join(profile, 'node_modules', name))).toBe(await realpath(join(options.kitRoot, name)))
  }
  expect(await readFile(join(webHome, 'profiles/web/package.json'), 'utf8')).toBe(webManifest)
})

it('rejects a Hi-Buddy kit that declares a web client without a client export', async () => {
  const options = await fixture(true)
  const manifestPath = join(options.kitRoot, 'hi-buddy-account-platform', 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  await writeFile(manifestPath, JSON.stringify({ ...manifest, dsh: { client: { platform: 'web' } } }))
  await expect(prepareLocalKits({ ...options, loginMode: 'hi-buddy' })).rejects.toThrow('must declare hi-buddy-account-platform')
})
