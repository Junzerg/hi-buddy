/** Reconcile legacy Desktop overrides with the company's built-in login and model configuration. */
import { copyFileSync, constants, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parse(text: string): Record<string, unknown>[] {
  let value: unknown
  try { value = yaml.load(text, { schema: entryListSchema }) }
  catch { throw new Error('Desktop company upgrade: invalid profile YAML; the original file was preserved') }
  if (!Array.isArray(value) || !value.every(object)) throw new Error('Desktop company upgrade: expected a patch list')
  return value
}

function bundleRows(runtime: string, name: string): Record<string, unknown>[] {
  const root = join(runtime, 'node_modules', '@deepseek-ai', name)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dsh?: { bundle?: { patch?: string | string[] } } }
  const patch = manifest.dsh?.bundle?.patch
  const files = typeof patch === 'string' ? [patch] : patch
  if (!Array.isArray(files) || !files.every(file => typeof file === 'string')) throw new Error('Desktop company upgrade: missing bundled patch')
  return files.flatMap(file => parse(readFileSync(join(root, file), 'utf8')))
    .flatMap(row => Array.isArray(row.insert) ? row.insert.filter(object) : [])
}

function append(original: string, patches: Record<string, unknown>[]): string {
  const wanted = [...parse(original), ...patches]
  const options = { schema: entryListSchema }
  const candidates = [original.trimEnd() + '\n' + yaml.dump(patches, options)]
  const end = original.lastIndexOf(']')
  if (end >= 0) for (const separator of parse(original).length ? [', ', ' '] : [' ']) {
    candidates.push(original.slice(0, end) + separator
      + patches.map(patch => yaml.dump(patch, { ...options, flowLevel: 0 }).trim()).join(', ')
      + original.slice(end))
  }
  for (const candidate of candidates) {
    try {
      if (isDeepStrictEqual(parse(candidate), wanted)) return candidate.trimEnd() + '\n'
    } catch (_unsupportedLayout) { /* Another layout may preserve the complete original document. */ }
  }
  throw new Error('Desktop company upgrade: unsupported patch layout; the original file was preserved')
}

/**
 * Upgrade only legacy company connection overrides while the caller holds the Desktop profile lock.
 * @param runtime - verified bundled dsh directory containing the deployment defaults.
 * @param profile - reserved Desktop profile directory, before starting its Host.
 * @returns after backing up and atomically replacing changed overrides; credentials and other settings are untouched.
 */
export async function upgradeCompanyProfile(runtime: string, profile: string): Promise<void> {
  const base = bundleRows(runtime, 'dsh-base')
  const account = base.find(row => row.id === 'deepseek-account')?.config
  if (!object(account) || account.companyLogin !== true) return
  const defaults = [...base, ...bundleRows(runtime, 'dsh-web-app')]
  const file = join(profile, 'cordis.patch.yml')
  const original = readFileSync(file, 'utf8')
  const current = parse(original)
  const patches: Record<string, unknown>[] = []
  for (const id of ['webserver', 'deepseek-account', 'llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account']) {
    const builtin = defaults.findLast(row => row.id === id)
    if (!builtin) throw new Error('Desktop company upgrade: missing built-in entry')
    const overrides = current.filter(row => row.id === id)
    let config = builtin.config
    for (const row of overrides) if (row.config !== undefined) config = row.config
    if (id === 'llm-deepseek' || id === 'llm-deepseek-account') {
      const disabled = overrides.findLast(row => row.disabled !== undefined)?.disabled ?? builtin.disabled
      if (disabled !== true) patches.push({ id, disabled: true })
      continue
    }
    if (!object(config) || !object(builtin.config)) throw new Error('Desktop company upgrade: invalid connection settings')
    let next: Record<string, unknown>
    if (id === 'webserver') next = { ...builtin.config, ...config, port: 18743 }
    else if (id === 'deepseek-account') next = { ...builtin.config, ...config,
      companyLogin: true, companyLoginEndpoint: account.companyLoginEndpoint,
      platformOrigin: account.platformOrigin, inferenceOrigin: account.inferenceOrigin }
    else {
      if (!object(builtin.config.providers) || !object(builtin.config.providers['company-gateway'])) throw new Error('Desktop company upgrade: missing built-in company provider')
      if (config.providers !== undefined && !object(config.providers)) throw new Error('Desktop company upgrade: invalid provider settings')
      const providers = object(config.providers) ? config.providers : {}
      if (providers['company-gateway'] !== undefined && !object(providers['company-gateway'])) throw new Error('Desktop company upgrade: invalid company settings')
      const company = object(providers['company-gateway']) ? providers['company-gateway'] : {}
      const route = builtin.config.providers['company-gateway']
      next = { ...builtin.config, ...config, providers: { ...builtin.config.providers, ...providers,
        'company-gateway': { ...route, ...company,
          api: route.api, apiKeyEnv: route.apiKeyEnv, accountRequired: route.accountRequired,
          baseURL: route.baseURL, displayName: route.displayName } } }
    }
    // A fresh profile uses its built-in defaults; only persisted overrides need repair.
    if (overrides.length && !isDeepStrictEqual(config, next)) patches.push({ id, config: next })
  }
  if (!patches.length) return
  const next = append(original, patches)
  copyFileSync(file, `${file}.before-company-upgrade-${Date.now()}`, constants.COPYFILE_EXCL)
  if (readFileSync(file, 'utf8') !== original) throw new Error('Desktop company upgrade: settings changed during preparation')
  await writeFileAtomic(file, next, { mode: 0o600, dirMode: 0o700 })
}
