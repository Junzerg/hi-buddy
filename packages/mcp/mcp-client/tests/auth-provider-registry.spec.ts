/** [lingxi] authProviderRef registry semantics and the transport seam it drives. */
import { describe, expect, it, onTestFinished } from 'vitest'
import { Client } from '@modelcontextprotocol/client'
import type { AuthProvider } from '@modelcontextprotocol/client'
import { registerAuthProvider, resolveAuthProvider } from '../src/auth-provider-registry.ts'
import { createTransport } from '../src/transport.ts'
import type { StreamableHttpConfig } from '../src/index.ts'
import { startHttpMcpFixture } from './http-fixture.ts'

function provider(token: string): AuthProvider {
  return { token: async () => token }
}

function httpConfig(url: string, overrides: Partial<StreamableHttpConfig> = {}): StreamableHttpConfig {
  return {
    transport: 'streamable-http',
    serverName: 'fixture',
    url,
    headers: {},
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    ...overrides,
  }
}

describe('auth-provider registry', () => {
  it('resolves a registered provider and forgets it after disposal', () => {
    const ref = 'test:roundtrip'
    const dispose = registerAuthProvider(ref, provider('t1'))
    expect(resolveAuthProvider(ref).token).toBeTypeOf('function')
    dispose()
    expect(() => resolveAuthProvider(ref)).toThrow(/test:roundtrip/)
  })

  it('rejects a duplicate ref while the original is live', () => {
    const ref = 'test:duplicate'
    const dispose = registerAuthProvider(ref, provider('t1'))
    try {
      expect(() => registerAuthProvider(ref, provider('t2'))).toThrow(/test:duplicate/)
      // The original instance stays resolvable after the rejected attempt.
      expect(resolveAuthProvider(ref)).toBeDefined()
    } finally {
      dispose()
    }
  })

  it('a stale disposer never removes a newer registration', () => {
    const ref = 'test:stale'
    const first = provider('t1')
    const disposeFirst = registerAuthProvider(ref, first)
    disposeFirst()
    const second = provider('t2')
    const disposeSecond = registerAuthProvider(ref, second)
    try {
      disposeFirst() // Late call from a disposed generation.
      expect(resolveAuthProvider(ref).token).toBeTypeOf('function')
      expect(() => resolveAuthProvider(ref)).not.toThrow()
    } finally {
      disposeSecond()
    }
    expect(() => resolveAuthProvider(ref)).toThrow(/test:stale/)
  })

  it('diagnoses an unregistered ref with actionable guidance', () => {
    expect(() => resolveAuthProvider('never-registered')).toThrow(
      /never-registered.*registerAuthProvider/s,
    )
  })
})

describe('createTransport authProviderRef seam', () => {
  it('sends the provider token as the dynamic Authorization header', async () => {
    const fixture = await startHttpMcpFixture()
    onTestFinished(() => fixture.close())
    const ref = 'test:transport-dynamic'
    const dispose = registerAuthProvider(ref, provider('dynamic-token-1'))
    onTestFinished(dispose)

    const transport = createTransport(httpConfig(fixture.url, { authProviderRef: ref }))
    const client = new Client({ name: 'auth-registry-spec', version: '0' })
    onTestFinished(() => client.close())
    await client.connect(transport)
    expect(fixture.authorization).toContain('Bearer dynamic-token-1')
  })

  it('without a ref keeps static headers and sends no Authorization', async () => {
    const fixture = await startHttpMcpFixture()
    onTestFinished(() => fixture.close())

    const transport = createTransport(httpConfig(fixture.url, {
      headers: { 'x-static': 'yes' },
    }))
    const client = new Client({ name: 'auth-registry-spec', version: '0' })
    onTestFinished(() => client.close())
    await client.connect(transport)
    expect(fixture.authorization.every(header => header === undefined)).toBe(true)
    // The transport still negotiated and serves tools over the static headers.
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['ping'])
  })
})
