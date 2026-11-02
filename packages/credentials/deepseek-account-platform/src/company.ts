/** Company OAuth and personal gateway-key protocol, using the account provider's existing attempt lifetime. */
import { PlatformAuthError } from './protocol.ts'
import type { AccountProfile } from '@deepseek-ai/dsh-deepseek-account/types'

/** Verified display fields returned beside the personal gateway key. */
interface CompanyIdentity {
  apiKey: string
  account: string
  email: string
  name?: string
  orgName?: string
  orgPathName?: string
}

function displayFields(value: Record<string, unknown>): Pick<CompanyIdentity, 'name' | 'orgName' | 'orgPathName'> {
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.orgName === 'string' ? { orgName: value.orgName } : {}),
    ...(typeof value.orgPathName === 'string' ? { orgPathName: value.orgPathName } : {}),
  }
}

/**
 * Project the verified company identity for display and device-local storage.
 * IAM's path contains ancestors: omit the company root and append the current organization.
 * @param identity - verified exchange result; old login servers may omit display fields.
 * @returns name, email and department hierarchy, without IAM identifiers or credentials.
 */
export function companyAccountProfile(identity: CompanyIdentity): AccountProfile {
  const parents = (identity.orgPathName ?? '').split('/').map(part => part.trim()).filter(Boolean).slice(1)
  const current = identity.orgName?.trim()
  const department = [...parents, ...(current ? [current] : [])].join(' / ')
  return { id: null, name: identity.name?.trim() || identity.account, contact: identity.email,
    ...(department ? { department } : {}) }
}

/** Deployment's shared model provider. */
export const COMPANY_PROVIDER = 'company-gateway'
/** API key shared by manual entry and verified IAM login. */
export const COMPANY_KEY_REF = 'COMPANY_GATEWAY_API_KEY'
/** Test-environment user-key service. */
export const COMPANY_KEY_URL = 'http://galois-server-in.haiercash.work/ploto-llm-admin-app/api/internal/apiKey/getOrCreate'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Exchange the validated callback through the versions server; application secrets stay on that server.
 * @param endpoint - built-in versions server login endpoint.
 * @param redirectUri - callback URI used for this authorization.
 * @param code - authorization code from the existing state-validated callback.
 * @param signal - original account attempt cancellation and deadline.
 * @returns the verified profile and personal gateway key, without IAM tokens or application secrets.
 */
export async function exchangeCompanyLogin(endpoint: string, redirectUri: string, code: string,
  signal: AbortSignal): Promise<CompanyIdentity> {
  try {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ code, redirectUri }) })
    if (!response.ok) { await response.body?.cancel(); throw new PlatformAuthError('network') }
    const value: unknown = await response.json()
    if (!record(value) || typeof value.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(value.email)
      || value.account !== value.email.slice(0, value.email.indexOf('@'))
      || typeof value.apiKey !== 'string' || !/^[\x21-\x7e]+$/.test(value.apiKey)) throw new PlatformAuthError('protocol')
    return { apiKey: value.apiKey, account: value.account, email: value.email, ...displayFields(value) }
  } catch (error) {
    if (error instanceof PlatformAuthError) throw error
    throw new PlatformAuthError(signal.aborted ? 'expired' : 'no-response')
  }
}

/**
 * Build an IAM authorization-code destination; no application secret reaches the browser.
 * @param origin - configured IAM STG origin.
 * @param redirectUri - callback owned by the existing Host webServer.
 * @param state - unpredictable state retained by the existing account attempt.
 * @returns browser authorization URL for the registered APP176 client.
 */
export function companyAuthorizeUrl(origin: string, redirectUri: string, state: string): string {
  const url = new URL('/sso/oauth2/authorize', origin)
  url.search = new URLSearchParams({ client_id: 'APP176', response_type: 'code', redirect_uri: redirectUri, state }).toString()
  return url.href
}

/**
 * Exchange an already state-validated callback and obtain only the authenticated user's gateway key.
 * @param origin - configured IAM STG origin.
 * @param redirectUri - exact redirect URI used for authorization.
 * @param code - one-time authorization code from the owned callback.
 * @param clientSecret - private IAM application secret.
 * @param authSecret - private gateway key-service secret.
 * @param signal - existing attempt deadline and cancellation.
 * @returns personal API key and verified profile facts; never persists IAM tokens.
 * Failures log only the stage, HTTP status and declared error code on the server.
 */
export async function exchangeCompanyIdentity(origin: string, redirectUri: string, code: string,
  clientSecret: string, authSecret: string, signal: AbortSignal): Promise<CompanyIdentity> {
  let stage: 'iam-token' | 'iam-userinfo' | 'gateway-key' = 'iam-token'
  let httpStatus: number | undefined
  const post = async (url: string | URL, body: URLSearchParams | string): Promise<unknown> => {
    httpStatus = undefined
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal,
      headers: {
        'content-type': typeof body === 'string' ? 'application/json' : 'application/x-www-form-urlencoded',
        accept: 'application/json',
        ...(stage === 'gateway-key' ? { 'X-Ploto-Direct-Target': 'ploto-llm-admin-app' } : {}),
      },
      body,
    })
    httpStatus = response.status
    if (!response.ok) {
      await response.body?.cancel()
      throw new PlatformAuthError('network')
    }
    return response.json()
  }
  try {
    const token = await post(new URL('/sso/oauth2/token', origin), new URLSearchParams({
      grant_type: 'authorization_code', client_id: 'APP176', client_secret: clientSecret, redirect_uri: redirectUri, code,
    }))
    if (!record(token) || 'error' in token || typeof token.access_token !== 'string' || !token.access_token) throw new PlatformAuthError('protocol')
    stage = 'iam-userinfo'
    const user = await post(new URL('/sso/oauth2/userInfo', origin), new URLSearchParams({ access_token: token.access_token }))
    if (!record(user) || 'error' in user || 'errno' in user || 'code' in user
      || typeof user.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(user.email)) throw new PlatformAuthError('protocol')
    const account = user.email.slice(0, user.email.indexOf('@'))
    signal.throwIfAborted()
    stage = 'gateway-key'
    const system = 'lingxi-office'
    const result = await post(COMPANY_KEY_URL, JSON.stringify({ 'account': account, 'authSecret': authSecret, 'system': system }))
    if (!record(result) || result.success !== true || !record(result.status) || result.status.code !== 20000
      || !record(result.data) || result.data.username !== `${system}_${account}` || typeof result.data.apiKey !== 'string'
      || !/^[\x21-\x7e]+$/.test(result.data.apiKey)) throw new PlatformAuthError('protocol')
    return { apiKey: result.data.apiKey, account, email: user.email, ...displayFields(user) }
  } catch (error) {
    // Fetch and JSON errors may contain private parameters; preserve only declared safe failures.
    console.error('[company-login] exchange failed', {
      stage, httpStatus, errorCode: error instanceof PlatformAuthError ? error.code : signal.aborted ? 'expired' : 'no-response',
    })
    if (error instanceof PlatformAuthError) throw error
    throw new PlatformAuthError(signal.aborted ? 'expired' : 'no-response')
  }
}
