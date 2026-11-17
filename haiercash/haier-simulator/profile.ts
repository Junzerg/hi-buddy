/** Development profile configuration for the standard Web launcher. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { load, dump } from 'js-yaml'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))

/** Which development login a profile wires: the company simulator or Hi-Buddy (lingxi). */
export type DevMode = 'company' | 'hi-buddy'

/** Default lingxi-server endpoint for --hibuddy development; the account package shares it. */
export const LINGXI_ENDPOINT = 'http://127.0.0.1:18881'

interface SimulatorPorts {
  servicesPort?: number | undefined
  exchangePort?: number | undefined
}
interface ProfileRow {
  id: string
  config?: Record<string, unknown>
  [key: string]: unknown
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function profileRows(value: unknown): ProfileRow[] {
  if (!Array.isArray(value) || value.some((row: unknown) => typeof record(row).id !== 'string')) {
    throw new Error('Simulator profile is invalid; inspect its cordis.patch.yml')
  }
  return value as ProfileRow[]
}

/** Initial writable profile pointing company authentication and models to loopback services. */
export function simulatorPatch(
  mode: DevMode = 'company',
  { servicesPort = 18080, exchangePort = 18081 }: SimulatorPorts = {},
): string {
  if (mode === 'hi-buddy') {
    return `- id: deepseek-account
  config:
    hiBuddyLogin: true
    allowLoopbackHttp: true
    requestTimeoutMs: 10000
- id: agent-default-model
  config:
    provider: deepseek
    model: ''
- id: ui-settings-account
  config:
    feedbackDestination: internal-team
    requireIamLogin: true
`
  }
  const origin = `http://127.0.0.1:${servicesPort}`
  return `- id: deepseek-account
  config:
    companyLogin: true
    companyLoginEndpoint: http://127.0.0.1:${exchangePort}/company-login/exchange
    platformOrigin: ${origin}
    inferenceOrigin: ${origin}
    allowLoopbackHttp: true
    requestTimeoutMs: 10000
- id: llm-pi-ai
  config:
    providers:
      company-gateway:
        displayName: 海尔服务模拟器
        apiKeyEnv: COMPANY_GATEWAY_API_KEY
        accountRequired: true
        api: openai-completions
        baseURL: ${origin}/v1
        models: []
- id: agent-default-model
  config:
    provider: company-gateway
    model: ''
- id: ui-settings-account
  config:
    feedbackDestination: internal-team
    requireIamLogin: true
`
}

/** Update simulator endpoints while retaining saved models and the current default selection. */
export function prepareWeb({
  stateDirectory = resolve(directory, '.state'), servicesPort, exchangePort, environment = process.env,
  mode = 'company',
}: SimulatorPorts & { stateDirectory?: string | undefined; environment?: NodeJS.ProcessEnv; mode?: DevMode } = {}): { patch: string; env: NodeJS.ProcessEnv } {
  mkdirSync(stateDirectory, { recursive: true })
  const profile = resolve(stateDirectory, 'home/profiles/web')
  mkdirSync(profile, { recursive: true })
  const patch = resolve(profile, 'cordis.patch.yml')
  const template = simulatorPatch(mode, { servicesPort, exchangePort })
  if (!existsSync(patch)) writeFileSync(patch, template)
  else {
    const existing = profileRows(load(readFileSync(patch, 'utf8')))
    for (const row of profileRows(load(template))) {
      const previous = existing.find(value => value.id === row.id)
      if (!previous) { existing.push(row); continue }
      // The active login mode owns the account row outright; the other mode's
      // keys must not survive (hiBuddyLogin + companyLogin together throw).
      if (row.id === 'deepseek-account') {
        previous.config = { ...row.config }
        continue
      }
      // Hi-buddy mode owns the default model too: company-gateway points at the
      // simulator, which is not running there. Company mode keeps the saved selection.
      if (row.id === 'agent-default-model' && mode === 'hi-buddy') {
        previous.config = { ...row.config }
        continue
      }
      if (row.id === 'agent-default-model') continue
      if (row.id === 'llm-pi-ai') {
        const providers = record(previous.config?.providers)
        const company = record(providers['company-gateway'])
        const incoming = record(row.config?.providers)
        row.config = { providers: { ...providers, ...incoming,
          'company-gateway': { ...record(incoming['company-gateway']), models: company.models ?? [] },
        } }
      }
      previous.config = { ...previous.config, ...row.config }
    }
    writeFileSync(patch, dump(existing, { lineWidth: -1 }))
  }
  return { patch, env: { ...environment, DSH_HOME: resolve(stateDirectory, 'home'),
    DSH_TELEMETRY_MODE: 'DISABLED', DSH_TELEMETRY_DISABLED: '1' } }
}

/** Configure the explicit --haier/--hibuddy mode before the standard development loop starts. */
export async function configureHaierDevelopment({
  appArgs = [], environment = process.env, stateDirectory,
  mode = 'company', lingxiEndpoint = LINGXI_ENDPOINT,
}: {
  appArgs?: readonly string[]; environment?: NodeJS.ProcessEnv; stateDirectory?: string | undefined
  mode?: DevMode; lingxiEndpoint?: string | undefined
}): Promise<{ env: NodeJS.ProcessEnv; appArgs: readonly string[] }> {
  if (appArgs.some(value => ['--host', '--port', '--public-url'].some(flag => value === flag || value.startsWith(`${flag}=`)))) {
    throw new Error('--haier/--hibuddy owns --host and --port for the 127.0.0.1:3080 callback; omit address overrides')
  }
  if (mode === 'hi-buddy') {
    const unavailable = (): Error => new Error(`lingxi-server is not reachable at ${lingxiEndpoint}; start it with: cd hi-buddy-kit-packages/lingxi-server && node src/main.mjs`)
    // /v1/connectors sits behind session auth (401 anonymous), so any HTTP
    // response — including an error status — proves the server is up.
    const reachable = await fetch(`${lingxiEndpoint}/v1/connectors`, { signal: AbortSignal.timeout(3000) }).catch(() => {
      throw unavailable()
    })
    await reachable.body?.cancel().catch(() => {})
    const { env } = prepareWeb({ stateDirectory, environment, mode })
    return { env, appArgs: ['--host', '127.0.0.1', '--port', '3080', ...appArgs] }
  }
  const servicesPort = Number(environment.HAIER_SIMULATOR_PORT ?? 18080)
  const exchangePort = Number(environment.HAIER_EXCHANGE_PORT ?? 18081)
  for (const port of [servicesPort, exchangePort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Simulator ports must be between 1 and 65535')
  }
  const unavailable = (): Error => new Error('Start the simulator with pnpm --dir haiercash/haier-simulator run up')
  const healthy = await fetch(`http://127.0.0.1:${servicesPort}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => {
    throw unavailable()
  })
  const value: unknown = await healthy.json()
  if (!healthy.ok || record(value).service !== 'haier-simulator') throw unavailable()
  const { env } = prepareWeb({ stateDirectory, servicesPort, exchangePort, environment })
  return { env, appArgs: ['--host', '127.0.0.1', '--port', '3080', ...appArgs] }
}
