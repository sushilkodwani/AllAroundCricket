// Small match display pieces shared by the team screen, the Matches tab and match detail.
import { dateChip, fmtTime } from '../lib/dates'
import { matchStatus, STATUS_LABELS, type MatchStatus } from '../lib/stats'
import { navigate } from '../state/router'
import { useApp } from '../state/AppContext'
import { MATCH_TYPE_LABELS, RESULT_LABELS, type Match, type MatchResult, type Team } from '../types'
import { Pill, type Tone } from './ui'

const RESULT_TONE: Record<MatchResult, Tone> = { won: 'ok', lost: 'bad', tied: 'neutral', draw: 'neutral', no_result: 'neutral', abandoned: 'neutral' }
const STATUS_TONE: Record<MatchStatus, Tone> = { cancelled: 'neutral', completed: 'ok', settling: 'warn', upcoming: 'brand', awaiting: 'warn' }

export function ResultChip({ result }: { result?: MatchResult }) {
  if (!result) return null
  return <Pill tone={RESULT_TONE[result]}>{RESULT_LABELS[result]}</Pill>
}

export function StatusChip({ status }: { status: MatchStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Pill>
}

/** One match in a list. Tapping opens match detail. */
export function MatchRow({ match, team, showTeam }: { match: Match; team?: Team; showTeam?: boolean }) {
  const { isAdmin, session } = useApp()
  const chip = dateChip(match.date)
  const status = matchStatus(match)
  const playing = !isAdmin && !!session && match.squad.includes(session.personId)
  const details = [fmtTime(match.time), match.venue].filter(Boolean).join(' · ')
  // "Awaiting completion" is the admin's to-do; everyone sees settling / completed.
  const showStatus = status === 'settling' || status === 'completed' || (status === 'awaiting' && isAdmin)
  return (
    <button
      className="flex w-full items-stretch gap-3 px-3 py-3 text-left active:bg-alt"
      onClick={() => navigate(`/teams/${match.teamId}/matches/${match.id}`)}
      style={showTeam && team ? { borderLeft: `4px solid ${team.color}` } : undefined}
    >
      <span className="flex w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-alt py-1 leading-tight">
        <span className="text-[10px] font-semibold text-muted">{chip.dow}</span>
        <span className="text-lg font-bold">{chip.day}</span>
        <span className="text-[10px] font-semibold text-muted">{chip.mon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {showTeam && team ? `${team.shortName} ` : ''}vs {match.opponent}
        </span>
        {details && <span className="block truncate text-sm text-muted">{details}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Pill>{MATCH_TYPE_LABELS[match.matchType]}</Pill>
          <span className="text-xs text-muted">{match.squad.length > 0 ? `${match.squad.length} in squad` : 'No squad yet'}</span>
          <ResultChip result={match.result} />
          {showStatus && <StatusChip status={status} />}
          {playing && <span className="text-xs font-medium text-ok">You’re playing ✅</span>}
        </span>
      </span>
    </button>
  )
}
