/** Command identity and localized input spelling over the effective Host catalog. */
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { builtinCommandName, type BuiltinCommandName } from '@deepseek-ai/dsh-commands/builtin'

/** Host commands that stay registered for other surfaces but are not composer skills. */
const COMPOSER_OMITTED: ReadonlySet<BuiltinCommandName> = new Set(['feedback', 'export'])

/**
 * Whether the composer must ignore this host command: no menu row, no claim, no enter.
 * @param descriptor - effective Host descriptor.
 * @returns true for the omitted feedback and export commands.
 */
export function composerOmits(descriptor: CommandDescriptor): boolean {
  const name = builtinCommandName(descriptor)
  return name !== undefined && COMPOSER_OMITTED.has(name)
}

/**
 * Select the input spelling for a menu-picked command.
 * @param descriptor - effective Host descriptor.
 * @param t - command-namespace translator.
 * @returns localized spelling for a known definition, otherwise its registered name.
 */
export function claimToken(descriptor: CommandDescriptor, t: TranslateNS<'command'>): string {
  const name = builtinCommandName(descriptor)
  return name === undefined ? descriptor.name : t(`token.${name}`)
}
