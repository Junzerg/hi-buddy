/** Pointer and keyboard resizing of the normal right panel. */
import { useState } from 'react'
import type { PointerEvent } from 'react'
import type { PanelActions } from './service.ts'
import { clampRightbarWidth, type RightbarBounds } from './columns.ts'
import css from './AppFrame.module.css'

interface ResizeHandleProps {
  readonly width: number
  readonly bounds: RightbarBounds
  readonly label: string
  readonly onResize: PanelActions['setRightbarWidth']
}

/**
 * The handle owns its captured gesture; removing it also removes the drag styling.
 * @param props - resolved width, limits, accessible label, and width update action.
 * @returns the focusable vertical separator.
 */
export function RightbarResizeHandle({ width, bounds, label, onResize }: ResizeHandleProps) {
  const [drag, setDrag] = useState<{ pointerId: number; x: number; width: number } | null>(null)
  const end = (event: PointerEvent<HTMLButtonElement>): void => {
    setDrag(current => current?.pointerId === event.pointerId ? null : current)
  }
  return <button
    type="button"
    role="separator"
    className={css.rightbarResize}
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={bounds.min}
    aria-valuemax={bounds.max}
    aria-valuenow={width}
    data-rightbar-resize
    data-resizing={drag !== null || undefined}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary || drag !== null) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ pointerId: event.pointerId, x: event.clientX, width })
    }}
    onPointerMove={(event) => {
      if (drag?.pointerId !== event.pointerId) return
      onResize(clampRightbarWidth(drag.width + drag.x - event.clientX, bounds))
    }}
    onPointerUp={end}
    onPointerCancel={end}
    onLostPointerCapture={end}
    onKeyDown={(event) => {
      const widths: Record<string, number> = {
        ArrowLeft: width + 16, ArrowRight: width - 16, Home: bounds.min, End: bounds.max,
      }
      const next = widths[event.key]
      if (next === undefined) return
      event.preventDefault()
      event.stopPropagation()
      onResize(clampRightbarWidth(next, bounds))
    }}
  />
}
