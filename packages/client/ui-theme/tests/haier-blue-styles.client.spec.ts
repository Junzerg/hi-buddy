/** The light brand palette keeps readable content and controls on both workbench surfaces. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseRules } from './stylesheet-scan.ts'

const css = readFileSync(new URL('../src/styles/design-platform.css', import.meta.url), 'utf8')
const rules = parseRules(css)
const light = new Map(rules.filter(rule => rule.selectors.includes('body')).flatMap(rule => rule.declarations))

function color(name: string): string {
  const value = light.get(name)
  if (value === undefined) throw new Error(`Missing palette role ${name}`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
  return alias === undefined ? value : color(alias)
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((start) => {
    const channel = Number.parseInt(value.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05)
}

it('keeps body, secondary, caption and placeholder text readable on the light workbench', () => {
  for (const role of ['primary', 'secondary', 'tertiary', 'caption', 'dimmed']) {
    expect(contrast(color(`--dsw-alias-label-${role}`), color('--dsw-alias-bg-base')), role).toBeGreaterThanOrEqual(4.5)
  }
})

it('keeps primary and hover actions readable with white labels', () => {
  for (const state of ['fill', 'hover']) {
    expect(contrast('#ffffff', color(`--dsw-alias-button-primary-${state}`))).toBeGreaterThanOrEqual(4.5)
  }
})

it('keeps sidebar labels readable over the brightest point of its blue background', () => {
  for (const role of ['primary', 'secondary', 'tertiary', 'caption']) {
    expect(contrast(color(`--dsh-sidebar-label-${role}`), '#2c669f'), role).toBeGreaterThanOrEqual(4.5)
  }
})
