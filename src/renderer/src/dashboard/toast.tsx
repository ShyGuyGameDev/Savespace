import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'

type Toast = { id: number; text: string }
let push: ((t: string) => void) | null = null
export const toast = (text: string) => push?.(text)

/** Quiet, accessible toast (role=status), bottom-right. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    push = (text) => {
      const id = Date.now() + Math.random()
      setItems((s) => [...s.slice(-2), { id, text }])
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3500)
    }
    return () => {
      push = null
    }
  }, [])
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-lg bg-foreground px-3 py-2 text-[13px] text-background shadow-lg"
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
