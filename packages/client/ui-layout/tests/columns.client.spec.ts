import { describe, expect, it } from 'vitest'
import { clampRightbarWidth, computeColumns, rightbarBounds } from '../src/client/columns.ts'

describe('three-column layout', () => {
  it.each([
    [1440, true, { sidebar: 236, center: 868, rightbar: 336 }],
    [1181, true, { sidebar: 236, center: 609, rightbar: 336 }],
    [1180, true, { sidebar: 236, center: 944, rightbar: 0 }],
    [768, true, { sidebar: 236, center: 532, rightbar: 0 }],
    [390, true, { sidebar: 236, center: 154, rightbar: 0 }],
    [1440, false, { sidebar: 236, center: 1204, rightbar: 0 }],
    [390, false, { sidebar: 236, center: 154, rightbar: 0 }],
  ] as const)('resolves %ipx with right track=%s', (viewport, shown, expected) => {
    expect(computeColumns(viewport, shown)).toEqual(expected)
  })

  it('reserves the chosen panel width only above the overlay breakpoint', () => {
    expect(computeColumns(1440, true, 520)).toEqual({ sidebar: 236, center: 684, rightbar: 520 })
    expect(computeColumns(1180, true, 520)).toEqual({ sidebar: 236, center: 944, rightbar: 0 })
  })

  it('reserves main-content room in wide frames and a visible edge beside overlays', () => {
    expect(rightbarBounds(1440, 236)).toEqual({ min: 280, max: 844 })
    expect(rightbarBounds(1440, 0)).toEqual({ min: 280, max: 1080 })
    expect(rightbarBounds(390, 236)).toEqual({ min: 280, max: 366 })
    expect(rightbarBounds(200, 236)).toEqual({ min: 176, max: 176 })
    expect(rightbarBounds(0, 236)).toEqual({ min: 0, max: 0 })
  })

  it('bounds and rounds the displayed width while accepting an unchanged preference', () => {
    const bounds = rightbarBounds(1440, 236)
    expect(clampRightbarWidth(100, bounds)).toBe(280)
    expect(clampRightbarWidth(1000, bounds)).toBe(844)
    expect(clampRightbarWidth(520.4, bounds)).toBe(520)
    expect(clampRightbarWidth(336, rightbarBounds(390, 236))).toBe(336)
  })
})
