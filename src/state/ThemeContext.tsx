/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'aac.theme'

const Ctx = createContext<{ pref: ThemePref; isDark: boolean; setPref: (p: ThemePref) => void } | null>(null)

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme outside provider')
  return ctx
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref | null) ?? 'system')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const isDark = pref === 'dark' || (pref === 'system' && systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    // The phone's status bar follows the header: red in light mode, black in dark.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#000000' : '#9B1C1F')
  }, [isDark])

  function setPref(p: ThemePref) {
    localStorage.setItem(KEY, p)
    setPrefState(p)
  }

  return <Ctx.Provider value={{ pref, isDark, setPref }}>{children}</Ctx.Provider>
}
