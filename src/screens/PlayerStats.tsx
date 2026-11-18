// A player's page (PLAN §28, §39, §40): profile card, recent form and the
// career record over a set of matches.
import { useMemo, type ReactNode } from 'react'
import { BarList } from '../components/charts'
import { ProfileCard, ProfileSheet } from '../components/Profile'
import { GroundMap } from '../components/scoring'
import { Screen } from '../components/Screen'
import { useScores } from '../components/StatsTab'
import { batAverage, batStrikeRate, bestBowling, bowlAverage, bowlEconomy, bowlOvers, careerStats, formOf, highScore } from '../lib/career'
import { fmtDayMonth } from '../lib/dates'
import { oversText } from '../lib/scoring'
import { useApp, useTeam } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import { WICKET_LABELS, type Match, type WicketKind } from '../types'

function Grid({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="card grid grid-cols-4 gap-y-3 p-3 text-center">
      {items.map(([label, value]) => (
        <div key={label}>
          <p className="text-lg font-semibold">{value}</p>
          <p className="text-[11px] text-muted">{label}</p>
        </div>
      ))}
    </div>
  )
}

/** Last few scores as chips, newest first. */
export function FormStrip({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="w-12 text-xs text-muted">{label}</span>
      {values.map((v, n) => (
        <span key={n} className={`rounded-md px-2 py-0.5 text-xs font-semibold ${n === 0 ? 'bg-ink text-bg' : 'bg-alt'}`}>
          {v}
        </span>
      ))}
    </p>
  )
}

export function PlayerStats({ teamId, personId }: { teamId: string; personId: string }) {
  const data = useTeam(teamId)
  return <PlayerStatsView personId={personId} matches={data.matches} loading={!data.ready} back={`/teams/${teamId}`} teamName={data.team?.name ?? ''} color={data.team?.color} />
}

