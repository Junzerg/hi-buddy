/** Build sibling kit sources and link them into an isolated development profile. */
import { mkdir, readFile, rename, writeFile, access, realpath, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import { PROFILE_TEMPLATES } from '../packages/util/official-bundles/src/bundles.ts'
import type { DevMode } from '../haiercash/haier-simulator/profile.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Kits linked by the standard development profile. */
export const LOCAL_KITS = [
  { id: 'hi-buddy-claude', name: 'hi-buddy-claude-kit' },
  { id: 'project-glossary', name: 'hi-buddy-glossary-kit' },
  { id: 'session-pool', name: 'hi-buddy-session-pool-kit' },
] as const

const HI_BUDDY_KITS = [
  { id: 'hi-buddy-connector', name: 'hi-buddy-connector-kit' },
  { id: 'hi-buddy-account-platform', name: 'hi-buddy-account-platform' },
] as const

/** Give each login mode its own development home and credential store. */
export function localKitsStateDirectory(repositoryRoot: string, loginMode?: DevMode): string {
  return resolve(repositoryRoot, '.artifacts', loginMode === undefined ? 'local-kits' : `local-kits-${loginMode}`)
}

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
  /** Omit for the standard Web home. Hi-Buddy mode also links its login and connector kits. */
  loginMode?: DevMode
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
  const selected = options.loginMode === 'hi-buddy' ? [...LOCAL_KITS, ...HI_BUDDY_KITS] : LOCAL_KITS
  const kits = await Promise.all(selected.map(async (kit) => {
    const directory = resolve(kitRoot, kit.name)
    const manifestPath = resolve(directory, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch((cause: unknown) => {
      throw new Error(`local-kits: cannot read ${manifestPath}. Check out the matching hi-buddy-kit-packages branch.`, { cause })
    })) as KitManifest
    const hostOnly = kit.name === 'hi-buddy-account-platform' && manifest.dsh?.client === undefined
    const client = hostOnly ? undefined : manifest.exports?.['./client']
    if (manifest.name !== kit.name || typeof manifest.main !== 'string'
      || (!hostOnly && (manifest.dsh?.client?.platform !== 'web' || typeof client !== 'string'))) {
      throw new Error(`local-kits: ${directory} must declare ${kit.name} with Host${hostOnly ? '' : ' and Web Client'} entries`)
    }
    return {
      ...kit, directory, host: resolve(directory, manifest.main),
      ...(client !== undefined ? { client: resolve(directory, client) } : {}),
    }
  }))
  for (const kit of kits) {
    if (options.build !== false) {
      const invocation = pnpmInvocation(['run', 'build'])
      await execa(invocation.command, invocation.args, { cwd: kit.directory, stdio: 'inherit', ...(options.signal !== undefined ? { cancelSignal: options.signal } : {}) })
    }
    await Promise.all([access(kit.host), ...(kit.client !== undefined ? [access(kit.client)] : [])])
  }
  const home = resolve(localKitsStateDirectory(options.repositoryRoot, options.loginMode), 'home')
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
  if (options.loginMode === 'hi-buddy') {
    const fallback = PROFILE_TEMPLATES.web
    if (fallback === undefined) throw new Error('local-kits: PROFILE_TEMPLATES.web template is missing')
    const profileSection = (manifest.dsh as { profile?: { bundles?: unknown } } | undefined)?.profile ?? fallback
    const active = Array.isArray(profileSection.bundles)
      ? profileSection.bundles.filter((name): name is string => typeof name === 'string')
      : fallback.bundles
    manifest.dsh = {
      ...(manifest.dsh as Record<string, unknown>),
      profile: { ...profileSection, bundles: [...new Set([...active, ...HI_BUDDY_KITS.map(kit => kit.name)])] },
    }
  }
  const temporary = `${manifestPath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n')
  await rename(temporary, manifestPath)
  return home
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      'kit-root': { type: 'string' }, 'no-build': { type: 'boolean' },
      haier: { type: 'boolean' }, hibuddy: { type: 'boolean' },
    } })
    if (values.haier && values.hibuddy) throw new Error('--haier and --hibuddy are mutually exclusive')
    const loginMode = values.hibuddy ? 'hi-buddy' : values.haier ? 'company' : undefined
    const home = await prepareLocalKits({
      repositoryRoot: resolve(import.meta.dirname, '..'),
      ...(values['kit-root'] !== undefined ? { kitRoot: resolve(values['kit-root']) } : {}),
      ...(loginMode !== undefined ? { loginMode } : {}),
      build: !values['no-build'],
    })
    console.log(`local-kits: DSH_HOME=${home}`)
    const modeFlag = values.hibuddy ? ' --hibuddy' : values.haier ? ' --haier' : ''
    console.log(`Start Web with: pnpm run dev:web --kits${modeFlag}`)
    console.log(`After kit or shared edits, rerun pnpm run prepare:local-kits${modeFlag}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
