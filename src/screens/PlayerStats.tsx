// One player's career record for a team (PLAN §28).
import { useMemo, type ReactNode } from 'react'
import { GroundMap } from '../components/scoring'
import { Screen } from '../components/Screen'
import { useTeamScores } from '../components/StatsTab'
import { Avatar, Empty, Pill } from '../components/ui'
import { batAverage, batStrikeRate, bestBowling, bowlAverage, bowlEconomy, bowlOvers, careerStats, highScore } from '../lib/career'
import { fmtDayMonth } from '../lib/dates'
import { oversText } from '../lib/scoring'
import { useApp, useTeam } from '../state/AppContext'
import { navigate } from '../state/router'

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

export function PlayerStats({ teamId, personId }: { teamId: string; personId: string }) {
  const { people, personName } = useApp()
  const data = useTeam(teamId)
  const { files, scored, ready } = useTeamScores(teamId, data.matches)
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => careerStats(files).get(personId), [stamp, personId])
  const person = people.find((p) => p.id === personId)
  const back = `/teams/${teamId}?tab=stats`

  if (!data.ready || !ready) {
    return (
      <Screen title={personName(personId)} back={back}>
        <p className="p-10 text-center text-sm text-muted">Loading…</p>
      </Screen>
    )
  }
  if (!c) {
    return (
      <Screen title={personName(personId)} back={back}>
        <Empty icon="📊" title="No stats yet" text="This player has not appeared in a scored match for this team." />
      </Screen>
    )
  }

  const matchOf = (id: string) => scored.find((m) => m.id === id)
  const rows = c.byMatch
    .map((l) => ({ l, m: matchOf(l.matchId) }))
    .filter((x) => !!x.m)
    .sort((a, b) => b.m!.date.localeCompare(a.m!.date))

  return (
    <Screen title={personName(personId)} back={back}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Avatar name={personName(personId)} color={data.team?.color} size={52} />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{personName(personId)}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              {data.team?.name} · {c.matches} match{c.matches === 1 ? '' : 'es'}
              {person?.batsLeft && <Pill>Left-hand bat</Pill>}
            </p>
          </div>
        </div>

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

        {c.shots.length > 0 && (
          <section>
            <h2 className="section-title">Wagon wheel — all matches</h2>
            <div className="card p-4">
              <div className="mb-2 flex gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4" style={{ background: 'var(--series-1)' }} />
                  Fours ({c.shots.filter((s) => s.runs === 4).length})
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4" style={{ background: 'var(--series-2)' }} />
                  Sixes ({c.shots.filter((s) => s.runs === 6).length})
                </span>
              </div>
              <GroundMap left={person?.batsLeft} shots={c.shots} />
              <p className="mt-1 text-center text-xs text-muted">Only boundaries whose direction was recorded.</p>
            </div>
          </section>
        )}

        <section>
          <h2 className="section-title">Match by match</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {rows.map(({ l, m }) => (
              <button key={l.matchId} className="row active:bg-alt" onClick={() => navigate(`/teams/${teamId}/matches/${l.matchId}/live?tab=scorecard`)}>
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
      </div>
    </Screen>
  )
}
