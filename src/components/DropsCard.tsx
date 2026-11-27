// Catching and dropped catches, for a team or a season (Stats tab), for one match
// (scorecard) and for one player (Insights tab). Only drops the scorer marked are
// counted, so the card stays hidden until a match has at least one.
import { useMemo } from 'react'
import { dropSummary, dropsIn, impactText, playerDrops, type DropEvent, type FielderRow } from '../lib/drops'
import { fmtDayMonth } from '../lib/dates'
import { shotRegion } from '../lib/scorecard'
import { useApp } from '../state/AppContext'
import { navigate } from '../state/router'
import type { Match, ScoreFile, SideKey } from '../types'
import { BarList, ChartCard } from './charts'
import { GroundMap } from './scoring'

const PHASE_LABEL: Record<DropEvent['phase'], string> = { pp: 'Powerplay', mid: 'Middle overs', death: 'Death overs', all: 'Innings' }

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-alt px-3 py-2">
      <span className="block text-xs text-muted">{label}</span>
      <span className="block text-xl font-bold">{value}</span>
      {note && <span className="block text-[11px] text-muted">{note}</span>}
    </div>
  )
}

const pct = (n: number | null) => (n === null ? '–' : `${n}%`)

/** The team's (or season's) catching: totals, phases, places, and the people behind them. */
export function TeamDrops({ files, matches, side }: { files: ScoreFile[]; matches: Match[]; side: SideKey }) {
  const { personName } = useApp()
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => dropSummary(files, side), [stamp, side])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => dropsIn(files).length, [stamp])
  if (all === 0) return null
  // Everyone in the team sees every fielder's numbers, like the rest of the stats.
  const rows: FielderRow[] = s.byFielder
  const matchOf = (id: string) => matches.find((m) => m.id === id)
  return (
    <ChartCard title="Catching" subtitle="Catches held and catches dropped, from the drops your scorers marked.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Chances" value={String(s.chances)} note={`${s.taken} held, ${s.drops} dropped`} />
        <Tile label="Catch rate" value={pct(s.rate)} />
        <Tile label="Dropped" value={String(s.drops)} note={s.tough > 0 ? `${s.tough} hard chance${s.tough === 1 ? '' : 's'}` : undefined} />
        <Tile label="Runs given" value={String(s.runsCost)} note={s.decisive > 0 ? `${s.decisive} could have decided a match` : s.costly > 0 ? `${s.costly} in a lost match` : 'by batters after a life'} />
      </div>

      {s.byPhase.length > 0 && (
        <div className="mt-4">
          <strong className="text-sm">When they went down</strong>
          <div className="mt-1">
            <BarList rows={s.byPhase.map((p) => ({ label: PHASE_LABEL[p.key], value: p.drops }))} slot={side === 'home' ? 2 : 1} />
          </div>
        </div>
      )}

      {s.marks.length > 0 && (
        <div className="mt-4">
          <strong className="text-sm">Where they went down</strong>
          <p className="text-xs text-muted">Each ✕ is a dropped catch the scorer placed.</p>
          <GroundMap marks={s.marks} />
        </div>
      )}

      <div className="mt-4">
        <strong className="text-sm">By fielder</strong>
        {(
          <div className="mt-1 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-alt text-xs text-muted">
                  <th className="px-2 py-1.5 text-left font-semibold">Fielder</th>
                  <th className="px-1.5 py-1.5 text-right font-semibold">Held</th>
                  <th className="px-1.5 py-1.5 text-right font-semibold">Drop</th>
                  <th className="px-1.5 py-1.5 text-right font-semibold">Rate</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="max-w-0 truncate px-2 py-2 font-medium">{personName(r.id)}</td>
                    <td className="px-1.5 py-2 text-right">{r.taken}</td>
                    <td className="px-1.5 py-2 text-right">{r.drops}</td>
                    <td className="px-1.5 py-2 text-right">{pct(r.rate)}</td>
                    <td className="px-2 py-2 text-right">{r.runsCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-muted">Cost is the runs the batter scored after the life. Hard chances still count as drops here.</p>
      </div>

      {s.recent.length > 0 && (
        <div className="mt-4">
          <strong className="text-sm">Recent drops</strong>
          <div className="mt-1 divide-y divide-line">
            {s.recent.map((d) => {
              const m = matchOf(d.matchId)
              return (
                <button key={d.ballId} className="flex w-full items-start gap-2 py-2 text-left text-sm active:bg-alt" onClick={() => m && navigate(`/teams/${m.teamId}/matches/${m.id}/live?tab=commentary`)}>
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      {personName(d.by)} dropped {personName(d.batter)}
                      {d.tough ? ' (hard chance)' : ''}
                    </span>
                    <span className="block text-xs text-muted">
                      {m ? `vs ${m.opponent} · ${fmtDayMonth(m.date)} · ` : ''}
                      {impactText(d)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </ChartCard>
  )
}

/** One match's dropped catches, for the scorecard: who, where, and what each cost. */
export function MatchDrops({ file, names }: { file: ScoreFile; names: (id: string) => string }) {
  const drops = dropsIn([file])
  if (drops.length === 0) return null
  return (
    <section className="card p-4">
      <h3 className="font-semibold">Dropped catches</h3>
      <div className="mt-2 divide-y divide-line">
        {drops.map((d) => (
          <div key={d.ballId} className="py-2 text-sm">
            <span className="block">
              <strong>{names(d.by)}</strong> dropped {names(d.batter)}
              {d.tough ? ' (hard chance)' : ''}
              {d.at ? `, ${shotRegion(d.at, false)}` : ''} — bowler {names(d.bowler)}
            </span>
            <span className="block text-xs text-muted">
              {d.inningsIdx === 0 ? '1st' : '2nd'} innings, over {d.over} · {names(d.batter)} made {d.runsAfter} ({d.ballsAfter} balls) after the life{d.out ? ' and was then out' : ' and was not out'}
            </span>
            {d.impact !== 'none' && <span className="mt-0.5 block text-xs font-semibold text-warn">{impactText(d)}</span>}
          </div>
        ))}
      </div>
    </section>
  )
}

/** A player's own side of it: their catching, the lives they were given, and chances off their bowling. */
export function PlayerDrops({ files, personId }: { files: ScoreFile[]; personId: string }) {
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const total = useMemo(() => dropsIn(files).length, [stamp])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const p = useMemo(() => playerDrops(files, personId), [stamp, personId])
  const involved = p.fielding.chances + p.lives.count + p.luck.count
  if (total === 0 || involved === 0) return null
  return (
    <ChartCard title="Catching and chances" subtitle="From the drops your scorers marked.">
      <div className="grid grid-cols-2 gap-2">
        {p.fielding.chances > 0 && <Tile label="Catch rate" value={pct(p.fielding.rate)} note={`${p.fielding.taken} held, ${p.fielding.drops} dropped`} />}
        {p.fielding.drops > 0 && <Tile label="Runs after your drops" value={String(p.fielding.runsCost)} note={p.fielding.tough > 0 ? `${p.fielding.tough} hard chance${p.fielding.tough === 1 ? '' : 's'}` : undefined} />}
        {p.lives.count > 0 && <Tile label="Lives you were given" value={String(p.lives.count)} note={`${p.lives.runsAfter} runs after them`} />}
        {p.luck.count > 0 && <Tile label="Chances off your bowling dropped" value={String(p.luck.count)} note={`${p.luck.runsAfter} runs after them`} />}
      </div>
    </ChartCard>
  )
}
