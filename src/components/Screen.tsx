import type { ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import { goBack, navigate, useRoute } from '../state/router'

/** Save / offline / view-only indicators shown in every header. */
function StatusBadges() {
  const { status, isAdmin, role } = useApp()
  const saving =
    status.save === 'saving' ? 'Saving…' : status.save === 'saved' ? '✓ Saved' : status.save === 'offline' ? 'Offline — will sync' : status.save === 'error' ? 'Save failed' : null
  return (
    <span className="flex items-center gap-2 text-xs font-medium">
      {role === 'viewer' && <span className="rounded-full bg-white/20 px-2 py-0.5">👁 View only</span>}
      {isAdmin && saving && <span className={status.save === 'error' ? 'rounded-full bg-white px-2 py-0.5 text-bad' : 'opacity-90'}>{saving}</span>}
      {!status.online && status.save !== 'offline' && <span className="rounded-full bg-white/20 px-2 py-0.5">Offline</span>}
    </span>
  )
}

/**
 * One screen: sticky header (back chevron on sub-screens, title, status,
 * actions) and padded content that clears the bottom tab bar.
 */
export function Screen({
  title,
  back,
  actions,
  children,
  footer,
}: {
  title: string
  /** Where Back goes when there is no in-app history (deep link / reload). */
  back?: string
  actions?: ReactNode
  children: ReactNode
  /** Sticky bar above the tab area (used by full-screen flows). */
  footer?: ReactNode
}) {
  return (
    <div className="mx-auto min-h-screen max-w-2xl">
      <header className="app-header sticky top-0 z-40 pt-[env(safe-area-inset-top)]">
        <div className="flex min-h-[52px] items-center gap-1 px-2">
          {back ? (
            <button className="flex h-11 w-11 items-center justify-center text-2xl" onClick={() => goBack(back)} aria-label="Back">
              ‹
            </button>
          ) : (
            <span className="w-2" />
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
          <StatusBadges />
          {actions}
        </div>
      </header>
      <main className={footer ? 'pb-40' : 'pb-28'}>{children}</main>
      {footer && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-2xl px-4 py-3">{footer}</div>
        </div>
      )}
    </div>
  )
}

/** Refresh arrows, drawn as a shape so the size is predictable on every phone. */
export function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${spinning ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5v4.6h-4.6" />
    </svg>
  )
}

/** Round icon button for header actions. */
export function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="flex h-11 min-w-[44px] items-center justify-center rounded-full px-2 text-lg font-semibold active:bg-white/20" onClick={onClick} aria-label={label}>
      {children}
    </button>
  )
}

const TABS: { path: string; icon: string; label: string }[] = [
  { path: '/teams', icon: '🏏', label: 'Teams' },
  { path: '/matches', icon: '📅', label: 'Matches' },
  { path: '/funds', icon: '💰', label: 'Funds' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
]

export function TabBar() {
  const route = useRoute()
  // Opponent teams are reached from the Teams tab, so they light it up too.
  const first = route.segs[0] ?? 'teams'
  const current = first === 'opponents' ? '/teams' : first === 'tournaments' ? '/matches' : `/${first}`
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="Main">
      <div className="mx-auto flex max-w-2xl">
        {TABS.map((t) => {
          const on = current === t.path
          return (
            <button
              key={t.path}
              className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${on ? 'text-accent' : 'text-muted'}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => navigate(t.path, { replace: on })}
            >
              {on && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-brand" />}
              <span className="text-xl" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
