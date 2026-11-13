import { useEffect } from 'react'

/**
 * Follow mouse input while the blank-home surface is visible and motion is allowed.
 * @param body - conversation surface containing the brand artwork.
 * @param hero - whether the new-conversation hero is visible.
 */
export function useHeroInteraction(body: HTMLDivElement | null, hero: boolean): void {
  useEffect(() => {
    if (body === null || !hero || typeof window.matchMedia !== 'function') return
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference) and (any-hover: hover)')
    let frame = 0

    const reset = () => {
      cancelAnimationFrame(frame)
      frame = 0
      body.removeAttribute('data-hero-pointer')
      body.style.removeProperty('--dsh-brand-pointer-x')
      body.style.removeProperty('--dsh-brand-pointer-y')
      body.style.removeProperty('--hero-light-x')
      body.style.removeProperty('--hero-light-y')
      for (const eye of body.querySelectorAll<HTMLElement>('[data-brand-eye]')) {
        eye.style.removeProperty('--dsh-eye-gaze-x')
        eye.style.removeProperty('--dsh-eye-gaze-y')
      }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !motion.matches || document.hidden) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bounds = body.getBoundingClientRect()
        if (bounds.width === 0 || bounds.height === 0) return
        const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
        const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
        body.style.setProperty('--dsh-brand-pointer-x', String(x / bounds.width * 2 - 1))
        body.style.setProperty('--dsh-brand-pointer-y', String(y / bounds.height * 2 - 1))
        body.style.setProperty('--hero-light-x', `${x}px`)
        body.style.setProperty('--hero-light-y', `${y}px`)
        if (body.contains(event.target as Node)) body.setAttribute('data-hero-pointer', '')
        else body.removeAttribute('data-hero-pointer')
        for (const eye of body.querySelectorAll<HTMLElement>('[data-brand-eye]')) {
          const bounds = eye.getBoundingClientRect()
          const dx = event.clientX - bounds.x - bounds.width / 2
          const dy = event.clientY - bounds.y - bounds.height / 2
          const distance = Math.min(1, Math.hypot(dx, dy) / 160)
          const angle = Math.atan2(dy, dx)
          eye.style.setProperty('--dsh-eye-gaze-x', `${Math.cos(angle) * bounds.width * 0.07 * distance}px`)
          eye.style.setProperty('--dsh-eye-gaze-y', `${Math.sin(angle) * bounds.height * 0.045 * distance}px`)
        }
        frame = 0
      })
    }
    const preferenceChanged = () => {
      if (!motion.matches) reset()
    }

    document.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', reset)
    motion.addEventListener('change', preferenceChanged)
    document.addEventListener('visibilitychange', reset)
    return () => {
      reset()
      document.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', reset)
      motion.removeEventListener('change', preferenceChanged)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [body, hero])
}
