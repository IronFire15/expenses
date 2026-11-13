import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Theme = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

const STORAGE_KEY = 'theme' // also read by the inline script in index.html
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStored(): Theme {
  try {
    const t = localStorage.getItem(STORAGE_KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function subscribeSystem(cb: () => void) {
  const mq = matchMedia(DARK_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

const ThemeContext = createContext<{ theme: Theme; resolvedTheme: Resolved; setTheme: (t: Theme) => void } | null>(null)

/**
 * Small theme provider: Light / Dark / System, stored in localStorage.
 * The inline script in index.html applies the class before first paint (no flash).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored)
  const systemDark = useSyncExternalStore(subscribeSystem, () => matchMedia(DARK_QUERY).matches)
  const resolvedTheme: Resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    const root = document.documentElement
    // Disable transitions for one frame so colors switch at once instead of fading unevenly.
    root.classList.add('[&_*]:transition-none!')
    root.classList.toggle('dark', resolvedTheme === 'dark')
    const color = resolvedTheme === 'dark' ? '#0f1115' : '#f8f9fa' // hex: some browsers ignore oklch here
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', color)
      m.removeAttribute('media')
    })
    const id = requestAnimationFrame(() => root.classList.remove('[&_*]:transition-none!'))
    return () => cancelAnimationFrame(id)
  }, [resolvedTheme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      if (t === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* storage blocked: theme still applies for this session */
    }
  }, [])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

const OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** Segmented control: Light / Dark / System, with a sliding selection pill. */
export function ThemeSwitcher({ compact = false, id = 'theme' }: { compact?: boolean; id?: string }) {
  const { theme, setTheme } = useTheme()

  return (
    <div role="group" aria-label="Theme" className="inline-flex w-fit rounded-lg bg-muted p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-10 pointer-coarse:px-3.5',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-pill`}
                className="absolute inset-0 rounded-md bg-card shadow-card"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
              />
            )}
            <Icon className="relative size-3.5" aria-hidden />
            {!compact && <span className="relative">{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
