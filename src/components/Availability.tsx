// Availability poll (PLAN §30): each player says In / Maybe / Out for an
// upcoming match; everyone sees the count, the admin uses it to pick the squad.
import { setAvailability } from '../lib/domain'
import { P } from '../lib/paths'
import { useApp, useFile, type TeamData } from '../state/AppContext'
import type { AvailabilityEntry, AvailabilityFile, AvailabilityStatus, Match } from '../types'
import { Pill, type Tone } from './ui'

export const AVAIL_LABEL: Record<AvailabilityStatus, string> = { in: 'In', maybe: 'Maybe', out: 'Out' }
export const AVAIL_TONE: Record<AvailabilityStatus, Tone> = { in: 'ok', maybe: 'warn', out: 'bad' }

/** Answers for one match, by person. */
export function useAvailability(teamId: string, matchId: string): Map<string, AvailabilityStatus> {
  const file = useFile<AvailabilityFile>(P.availability(teamId))
  return new Map((file?.entries ?? []).filter((e: AvailabilityEntry) => e.matchId === matchId).map((e) => [e.personId, e.status]))
}

export function AvailabilityCard({ match, data }: { match: Match; data: TeamData }) {
  const { store, session, isAdmin, personName, toast } = useApp()
  const answers = useAvailability(match.teamId, match.id)
  const me = session?.personId ?? ''
  const active = data.members.filter((m) => m.status === 'active').map((m) => m.personId)
  const isMember = active.includes(me)
  const mine = answers.get(me)
  const groups = (['in', 'maybe', 'out'] as const).map((status) => ({
    status,
    ids: active.filter((id) => answers.get(id) === status).sort((a, b) => personName(a).localeCompare(personName(b))),
  }))
  const waiting = active.filter((id) => !answers.has(id))

  function answer(status: AvailabilityStatus) {
    if (!store) return
    // Tapping the current answer again clears it.
    const ok = setAvailability(store, match.teamId, match.id, me, mine === status ? null : status)
    if (!ok) toast('Could not save your answer')
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Who can play?</h2>
        <span className="text-sm text-muted">
          {groups[0].ids.length} in · {groups[1].ids.length} maybe · {groups[2].ids.length} out
        </span>
      </div>

      {isMember && (
        <div>
          <p className="mb-2 text-sm text-muted">Your answer</p>
          <div className="grid grid-cols-3 gap-2">
            {(['in', 'maybe', 'out'] as const).map((s) => (
              <button
                key={s}
                aria-pressed={mine === s}
                className={`min-h-[44px] rounded-xl border text-sm font-semibold ${mine === s ? (s === 'in' ? 'border-ok bg-ok/15 text-ok' : s === 'out' ? 'border-bad bg-bad/15 text-bad' : 'border-warn bg-warn/15 text-warn') : 'border-line bg-surface'}`}
                onClick={() => answer(s)}
              >
                {s === 'in' ? '✅ In' : s === 'out' ? '❌ Out' : '🤔 Maybe'}
              </button>
            ))}
          </div>
        </div>
      )}

      {groups
        .filter((g) => g.ids.length > 0)
        .map((g) => (
          <p key={g.status} className="text-sm">
            <Pill tone={AVAIL_TONE[g.status]}>{AVAIL_LABEL[g.status]}</Pill> <span className="text-muted">{g.ids.map(personName).join(', ')}</span>
          </p>
        ))}
      {(isAdmin || answers.size > 0) && waiting.length > 0 && (
        <p className="text-sm">
          <Pill>No answer</Pill> <span className="text-muted">{waiting.map(personName).join(', ')}</span>
        </p>
      )}
      {answers.size === 0 && !isMember && !isAdmin && <p className="text-sm text-muted">Nobody has answered yet.</p>}
    </div>
  )
}
