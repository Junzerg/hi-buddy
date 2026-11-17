/**
 * [lingxi] Auth-provider registry: lets a dynamic plugin register in-memory
 * SDK `AuthProvider` instances that `streamable-http` configs reference by
 * opaque string. Loader config is serializable data only, so live provider
 * instances travel through this module-scoped map on the shared
 * `@deepseek-ai/dsh-mcp-client` module instance rather than the config.
 *
 * The registry's owner is this module instance; refs are opaque to the host
 * (no Lingxi vocabulary here). Registration is generation-safe: a disposer
 * only removes the exact provider instance it registered, so a late disposer
 * from a disposed generation never unseats a newer registration.
 *
 * @module
 */

import type { AuthProvider } from '@modelcontextprotocol/client'

const registry = new Map<string, AuthProvider>()

/**
 * Register an auth provider under an opaque ref for `authProviderRef` configs.
 *
 * @param ref - Opaque, caller-namespaced ref string (non-empty).
 * @param provider - SDK `AuthProvider` the transport calls per request.
 * @returns Disposer that unregisters exactly this registration; safe to call
 * more than once and never removes a newer provider under the same ref.
 * @throws When `ref` is not a non-empty string or already has a live provider.
 */
export function registerAuthProvider(ref: string, provider: AuthProvider): () => void {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new Error('authProviderRef must be a non-empty string')
  }
  if (registry.has(ref)) {
    throw new Error(`authProviderRef "${ref}" is already registered — dispose the previous registration first`)
  }
  registry.set(ref, provider)
  return () => {
    // Instance identity check: only the registration this disposer created
    // may be removed, so a stale disposer cannot unseat a newer provider.
    if (registry.get(ref) === provider) registry.delete(ref)
  }
}

/**
 * Resolve a live auth provider registered under `ref`.
 *
 * @param ref - The `authProviderRef` from a `streamable-http` config.
 * @returns The registered provider.
 * @throws When nothing is registered under `ref` (with the ref echoed back).
 */
export function resolveAuthProvider(ref: string): AuthProvider {
  const provider = registry.get(ref)
  if (provider === undefined) {
    throw new Error(`authProviderRef "${ref}" has no registered provider — call registerAuthProvider(ref, provider) before loading the config`)
  }
  return provider
}
