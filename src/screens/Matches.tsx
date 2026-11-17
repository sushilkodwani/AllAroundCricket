// Matches tab (PLAN §7.5): upcoming across the user's teams, then recent results.
import { useState } from 'react'
import { MatchRow } from '../components/match'
import { Screen } from '../components/Screen'
import { Empty, SearchBox } from '../components/ui'
import { addDays, fmtDate, todayISO } from '../lib/dates'
import { matchesOf, teamLoaded } from '../lib/domain'
import { getPref } from '../lib/session'
import { matchStatus, sortMatchesAsc } from '../lib/stats'
import { MATCH_TYPE_LABELS } from '../types'
import { useApp, useTeamsLoaded } from '../state/AppContext'
import { navigate } from '../state/router'

export function Matches() {
  const { teams, store, isAdmin, session } = useApp()
  const [mine, setMine] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const showArchived = isAdmin && getPref('showArchived', false)
  const visible = teams.filter((t) => showArchived || !t.archived)
  useTeamsLoaded(visible.map((t) => t.id))

  const loading = !!store && visible.some((t) => !teamLoaded(store, t.id))
  const teamOf = new Map(visible.map((t) => [t.id, t]))
  const all = store ? visible.flatMap((t) => matchesOf(store, t.id)) : []
  // Search looks at the opponent, our team, the venue, the match type and the date as written on screen.
  const found = (m: (typeof all)[number]) => {
    if (!q) return true
    const t = teamOf.get(m.teamId)
    return [m.opponent, m.venue, t?.name, t?.shortName, MATCH_TYPE_LABELS[m.matchType], fmtDate(m.date), m.date].some((x) => x?.toLowerCase().includes(q))
  }
  const pool = sortMatchesAsc(all.filter((m) => !m.cancelled && found(m) && (!mine || m.squad.includes(session?.personId ?? ''))))

  const upcoming = pool.filter((m) => matchStatus(m) === 'upcoming')
  const since = addDays(todayISO(), -30)
  const recent = pool.filter((m) => matchStatus(m) !== 'upcoming' && (q || m.date >= since)).reverse()

  return (
    <Screen
      title="Matches"
      actions={
        <button className="mr-2 min-h-[36px] rounded-full bg-white px-3 text-sm font-semibold text-brand" onClick={() => navigate('/tournaments')}>
          🏆 Tournaments
        </button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <SearchBox value={query} onChange={setQuery} placeholder='Search opponent, venue, team or date' ariaLabel='Search matches' />
        {!isAdmin && (
          <div>
            <button className={`${mine ? 'chip-on' : 'chip'} min-h-[36px] px-3`} aria-pressed={mine} onClick={() => setMine((v) => !v)}>
              My matches
            </button>
          </div>
        )}

        {upcoming.length === 0 && recent.length === 0 ? (
          loading ? (
            <p className="p-10 text-center text-sm text-muted">Loading…</p>
          ) : (
            <Empty icon="📅" title={q ? `No match for “${query.trim()}”` : mine ? 'No matches with you in the squad' : 'No matches to show'} text={q ? 'Try an opponent, a ground or a date.' : 'Upcoming matches and results from the last 30 days appear here.'} />
          )
        ) : (
          <>
            <section>
              <h2 className="section-title">Upcoming</h2>
              {upcoming.length === 0 ? (
                <p className="card px-4 py-5 text-center text-sm text-muted">No upcoming match</p>
              ) : (
                <div className="card divide-y divide-line overflow-hidden">
                  {upcoming.map((m) => (
                    <MatchRow key={m.id} match={m} team={teamOf.get(m.teamId)} showTeam />
                  ))}
                </div>
              )}
            </section>
            {recent.length > 0 && (
              <section>
                <h2 className="section-title">Recent results</h2>
                <div className="card divide-y divide-line overflow-hidden">
                  {recent.map((m) => (
                    <MatchRow key={m.id} match={m} team={teamOf.get(m.teamId)} showTeam />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Screen>
  )
}
