/** Company footer geometry keeps its account and adjacent actions compact. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/AccountMenu.module.css', import.meta.url), 'utf8')

it('keeps the account and footer actions on one row without a sign-in inset', () => {
  expect(css).toMatch(/\.root\s*\{[^}]*display: flex;[^}]*align-items: center;/)
  expect(css).not.toContain('data-inset')
  expect(css).toMatch(/\.footerActions\s*\{[^}]*margin-left: auto;[^}]*display: flex;/)
})

it('preserves the 26px circular launcher and 34px identity avatar', () => {
  const trigger = css.match(/\.trigger\s*\{([^}]+)\}/)?.[1]
  expect(trigger).toContain('width: 26px;')
  expect(trigger).toContain('height: 26px;')
  expect(trigger).toContain('padding: 0;')
  expect(trigger).toContain('border-radius: 50%;')
  expect(css).toMatch(/\.profileAvatar\s*\{[^}]*width: 34px;[^}]*height: 34px;/)
})
