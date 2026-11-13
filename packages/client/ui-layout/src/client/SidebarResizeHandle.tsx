/** Upstream DSH pointer capture and rAF-coalesced sidebar resizing. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { clampWidth, type RightbarBounds } from './columns.ts'
import css from './AppFrame.module.css'

interface SidebarResizeHandleProps {
  width: number
  bounds: RightbarBounds
  label: string
  onResize: (width: number) => void
  onStart: () => void
  onEnd: () => void
}

/** Render the sidebar divider using the upstream captured, frozen-origin gesture. */
export function SidebarResizeHandle(props: SidebarResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const baseWidth = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  const resize = useCallback((dx: number) => {
    const { bounds, onResize } = callbacks.current
    onResize(clampWidth(baseWidth.current + dx, bounds.min, bounds.max))
  }, [])
  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === event.pointerId) endDrag()
  }, [endDrag])

  return <div
    className={css.sidebarResize}
    style={{ '--dsh-sidebar-resize-left': `${props.width}px` } as CSSProperties}
    role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={props.label} aria-valuenow={props.width} aria-valuemin={props.bounds.min} aria-valuemax={props.bounds.max}
    data-sidebar-resize="" data-dragging={dragging || undefined}
    onPointerDown={(event) => {
      if (event.button !== 0 || capture.current !== null) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      capture.current = { element: event.currentTarget, id: event.pointerId }
      origin.current = event.clientX
      baseWidth.current = callbacks.current.width
      latest.current = event.clientX
      callbacks.current.onStart()
      setDragging(true)
    }}
    onPointerMove={(event) => {
      if (capture.current?.id !== event.pointerId) return
      latest.current = event.clientX
      frame.current ??= requestAnimationFrame(() => {
        frame.current = null
        resize(latest.current - origin.current)
      })
    }}
    onPointerUp={(event) => {
      if (capture.current?.id !== event.pointerId) return
      resize(event.clientX - origin.current)
      endDrag()
    }}
    onPointerCancel={onPointerCancel}
    onLostPointerCapture={onPointerCancel}
    onKeyDown={(event) => {
      const widths: Record<string, number> = {
        ArrowLeft: props.width - 16, ArrowRight: props.width + 16, Home: props.bounds.min, End: props.bounds.max,
      }
      const next = widths[event.key]
      if (next === undefined) return
      event.preventDefault()
      event.stopPropagation()
      props.onResize(clampWidth(next, props.bounds.min, props.bounds.max))
    }}
  />
}
