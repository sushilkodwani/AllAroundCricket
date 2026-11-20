// Super admin only: a warning across the top when less than 10% of the hour's GitHub requests are left.
import { useEffect, useState } from 'react'
import { fmtTime } from '../lib/dates'
import { isLow } from '../lib/usage'
import { useRate } from '../screens/Usage'
import { useApp } from '../state/AppContext'
import { navigate, useRoute } from '../state/router'

const HIDE_KEY = 'aac.lowHiddenUntil'

export function LowAllowanceBar() {
  const { store, config, realSession, pausedUntil } = useApp()
  const route = useRoute()
  const rate = useRate()
  const isSuper = !!realSession && config?.superAdminId === realSession.personId
  const [hiddenUntil, setHiddenUntil] = useState(() => Number(sessionStorage.getItem(HIDE_KEY) ?? 0))

  // The figure also comes with every request; asking now and then (free) keeps it fresh when the app is idle.
  useEffect(() => {
    if (!store || !isSuper) return
    const ask = () => document.visibilityState === 'visible' && void store.rateLimit()
    ask()
    const t = setInterval(ask, 5 * 60_000)
    return () => clearInterval(t)
  }, [store, isSuper])

  // While the hard stop is on, the super admin is reminded on every screen.
  if (isSuper && pausedUntil && route.path !== '/settings/usage') {
    return (
      <button className="flex w-full items-center gap-2 bg-warn px-3 py-2 text-left text-sm text-white" onClick={() => navigate('/settings/usage')}>
        <span aria-hidden="true">⏸</span>
        <span className="min-w-0 flex-1">
          Hard stop on: the app is closed for everyone else until <strong>{fmtTime(new Date(pausedUntil).toTimeString().slice(0, 5))}</strong>. Tap to turn it off.
        </span>
      </button>
    )
  }
  if (!isSuper || !rate || !isLow(rate) || route.path === '/settings/usage' || hiddenUntil >= rate.resetAt) return null
  const reset = fmtTime(new Date(rate.resetAt).toTimeString().slice(0, 5))
  return (
    <div className="flex items-center gap-2 bg-bad px-3 py-2 text-sm text-white" role="alert">
      <button className="min-w-0 flex-1 text-left" onClick={() => navigate('/settings/usage')}>
        ⚠ Only <strong>{rate.remaining.toLocaleString('en-IN')}</strong> of {rate.limit.toLocaleString('en-IN')} GitHub requests left this hour (until {reset}). Tap for usage.
      </button>
      <button
        className="min-h-[32px] shrink-0 rounded-lg border border-white/60 px-2 font-semibold"
        aria-label="Hide until the hour starts afresh"
        onClick={() => {
          sessionStorage.setItem(HIDE_KEY, String(rate.resetAt))
          setHiddenUntil(rate.resetAt)
        }}
      >
        Hide
      </button>
    </div>
  )
}
