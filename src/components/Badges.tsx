// Badges on a player's page: the latest few earned, and a sheet with every
// badge (earned ones with their date, the rest greyed with what it takes).
import { useState } from 'react'
import { earnedBadges, type Badge, type BadgeGroup } from '../lib/badges'
import { fmtDate } from '../lib/dates'
import { Sheet } from './ui'

const GROUPS: { key: BadgeGroup; label: string }[] = [
  { key: 'batting', label: 'Batting' },
  { key: 'bowling', label: 'Bowling' },
  { key: 'fielding', label: 'Fielding' },
  { key: 'match', label: 'Matches and awards' },
]

function Medal({ b, size = 48 }: { b: Badge; size?: number }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full border-2 ${b.earned ? 'border-brand bg-alt' : 'border-dashed border-line bg-alt opacity-50 grayscale'}`} style={{ width: size, height: size, fontSize: size * 0.48 }} aria-hidden>
      {b.icon}
    </span>
  )
}

export function BadgesCard({ badges, name }: { badges: Badge[]; name: string }) {
  const [open, setOpen] = useState(false)
  const earned = earnedBadges(badges)
  // The nearest locked count badge, as something to aim for.
  const next = badges
    .filter((b) => !b.earned && b.progress && b.progress.have > 0)
    .sort((a, b) => b.progress!.have / b.progress!.need - a.progress!.have / a.progress!.need)[0]
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Badges</h3>
        <button className="text-sm font-semibold text-accent" onClick={() => setOpen(true)}>
          {earned.length} of {badges.length} · See all
        </button>
      </div>
      {earned.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No badges yet. A thirty, a first wicket or a catch is all it takes.</p>
      ) : (
        <div className="-mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {earned.slice(0, 8).map((b) => (
            <button key={b.id} className="flex w-16 shrink-0 flex-col items-center gap-1 text-center" onClick={() => setOpen(true)}>
              <Medal b={b} />
              <span className="line-clamp-2 text-[11px] font-medium leading-tight">{b.name}</span>
            </button>
          ))}
        </div>
      )}
      {next && (
        <div className="mt-3 rounded-xl bg-alt px-3 py-2 text-sm">
          <div className="flex justify-between gap-2">
            <span>
              Next: <strong className="font-semibold">{next.name}</strong>
            </span>
            <span className="text-muted">
              {next.progress!.have} / {next.progress!.need}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(next.progress!.have / next.progress!.need) * 100}%` }} />
          </div>
        </div>
      )}

      {open && (
        <Sheet title={`${name} — badges`} onClose={() => setOpen(false)} full>
          <p className="mb-3 text-sm text-muted">
            {earned.length} of {badges.length} earned, from the scored matches shown on this page.
          </p>
          {GROUPS.map((g) => {
            const list = badges.filter((b) => b.group === g.key)
            return (
              <div key={g.key} className="mb-4">
                <h4 className="section-title">{g.label}</h4>
                <div className="card divide-y divide-line">
                  {list.map((b) => (
                    <div key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                      <Medal b={b} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold ${b.earned ? '' : 'text-muted'}`}>
                          {b.name}
                          {b.times > 1 && <span className="ml-1 font-normal text-muted">×{b.times}</span>}
                        </p>
                        <p className="text-xs text-muted">{b.earned ? `Earned ${fmtDate(b.earned.date)}` : b.how}</p>
                        {!b.earned && b.progress && (
                          <div className="mt-1 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                              <div className="h-full rounded-full bg-brand" style={{ width: `${(b.progress.have / b.progress.need) * 100}%` }} />
                            </div>
                            <span className="text-[11px] text-muted">
                              {b.progress.have}/{b.progress.need}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </Sheet>
      )}
    </section>
  )
}
