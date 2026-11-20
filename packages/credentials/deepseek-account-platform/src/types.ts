/** Platform provider reuses the account service's client-safe state. */
export type { AccountView, SignInAttemptView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type {
  AccountBonusBatch, AccountBonusOrderId, AccountClientMetadata, AccountDetails, AccountUserId,
  AccountView, PlatformSession, SignInAttemptId,
} from '@deepseek-ai/dsh-deepseek-account'

/**
 * [hiBuddy] The hi-buddy-account-platform service surface this provider delegates to when its
 * `hiBuddyLogin` config key is set. Structural only — no runtime dependency on the package; the
 * guard resolves the mounted `hiBuddyAccount` service per call.
 */
export interface HiBuddyAccountDelegate {
  getState(): Promise<AccountView>
  getProfile(client: AccountClientMetadata): Promise<AccountDetails['profile'] | null>
  getBalance(client: AccountClientMetadata): Promise<AccountDetails['balance'] | null>
  getUnnotifiedBonuses(client: AccountClientMetadata): Promise<AccountBonusBatch | null>
  ackBonusNotified(accountId: AccountUserId, orderId: AccountBonusOrderId, client: AccountClientMetadata): Promise<boolean>
  startSignIn(client: AccountClientMetadata, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView>
  /** Hi-Buddy login has no API-key path; the delegate rejects the call. */
  completeApiKeySignIn(apiKey: string): Promise<void>
  cancelSignIn(id: SignInAttemptId): Promise<AccountView>
  signOut(client: AccountClientMetadata): Promise<AccountView>
  watch(signal: AbortSignal): AsyncIterable<AccountView>
  resolveToken(url: string): Promise<string | undefined>
  rejectToken(token: string): Promise<void>
  getPlatformSession(): Promise<PlatformSession | null>
  getDeviceIdentity(): Promise<{ osVersion: string }>
  /** The authorization seam's flow run target; the guard registers this as its DeepSeek flow. */
  handleAuthorizationRun(session: AuthorizationSession): Promise<void>
  /** The guard forwards `credentials/record-updated` for the shared record key here. */
  notifyRecordUpdated(): void
  /** The session-ticket seam the connector kit consumes; renewing when stale
   *  (within the delegate's renewal margin of expiry) or forced. */
  getSessionTicket(force?: boolean): Promise<string>
  /** Heartbeat hygiene: renew near/past expiry + refresh the gateway model
   *  plane (diff-guarded); failures settle the account state instead. */
  ensureSessionTicket(): Promise<void>
}
