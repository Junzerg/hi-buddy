/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('uses compact navigation spacing', () => {
    expect(declarations('.panelList')?.get('gap')).toBe('0')
  })

  it('shares and cancels the wide shell trailing padding structurally', () => {
    const root = declarations('.root')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('8px')
    expect(root?.get('padding')).toBe('6px var(--dsh-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--dsh-sidebar-inline-padding))',
    )
  })



  it('rests New Session like the other navigation rows', () => {
    const row = declarations('.newSession')
    expect(row?.get('background')).toBe('transparent')
    expect(row?.get('font-weight')).toBe('400')
    expect(row?.get('color')).toBe('var(--dsw-alias-label-secondary)')
    expect(declarations('.newSession:hover')?.get('background')).toBe('var(--dsw-specific-task-row-hover)')
  })

  it('separates navigation hover from the selected page', () => {
    expect(declarations('.panelRow:hover')?.get('background')).toBe('var(--dsw-specific-task-row-hover)')
    expect(declarations('.panelRow[aria-expanded=\'true\']')?.get('background')).toBe('var(--dsw-specific-task-row-hover)')
    const selected = declarations('.panelRow.panelActive')
    expect(selected?.get('background')).toBe('var(--dsw-specific-task-row-selected)')
    expect(selected?.get('color')).toBe('var(--dsw-specific-task-row-selected-ink)')
    expect(selected?.get('font-weight')).toBe('500')
  })

  it('keeps the mark beside a two-line brand label', () => {
    expect(declarations('.brandIdentity')?.get('align-items')).toBe('center')
    expect(declarations('.brandText')?.get('flex-direction')).toBe('column')
    expect(declarations('.brandName')?.get('font-size')).toBe('13.5px')
    expect(declarations('.buildVersion')?.get('font-size')).toBe('10.5px')
  })
})
