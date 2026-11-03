import assert from 'node:assert/strict'

export const callback = 'http://127.0.0.1:3080/oauth/callback'
export const form = value => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(value), redirect: 'manual' })

export async function authorize(origin, mode = 'success', account = 'developer') {
  const response = await fetch(`${origin}/sso/oauth2/authorize?${new URLSearchParams({
    client_id: 'APP176', response_type: 'code', redirect_uri: callback, state: 'state-must-be-preserved',
  })}`)
  assert.equal(response.status, 200)
  const text = await response.text()
  const request = /name="request" value="([^"]+)"/.exec(text)?.[1]
  assert.ok(request)
  const approved = await fetch(`${origin}/sso/simulator/login`, form({ request, account, mode }))
  assert.equal(approved.status, 302)
  const result = new URL(approved.headers.get('location'))
  assert.equal(result.searchParams.get('state'), 'state-must-be-preserved')
  return result.searchParams.get('code')
}
