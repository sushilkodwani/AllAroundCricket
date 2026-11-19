// Tournaments / seasons (PLAN §35): a points table with net run rate, built
// from our own matches plus results between other teams that the admin types in.
import { useMemo, useState } from 'react'
import { Screen } from '../components/Screen'
import { useScores } from '../components/StatsTab'
import { ChoiceChips, Confirm, Empty, ErrorNote, Field, NumberInput, Pill, Sheet, Toggle } from '../components/ui'
import { fmtDayMonth } from '../lib/dates'
import { matchesOf, opponentsOf } from '../lib/domain'
import { BALLS, oversText } from '../lib/scoring'
import {
  addTournamentTeam,
  createTournament,
  deleteOtherResult,
  deleteTournament,
  fmtNrr,
  gameFromMatch,
  gameFromOther,
  oversToBalls,
  pointsTable,
  removeTournamentTeam,
  saveOtherResult,
  tournamentsOf,
  updateTournament,
  type Game,
} from '../lib/tournament'
import { useApp, useTeamsLoaded } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import type { OtherResult, Tournament } from '../types'

export function Tournaments() {
  const { store, isAdmin } = useApp()
  const sheet = useSheet()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const all = store ? tournamentsOf(store) : []
  const live = all.filter((t) => !t.archived)
  const archived = all.filter((t) => t.archived)

  return (
    <Screen title="Tournaments" back="/matches">
      <div className="flex flex-col gap-3 p-4">
        {isAdmin && (
          <button className="btn-primary" onClick={() => sheet.open('new')}>
            + New tournament
          </button>
        )}
        {all.length === 0 && <Empty icon="🏆" title="No tournaments yet" text={isAdmin ? 'Create one, then put matches in it from the match form. The points table builds itself.' : 'No admin has set up a tournament yet.'} />}
        {[live, archived].map(
          (list, n) =>
            list.length > 0 && (
              <section key={n}>
                {n === 1 && <h2 className="section-title">Finished</h2>}
                <div className="card divide-y divide-line overflow-hidden">
                  {list.map((t) => (
                    <button key={t.id} className="row active:bg-alt" onClick={() => navigate(`/tournaments/${t.id}`)}>
                      <span className="text-xl" aria-hidden="true">
                        🏆
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{t.name}</span>
                        <span className="block text-xs text-muted">
                          {t.teams.length} team{t.teams.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="text-muted">›</span>
                    </button>
                  ))}
                </div>
              </section>
            ),
        )}
      </div>

      {sheet.name === 'new' && isAdmin && (
        <Sheet title="New tournament" onClose={sheet.close}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              try {
                const t = createTournament(store!, name)
                setName('')
                sheet.replaceWith(`/tournaments/${t.id}`)
              } catch (err) {
                setError((err as Error).message)
              }
            }}
          >
            <Field label="Name" hint="For example: Sunday League 2026.">
              <input className="input" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <button className="btn-primary" disabled={!name.trim()}>
              Create
            </button>
          </form>
        </Sheet>
      )}
    </Screen>
  )
}

