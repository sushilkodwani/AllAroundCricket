// Match awards (PLAN §33): the app suggests them from a points formula; the
// admin (or scorer) confirms or changes them. Everyone sees the confirmed ones.
import { useMemo, useState } from 'react'
import { awardPoints, suggestAwards } from '../lib/insights'
import { useApp } from '../state/AppContext'
import type { MatchAwards, ScoreFile } from '../types'

const ROWS: { key: keyof MatchAwards; label: string; icon: string }[] = [
  { key: 'potm', label: 'Player of the match', icon: '🏆' },
  { key: 'batter', label: 'Best batter', icon: '🏏' },
  { key: 'bowler', label: 'Best bowler', icon: '🎯' },
]

/** Read-only list of the confirmed awards. */
export function AwardsList({ awards }: { awards: MatchAwards }) {
  const { personName } = useApp()
  const rows = ROWS.filter((r) => awards[r.key])
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1 text-sm">
      {rows.map((r) => (
        <p key={r.key}>
          <span aria-hidden="true">{r.icon}</span> <span className="text-muted">{r.label}:</span> <strong>{personName(awards[r.key]!)}</strong>
        </p>
      ))}
    </div>
  )
}

export function AwardsEditor({ file, onSave }: { file: ScoreFile; onSave: (awards: MatchAwards) => void }) {
  const { personName } = useApp()
  const suggested = useMemo(() => suggestAwards(file), [file])
  const points = useMemo(() => new Map(awardPoints(file).map((p) => [p.id, p])), [file])
  const [editing, setEditing] = useState(!file.awards)
  const [draft, setDraft] = useState<MatchAwards>(file.awards ?? suggested)
  const players = [...file.home.xi, ...file.away.xi].sort((a, b) => (points.get(b)?.total ?? 0) - (points.get(a)?.total ?? 0))

  if (!editing && file.awards) {
    return (
      <div className="card flex flex-col gap-3 p-4">
        <h3 className="font-semibold">Match awards</h3>
        <AwardsList awards={file.awards} />
        <button className="btn-secondary" onClick={() => setEditing(true)}>
          Change awards
        </button>
      </div>
    )
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <h3 className="font-semibold">Match awards</h3>
      <p className="text-sm text-muted">Suggested from the scorecard. Change any of them, then confirm.</p>
      {ROWS.map((r) => (
        <label key={r.key} className="block">
          <span className="label">
            {r.icon} {r.label}
          </span>
          <select className="input" value={draft[r.key] ?? ''} onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value || undefined })}>
            <option value="">— none —</option>
            {players.map((id) => {
              const p = points.get(id)
              const n = r.key === 'potm' ? p?.total : r.key === 'batter' ? p?.bat : p?.bowl
              return (
                <option key={id} value={id}>
                  {personName(id)}
                  {n ? ` · ${n} pts` : ''}
                  {suggested[r.key] === id ? ' (suggested)' : ''}
                </option>
              )
            })}
          </select>
        </label>
      ))}
      <button
        className="btn-primary"
        onClick={() => {
          onSave(draft)
          setEditing(false)
        }}
      >
        Confirm awards
      </button>
      <p className="text-xs text-muted">Points: runs + 1 per four + 2 per six, bonuses at 30 / 50 / 100 and for a fast strike rate; 25 per wicket, 10 per maiden, bonuses for 3 and 5 wickets and a tight economy; 10 per catch, stumping or run out.</p>
    </div>
  )
}
