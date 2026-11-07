import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { resolvePortableCrtDirectory } from '../scripts/portable-crt.mjs'

describe('portable CRT resolution', () => {
  const stocked = mkdtempSync(join(tmpdir(), 'dsh-portable-crt-'))
  afterAll(() => { rmSync(stocked, { recursive: true, force: true }) })

  it('uses the repository default for Windows targets without an override', () => {
    expect(resolvePortableCrtDirectory({}, 'win32', stocked)).toBe(stocked)
  })

  it('prefers an absolute environment override on Windows targets', () => {
    expect(resolvePortableCrtDirectory(
      { DSH_DESKTOP_PORTABLE_CRT_DIR: stocked }, 'win32', join(stocked, 'default'),
    )).toBe(stocked)
  })

  it('fails closed when a Windows target has no usable directory', () => {
    expect(() => resolvePortableCrtDirectory({}, 'win32', join(stocked, 'missing')))
      .toThrow('portable CRT directory')
    expect(() => resolvePortableCrtDirectory({ DSH_DESKTOP_PORTABLE_CRT_DIR: 'portable-crt' }, 'win32', stocked))
      .toThrow('absolute directory')
    expect(() => resolvePortableCrtDirectory({ DSH_DESKTOP_PORTABLE_CRT_DIR: '  ' }, 'win32', stocked))
      .toThrow('nonempty absolute directory')
  })

  it('skips other platforms unless an environment names a directory', () => {
    expect(resolvePortableCrtDirectory({}, 'darwin', stocked)).toBe(undefined)
    expect(() => resolvePortableCrtDirectory({ DSH_DESKTOP_PORTABLE_CRT_DIR: stocked }, 'darwin', stocked))
      .toThrow('Windows targets only')
  })

  it('keeps the repository directory stocked with the required runtime DLLs', () => {
    const directory = fileURLToPath(new URL('../resources/portable-crt', import.meta.url))
    const names = new Set(readdirSync(directory).map(file => file.toLowerCase()))
    for (const required of ['msvcp140.dll', 'vcruntime140.dll']) {
      expect(names, `resources/portable-crt must keep ${required} so Windows packaging fails closed`).toContain(required)
    }
  })
})