export function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const { store, isAdmin: anyAdmin, isSuper, me, teams, toast } = useApp()
  const sheet = useSheet()
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const t = store ? tournamentsOf(store).find((x) => x.id === tournamentId) : undefined
  // Any admin can enter matches; only whoever created the tournament (or the super admin) edits it.
  const isAdmin = anyAdmin && (isSuper || t?.createdBy === me?.id)

  const teamIds = teams.map((x) => x.id)
  useTeamsLoaded(teamIds)
  const version = store?.getVersion() ?? 0
  const key = teamIds.join(',')
  const matches = useMemo(
    () => (store ? key.split(',').filter(Boolean).flatMap((id) => matchesOf(store, id)).filter((m) => m.tournamentId === tournamentId && !m.cancelled) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, key, tournamentId, version],
  )
  const { files } = useScores(matches)

  if (!t || !store) {
    return (
      <Screen title="Tournament" back="/tournaments">
        <Empty icon="🤷" title="Tournament not found" />
      </Screen>
    )
  }

  const nameOf = (id: string) => t.teams.find((x) => x.id === id)?.name ?? '?'
  const ours = matches
    .map((m) => ({ m, g: gameFromMatch(t, m, files.find((f) => f.matchId === m.id)) }))
    .sort((a, b) => b.m.date.localeCompare(a.m.date))
  const games: Game[] = [...ours.map((x) => x.g).filter((g): g is Game => !!g), ...t.otherResults.map(gameFromOther)]
  const table = pointsTable(t.teams, games, t.points)
  const noRate = ours.filter((x) => x.g && x.g.outcome !== 'nr' && x.g.aBalls === 0).length
  const editing = sheet.name === 'result' ? t.otherResults.find((r) => r.id === sheet.arg) : undefined

  return (
    <Screen title={t.name} back="/tournaments">
      <div className="flex flex-col gap-4 p-4">
        {t.archived && <Pill>Finished</Pill>}
        <section>
          <h2 className="section-title">Points table</h2>
          {table.length === 0 ? (
            <div className="card px-4 py-5 text-center text-sm text-muted">No teams yet. Put a match in this tournament from the match form, or add teams below.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-alt text-xs text-muted">
                    <th className="px-2 py-1.5 text-left font-semibold">Team</th>
                    {['P', 'W', 'L', 'T', 'NR', 'Pts', 'NRR'].map((h) => (
                      <th key={h} className="px-1.5 py-1.5 text-right font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {table.map((r, n) => {
                    const team = t.teams.find((x) => x.id === r.id)
                    return (
                      <tr key={r.id} className={team?.teamId ? 'bg-alt/60 font-medium' : ''}>
                        <td className="max-w-[140px] truncate px-2 py-2.5">
                          <span className="mr-1.5 text-muted">{n + 1}</span>
                          {r.name}
                        </td>
                        <td className="px-1.5 text-right">{r.played}</td>
                        <td className="px-1.5 text-right">{r.won}</td>
                        <td className="px-1.5 text-right">{r.lost}</td>
                        <td className="px-1.5 text-right">{r.tied}</td>
                        <td className="px-1.5 text-right">{r.nr}</td>
                        <td className="px-1.5 text-right font-bold">{r.points}</td>
                        <td className="px-1.5 pr-2 text-right">{r.played - r.nr > 0 ? fmtNrr(r.nrr) : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 px-1 text-xs text-muted">
            Win {t.points.win} · tie {t.points.tie} · no result {t.points.nr}. NRR = runs scored per over − runs conceded per over; a side bowled out is charged its full overs.
            {noRate > 0 && ` ${noRate} of our result${noRate === 1 ? ' has' : 's have'} no overs recorded, so ${noRate === 1 ? 'it counts' : 'they count'} for points but not NRR.`}
          </p>
        </section>

        {isAdmin && (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary" onClick={() => sheet.open('team')}>
              + Add team
            </button>
            <button className="btn-secondary" disabled={t.teams.length < 2} onClick={() => sheet.open('result')}>
              + Other result
            </button>
          </div>
        )}

        <section>
          <h2 className="section-title">Our matches ({ours.length})</h2>
          {ours.length === 0 ? (
            <div className="card px-4 py-4 text-center text-sm text-muted">None yet. Open a match → Edit match → pick this tournament.</div>
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {ours.map(({ m, g }) => (
                <button key={m.id} className="row active:bg-alt" onClick={() => navigate(`/teams/${m.teamId}/matches/${m.id}`)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {teams.find((x) => x.id === m.teamId)?.shortName} vs {m.opponent}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {fmtDayMonth(m.date)}
                      {m.ourScore && m.theirScore && ` · ${m.ourScore} v ${m.theirScore}`}
                    </span>
                  </span>
                  {g ? <Pill tone={g.outcome === 'a' ? 'ok' : g.outcome === 'b' ? 'bad' : 'neutral'}>{g.outcome === 'a' ? 'Won' : g.outcome === 'b' ? 'Lost' : g.outcome === 'tie' ? 'Tied' : 'No result'}</Pill> : <Pill>To play</Pill>}
                </button>
              ))}
            </div>
          )}
        </section>

        {t.otherResults.length > 0 && (
          <section>
            <h2 className="section-title">Other results ({t.otherResults.length})</h2>
            <div className="card divide-y divide-line overflow-hidden">
              {t.otherResults.map((r) => (
                <button key={r.id} className="row active:bg-alt" disabled={!isAdmin} onClick={() => sheet.open('result', r.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {nameOf(r.a)} v {nameOf(r.b)}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {r.outcome === 'nr' ? 'No result' : `${r.aRuns} (${oversText(r.aBalls)}) v ${r.bRuns} (${oversText(r.bBalls)}) · ${r.outcome === 'tie' ? 'tied' : `${nameOf(r.outcome === 'a' ? r.a : r.b)} won`}`}
                    </span>
                  </span>
                  {isAdmin && <span className="text-muted">›</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {isAdmin && t.teams.length > 0 && (
          <section>
            <h2 className="section-title">Teams ({t.teams.length})</h2>
            <div className="card divide-y divide-line overflow-hidden">
              {t.teams.map((x) => (
                <div key={x.id} className="row">
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  {x.teamId && <Pill tone="brand">Ours</Pill>}
                  <button className="btn-ghost min-h-[36px] text-muted" aria-label={`Remove ${x.name}`} onClick={() => setConfirmRemove(x.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className="btn-ghost mt-2 w-full" onClick={() => updateTournament(store, t.id, { archived: !t.archived })}>
              {t.archived ? 'Reopen tournament' : 'Mark tournament as finished'}
            </button>
            <button className="btn-ghost mt-1 w-full text-bad" onClick={() => setConfirmDelete(true)}>
              Delete tournament
            </button>
          </section>
        )}
      </div>

      {sheet.name === 'team' && isAdmin && <AddTeamSheet t={t} onClose={sheet.close} />}
      {confirmDelete && (
        <Confirm
          title={`Delete ${t.name}?`}
          message="The points table and the results typed in for other teams are deleted. Your matches stay; they just no longer count towards a table."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            try {
              deleteTournament(store!, t.id)
              toast(`${t.name} deleted`)
              navigate('/tournaments', { replace: true })
            } catch (e) {
              toast((e as Error).message)
            }
          }}
        />
      )}
      {sheet.name === 'result' && isAdmin && (
        <ResultSheet
          t={t}
          result={editing}
          onClose={sheet.close}
          onSaved={() => {
            toast('Result saved')
            sheet.close()
          }}
        />
      )}
      {confirmRemove && (
        <Confirm
          title={`Remove ${nameOf(confirmRemove)}?`}
          message="The team leaves the table, and results typed in for it are deleted. Your own matches are not touched."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            removeTournamentTeam(store, t.id, confirmRemove)
            setConfirmRemove(null)
          }}
        />
      )}
    </Screen>
  )
}

function AddTeamSheet({ t, onClose }: { t: Tournament; onClose: () => void }) {
  const { store, teams } = useApp()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const has = (x: { teamId?: string; opponentId?: string; name: string }) =>
    t.teams.some((y) => (x.teamId && y.teamId === x.teamId) || (x.opponentId && y.opponentId === x.opponentId) || y.name.toLowerCase() === x.name.toLowerCase())
  const known = [...teams.filter((x) => !x.archived).map((x) => ({ name: x.name, teamId: x.id })), ...(store ? opponentsOf(store) : []).map((o) => ({ name: o.name, opponentId: o.id }))].filter((x) => !has(x))

  function add(team: { name: string; teamId?: string; opponentId?: string }) {
    try {
      addTournamentTeam(store!, t.id, team)
      setName('')
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title="Add team" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {known.length > 0 && (
          <div>
            <span className="label">Teams you already have</span>
            <div className="flex flex-wrap gap-2">
              {known.map((x) => (
                <button key={x.name} className="chip min-h-[36px] px-3" onClick={() => add(x)}>
                  + {x.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            add({ name })
          }}
        >
          <Field label="Another team" hint="A team in the tournament that you never play yourself.">
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn-secondary" disabled={!name.trim()}>
            Add
          </button>
        </form>
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  )
}

function ResultSheet({ t, result, onClose, onSaved }: { t: Tournament; result?: OtherResult; onClose: () => void; onSaved: () => void }) {
  const { store } = useApp()
  const [a, setA] = useState(result?.a ?? '')
  const [b, setB] = useState(result?.b ?? '')
  const [noResult, setNoResult] = useState(result?.outcome === 'nr')
  const [quota, setQuota] = useState('20')
  const [aRuns, setARuns] = useState(result ? String(result.aRuns) : '')
  const [aOvers, setAOvers] = useState(result ? oversText(result.aBalls) : '')
  const [aOut, setAOut] = useState(false)
  const [bRuns, setBRuns] = useState(result ? String(result.bRuns) : '')
  const [bOvers, setBOvers] = useState(result ? oversText(result.bBalls) : '')
  const [bOut, setBOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = t.teams.map((x) => ({ value: x.id, label: x.name }))

  function save() {
    setError(null)
    try {
      const balls = (overs: string, allOut: boolean) => (allOut ? Number(quota) * BALLS : oversToBalls(overs || '0'))
      const ra = Number(aRuns)
      const rb = Number(bRuns)
      saveOtherResult(store!, t.id, {
        id: result?.id,
        a,
        b,
        aRuns: noResult ? 0 : ra,
        aBalls: noResult ? 0 : balls(aOvers, aOut),
        bRuns: noResult ? 0 : rb,
        bBalls: noResult ? 0 : balls(bOvers, bOut),
        outcome: noResult ? 'nr' : ra > rb ? 'a' : rb > ra ? 'b' : 'tie',
      })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const side = (label: string, runs: string, setRuns: (v: string) => void, overs: string, setOvers: (v: string) => void, out: boolean, setOut: (v: boolean) => void) => (
    <div className="card flex flex-col gap-2 p-3">
      <span className="text-sm font-semibold">{label || 'Team'}</span>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Runs">
          <NumberInput value={runs} onChange={setRuns} maxLength={3} ariaLabel={`${label} runs`} />
        </Field>
        <Field label="Overs batted">
          <input className="input" inputMode="decimal" value={out ? quota : overs} disabled={out} placeholder="18.3" onChange={(e) => setOvers(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} aria-label={`${label} overs`} />
        </Field>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>All out (counts as the full {quota || '?'} overs)</span>
        <Toggle checked={out} onChange={setOut} label={`${label} all out`} />
      </div>
    </div>
  )

  return (
    <Sheet title={result ? 'Edit result' : 'Result between two other teams'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <span className="label">Batted first</span>
          <ChoiceChips options={options.filter((o) => o.value !== b)} value={a} onChange={setA} />
        </div>
        <div>
          <span className="label">Batted second</span>
          <ChoiceChips options={options.filter((o) => o.value !== a)} value={b} onChange={setB} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>No result / abandoned</span>
          <Toggle checked={noResult} onChange={setNoResult} label="No result" />
        </div>
        {!noResult && (
          <>
            <Field label="Overs per side">
              <NumberInput value={quota} onChange={setQuota} maxLength={2} ariaLabel="Overs per side" />
            </Field>
            {side(t.teams.find((x) => x.id === a)?.name ?? '', aRuns, setARuns, aOvers, setAOvers, aOut, setAOut)}
            {side(t.teams.find((x) => x.id === b)?.name ?? '', bRuns, setBRuns, bOvers, setBOvers, bOut, setBOut)}
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={!a || !b} onClick={save}>
          Save result
        </button>
        {result && (
          <button
            className="btn-danger"
            onClick={() => {
              deleteOtherResult(store!, t.id, result.id)
              onClose()
            }}
          >
            Delete result
          </button>
        )}
      </div>
    </Sheet>
  )
}
