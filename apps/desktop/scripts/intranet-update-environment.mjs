/** Resolve an explicitly configured intranet update feed. */

/**
 * Validate the intranet feed URL; omission retains the ordinary release mode.
 * HTTP transport trusts the internal network and does not authenticate downloaded code.
 * Allowed packaging modes: unsigned Windows x64, or signed notarized macOS arm64/x64.
 * @param {NodeJS.ProcessEnv} environment File-owned packaging settings.
 * @returns {string | undefined} Absolute feed directory URL.
 */
export function resolveIntranetUpdateUrl(environment) {
  const value = environment.DSH_DESKTOP_INTRANET_UPDATE_URL
  if (value === undefined) return undefined
  let url
  try { url = new URL(value) }
  catch { throw new Error('desktop package: DSH_DESKTOP_INTRANET_UPDATE_URL requires an HTTP(S) feed directory URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('desktop package: intranet update URL must use HTTP(S) without credentials, query, or fragment')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/**
 * Whether this packaging target may use an intranet update feed.
 * Windows stays unsigned-only; macOS requires a signed (non-unsigned) build so Gatekeeper can accept updates.
 * @param {{ platform: 'win32' | 'darwin', arch: string }} target Selected release target.
 * @param {{ unsigned?: boolean }} options Explicit packaging mode.
 * @returns {boolean} True for unsigned Windows x64 or signed macOS arm64/x64.
 */
export function isAllowedIntranetPackaging(target, options = {}) {
  const unsigned = options.unsigned === true
  if (target.platform === 'win32') return unsigned && target.arch === 'x64'
  if (target.platform === 'darwin') return !unsigned && (target.arch === 'arm64' || target.arch === 'x64')
  return false
}
