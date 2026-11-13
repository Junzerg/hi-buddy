import clsx from 'clsx'
import { BrandLogo } from './BrandLogo.tsx'
import css from './BrandBackground.module.css'

/** Shared decorative artwork for main pages, conversations, and settings. */
export interface BrandBackgroundProps {
  /** Clear faces with a progressively frosted lower body, or a fully blurred image. */
  variant?: 'clear' | 'blurred'
  /** Bottom corner occupied by the illustration. */
  position?: 'left' | 'right'
}

/** Render theme-owned artwork behind a positioned, isolated parent surface. */
export function BrandBackground({ variant = 'blurred', position = 'right' }: BrandBackgroundProps) {
  return <div className={clsx(css.root, css[variant], position === 'left' && css.left)}
    data-brand-background={variant} aria-hidden="true">
    {variant === 'clear' && <>
      <div className={css.eyes}>
        <span className={clsx(css.eye, css.darkLeft)} data-brand-eye="" />
        <span className={clsx(css.eye, css.darkRight)} data-brand-eye="" />
        <span className={clsx(css.eye, css.blondLeft)} data-brand-eye="" />
        <span className={clsx(css.eye, css.blondRight)} data-brand-eye="" />
      </div>
      <div className={css.buckles}>
        <span className={clsx(css.buckle, css.buckleLeft)} data-brand-buckle="left"><BrandLogo size={24} /></span>
        <span className={clsx(css.buckle, css.buckleRight)} data-brand-buckle="right"><BrandLogo size={24} /></span>
      </div>
    </>}
  </div>
}
