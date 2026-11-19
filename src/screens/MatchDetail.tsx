import { useState } from 'react'
import { AvailabilityCard } from '../components/Availability'
import { RoleTag } from '../components/Profile'
import { ResultChip, StatusChip } from '../components/match'
import { MatchForm, RESULTS } from '../components/MatchForm'
import { MatchMoney } from '../components/MatchMoney'
import { HeaderButton, Screen } from '../components/Screen'
import { Avatar, ChoiceChips, Confirm, Empty, ErrorNote, Field, Pill, Sheet } from '../components/ui'
import { fmtDate, fmtDayMonth, fmtTime, relativeDay } from '../lib/dates'
import { deleteMatch, groundByName, isGuestIn, recordResult, setCancelled, setScorer } from '../lib/domain'
import { expenseMessage, shareMessage, squadMessage } from '../lib/messages'
import { canMarkComplete, matchStatus } from '../lib/stats'
import { useApp, useTeam } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import { MATCH_TYPE_LABELS, type Match, type MatchResult } from '../types'
import { GroundInfo } from './Grounds'
import { ScoutCard } from './OpponentDetail'

export function MatchDetail({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { canManage, canSeeMoney, teams, store, session, personName, toast, people } = useApp()
  const seesMoney = canSeeMoney(teamId)
  const isAdmin = canManage(teamId)
  const route = useRoute()
  const sheet = useSheet()
  const data = useTeam(teamId)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const team = teams.find((t) => t.id === teamId)
  const match = data.matches.find((m) => m.id === matchId)
  const backTo = `/teams/${teamId}?tab=matches`

  if (!team || (data.ready && !match)) {
    return (
      <Screen title="Match" back={team ? backTo : '/teams'}>
        <Empty icon="🤷" title="Match not found" text="It may have been deleted." />
      </Screen>
    )
  }
  if (!match) {
    return (
      <Screen title="Match" back={backTo}>
        <p className="p-10 text-center text-sm text-muted">Loading…</p>
      </Screen>
    )
  }

  const base = `/teams/${teamId}/matches/${matchId}`
  const status = matchStatus(match)
  const me = session?.personId ?? ''
  const inSquad = match.squad.includes(me)
  // The admin, or the one player the admin handed this match to (PLAN §31).
  const canScore = isAdmin || match.scorerId === me
  const ground = store ? groundByName(store, match.venue) : undefined
  const byId = new Map(people.map((p) => [p.id, p]))
  const share = (text: string) => void shareMessage(text).then((how) => how === 'copied' && toast('Message copied'))
  const squadLocked = match.lifecycle !== 'scheduled'
  const activeIds = new Set(data.members.filter((m) => m.status === 'active').map((m) => m.personId))
  const squad = [...match.squad].sort((a, b) => personName(a).localeCompare(personName(b)))

  function act(fn: () => void) {
    setError(null)
    try {
      fn()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Screen
      title={`vs ${match.opponent}`}
      back={backTo}
      actions={
        isAdmin ? (
          <HeaderButton label="Match options" onClick={() => sheet.open('matchmenu')}>
            ⋯
          </HeaderButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="card overflow-hidden">
          <div className="h-1.5" style={{ background: team.color }} />
          <div className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-bold">
                {team.shortName} vs {match.opponent}
              </h2>
              <StatusChip status={status} />
            </div>
            <p className="text-sm">
              {fmtDate(match.date)}
              {match.time && ` · ${fmtTime(match.time)}`}
              {status === 'upcoming' && <span className="font-medium text-accent"> · {relativeDay(match.date)}</span>}
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              {match.venue && <span>📍 {match.venue}</span>}
              <Pill>{MATCH_TYPE_LABELS[match.matchType]}</Pill>
              {match.overs && <Pill>{match.overs} overs</Pill>}
            </p>
            {(match.result || match.ourScore || match.theirScore) && (status !== 'upcoming' || match.scoring === 'finished') && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm">
                <ResultChip result={match.result} />
                {match.ourScore && (
                  <span>
                    {team.shortName} <strong>{match.ourScore}</strong>
                  </span>
                )}
                {match.theirScore && (
                  <span>
                    {match.opponent} <strong>{match.theirScore}</strong>
                  </span>
                )}
              </div>
            )}
            {match.notes && <p className="border-t border-line pt-2 text-sm text-muted">{match.notes}</p>}
          </div>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {ground && <GroundInfo ground={ground} />}
        {!match.cancelled && match.lifecycle === 'scheduled' && match.scoring !== 'finished' && match.opponentId && <ScoutCard opponentId={match.opponentId} />}

        {isAdmin && !match.cancelled && match.lifecycle === 'scheduled' && (
          <div>
            <button className="btn-primary w-full" disabled={!canMarkComplete(match)} onClick={() => navigate(`${base}/complete`)}>
              {match.expense?.status === 'draft' ? 'Continue: complete match' : 'Mark complete'}
            </button>
            {!canMarkComplete(match) && <p className="mt-1 text-center text-xs text-muted">Available from {fmtDayMonth(match.date)}</p>}
          </div>
        )}

        {!match.cancelled && match.lifecycle !== 'completed' && match.scoring !== 'finished' && <AvailabilityCard match={match} data={data} />}

        {!match.cancelled && (match.scoring || canScore) && (
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Ball-by-ball score</h2>
              {match.scoring === 'live' && <Pill tone="bad">LIVE</Pill>}
              {match.scoring === 'finished' && <Pill tone="ok">Final</Pill>}
            </div>
            {match.scoring ? (
              <div className="flex gap-2">
                <button className="btn-primary flex-1" onClick={() => navigate(`${base}/live`)}>
                  View scorecard
                </button>
                {canScore && (
                  <button className="btn-secondary flex-1" onClick={() => navigate(`${base}/score`)}>
                    {match.scoring === 'live' ? 'Continue scoring' : 'Open scoring'}
                  </button>
                )}
              </div>
            ) : (
              <>
                <p className="text-sm text-muted">Score the match ball by ball. Players can follow the scorecard, commentary and charts.</p>
                <button className="btn-secondary" onClick={() => navigate(`${base}/setup`)}>
                  🏏 Start live scoring
                </button>
              </>
            )}
            {match.scoring !== 'finished' && (isAdmin || match.scorerId) && (
              <div className="flex items-center justify-between gap-2 border-t border-line pt-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-muted">Scorer:</span> {match.scorerId ? `${personName(match.scorerId)}${match.scorerId === me ? ' (you)' : ''}` : 'Admin only'}
                </span>
                {isAdmin && (
                  <button className="btn-ghost min-h-[36px]" onClick={() => sheet.open('scorer')}>
                    {match.scorerId ? 'Change' : 'Let a player score'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {seesMoney && <MatchMoney team={team} match={match} data={data} />}
        {seesMoney && match.expense?.status === 'submitted' && !match.cancelled && (
          <button className="btn-secondary" onClick={() => share(expenseMessage(match, team, people))}>
            📤 Share expenses on WhatsApp
          </button>
        )}

        <section>
          <div className="flex items-center justify-between">
            <h2 className="section-title">Squad ({match.squad.length})</h2>
            {match.squad.length > 0 && !match.cancelled && (
              <button className="btn-ghost min-h-[36px]" onClick={() => share(squadMessage(match, team, people))}>
                📤 Share squad
              </button>
            )}
            {isAdmin && !match.cancelled && !squadLocked && match.squad.length > 0 && (
              <button className="btn-ghost min-h-[36px]" onClick={() => navigate(`${base}/squad`)}>
                Edit squad
              </button>
            )}
          </div>

          {!isAdmin && match.squad.length > 0 && (
            <p className={`mb-2 rounded-xl px-3 py-2 text-sm font-medium ${inSquad ? 'bg-ok/15 text-ok' : 'bg-alt text-muted'}`}>
              {inSquad ? '✅ You’re in the squad' : 'You’re not in the squad for this match'}
            </p>
          )}

          {match.squad.length === 0 ? (
            <div className="card px-4 py-6 text-center">
              {isAdmin && !match.cancelled && !squadLocked ? (
                <>
                  <p className="text-sm text-muted">Pick who is playing — everyone at once, from the team’s master list.</p>
                  <button className="btn-primary mt-3" onClick={() => navigate(`${base}/squad`)}>
                    Pick squad
                  </button>
                </>
              ) : (
                <p className="text-sm text-muted">Squad not announced yet</p>
              )}
            </div>
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {squad.map((id) => (
                <button key={id} className={`row active:bg-alt ${id === me ? 'bg-alt' : ''}`} onClick={() => navigate(`/teams/${teamId}/players/${id}`)}>
                  <Avatar name={personName(id)} personId={id} color={team.color} size={36} />
                  <span className="min-w-0 flex-1 truncate">
                    {personName(id)}
                    {id === me && <span className="text-muted"> (you)</span>}
                    {!activeIds.has(id) && !isGuestIn(data.members, id) && <span className="text-muted"> (left team)</span>}
                  </span>
                  <RoleTag person={byId.get(id)} />
                  {isGuestIn(data.members, id) && <Pill>Guest</Pill>}
                </button>
              ))}
            </div>
          )}
          {squadLocked && isAdmin && match.squad.length > 0 && <p className="mt-1 px-1 text-xs text-muted">The squad is locked once expenses are submitted.</p>}
        </section>
      </div>

      {sheet.name === 'matchmenu' && isAdmin && (
        <Sheet title={`vs ${match.opponent}`} onClose={sheet.close}>
          <div className="flex flex-col gap-2">
            <button className="btn-secondary" onClick={() => navigate(withQuery(route, { sheet: 'editmatch' }), { replace: true })}>
              Edit match
            </button>
            {!match.cancelled && (
              <button className="btn-secondary" onClick={() => navigate(withQuery(route, { sheet: 'result' }), { replace: true })}>
                Record result
              </button>
            )}
            {match.lifecycle === 'scheduled' &&
              (match.cancelled ? (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    act(() => setCancelled(store!, teamId, matchId, false))
                    sheet.close()
                  }}
                >
                  Restore match
                </button>
              ) : (
                <button className="btn-danger" onClick={() => setConfirm('cancel')}>
                  Cancel match
                </button>
              ))}
            {match.lifecycle === 'scheduled' ? (
              <button className="btn-danger" onClick={() => setConfirm('delete')}>
                Delete match
              </button>
            ) : (
              <p className="px-1 text-xs text-muted">A match with submitted expenses can’t be cancelled or deleted, to keep the fund ledger honest.</p>
            )}
          </div>
        </Sheet>
      )}

      {sheet.name === 'scorer' && isAdmin && (
        <Sheet title="Who scores this match?" onClose={sheet.close}>
          <p className="mb-3 text-sm text-muted">The player you pick can start and score this one match from their own phone. They can’t change anything else. You can always score too.</p>
          <div className="card divide-y divide-line overflow-hidden">
            <button
              className="row active:bg-alt"
              onClick={() => {
                act(() => setScorer(store!, teamId, matchId, undefined))
                sheet.close()
              }}
            >
              <span className="flex-1">Admin only</span>
              {!match.scorerId && <span className="text-accent">✓</span>}
            </button>
            {[...activeIds]
              .filter((id) => id !== me)
              .sort((a, b) => personName(a).localeCompare(personName(b)))
              .map((id) => (
                <button
                  key={id}
                  className="row active:bg-alt"
                  onClick={() => {
                    act(() => setScorer(store!, teamId, matchId, id))
                    toast(`${personName(id)} can now score this match`)
                    sheet.close()
                  }}
                >
                  <Avatar name={personName(id)} personId={id} color={team.color} size={32} />
                  <span className="min-w-0 flex-1 truncate">{personName(id)}</span>
                  {match.scorerId === id && <span className="text-accent">✓</span>}
                </button>
              ))}
          </div>
        </Sheet>
      )}

      {sheet.name === 'editmatch' && isAdmin && <MatchForm team={team} matches={data.matches} match={match} onClose={sheet.close} onSaved={() => sheet.close()} />}
      {sheet.name === 'result' && isAdmin && <ResultSheet match={match} onClose={sheet.close} />}

      {confirm === 'cancel' && (
        <Confirm
          title="Cancel this match?"
          message={match.expense?.status === 'draft' ? 'The draft expense split will be discarded. You can restore the match later.' : 'You can restore it later.'}
          confirmLabel="Cancel match"
          cancelLabel="Keep"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            act(() => setCancelled(store!, teamId, matchId, true))
            setConfirm(null)
            sheet.close()
          }}
        />
      )}
      {confirm === 'delete' && (
        <Confirm
          title="Delete this match?"
          message={`vs ${match.opponent} on ${fmtDate(match.date)} will be removed${match.expense ? ', along with its draft expense split' : ''}.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            try {
              deleteMatch(store!, teamId, matchId)
              toast('Match deleted')
              navigate(backTo, { replace: true })
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        />
      )}
    </Screen>
  )
}

function ResultSheet({ match, onClose }: { match: Match; onClose: () => void }) {
  const { store } = useApp()
  const [result, setResult] = useState<MatchResult | undefined>(match.result)
  const [ourScore, setOurScore] = useState(match.ourScore ?? '')
  const [theirScore, setTheirScore] = useState(match.theirScore ?? '')
  return (
    <Sheet title="Record result" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ChoiceChips options={RESULTS} value={result} onChange={(r) => setResult(r === result ? undefined : r)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Our score">
            <input className="input" value={ourScore} maxLength={30} placeholder="154/6 (20)" onChange={(e) => setOurScore(e.target.value)} />
          </Field>
          <Field label="Their score">
            <input className="input" value={theirScore} maxLength={30} placeholder="149/9 (20)" onChange={(e) => setTheirScore(e.target.value)} />
          </Field>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            recordResult(store!, match.teamId, match.id, { result, ourScore, theirScore })
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}
