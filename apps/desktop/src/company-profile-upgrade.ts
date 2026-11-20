/** Migrate a legacy company-login Desktop profile to the Hi-Buddy account chain. */

import { copyFileSync, constants, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import * as yaml from 'js-yaml'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parse(text: string): Record<string, unknown>[] {
  let value: unknown
  try { value = yaml.load(text, { schema: entryListSchema }) }
  catch { throw new Error('Desktop company upgrade: invalid profile YAML; the original file was preserved') }
  if (!Array.isArray(value) || !value.every(object)) throw new Error('Desktop company upgrade: expected a patch list')
  return value
}

/** The profile row pinning the company-login connection: any deepseek-account
 *  override naming `companyLogin`. Removing the whole row lets the bundled
 *  Hi-Buddy account defaults apply; the stored company-login grant no longer
 *  matches the new chain's credential shape, so the user signs in again. */
function isLegacyCompanyConnectionRow(row: Record<string, unknown>): boolean {
  return row.id === 'deepseek-account' && object(row.config) && row.config.companyLogin !== undefined
}

/**
 * Remove the legacy company-login connection row from the profile patch, once,
 * while the caller holds the Desktop profile lock. Idempotent: a patch without
 * the row is left byte-identical. The migration re-dumps the machine-managed
 * patch (comments are not preserved) and keeps a timestamped backup beside it.
 */
export async function migrateCompanyProfile(profile: string): Promise<void> {
  const file = join(profile, 'cordis.patch.yml')
  let original: string
  try { original = readFileSync(file, 'utf8') }
  catch { throw new Error('Desktop company upgrade: cordis.patch.yml is missing; initProfile seeds it before the migration runs') }
  const current = parse(original)
  const migrated = current.filter(row => !isLegacyCompanyConnectionRow(row))
  if (migrated.length === current.length) return
  const next = yaml.dump(migrated, { schema: entryListSchema, lineWidth: -1 })
  copyFileSync(file, `${file}.before-company-upgrade-${Date.now()}`, constants.COPYFILE_EXCL)
  if (readFileSync(file, 'utf8') !== original) throw new Error('Desktop company upgrade: settings changed during preparation')
  await writeFileAtomic(file, next, { mode: 0o600, dirMode: 0o700 })
}
