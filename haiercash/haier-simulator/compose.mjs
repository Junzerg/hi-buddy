/** Build only the exchange artifact, then manage this directory's Compose project. */
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const directory = fileURLToPath(new URL('.', import.meta.url))
export const repository = resolve(directory, '../..')

export async function compose(args, { env = process.env, capture = false, projectDirectory = directory } = {}) {
  return run('docker', ['compose', '--project-directory', projectDirectory, ...args], { env, capture })
}

export function run(command, args, { env = process.env, capture = false, cwd = repository } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    let output = ''
    let errors = ''
    if (capture) {
      child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
      child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk })
    }
    let failure
    const signals = ['SIGINT', 'SIGTERM']
    const forward = signal => { child.kill(signal) }
    const listeners = signals.map(signal => {
      const listener = () => forward(signal)
      process.once(signal, listener)
      return listener
    })
    child.once('error', error => { failure = error })
    child.once('close', (code, signal) => {
      signals.forEach((value, index) => process.removeListener(value, listeners[index]))
      if (failure) reject(failure)
      else if (code === 0 && signal === null) accept(output)
      else reject(new Error(`${command} ${args[0] ?? ''} failed (${signal ?? code}). ${errors}`))
    })
  })
}

export async function prepare({ contextDirectory = directory } = {}) {
  const { build } = await import('tsdown')
  await build({ config: false, entry: [resolve(repository, 'apps/desktop/scripts/company-login-server.ts')],
    outDir: resolve(contextDirectory, '.build'), format: ['esm'], platform: 'node', target: 'node22', dts: false,
    clean: true, deps: { alwaysBundle: [/./] }, fixedExtension: true })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const action = process.argv[2]
    if (action === 'up') {
      await prepare()
      await compose(['up', '--build', '-d', '--wait', '--wait-timeout', '60'])
      console.log(`海尔服务模拟器：http://127.0.0.1:${process.env.HAIER_SIMULATOR_PORT ?? '18080'}`)
    } else if (action === 'down') await compose(['down', '--remove-orphans'])
    else throw new Error('Usage: node haiercash/haier-simulator/compose.mjs up|down')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
