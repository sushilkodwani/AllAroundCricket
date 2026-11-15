// Home-screen team card (PLAN §7.2). Reads TeamStats, so the home screen needs
// only teams.json; when the team's own files are cached the date-dependent
// parts (next / last match, awaiting) are re-derived so they never go stale.
import { fmtDate, fmtDayMonth, fmtTime, money, relativeDay } from '../lib/dates'
import { fundsOf, matchesOf, membersOf, teamLoaded } from '../lib/domain'
import { duesTotal } from '../lib/funds'
import { computeTeamStats, winPercent } from '../lib/stats'
import { useApp } from '../state/AppContext'
import { navigate } from '../state/router'
import { RESULT_LABELS, RESULT_LETTER, type MatchResult, type Team, type TeamStats } from '../types'
import { Pill } from './ui'

const formColor = (r: MatchResult) => (r === 'won' ? 'bg-ok text-white' : r === 'lost' ? 'bg-bad text-white' : 'bg-alt text-muted')

export function liveStats(store: ReturnType<typeof useApp>['store'], team: Team): TeamStats {
  if (!store || !teamLoaded(store, team.id)) return team.stats
  return computeTeamStats(membersOf(store, team.id), matchesOf(store, team.id), fundsOf(store, team.id))
}

export function TeamCard({ team }: { team: Team }) {
  const { store, isAdmin, session } = useApp()
  const s = liveStats(store, team)
  const win = winPercent(s)
  const other = s.tied + s.draw + s.noResult

  // Personal line for players — needs the team's matches (loaded in the background).
  let personal: React.ReactNode = null
  if (!isAdmin && session && store && teamLoaded(store, team.id)) {
    const matches = matchesOf(store, team.id)
    const next = s.nextMatch ? matches.find((m) => m.id === s.nextMatch!.id) : undefined
    const owe = duesTotal(matches, session.personId)
    personal = (
      <div className="flex flex-wrap gap-x-3 text-sm">
        {next && (next.squad.includes(session.personId) ? <span className="font-medium text-ok">✅ You’re in the next squad</span> : <span className="text-muted">{next.squad.length ? 'Not in next squad' : 'Squad not announced yet'}</span>)}
        {owe > 0 && <span className="font-medium text-warn">You owe {money(owe)}</span>}
      </div>
    )
  }

  return (
    <button
      className={`card flex w-full overflow-hidden text-left active:bg-alt ${team.archived ? 'opacity-60' : ''}`}
      onClick={() => navigate(`/teams/${team.id}`)}
      aria-label={`Open ${team.name}`}
    >
      <span className="w-1.5 shrink-0" style={{ background: team.color }} />
      <span className="min-w-0 flex-1 space-y-1 px-3 py-3">
        <span className="flex items-start gap-2">
          <span className="rounded-md px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: team.color }}>
            {team.shortName}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {team.archived && <Pill>Archived</Pill>}
            {s.settlingMatches > 0 && <Pill tone="warn">⚠ {s.settlingMatches} to settle</Pill>}
            {isAdmin && s.awaitingCompletion > 0 && <Pill tone="warn">🕓 {s.awaitingCompletion} awaiting completion</Pill>}
          </span>
        </span>

        <span className="block text-sm text-muted">
          👥 {s.activePlayers} player{s.activePlayers === 1 ? '' : 's'} · 🏏 {s.played} played
          {win !== null && ` · ${win}% wins`}
        </span>

        {s.form.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>
              W {s.won} · L {s.lost}
              {other > 0 && ` · T/D/NR ${other}`}
            </span>
            <span className="flex items-center gap-1" aria-label={`Form, latest last: ${s.form.map((r) => RESULT_LABELS[r]).join(', ')}`}>
              <span className="text-xs text-muted">Form</span>
              {s.form.map((r, i) => (
                <span key={i} className={`flex h-5 min-w-[20px] items-center justify-center rounded px-1 text-[10px] font-bold ${formColor(r)}`}>
                  {RESULT_LETTER[r]}
                </span>
              ))}
            </span>
          </span>
        )}

        <span className="block text-sm">
          {s.nextMatch ? (
            <>
              📅 Next: vs {s.nextMatch.opponent} · {fmtDate(s.nextMatch.date, false)}
              {s.nextMatch.time && `, ${fmtTime(s.nextMatch.time)}`} · <span className="text-accent">{relativeDay(s.nextMatch.date)}</span>
            </>
          ) : (
            <span className="text-muted">No upcoming match</span>
          )}
        </span>

        {s.lastMatch && (
          <span className="block text-sm text-muted">
            Last: {s.lastMatch.result ? `${RESULT_LABELS[s.lastMatch.result]} vs ${s.lastMatch.opponent}` : `vs ${s.lastMatch.opponent} · Result pending`} · {fmtDayMonth(s.lastMatch.date)}
          </span>
        )}

        {(s.fundBalance > 0 || s.pendingDues > 0) && (
          <span className="block text-sm">
            💰 Fund {money(s.fundBalance)}
            {s.pendingDues > 0 && <span className="text-warn"> · Dues {money(s.pendingDues)}</span>}
          </span>
        )}

        {personal}
      </span>
    </button>
  )
}
