// Team → Stats (PLAN §28): leaderboards built from every scored match.
import { useEffect, useMemo, type ReactNode } from 'react'
import { batAverage, batStrikeRate, bestBowling, bowlEconomy, bowlOvers, careerStats, highScore, type Career } from '../lib/career'
import { P } from '../lib/paths'
import { useApp, type TeamData } from '../state/AppContext'
import { navigate } from '../state/router'
import type { Match, ScoreFile, Team } from '../types'
import { Empty } from './ui'

/** Score files of a team's scored matches; each is loaded (cache first) the first time it is needed. */
export function useTeamScores(teamId: string, matches: Match[]): { files: ScoreFile[]; scored: Match[]; ready: boolean } {
  const { store } = useApp()
  const scored = useMemo(() => matches.filter((m) => m.scoring && !m.cancelled), [matches])
  const key = scored.map((m) => m.id).join(',')
  useEffect(() => {
    if (!store) return
    for (const id of key.split(',').filter(Boolean)) void store.load(P.scoring(teamId, id)).catch(() => {})
  }, [store, teamId, key])
  const paths = scored.map((m) => P.scoring(teamId, m.id))
  const files = store ? paths.map((p) => store.get<ScoreFile>(p)).filter((f): f is ScoreFile => !!f) : []
  return { files, scored, ready: !!store && paths.every((p) => store.has(p)) }
}

/** Our own players only: everyone who was in this team's XI in a scored match. */
export function teamCareers(files: ScoreFile[]): Career[] {
  const ours = new Set(files.flatMap((f) => f.home.xi))
  return [...careerStats(files).values()].filter((c) => ours.has(c.id))
}

const Th = ({ children, left }: { children?: ReactNode; left?: boolean }) => <th className={`px-1.5 py-1.5 text-xs font-semibold text-muted ${left ? 'pl-3 text-left' : 'text-right'}`}>{children}</th>
const Td = ({ children, strong }: { children?: ReactNode; strong?: boolean }) => <td className={`px-1.5 py-2.5 text-right ${strong ? 'font-bold' : ''}`}>{children}</td>

export function StatsTab({ data }: { data: TeamData & { team: Team } }) {
  const { personName } = useApp()
  const { team, matches } = data
  const { files, scored, ready } = useTeamScores(team.id, matches)
  // `files` is a new array each render; its content only changes with the store.
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const careers = useMemo(() => teamCareers(files), [stamp])

  if (scored.length === 0) return <Empty icon="📊" title="No stats yet" text="Stats appear once a match has been scored ball by ball." />
  if (!ready) return <p className="p-10 text-center text-sm text-muted">Loading…</p>

  const open = (id: string) => navigate(`/teams/${team.id}/players/${id}`)
  const name = (c: Career) => (
    <td className="max-w-0 py-2.5 pl-3 pr-1.5" style={{ width: '38%' }}>
      <span className="block truncate font-medium">{personName(c.id)}</span>
    </td>
  )
  const batters = careers.filter((c) => c.bat.innings > 0).sort((a, b) => b.bat.runs - a.bat.runs || a.bat.balls - b.bat.balls)
  const bowlers = careers.filter((c) => c.bowl.innings > 0).sort((a, b) => b.bowl.wickets - a.bowl.wickets || a.bowl.runs - b.bowl.runs)
  const fielders = careers
    .map((c) => ({ c, n: c.field.catches + c.field.stumpings + c.field.runOuts }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
  const most = (pick: (c: Career) => number) => [...careers].sort((a, b) => pick(b) - pick(a))[0]
  const sixes = most((c) => c.bat.sixes)
  const tiles: { label: string; who?: Career; value: string }[] = [
    { label: 'Most runs', who: batters[0], value: batters[0] ? `${batters[0].bat.runs}` : '' },
    { label: 'Most wickets', who: bowlers[0]?.bowl.wickets ? bowlers[0] : undefined, value: bowlers[0] ? `${bowlers[0].bowl.wickets}` : '' },
    { label: 'Most sixes', who: sixes?.bat.sixes ? sixes : undefined, value: sixes ? `${sixes.bat.sixes}` : '' },
  ]

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm text-muted">
        From {scored.length} scored match{scored.length === 1 ? '' : 'es'}. Tap a player for their full record.
      </p>

      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <button key={t.label} className="card p-3 text-left active:bg-alt disabled:opacity-60" disabled={!t.who} onClick={() => t.who && open(t.who.id)}>
            <span className="block text-xs text-muted">{t.label}</span>
            <span className="block text-2xl font-semibold">{t.who ? t.value : '–'}</span>
            <span className="block truncate text-xs">{t.who ? personName(t.who.id) : ' '}</span>
          </button>
        ))}
      </div>

      <section>
        <h2 className="section-title">Batting</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-alt">
                <Th left>Player</Th>
                <Th>Inn</Th>
                <Th>Runs</Th>
                <Th>HS</Th>
                <Th>Avg</Th>
                <Th>SR</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {batters.map((c) => (
                <tr key={c.id} className="active:bg-alt" onClick={() => open(c.id)}>
                  {name(c)}
                  <Td>{c.bat.innings}</Td>
                  <Td strong>{c.bat.runs}</Td>
                  <Td>{highScore(c)}</Td>
                  <Td>{batAverage(c)}</Td>
                  <Td>{batStrikeRate(c)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {bowlers.length > 0 && (
        <section>
          <h2 className="section-title">Bowling</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-alt">
                  <Th left>Player</Th>
                  <Th>O</Th>
                  <Th>R</Th>
                  <Th>W</Th>
                  <Th>Best</Th>
                  <Th>Eco</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bowlers.map((c) => (
                  <tr key={c.id} className="active:bg-alt" onClick={() => open(c.id)}>
                    {name(c)}
                    <Td>{bowlOvers(c)}</Td>
                    <Td>{c.bowl.runs}</Td>
                    <Td strong>{c.bowl.wickets}</Td>
                    <Td>{bestBowling(c)}</Td>
                    <Td>{bowlEconomy(c)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {fielders.length > 0 && (
        <section>
          <h2 className="section-title">Fielding</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-alt">
                  <Th left>Player</Th>
                  <Th>Catches</Th>
                  <Th>Stumpings</Th>
                  <Th>Run outs</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {fielders.map(({ c }) => (
                  <tr key={c.id} className="active:bg-alt" onClick={() => open(c.id)}>
                    {name(c)}
                    <Td strong>{c.field.catches}</Td>
                    <Td>{c.field.stumpings}</Td>
                    <Td>{c.field.runOuts}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
