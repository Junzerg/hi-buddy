/** Run the shipping exchange service against Docker-local Haier substitutes. */
import { createCompanyLoginServer } from './company-login-server.mjs'

const server = createCompanyLoginServer({
  iamOrigin: 'http://haier-services:8080',
  clientSecret: 'haier-simulator-client-secret',
  authSecret: 'haier-simulator-gateway-secret',
})
server.listen(18766, '0.0.0.0')
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close()
  server.closeIdleConnections()
})
