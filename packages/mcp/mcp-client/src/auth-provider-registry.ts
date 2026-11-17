import type { Context } from '@deepseek-ai/cordis'
import type { AuthProvider } from '@modelcontextprotocol/client'

/**
 * Resolve the provider before opening a connection to its registered endpoint.
 * @param ctx - Host context in which the provider was registered.
 * @param ref - configured provider reference.
 * @param url - destination for the MCP requests.
 * @returns provider authorized for the destination.
 * @throws if the reference is missing or belongs to a different endpoint.
 */
export function resolveAuthProvider(ctx: Context, ref: string, url: URL): AuthProvider {
  const entry = ctx.bail('mcp-client/resolve-auth-provider', ref)
  if (entry === undefined) {
    throw new Error(`authProviderRef "${ref}" has no registered provider in this Host`)
  }
  if (new URL(entry.url).href !== url.href) {
    throw new Error(`authProviderRef "${ref}" is registered for a different MCP endpoint`)
  }
  return entry.provider
}
