/** Local substitutes for the Haier IAM, personal-key service and OpenAI-compatible model gateway. */
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const CLIENT_SECRET = 'haier-simulator-client-secret'
export const GATEWAY_SECRET = 'haier-simulator-gateway-secret'
export const MODEL = 'haier-simulator'
export const USERS = [
  { account: 'developer', email: 'developer@example.test', name: '开发用户',
    orgName: 'AI工程', orgPathName: '/模拟海尔/金融科技中心/架构平台/' },
  { account: 'reviewer', email: 'reviewer@example.test', name: '验收用户',
    orgName: '产品设计', orgPathName: '/模拟海尔/办公平台/' },
]
const MODES = {
  success: '正常登录', denied: '拒绝授权', 'expired-code': '授权码过期',
  'token-error': 'Token 接口失败', 'userinfo-error': '用户资料接口失败',
  'key-error': '个人 Key 接口失败', 'model-error': '模型列表接口失败',
}
const keyPath = '/ploto-llm-admin-app/api/internal/apiKey/getOrCreate'
const htmlEscape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])
const page = (title, body) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;max-width:680px;margin:64px auto;padding:0 24px;line-height:1.6;background:#f7f8fa;color:#20252c}main{padding:28px;background:white;border:1px solid #dce1e8;border-radius:12px}h1{font-size:24px}label{display:block;margin:20px 0}select,button{font:inherit;padding:8px 12px}button{cursor:pointer}aside{color:#586372}a{color:#145dcc}</style><main><aside>海尔服务模拟器 · 仅供本地开发</aside><h1>${title}</h1>${body}</main></html>`

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(value))
}
// Browser form restrictions cover redirects to the application's validated callback as well.
function html(res, value, callbackOrigin) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${callbackOrigin ? ` ${callbackOrigin}` : ''}; frame-ancestors 'none'`,
  }).end(value)
}
async function body(req, type) {
  if (!req.headers['content-type']?.startsWith(type)) throw Object.assign(new Error('Unsupported content type'), { status: 415 })
  let value = ''
  req.setEncoding('utf8')
  for await (const chunk of req) {
    value += String(chunk)
    if (Buffer.byteLength(value) > 1024 * 1024) throw Object.assign(new Error('Request too large'), { status: 413 })
  }
  try {
    const parsed = type === 'application/json' ? JSON.parse(value) : Object.fromEntries(new URLSearchParams(value))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object')
    return parsed
  }
  catch { throw Object.assign(new Error('Invalid request body'), { status: 400 }) }
}

/** Each instance owns its codes, IAM tokens and personal keys; callers own listen/close. */
export function createHaierSimulator({
  callbackUris = ['http://127.0.0.1:3080/oauth/callback'], now = Date.now,
} = {}) {
  const pending = new Map()
  const codes = new Map()
  const tokens = new Map()
  const keys = new Map()
  const keyModes = new Map()
  const expiry = () => now() + 10 * 60_000
  const reset = () => {
    pending.clear(); codes.clear(); tokens.clear(); keys.clear(); keyModes.clear()
  }
  const accountKey = account => [...keys.entries()].find(([, identity]) => identity.user.account === account)
  const authorized = req => {
    const header = req.headers.authorization ?? ''
    return header.startsWith('Bearer ') ? keys.get(header.slice(7)) : undefined
  }
  const route = async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    const url = new URL(req.url, 'http://simulator.invalid')
    for (const map of [pending, codes, tokens]) {
      for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key)
    }
    if (req.method === 'GET' && url.pathname === '/health') { send(res, 200, { service: 'haier-simulator' }); return }
    if (req.method === 'GET' && url.pathname === '/') {
      html(res, page('海尔服务模拟器', `<p>IAM、个人 Key 和模型网关均使用本地假数据。请从应用的登录按钮发起授权。</p><p>当前个人 Key：${keys.size} 个。重置会撤销所有模拟凭据；应用下次请求模型时收到 401。</p><form method="post" action="/__simulator/reset"><button>重置模拟凭据</button></form>`))
      return
    }
    if (req.method === 'POST' && url.pathname === '/__simulator/reset') {
      reset()
      res.writeHead(303, { location: '/' }).end()
      return
    }
    if (req.method === 'GET' && url.pathname === '/sso/oauth2/authorize') {
      const input = Object.fromEntries(url.searchParams)
      if (input.client_id !== 'APP176' || input.response_type !== 'code' || !input.state
        || !callbackUris.includes(input.redirect_uri)
        || ['client_id', 'response_type', 'state', 'redirect_uri'].some(name => url.searchParams.getAll(name).length !== 1)) {
        send(res, 400, { error: 'invalid_request' }); return
      }
      const requestId = randomUUID()
      pending.set(requestId, { ...input, expiresAt: expiry() })
      html(res, page('模拟海尔 IAM 登录', `<p>此页面不接收真实海尔账号或密码。</p><form method="post" action="/sso/simulator/login"><input type="hidden" name="request" value="${requestId}"><label>模拟账号 <select name="account">${USERS.map(user => `<option value="${user.account}">${htmlEscape(user.name)}（${user.email}）</option>`).join('')}</select></label><label>验证场景 <select name="mode">${Object.entries(MODES).map(([mode, label]) => `<option value="${mode}">${label}</option>`).join('')}</select></label><button>登录并返回应用</button></form>`), new URL(input.redirect_uri).origin)
      return
    }
    if (req.method === 'POST' && url.pathname === '/sso/simulator/login') {
      const input = await body(req, 'application/x-www-form-urlencoded')
      const request = pending.get(input.request)
      pending.delete(input.request)
      const user = USERS.find(value => value.account === input.account)
      if (!request || !user || !Object.hasOwn(MODES, input.mode)) { send(res, 400, { error: 'invalid_request' }); return }
      const code = randomBytes(24).toString('base64url')
      codes.set(code, { user, mode: input.mode, redirectUri: request.redirect_uri,
        expiresAt: input.mode === 'expired-code' ? now() - 1 : expiry() })
      const callback = new URL(request.redirect_uri)
      callback.search = new URLSearchParams({ code, state: request.state }).toString()
      res.writeHead(302, { location: callback.href }).end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/sso/oauth2/token') {
      const input = await body(req, 'application/x-www-form-urlencoded')
      if (input.client_id !== 'APP176' || input.client_secret !== CLIENT_SECRET || input.grant_type !== 'authorization_code') {
        send(res, 401, { error: 'invalid_client' }); return
      }
      const identity = codes.get(input.code)
      if (!identity || identity.redirectUri !== input.redirect_uri) { send(res, 400, { error: 'invalid_grant' }); return }
      codes.delete(input.code)
      if (identity.mode === 'denied') { send(res, 400, { error: 'access_denied' }); return }
      if (identity.mode === 'token-error') { send(res, 503, { error: 'temporarily_unavailable' }); return }
      const token = randomBytes(24).toString('base64url')
      tokens.set(token, { ...identity, expiresAt: expiry() })
      send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 600 })
      return
    }
    if (req.method === 'POST' && url.pathname === '/sso/oauth2/userInfo') {
      const input = await body(req, 'application/x-www-form-urlencoded')
      const identity = tokens.get(input.access_token)
      if (!identity) { send(res, 401, { error: 'invalid_token' }); return }
      if (identity.mode === 'userinfo-error') { send(res, 503, { error: 'temporarily_unavailable' }); return }
      keyModes.set(identity.user.account, identity.mode)
      const { account, ...profile } = identity.user
      send(res, 200, { ret: 0, sub: `simulator-${account}`, ...profile })
      return
    }
    if (req.method === 'POST' && url.pathname === keyPath) {
      const input = await body(req, 'application/json')
      if (input.authSecret !== GATEWAY_SECRET || req.headers['x-ploto-direct-target'] !== 'ploto-llm-admin-app') {
        send(res, 403, { success: false, status: { code: 40300 } }); return
      }
      const user = USERS.find(value => value.account === input.account)
      if (!user || input.system !== 'lingxi-office') { send(res, 400, { success: false, status: { code: 40000 } }); return }
      const mode = keyModes.get(user.account)
      if (mode === 'key-error') { send(res, 503, { success: false, status: { code: 50300 } }); return }
      const previous = accountKey(user.account)
      const key = previous?.[0] ?? `sk-haier-simulator-${randomBytes(24).toString('hex')}`
      keys.set(key, { user, mode })
      send(res, 200, { success: true, status: { code: 20000 }, msg: null, extraInfo: {},
        data: { username: `lingxi-office_${user.account}`, apiKey: key, newlyCreated: previous === undefined, authorizedModels: [MODEL] } })
      return
    }
    if (url.pathname === '/v1/models' && req.method === 'GET') {
      const identity = authorized(req)
      if (!identity) { send(res, 401, { error: { message: '模拟凭据已失效，请重新登录', type: 'authentication_error' } }); return }
      if (identity.mode === 'model-error') { send(res, 503, { error: { message: '模拟模型列表失败' } }); return }
      send(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'haier-simulator',
        name: '海尔模拟模型', context_window: 32000, max_tokens: 4096 }] })
      return
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      if (!authorized(req)) { send(res, 401, { error: { message: '模拟凭据已失效，请重新登录', type: 'authentication_error' } }); return }
      const input = await body(req, 'application/json')
      if (input?.model !== MODEL || !Array.isArray(input.messages)) { send(res, 400, { error: { message: 'Invalid model or messages' } }); return }
      const prompt = input.messages.findLast(message => message.role === 'user')?.content
      const content = typeof prompt === 'string' ? prompt : Array.isArray(prompt)
        ? prompt.filter(part => part.type === 'text').map(part => part.text).join('') : ''
      const text = `【海尔服务模拟器】已收到：${content.slice(0, 1000)}\n这是本地固定回复，没有调用真实模型。`
      const base = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(now() / 1000), model: MODEL }
      const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      if (input.stream !== true) {
        send(res, 200, { ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text },
          finish_reason: 'stop' }], usage })
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-accel-buffering': 'no' })
      const chunk = (delta, finish_reason = null) => ({ ...base, object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason }] })
      for (const value of [chunk({ role: 'assistant', content: '' }), chunk({ content: text }), chunk({}, 'stop'),
        { ...base, object: 'chat.completion.chunk', choices: [], usage }]) res.write(`data: ${JSON.stringify(value)}\n\n`)
      res.end('data: [DONE]\n\n')
      return
    }
    send(res, 404, { error: 'not_found' })
  }
  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, (req, res) => {
    void route(req, res).catch(error => {
      if (res.headersSent || res.destroyed) { res.destroy(); return }
      send(res, error.status ?? 500, { error: error.status ? error.message : 'simulator_error' })
      if (!error.status) console.error('[haier-simulator]', error)
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = process.env.HAIER_CALLBACK_URI ? { callbackUris: [process.env.HAIER_CALLBACK_URI] } : {}
  const servers = [createHaierSimulator(options)]
  // Both listeners share the same state: the existing exchange uses the key service's original port 80.
  const server = servers[0]
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')
  if (process.env.KEY_PORT) {
    const alias = createServer({ requestTimeout: 30_000 }, (req, res) => server.emit('request', req, res))
    alias.listen(Number(process.env.KEY_PORT), '0.0.0.0')
    servers.push(alias)
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    for (const listener of servers) { listener.close(); listener.closeIdleConnections() }
  })
}
