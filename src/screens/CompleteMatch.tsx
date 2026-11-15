// "Mark complete" (PLAN §16.2): a match is completed either with an expense
// split that everyone has settled, or with "No expense split needed".
import { useState } from 'react'
import { RESULTS } from '../components/MatchForm'
import { Screen } from '../components/Screen'
import { ChoiceChips, Confirm, Empty, ErrorNote, Field } from '../components/ui'
import { fmtDate } from '../lib/dates'
import { completeMatch, recordResult } from '../lib/domain'
import { canMarkComplete } from '../lib/stats'
import { useApp, useTeam } from '../state/AppContext'
import { navigate } from '../state/router'
import type { MatchResult } from '../types'

export function CompleteMatch({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { store, isAdmin, toast } = useApp()
  const data = useTeam(teamId)
  const match = data.matches.find((m) => m.id === matchId)
  const base = `/teams/${teamId}/matches/${matchId}`
  const [result, setResult] = useState<MatchResult | undefined>(match?.result)
  const [ourScore, setOurScore] = useState(match?.ourScore ?? '')
  const [theirScore, setTheirScore] = useState(match?.theirScore ?? '')
  const [noSplit, setNoSplit] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!match || !store || !isAdmin) {
    return (
      <Screen title="Complete match" back={base}>
        {data.ready || !isAdmin ? <Empty icon="🤷" title="Match not found" /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>}
      </Screen>
    )
  }
  if (!canMarkComplete(match)) {
    return (
      <Screen title="Complete match" back={base}>
        <Empty
          icon="🕓"
          title={match.lifecycle === 'scheduled' ? 'Not yet' : 'Already in progress'}
          text={match.lifecycle === 'scheduled' ? `This match can be completed from ${fmtDate(match.date)}.` : 'Expenses were already submitted for this match.'}
        />
      </Screen>
    )
  }

  const hasDraft = match.expense?.status === 'draft'

  function toSplit() {
    setError(null)
    recordResult(store!, teamId, matchId, { result, ourScore, theirScore })
    if (match!.squad.length === 0) return navigate(`${base}/squad`)
    navigate(`${base}/expenses`)
  }

  return (
    <Screen
      title="Complete match"
      back={base}
      footer={
        noSplit ? (
          <button className="btn-primary w-full" onClick={() => setConfirm(true)}>
            Complete match
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={toSplit}>
            {match.squad.length === 0 ? 'Pick the squad first →' : hasDraft ? 'Continue splitting expenses →' : 'Split expenses →'}
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5 p-4">
        <div>
          <h2 className="text-lg font-semibold">vs {match.opponent}</h2>
          <p className="text-sm text-muted">{fmtDate(match.date)}</p>
        </div>

        <div>
          <span className="label">Result (optional — can be added later)</span>
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

        <label className="card flex min-h-[56px] cursor-pointer items-center gap-3 px-4 py-3">
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-[rgb(155,28,31)]" checked={noSplit} onChange={(e) => setNoSplit(e.target.checked)} />
          <span>
            <span className="block font-medium">No expense split needed for this match</span>
            <span className="block text-xs text-muted">Otherwise the match costs are split among the squad and settled before it can be completed.</span>
          </span>
        </label>

        {match.squad.length === 0 && !noSplit && <p className="text-sm text-warn">No squad has been picked yet — you’ll pick it first, then come back here.</p>}
        <ErrorNote>{error}</ErrorNote>
      </div>

      {confirm && (
        <Confirm
          title="Complete this match?"
          message={`vs ${match.opponent} will be marked completed with no expense split.${hasDraft ? ' The draft split will be discarded.' : ''}`}
          confirmLabel="Complete match"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            try {
              completeMatch(store, teamId, matchId, { noExpenseSplit: true, result, ourScore, theirScore })
              toast('Match completed')
              navigate(base, { replace: true })
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        />
      )}
    </Screen>
  )
}
