import type { Transition, Variants } from 'motion/react'

/**
 * Motion tokens. Keep animations short and purposeful:
 * - enter: 200–300 ms, ease-out (things arrive quickly, settle gently)
 * - no exit animations on navigation (they delay the next page)
 * - springs only for things that move position (nav pill, toggles)
 */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

export const DURATION = { fast: 0.15, base: 0.25, slow: 0.4, number: 0.9 } as const

export const SPRING: Transition = { type: 'spring', bounce: 0.15, duration: 0.45 }

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
}

export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
}

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
}
