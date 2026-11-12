/** Build sibling kit sources and link them into an isolated development profile. */
import { mkdir, readFile, rename, writeFile, access, realpath, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import { PROFILE_TEMPLATES } from '../packages/util/official-bundles/src/bundles.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Existing Web roster rows whose release archives have sibling sources. */
export const LOCAL_KITS = [
  { id: 'hi-buddy-claude', name: 'hi-buddy-claude-kit' },
  { id: 'project-glossary', name: 'hi-buddy-glossary-kit' },
  { id: 'session-pool', name: 'hi-buddy-session-pool-kit' },
] as const

interface KitManifest {
  name: string
  main?: string
  exports?: { './client'?: string }
  dsh?: { client?: { platform?: string } }
}

/** Inputs for local development; release manifests and archives are never rewritten. */
export interface LocalKitOptions {
  repositoryRoot: string
  kitRoot?: string
  /** False validates existing artifacts without rebuilding them. */
  build?: boolean
  /** Cancels an in-progress build when the owning development loop stops. */
  signal?: AbortSignal
}

/**
 * Build and link the kits without changing the shipped roster or any profile patch.
 * @param options - repository paths and whether to build or validate existing artifacts.
 * @returns isolated Harness home; launch the Web profile with this `DSH_HOME`.
 */
export async function prepareLocalKits(options: LocalKitOptions): Promise<string> {
  const kitRoot = options.kitRoot ?? resolve(options.repositoryRoot, '../hi-buddy-kit-packages')
  const kits = await Promise.all(LOCAL_KITS.map(async (kit) => {
    const directory = resolve(kitRoot, kit.name)
    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as KitManifest
    if (manifest.name !== kit.name || manifest.dsh?.client?.platform !== 'web'
      || typeof manifest.main !== 'string' || typeof manifest.exports?.['./client'] !== 'string') {
      throw new Error(`local-kits: ${directory} must declare ${kit.name} with Host and Web Client entries`)
    }
    return { ...kit, directory, host: resolve(directory, manifest.main), client: resolve(directory, manifest.exports['./client']) }
  }))
  for (const kit of kits) {
    if (options.build !== false) {
      const invocation = pnpmInvocation(['run', 'build'])
      await execa(invocation.command, invocation.args, { cwd: kit.directory, stdio: 'inherit', ...(options.signal !== undefined ? { cancelSignal: options.signal } : {}) })
    }
    await Promise.all([access(kit.host), access(kit.client)])
  }
  const home = resolve(options.repositoryRoot, '.artifacts/local-kits/home')
  const profile = resolve(home, 'profiles/web')
  await mkdir(resolve(profile, 'node_modules'), { recursive: true })
  for (const kit of kits) {
    const link = resolve(profile, 'node_modules', kit.name)
    try {
      const target = await realpath(link)
      if (target !== await realpath(kit.directory)) {
        throw new Error(`local-kits: ${link} points to another checkout; use its kit sources or remove this generated link`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await symlink(kit.directory, link, process.platform === 'win32' ? 'junction' : 'dir')
    }
  }
  const manifestPath = resolve(profile, 'package.json')
  let manifest: { dependencies?: Record<string, string>; [key: string]: unknown }
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    manifest = { private: true, dsh: { profile: PROFILE_TEMPLATES.web } }
  }
  manifest.dependencies = { ...manifest.dependencies, ...Object.fromEntries(kits.map(kit => [kit.name, `link:${kit.directory}`])) }
  const temporary = `${manifestPath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n')
  await rename(temporary, manifestPath)
  return home
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { 'kit-root': { type: 'string' }, 'no-build': { type: 'boolean' } } })
    const home = await prepareLocalKits({
      repositoryRoot: resolve(import.meta.dirname, '..'),
      ...(values['kit-root'] !== undefined ? { kitRoot: resolve(values['kit-root']) } : {}),
      build: !values['no-build'],
    })
    console.log(`local-kits: DSH_HOME=${home}`)
    console.log('Start the real Web application with: pnpm run dev:web --kits')
    console.log('After kit/shared edits, rerun pnpm run prepare:local-kits; the Host reloads changed client bundles.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
