/** Fail-closed resolution of the VC++ runtime bundled beside the Windows LibreOffice engine. */

/**
 * Resolve the portable CRT directory for one packaging target.
 * Windows builds always bundle: the repository default stands in when the environment
 * names nothing, and unusable directories fail the build instead of shipping a package
 * whose Office previews crash on intranet hosts with old system MSVCP140.dll.
 * @param environment - Packaging environment; may name an override directory.
 * @param platform - Packaging target platform.
 * @param repositoryDefault - Absolute path of the repository-owned DLL directory.
 * @returns Absolute DLL directory for Windows targets; undefined elsewhere.
 * @throws Windows target with a missing, relative, or empty directory; other target naming one.
 */
export declare function resolvePortableCrtDirectory(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  repositoryDefault: string,
): string | undefined
