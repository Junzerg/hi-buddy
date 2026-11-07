/** Fail-closed resolution of the VC++ runtime bundled beside the Windows LibreOffice engine. */
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const CRT_ENVIRONMENT = 'DSH_DESKTOP_PORTABLE_CRT_DIR'

/**
 * Resolve the portable CRT directory for one packaging target.
 * Windows builds always bundle: the repository default stands in when the environment
 * names nothing, and unusable directories fail the build instead of shipping a package
 * whose Office previews crash on intranet hosts with old system MSVCP140.dll.
 * @param {NodeJS.ProcessEnv} environment Packaging environment; may name an override directory.
 * @param {NodeJS.Platform} platform Packaging target platform.
 * @param {string} repositoryDefault Absolute path of the repository-owned DLL directory.
 * @returns {string | undefined} Absolute DLL directory for Windows targets; undefined elsewhere.
 * @throws {Error} Windows target with a missing, relative, or empty directory; other target naming one.
 */
export function resolvePortableCrtDirectory(environment, platform, repositoryDefault) {
  const override = environment[CRT_ENVIRONMENT]?.trim()
  if (platform !== 'win32') {
    if (override !== undefined && override !== '') {
      throw new Error(`desktop runtime: ${CRT_ENVIRONMENT} applies to Windows targets only`)
    }
    return undefined
  }
  if (override === '') throw new Error(`desktop runtime: ${CRT_ENVIRONMENT} must name a nonempty absolute directory`)
  const directory = override ?? repositoryDefault
  if (!isAbsolute(directory)) {
    throw new Error(`desktop runtime: ${CRT_ENVIRONMENT} must name an absolute directory: ${directory}`)
  }
  if (!existsSync(directory)) {
    throw new Error(`desktop runtime: portable CRT directory ${directory} does not exist; restore ${repositoryDefault} or set ${CRT_ENVIRONMENT}`)
  }
  return directory
}
