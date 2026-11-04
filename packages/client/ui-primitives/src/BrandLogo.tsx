import { useId } from 'react'
import type { IconProps } from './icons/props.ts'
import { BRAND_PATH, BRAND_GRADIENT, BRAND_VIEWBOX } from './brand-artwork.ts'

/**
 * Render the designer-supplied HiBuddy mark on a transparent canvas.
 * @param props - Requested width and optional layout class.
 * @returns Decorative brand artwork at its native aspect ratio.
 */
export function BrandLogo({ size = 24, className }: IconProps) {
  const gradientId = useId()
  return (
    <svg
      className={className}
      width={size}
      height={(size * BRAND_VIEWBOX.height) / BRAND_VIEWBOX.width}
      viewBox={`${BRAND_VIEWBOX.x} ${BRAND_VIEWBOX.y} ${BRAND_VIEWBOX.width} ${BRAND_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1={BRAND_GRADIENT.start} y1={0} x2={BRAND_GRADIENT.end} y2={0} gradientUnits="userSpaceOnUse">
          <stop stopColor={BRAND_GRADIENT.colors[0]} />
          <stop offset={1} stopColor={BRAND_GRADIENT.colors[1]} />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d={BRAND_PATH} />
    </svg>
  )
}
