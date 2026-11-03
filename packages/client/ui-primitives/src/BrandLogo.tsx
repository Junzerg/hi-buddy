import type { IconProps } from './icons/props.ts'
import { FLOWER_PETALS, FLOWER_VIEWBOX } from './brand-artwork.ts'

/**
 * Render the six-petal HiBuddy mark on a transparent canvas.
 * @param props - Requested width and optional layout class.
 * @returns Decorative vector artwork at its native aspect ratio.
 */
export function BrandLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={(size * FLOWER_VIEWBOX.height) / FLOWER_VIEWBOX.width}
      viewBox={`${FLOWER_VIEWBOX.x} ${FLOWER_VIEWBOX.y} ${FLOWER_VIEWBOX.width} ${FLOWER_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      {FLOWER_PETALS.map(petal => <path key={petal.fill} fill={petal.fill} d={petal.d} />)}
    </svg>
  )
}
