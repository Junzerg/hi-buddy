/**
 * In-process module arrival: import every roster row's `/client` module (or
 * the plan's replacement) and register each as a pre-arrived factory on a
 * production `ClientModuleSystem`, so neither the Loader's `internal.import`
 * nor a stage-one `prefetch` ever fetches a bundle.
 * @module @deepseek-ai/dsh-client-test-runtime/src/assembly/modules
 */
import { readFileSync } from 'node:fs'
import { compileFunction } from 'node:vm'
import * as modulesClient from '@deepseek-ai/dsh-client-modules/client'
import { createClientModuleSystem } from '@deepseek-ai/dsh-client-modules/client'
import type { ClientBundleRegistration, ClientModuleLoader, ClientModuleLoaderTarget, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { getStaticModules } from '@deepseek-ai/dsh-client-web/src/seed.ts'
import { graphFromRoster, type AssemblyPlan, type ClientPluginModule, type ClientRosterRow } from './roster.ts'

/** The bootstrap row: always this process's static namespace, never a dynamic import or a `provide` replacement. */
export const MODULES_PACKAGE = '@deepseek-ai/dsh-client-modules'

/**
 * Resolve each roster row to its plugin module: `plan.provide[name]` when
 * present, otherwise a `/client` import resolved by the repository's tsconfig
 * path aliases under Vitest. Installed packages without a source import use
 * their bundle factory with the production module system and platform table.
 * The bootstrap row is the
 * statically imported `@deepseek-ai/dsh-client-modules/client` namespace.
 * @param plan - validated plan.
 * @returns package name → module, in roster order.
 * @throws {Error} when an import fails (the package name prefixes the original message) or the bootstrap row is provided.
 */
export async function loadPluginModules(plan: AssemblyPlan): Promise<ReadonlyMap<string, ClientPluginModule>> {
  const modules = new Map<string, ClientPluginModule>()
  const bundles: ClientBundleRegistration[] = []
  for (const row of plan.roster.rows) {
    const { name } = row
    const provided = plan.provide?.[name]
    if (name === MODULES_PACKAGE) {
      if (provided !== undefined) {
        throw new Error(`client-test-runtime: ${MODULES_PACKAGE} is the bootstrap module and cannot be provided`)
      }
      modules.set(name, modulesClient)
      continue
    }
    const loaded = provided ?? await importClient(row)
    if ('factory' in loaded) bundles.push(loaded)
    else modules.set(name, loaded)
  }
  if (bundles.length > 0) {
    const system = createInProcessModules(graphFromRoster(plan.roster.rows), modules, bundles)
    for (const { id } of bundles) modules.set(id, await system.import(id, '', {}) as ClientPluginModule)
  }
  return new Map(plan.roster.rows.map(({ name }) => {
    const module = modules.get(name)
    if (module === undefined) throw new Error(`client-test-runtime: no loaded module for ${name}`)
    return [name, module]
  }))
}

async function importClient({ name, clientBundle }: ClientRosterRow): Promise<ClientPluginModule | ClientBundleRegistration> {
  let namespace: unknown
  try {
    try {
      namespace = await import(/* @vite-ignore */ `${name}/client`)
    } catch (error) {
      if (clientBundle === undefined || !(error instanceof Error)
        || !error.message.startsWith(`Cannot find package '${name}/client'`)) throw error
      let registration: ClientBundleRegistration | undefined
      const loader = { load: (value: ClientBundleRegistration) => {
        if (registration !== undefined || value.id !== name) {
          throw new Error(`client-test-runtime: expected one bundle registration for ${name}`)
        }
        registration = value
      } }
      // Keep registration local to this assembly while forwarding other window reads.
      const browser = new Proxy(typeof window === 'undefined' ? {} : window, {
        get: (target, key): unknown => key === '__ModuleLoader__' ? loader : Reflect.get(target, key, target),
      })
      const execute = compileFunction(readFileSync(clientBundle, 'utf8'), ['window'], { filename: clientBundle }) as (browser: object) => void
      execute(browser)
      if (registration === undefined) throw new Error(`client-test-runtime: bundle did not register ${name}`)
      return registration
    }
  } catch (error) {
    throw new Error(`client-test-runtime: cannot import ${name}/client: ${String(error)}`, { cause: error })
  }
  return namespace as ClientPluginModule
}

/**
 * Build the production module system over queued factories returning the
 * loaded namespaces and installed bundle registrations. The bootstrap row uses
 * `bootstrapModule`; bundled externals use the shell's static module table.
 * Missing factories reject through `loadBundle` without fetching.
 * @param graph - raw boot graph from `graphFromRoster`; `createClientModuleSystem` parses it.
 * @param modules - loaded plugin modules keyed by package name.
 * @param bundles - installed package factories captured by this assembly.
 * @returns module system to install as `loader.internal`; its `manifest` is the parsed graph.
 */
export function createInProcessModules(
  graph: WebBootGraph,
  modules: ReadonlyMap<string, ClientPluginModule>,
  bundles: readonly ClientBundleRegistration[] = [],
): ClientModuleLoader {
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue: [],
    /* v8 ignore next -- construction replaces this sink before draining the prefilled queue. */
    load: () => { throw new Error('client-test-runtime: module facade is not initialized') },
    create: options => createClientModuleSystem(target, { id: MODULES_PACKAGE, exports: modulesClient }, options),
  }
  for (const [id, namespace] of modules) {
    if (id === MODULES_PACKAGE) continue
    target.pendingQueue.push({ id, factory: () => namespace as unknown as Record<string, unknown> })
  }
  target.pendingQueue.push(...bundles)
  return target.create({
    boot: graph,
    staticModules: getStaticModules(),
    loadBundle: url => Promise.reject(new Error(`client-test-runtime: in-process modules never load bundles (${url})`)),
  })
}