/** A player's page over any set of matches (one of our teams, or every match against an opponent). */
export function PlayerStatsView({ personId, matches, loading, back, teamName, color }: { personId: string; matches: Match[]; loading?: boolean; back: string; teamName: string; color?: string }) {
  const { people, personName, isAdmin, session } = useApp()
  const sheet = useSheet()
  const { files, scored, ready } = useScores(matches)
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => careerStats(files).get(personId), [stamp, personId])
  const person = people.find((p) => p.id === personId)
  const name = personName(personId)
  const canEdit = !!person && (isAdmin || session?.personId === personId)

  if (loading || !ready) {
    return (
      <Screen title={name} back={back}>
        <p className="p-10 text-center text-sm text-muted">Loading…</p>
      </Screen>
    )
  }

  const matchOf = (id: string) => scored.find((m) => m.id === id)
  const rows = (c?.byMatch ?? [])
    .map((l) => ({ l, m: matchOf(l.matchId) }))
    .filter((x) => !!x.m)
    .sort((a, b) => b.m!.date.localeCompare(a.m!.date))
  const form = formOf(c, scored)
  const outs = c ? (Object.keys(c.dismissals) as WicketKind[]).map((k) => ({ label: WICKET_LABELS[k], value: c.dismissals[k] ?? 0 })).sort((a, b) => b.value - a.value) : []

  return (
    <Screen title={name} back={back}>
      <div className="flex flex-col gap-4 p-4">
        <ProfileCard person={person} name={name} teamName={teamName} color={color} career={c} onEdit={canEdit ? () => sheet.open('profile') : undefined} />

        {!c && <p className="card px-4 py-5 text-center text-sm text-muted">No scored matches yet. Batting, bowling and fielding figures appear after the first ball-by-ball match.</p>}

        {(form.bat.length > 0 || form.bowl.length > 0) && (
          <section>
            <h2 className="section-title">Recent form (latest first)</h2>
            <div className="card flex flex-col gap-2 p-3">
              <FormStrip label="Batting" values={form.bat} />
              <FormStrip label="Bowling" values={form.bowl} />
            </div>
          </section>
        )}

        {c && (
          <>
            <section>
              <h2 className="section-title">Batting</h2>
              {c.bat.innings === 0 ? (
                <p className="card px-4 py-4 text-center text-sm text-muted">Has not batted yet</p>
              ) : (
                <Grid
                  items={[
                    ['Innings', c.bat.innings],
                    ['Runs', c.bat.runs],
                    ['Highest', highScore(c)],
                    ['Average', batAverage(c)],
                    ['Strike rate', batStrikeRate(c)],
                    ['Not outs', c.bat.notOuts],
                    ['Fours', c.bat.fours],
                    ['Sixes', c.bat.sixes],
                    ['50s', c.bat.fifties],
                    ['100s', c.bat.hundreds],
                    ['Ducks', c.bat.ducks],
                    ['Balls', c.bat.balls],
                  ]}
                />
              )}
            </section>

            <section>
              <h2 className="section-title">Bowling</h2>
              {c.bowl.innings === 0 ? (
                <p className="card px-4 py-4 text-center text-sm text-muted">Has not bowled yet</p>
              ) : (
                <Grid
                  items={[
                    ['Overs', bowlOvers(c)],
                    ['Wickets', c.bowl.wickets],
                    ['Best', bestBowling(c)],
                    ['Economy', bowlEconomy(c)],
                    ['Runs', c.bowl.runs],
                    ['Average', bowlAverage(c)],
                    ['Maidens', c.bowl.maidens],
                    ['Wd / Nb', `${c.bowl.wides} / ${c.bowl.noBalls}`],
                  ]}
                />
              )}
            </section>

            <section>
              <h2 className="section-title">Fielding</h2>
              <div className="card grid grid-cols-3 gap-y-3 p-3 text-center">
                {(
                  [
                    ['Catches', c.field.catches],
                    ['Stumpings', c.field.stumpings],
                    ['Run outs', c.field.runOuts],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-lg font-semibold">{value}</p>
                    <p className="text-[11px] text-muted">{label}</p>
                  </div>
                ))}
              </div>
            </section>

            {(c.shots.length > 0 || c.outAt.length > 0) && (
              <section>
                <h2 className="section-title">Wagon wheel — all matches</h2>
                <div className="card p-4">
                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4" style={{ background: 'var(--series-1)' }} />
                      Fours ({c.shots.filter((s) => s.runs === 4).length})
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4" style={{ background: 'var(--series-2)' }} />
                      Sixes ({c.shots.filter((s) => s.runs === 6).length})
                    </span>
                    {c.outAt.length > 0 && <span>✕ Caught / run out ({c.outAt.length})</span>}
                  </div>
                  <GroundMap left={person?.batsLeft} shots={c.shots} marks={c.outAt} />
                  <p className="mt-1 text-center text-xs text-muted">Only boundaries and dismissals whose position was recorded.</p>
                </div>
              </section>
            )}

            {outs.length > 0 && (
              <section>
                <h2 className="section-title">How they get out</h2>
                <div className="card p-4">
                  <BarList slot={1} rows={outs} />
                </div>
              </section>
            )}

            <section>
              <h2 className="section-title">Match by match</h2>
              <div className="card divide-y divide-line overflow-hidden">
                {rows.map(({ l, m }) => (
                  <button key={l.matchId} className="row active:bg-alt" onClick={() => navigate(`/teams/${m!.teamId}/matches/${l.matchId}/live?tab=scorecard`)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">vs {m!.opponent}</span>
                      <span className="block text-xs text-muted">{fmtDayMonth(m!.date)}</span>
                    </span>
                    <span className="text-right text-sm">
                      <span className="block">{l.bat ? `${l.bat.runs}${l.bat.notOut ? '*' : ''} (${l.bat.balls})` : <span className="text-muted">did not bat</span>}</span>
                      {l.bowl && (
                        <span className="block text-xs text-muted">
                          {l.bowl.wickets}/{l.bowl.runs} ({oversText(l.bowl.balls)} ov)
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {sheet.name === 'profile' && person && canEdit && <ProfileSheet person={person} onClose={sheet.close} />}
    </Screen>
  )
}
