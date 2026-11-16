import { useMemo, useState } from 'react'
import { todayISO } from '../lib/dates'
import { addMatch, editMatch, opponentsOf, type MatchInput } from '../lib/domain'
import { useApp } from '../state/AppContext'
import { MATCH_TYPE_LABELS, RESULT_LABELS, type Match, type MatchResult, type MatchType, type Team } from '../types'
import { ChoiceChips, ErrorNote, Field, NumberInput, Sheet, SuggestInput } from './ui'

const TYPES = (Object.keys(MATCH_TYPE_LABELS) as MatchType[]).map((value) => ({ value, label: MATCH_TYPE_LABELS[value] }))
export const RESULTS = (Object.keys(RESULT_LABELS) as MatchResult[]).map((value) => ({ value, label: RESULT_LABELS[value] }))

/** Add or edit a match. Any date — past or future. Past dates also offer result + scores. */
export function MatchForm({ team, matches, match, onClose, onSaved }: { team: Team; matches: Match[]; match?: Match; onClose: () => void; onSaved: (m: Match, isNew: boolean) => void }) {
  const { store } = useApp()
  const [date, setDate] = useState(match?.date ?? todayISO())
  const [time, setTime] = useState(match?.time ?? '')
  const [opponent, setOpponent] = useState(match?.opponent ?? '')
  const [venue, setVenue] = useState(match?.venue ?? team.homeGround ?? '')
  const [matchType, setMatchType] = useState<MatchType>(match?.matchType ?? 'friendly')
  const [overs, setOvers] = useState(match?.overs ? String(match.overs) : '')
  const [notes, setNotes] = useState(match?.notes ?? '')
  const [result, setResult] = useState<MatchResult | undefined>(match?.result)
  const [ourScore, setOurScore] = useState(match?.ourScore ?? '')
  const [theirScore, setTheirScore] = useState(match?.theirScore ?? '')
  const [error, setError] = useState<string | null>(null)

  // Suggestions come from this team's earlier matches.
  // …and from every saved opponent team, whose players are remembered for scoring.
  const saved = store ? opponentsOf(store) : []
  const savedKey = saved.map((o) => o.name).join('|')
  const opponents = useMemo(() => [...new Set([...savedKey.split('|').filter(Boolean), ...matches.map((m) => m.opponent)])].sort(), [matches, savedKey])
  const venues = useMemo(() => [...new Set([team.homeGround, ...matches.map((m) => m.venue)].filter((v): v is string => !!v))].sort(), [matches, team.homeGround])
  const isPast = date <= todayISO()

  function save() {
    if (!store) return
    const input: MatchInput = {
      date,
      time,
      opponent,
      venue,
      matchType,
      overs: Number(overs) || undefined,
      notes,
      // Values are kept when a date moves to the future; they just aren't shown.
      result,
      ourScore,
      theirScore,
    }
    try {
      const saved = match ? editMatch(store, team.id, match.id, input) : addMatch(store, team.id, input)
      onSaved(saved, !match)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title={match ? 'Edit match' : 'Add match'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input className="input" type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time (optional)">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Opponent" hint="Pick a saved opponent to reuse its players, or type a new name.">
          <SuggestInput value={opponent} onChange={setOpponent} suggestions={opponents} placeholder="e.g. Lions" autoFocus={!match} />
        </Field>
        <Field label="Venue (optional)">
          <SuggestInput value={venue} onChange={setVenue} suggestions={venues} />
        </Field>
        <div>
          <span className="label">Type</span>
          <ChoiceChips options={TYPES} value={matchType} onChange={setMatchType} />
        </div>
        <Field label="Overs per innings" hint="Needed for live scoring; can be set later.">
          <NumberInput value={overs} onChange={setOvers} maxLength={3} placeholder="20" ariaLabel="Overs" />
        </Field>
        <Field label="Notes (optional)">
          <textarea className="input min-h-[72px] py-2" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {isPast && (
          <>
            <div>
              <span className="label">Result (optional)</span>
              <ChoiceChips options={RESULTS} value={result} onChange={(r) => setResult(r === result ? undefined : r)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Our score">
                <input className="input" value={ourScore} maxLength={30} placeholder="154/6 (20)" onChange={(e) => setOurScore(e.target.value)} />
              </Field>
              <Field label="Their score">
                <input className="input" value={theirScore} maxLength={30} placeholder="149/9 (20)" onChange={(e) => setTheirScore(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={!opponent.trim() || !date}>
          {match ? 'Save' : 'Add match'}
        </button>
      </form>
    </Sheet>
  )
}
