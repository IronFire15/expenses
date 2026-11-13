import { animate, motion, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps } from 'motion/react'
import { useEffect } from 'react'
import { formatMoney } from '@/lib/money'
import { DURATION, EASE_OUT, staggerContainer, staggerItem } from '@/lib/motion'

/** Children animate in one after another. Wrap each child in <StaggerItem>. */
export function Stagger(props: HTMLMotionProps<'div'>) {
  return <motion.div variants={staggerContainer} initial="initial" animate="animate" {...props} />
}

export function StaggerItem(props: HTMLMotionProps<'div'>) {
  return <motion.div variants={staggerItem} {...props} />
}

/** Money value that counts up to its new value. Jumps instantly when the OS asks for reduced motion. */
export function AnimatedMoney({ cents, currency }: { cents: number; currency?: string }) {
  const reduce = useReducedMotion()
  const value = useMotionValue(reduce ? cents : 0)
  const text = useTransform(value, (v) => formatMoney(Math.round(v), currency))

  useEffect(() => {
    if (reduce) {
      value.set(cents)
      return
    }
    const controls = animate(value, cents, { duration: DURATION.number, ease: EASE_OUT })
    return () => controls.stop()
  }, [cents, reduce, value])

  return (
    <>
      <motion.span aria-hidden>{text}</motion.span>
      <span className="sr-only">{formatMoney(cents, currency)}</span>
    </>
  )
}
