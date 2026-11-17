import { Context } from '@deepseek-ai/cordis'
import { Client } from '@modelcontextprotocol/client'
import type { AuthProvider } from '@modelcontextprotocol/client'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { StreamableHttpConfig } from '../src/index.ts'
import { createTransport } from '../src/transport.ts'
import { startHttpMcpFixture } from './http-fixture.ts'

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

describe('createTransport authProviderRef', () => {
  it('authenticates only within the owning Host and removes the provider on unload', async () => {
    const fixture = await startHttpMcpFixture()
    onTestFinished(() => fixture.close())
    const ctx = new Context()
    const ref = 'connector:fixture'
    const config = httpConfig(fixture.url, { authProviderRef: ref })
    const provider = { token: async () => 'dynamic-token' } satisfies AuthProvider
    const owner = ctx.plugin((inner) => {
      inner.on('mcp-client/resolve-auth-provider', key =>
        key === ref ? { url: fixture.url, provider } : undefined)
    })
    onTestFinished(() => owner.dispose())
    await owner

    expect(() => createTransport(config, new Context())).toThrow(/no registered provider/)
    expect(() => createTransport({ ...config, url: fixture.url + '/other' }, ctx)).toThrow(/different MCP endpoint/)
    expect(fixture.authorization).toEqual([])

    const client = new Client({ name: 'auth-provider-spec', version: '0' })
    onTestFinished(() => client.close())
    await client.connect(createTransport(config, ctx))
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['ping'])
    expect(fixture.authorization).toContain('Bearer dynamic-token')

    await client.close()
    await owner.dispose()
    expect(() => createTransport(config, ctx)).toThrow(/no registered provider/)
  })

  it('a stale disposer leaves a new listener for the same provider intact', () => {
    const ctx = new Context()
    const ref = 'connector:fixture'
    const config = httpConfig('http://127.0.0.1/mcp', { authProviderRef: ref })
    const provider = { token: async () => 'token' } satisfies AuthProvider
    const listener = () => ({ url: config.url, provider })
    const first = ctx.on('mcp-client/resolve-auth-provider', listener)
    first()
    const current = ctx.on('mcp-client/resolve-auth-provider', listener)
    onTestFinished(() => { current() })
    first()
    expect(() => createTransport(config, ctx)).not.toThrow()
  })

  it('preserves static authorization when no provider ref is set', async () => {
    const fixture = await startHttpMcpFixture()
    onTestFinished(() => fixture.close())
    const client = new Client({ name: 'auth-provider-spec', version: '0' })
    onTestFinished(() => client.close())
    await client.connect(createTransport(httpConfig(fixture.url, {
      headers: { Authorization: 'Bearer static-token' },
    }), new Context()))
    expect(fixture.authorization).toContain('Bearer static-token')
  })
})
