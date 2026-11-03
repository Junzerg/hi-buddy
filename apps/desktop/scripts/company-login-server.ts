/** Stateless IAM exchange on the existing versions server; no application secret is returned to clients. */
import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'
import { exchangeCompanyIdentity } from '../../../packages/credentials/deepseek-account-platform/src/company.ts'

/** Server-only deployment credentials and IAM connection. */
export interface CompanyLoginServerConfig {
  /** Exact callback accepted by this server; the simulator supplies its own loopback URI. Production defaults to port 18743. */
  callbackUri?: string
  /** IAM origin; STG is supplied by the server entry point. */
  iamOrigin: string
  /** APP176 application secret, supplied only on the versions server. */
  clientSecret: string
  /** Internal gateway service secret, supplied only on the versions server. */
  authSecret: string
}

/**
 * Create the bounded, stateless exchange endpoint behind the versions server's Nginx.
 * @param config - private server deployment values; never accepts an account name from clients.
 * @returns an unbound HTTP server; the caller owns listen and close.
 */
export function createCompanyLoginServer(config: CompanyLoginServerConfig): Server {
  if (!config.clientSecret || !config.authSecret) throw new Error('Company login requires both server deployment secrets')
  const callbackUri = config.callbackUri ?? 'http://127.0.0.1:18743/oauth/callback'
  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, (req, res) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-type', 'application/json')
    if (req.url !== '/company-login/exchange') { res.writeHead(404).end('{}'); return }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return }
    if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end('{}'); return }
    const lifetime = new AbortController()
    const timer = setTimeout(() => lifetime.abort(), 30_000)
    res.once('close', () => { clearTimeout(timer); lifetime.abort() })
    const execute = async (): Promise<void> => {
      let body = ''
      for await (const chunk of req) {
        body += String(chunk)
        if (Buffer.byteLength(body) > 4096) { res.writeHead(413).end('{}'); return }
      }
      let value: unknown
      try { value = JSON.parse(body) } catch { res.writeHead(400).end('{}'); return }
      if (typeof value !== 'object' || value === null || !('code' in value) || typeof value.code !== 'string'
        || !/^[\x21-\x7e]{1,2048}$/.test(value.code) || !('redirectUri' in value)
        || value.redirectUri !== callbackUri
        || Object.keys(value).some(key => key !== 'code' && key !== 'redirectUri')) {
        res.writeHead(400).end('{}'); return
      }
      const identity = await exchangeCompanyIdentity(config.iamOrigin, value.redirectUri, value.code,
        config.clientSecret, config.authSecret, lifetime.signal)
      lifetime.signal.throwIfAborted()
      console.info('[company-login] personal key obtained')
      res.end(JSON.stringify(identity))
    }
    void execute().catch((_exchangeFailed: unknown) => {
      // Upstream exceptions can retain request secrets; the client receives only a fixed failure.
      if (!res.destroyed) res.writeHead(502).end('{"error":"company_login_failed"}')
    }).finally(() => { clearTimeout(timer) })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createCompanyLoginServer({ iamOrigin: 'http://iam-stg.haiercash.work',
    clientSecret: process.env.COMPANY_IAM_CLIENT_SECRET ?? '', authSecret: process.env.COMPANY_GATEWAY_AUTH_SECRET ?? '' })
  server.listen(18766, '0.0.0.0')
  process.once('SIGTERM', () => { server.close(); server.closeIdleConnections() })
  process.once('SIGINT', () => { server.close(); server.closeIdleConnections() })
}
