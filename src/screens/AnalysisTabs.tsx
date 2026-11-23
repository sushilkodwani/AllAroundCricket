// The two analysis tabs (PLAN §26). "Analysis" is the quick read: a few charts
// anyone can take in at a glance. "Detailed" is for the keen: phases in depth,
// every bowler's spell, every batter's innings ball by ball, fielding, extras.
import { useState } from 'react'
import { BarList, ChartCard, LineChart, Manhattan, type Series } from '../components/charts'
import { BallChip } from '../components/scoring'
import { PartnershipCards, WagonWheel, WicketDonut } from '../components/matchViz'
import { Bars, Insights, Tiles } from '../components/playerViz'
import { ChoiceChips, Empty } from '../components/ui'
import { battersOf, chaseOf, fieldingOf, handSplitOf, kpisOf, matchupsOf, momentumOf, phaseRange, phaseStats, spellsOf, swingOf, zonesOf } from '../lib/analysis'
import { awardPoints } from '../lib/insights'
import { inningsMinutes, mins, type InningsMinutes } from '../lib/minutes'
import { economy, fmtRate, strikeRate, type InningsSummary } from '../lib/scorecard'
import { BALLS, ballRuns, battingSide, bowlingSide, isBall, legalBalls, oversText } from '../lib/scoring'
import { useApp } from '../state/AppContext'
import { WICKET_LABELS, type ScoreFile, type WicketKind } from '../types'

const slotOf = (file: ScoreFile, n: number): 1 | 2 => (file.innings[n].batting === 'home' ? 1 : 2)

export function InningsPicker({ file, value, onChange }: { file: ScoreFile; value: number; onChange: (n: number) => void }) {
  if (file.innings.length < 2) return null
  return <ChoiceChips options={file.innings.map((i, n) => ({ value: String(n), label: `${battingSide(file, i).shortName} innings` }))} value={String(value)} onChange={(v) => onChange(Number(v))} />
}

const Empty0 = () => <Empty icon="📊" title="No analysis yet" text="Charts appear once the first over is under way." />

/** A small table that scrolls sideways instead of squeezing on a phone. */
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            {head.map((h, i) => (
              <th key={h} className={`px-1.5 py-1.5 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, n) => (
            <tr key={n}>
              {r.map((c, i) => (
                <td key={i} className={`px-1.5 py-2 ${i === 0 ? 'text-left font-medium' : 'text-right'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Analysis: the quick read ----------
export function AnalysisTab({ file, summaries }: { file: ScoreFile; summaries: InningsSummary[] }) {
  const [pick, setPick] = useState<number | null>(null)
  const idx = Math.min(pick ?? file.innings.length - 1, file.innings.length - 1)
  const s = summaries[idx]
  const inn = file.innings[idx]
  const slot = (n: number) => slotOf(file, n)
  const time = inningsMinutes(inn)

  const perOver: Series[] = summaries.map((x, n) => ({ name: battingSide(file, file.innings[n]).shortName, slot: slot(n), values: x.overLines.map((o) => o.runs), wickets: x.overLines.map((o) => o.wickets) }))
  const worm: Series[] = summaries.map((x, n) => ({ name: battingSide(file, file.innings[n]).shortName, slot: slot(n), values: x.overLines.map((o) => o.total), wickets: x.overLines.map((o) => o.wickets) }))
  const rates: Series[] = summaries.map((x, n) => ({
    name: battingSide(file, file.innings[n]).shortName,
    slot: slot(n),
    values: x.overLines.map((o, i) => {
      const balls = i === x.overLines.length - 1 ? x.legal - i * BALLS || BALLS : BALLS
      return (o.total * BALLS) / (i * BALLS + balls)
    }),
  }))

  const phases = summaries.map((_, n) => phaseStats(file, n))
  const swing = swingOf(file)
  const chase = chaseOf(file)
  const chaseSeries: Series[] = chase.length
    ? [
        { name: `${battingSide(file, file.innings[1]).shortName} scoring rate`, slot: slot(1), values: chase.map((c) => c.current) },
        { name: 'Rate still needed', slot: slot(1) === 1 ? 2 : 1, values: chase.map((c) => c.required) },
      ]
    : []

  const extrasRuns = inn.events.filter(isBall).reduce((sum, b) => sum + ballRuns(b) - b.bat, 0)
  const { personName } = useApp()

  if (summaries.every((x) => x.legal === 0)) return <Empty0 />

  return (
    <>
      <Manhattan series={perOver} />
      <LineChart
        title="Score progression"
        series={worm}
        idle="Tap an over to see the score. ● = wicket"
        pace={file.innings[1]?.target ? { label: 'Pace needed in the chase', to: file.innings[1].target - 1, overs: file.innings[1].overs } : undefined}
      />
      <LineChart title="Run rate" series={rates} decimals={2} idle="Runs per over so far, after each over." fromZero={false} />

      <ChartCard title="Powerplay, middle and death" subtitle="Runs/wickets and runs per over in each part of the innings">
        <Table
          head={['', ...file.innings.map((i) => battingSide(file, i).shortName)]}
          rows={(phases[0] ?? []).map((l, k) => [
            `${l.phase.label} (${phaseRange(l.phase)})`,
            ...phases.map((p) => (p[k] && p[k].balls + p[k].runs > 0 ? `${p[k].runs}/${p[k].wickets} · ${fmtRate(p[k].runRate)}` : '–')),
          ])}
        />
      </ChartCard>

      {chaseSeries.length > 0 && <LineChart title="The chase" series={chaseSeries} decimals={2} idle="Runs per over scored so far against what is still needed, after each over." fromZero={false} />}

      {swing.length > 0 && (
        <>
          <LineChart
            title="Chase: chance of winning"
            series={[{ name: `${battingSide(file, file.innings[1]).shortName} chance (%)`, slot: slot(1), values: swing.map((p) => p.chance) }]}
            idle="A rough estimate for the chasing side after each over, not a prediction."
            fromZero={false}
          />
          <ChartCard title="Ahead or behind the pace" subtitle="Runs the chasing side was ahead (+) or behind (–) the required pace after each over">
            <div className="flex flex-wrap gap-1.5">
              {swing.map((p) => (
                <span key={p.over} className={`inline-flex min-w-[44px] flex-col items-center rounded-lg border px-1.5 py-1 text-xs ${p.ahead >= 0 ? 'border-ok/40 bg-ok/10 text-ok' : 'border-bad/40 bg-bad/10 text-bad'}`}>
                  <span className="text-[10px] text-muted">ov {p.over}</span>
                  <strong>{p.ahead > 0 ? `+${p.ahead}` : p.ahead}</strong>
                </span>
              ))}
            </div>
          </ChartCard>
        </>
      )}

      <InningsPicker file={file} value={idx} onChange={setPick} />

      <ChartCard title="How the runs came" subtitle={`${battingSide(file, inn).name} — number of balls by result`}>
        <BarList
          slot={slot(idx)}
          rows={[
            { label: 'Dot balls', value: s.shots.dots },
            { label: 'Singles', value: s.shots.ones },
            { label: 'Twos', value: s.shots.twos },
            { label: 'Threes', value: s.shots.threes },
            { label: 'Fours', value: s.shots.fours },
            { label: 'Sixes', value: s.shots.sixes },
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          {s.shots.fours * 4 + s.shots.sixes * 6} runs in boundaries · {extrasRuns + s.extras.pen} in extras
        </p>
      </ChartCard>

      <ChartCard title="Wickets" subtitle={`${battingSide(file, inn).name} — how they got out`}>
        <WicketDonut kinds={s.wicketKinds} />
      </ChartCard>

      <ChartCard title="Partnerships" subtitle={`${battingSide(file, inn).name} — each stand, and the score it began and ended at`}>
        <PartnershipCards partnerships={s.partnerships} name={personName} minutes={time.timed ? time.stands : undefined} />
      </ChartCard>

      <TimeCard file={file} idx={idx} time={time} />
    </>
  )
}

/** Minutes on the field for one innings: how long it took, the over rate, the slowest overs and who batted longest. */
function TimeCard({ file, idx, time }: { file: ScoreFile; idx: number; time: InningsMinutes }) {
  const { personName } = useApp()
  const name = battingSide(file, file.innings[idx]).name
  if (!time.timed)
    return (
      <ChartCard title="Time on the field" subtitle={name}>
        <p className="py-2 text-sm text-muted">Not available for this innings. Minutes come from when each ball was entered, and these balls were entered in quick bursts (for example, scored after the match), so the times would be wrong.</p>
      </ChartCard>
    )
  const done = time.overs.length
  const legal = legalBalls(file.innings[idx])
  const perOver = time.total / 60_000 / Math.max(1 / BALLS, legal / BALLS)
  const slowest = time.overs
    .map((ms, i) => ({ over: i + 1, ms }))
    .slice(0, file.innings[idx].closed ? done : done - 1) // the over being bowled isn't over yet
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)
  const longest = [...time.batters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return (
    <ChartCard title="Time on the field" subtitle={`${name} — minutes, from when each ball was entered`}>
      <Tiles
        items={[
          ['Innings', `${mins(time.total)} min`],
          ['Per over', `${perOver.toFixed(1)} min`],
          ['Overs', oversText(legal)],
        ]}
      />
      <div className="mt-3">
        <Bars axis="over" idle="Minutes each over took. Tap a bar to read it." bars={time.overs.map((ms, i) => ({ label: String(i + 1), value: Number((ms / 60_000).toFixed(1)), note: `Over ${i + 1}: ${(ms / 60_000).toFixed(1)} min` }))} />
      </div>
      <Insights
        items={[
          slowest.length > 0 && (
            <>
              Slowest over{slowest.length > 1 ? 's' : ''}: <strong className="font-semibold">{slowest.map((o) => `${o.over} (${(o.ms / 60_000).toFixed(1)} min)`).join(', ')}</strong>
            </>
          ),
          longest.length > 0 && (
            <>
              Longest at the crease: <strong className="font-semibold">{longest.map(([id, ms]) => `${personName(id)} ${mins(ms)} min`).join(', ')}</strong>
            </>
          ),
        ]}
      />
      <p className="mt-2 text-xs text-muted">A break longer than 5 minutes between two balls counts as 5 minutes.</p>
    </ChartCard>
  )
}

// ---------- Detailed analysis ----------
export function DetailedTab({ file, summaries, lefties }: { file: ScoreFile; summaries: InningsSummary[]; lefties: Set<string> }) {
  const { personName } = useApp()
  const [pick, setPick] = useState<number | null>(null)
  const [batter, setBatter] = useState('all')
  const idx = Math.min(pick ?? file.innings.length - 1, file.innings.length - 1)
  const s = summaries[idx]
  const inn = file.innings[idx]
  const slot = slotOf(file, idx)
  const bowlSlot: 1 | 2 = slot === 1 ? 2 : 1
  const batName = battingSide(file, inn).name

  if (summaries.every((x) => x.legal === 0)) return <Empty0 />

  const kpi = kpisOf(file, idx)
  const phases = phaseStats(file, idx)
  const spells = spellsOf(file, idx)
  const batters = battersOf(file, idx)
  const fielding = fieldingOf(file, idx)
  const caughtAt = inn.events.filter(isBall).flatMap((b) => (b.wicket?.at ? [b.wicket.at] : []))
  // Catches (and run-out throws) for the wagon wheel: all of them, or the chosen batter's.
  const batterOuts = inn.events.filter(isBall).flatMap((b) => (b.wicket?.at && (batter === 'all' || b.wicket.who === batter) ? [b.wicket.at] : []))
  const boundaries = inn.events.filter(isBall).filter((b) => b.shot && (batter === 'all' || b.striker === batter))
  const hitters = [...new Set(inn.events.filter(isBall).filter((b) => b.shot).map((b) => b.striker))]
  const maxOverRuns = Math.max(1, ...spells.flatMap((x) => x.overs.map((o) => o.runs)))
  const momentum = momentumOf(file, idx)
  const matchups = matchupsOf(file, idx)
  const handSplit = handSplitOf(file, idx, lefties)
  const hasLefties = batters.some((b) => lefties.has(b.id))
  const zones = zonesOf(file, idx, lefties)
  const impact = awardPoints(file)
    .filter((x) => x.total !== 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
  const maxImpact = Math.max(1, ...impact.map((x) => x.total))
  const first = (id: string) => personName(id).split(' ')[0]
  const bowlersInOrder = spells.map((x) => x.id)
  const momentumSeries: Series[] = [{ name: battingSide(file, inn).shortName, slot, values: momentum.map((m) => m.rolling) }]
  const droughtSeries: Series[] = [{ name: battingSide(file, inn).shortName, slot, values: momentum.map((m) => m.sinceBoundary) }]

  return (
    <>
      <InningsPicker file={file} value={idx} onChange={(n) => (setPick(n), setBatter('all'))} />

      <div className="card grid grid-cols-2 divide-line py-2 text-center sm:grid-cols-4 sm:divide-x">
        {[
          ['Dot balls', `${kpi.dotPct}%`],
          ['Balls hit for 4 or 6', `${kpi.boundaryPct}%`],
          ['Runs from boundaries', `${kpi.boundaryRunsPct}%`],
          ['Best over', kpi.bestOver ? `${kpi.bestOver.runs} (over ${kpi.bestOver.over})` : '–'],
        ].map(([label, value]) => (
          <div key={label} className="px-1 py-1.5">
            <p className="text-base font-semibold">{value}</p>
            <p className="text-[11px] text-muted">{label}</p>
          </div>
        ))}
      </div>

      <ChartCard title="Phases in detail" subtitle={`${batName} — how each part of the innings went`}>
        <Table
          head={['Phase', 'Runs', 'Wkts', 'RR', 'Dots', '4s/6s']}
          rows={phases.map((l) => [`${l.phase.label} (${phaseRange(l.phase)})`, l.runs, l.wickets, fmtRate(l.runRate), `${l.dotPct}%`, `${l.boundaryPct}%`])}
        />
        <p className="mt-2 text-xs text-muted">Dots = balls with no runs. 4s/6s = share of balls that went for a boundary.</p>
      </ChartCard>

      <LineChart title="Momentum" series={momentumSeries} decimals={1} idle="Average runs per over across the last three overs, after each over." fromZero={false} />
      <LineChart title="Balls since a boundary" series={droughtSeries} idle="Legal balls since the last four or six, at the end of each over." fromZero={false} />

      <ChartCard title="Fall of wickets" subtitle={`${batName} — score when each wicket fell`}>
        {s.fow.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">No wickets fell.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {s.fow.map((w) => (
              <div key={w.n} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{w.n}.</span> {personName(w.who)}
                  </span>
                  <span className="shrink-0 text-muted">over {w.over}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="h-3 rounded-r" style={{ width: `${(w.score / Math.max(1, s.total)) * 100}%`, minWidth: 3, maxWidth: 'calc(100% - 52px)', background: `var(--series-${slot})` }} />
                  <span className="font-semibold">
                    {w.score}/{w.n}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>

      <ChartCard title="Bowling spells" subtitle={`${bowlingSide(file, inn).name} — each bar is one over's runs; ● = a wicket in it`}>
        {spells.length === 0 && <p className="py-3 text-center text-sm text-muted">Nothing yet</p>}
        <div className="flex flex-col divide-y divide-line">
          {spells.map((b) => (
            <div key={b.id} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{personName(b.id)}</p>
              <p className="text-sm">
                <strong>
                  {Math.floor(b.balls / BALLS)}.{b.balls % BALLS}-{b.maidens}-{b.runs}-{b.wickets}
                </strong>{' '}
                <span className="text-muted">
                  · econ {economy({ runs: b.runs, balls: b.balls })} · {b.dotPct}% dots
                </span>
              </p>
              <div className="mt-2 flex items-end gap-1.5" style={{ minHeight: 44 }}>
                {b.overs.map((o) => (
                  <div key={o.over} className="flex w-6 flex-col items-center gap-0.5">
                    <span className="text-[10px] font-medium">{o.runs}</span>
                    <span className="w-full rounded-t" style={{ height: Math.max(3, (o.runs / maxOverRuns) * 28), background: `var(--series-${bowlSlot})` }} />
                    <span className="text-[10px] text-muted">{o.wickets > 0 ? '●'.repeat(o.wickets) : o.over}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Every batter's innings" subtitle={`${batName} — each ball faced, in order`}>
        {batters.length === 0 && <p className="py-3 text-center text-sm text-muted">Nothing yet</p>}
        <div className="flex flex-col divide-y divide-line">
          {batters.map((b) => (
            <div key={b.id} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">
                {personName(b.id)}
                {!b.out && <span className="text-muted"> *</span>}
              </p>
              <p className="text-sm">
                <strong>
                  {b.runs} ({b.balls})
                </strong>{' '}
                <span className="text-muted">
                  · SR {strikeRate(b.runs, b.balls)} · {b.dotPct}% dots · {b.boundaryPct}% 4s/6s
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {b.faced.map((ball) => (
                  <BallChip key={ball.id} ball={ball} small />
                ))}
              </div>
              {b.byPhase.length > 1 && (
                <p className="mt-2 text-xs text-muted">
                  {b.byPhase
                    .filter((p) => p.balls > 0)
                    .map((p) => `${p.phase.label} ${p.runs} (${p.balls}) SR ${strikeRate(p.runs, p.balls)}`)
                    .join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Batter against bowler" subtitle={`${batName} — runs (balls) against each bowler; W = got them out`}>
        {matchups.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="px-1.5 py-1.5 text-left font-semibold">Batter</th>
                  {bowlersInOrder.map((id) => (
                    <th key={id} className="px-1.5 py-1.5 text-right font-semibold">
                      {first(id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {batters.map((b) => (
                  <tr key={b.id}>
                    <td className="max-w-[110px] truncate px-1.5 py-2 text-left font-medium">{first(b.id)}</td>
                    {bowlersInOrder.map((id) => {
                      const m = matchups.find((x) => x.batter === b.id && x.bowler === id)
                      return (
                        <td key={id} className={`whitespace-nowrap px-1.5 py-2 text-right ${m?.outs ? 'font-semibold text-bad' : ''}`}>
                          {m && m.balls > 0 ? `${m.runs} (${m.balls})${m.outs ? ' W' : ''}` : '–'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Left-handers and right-handers" subtitle="Each bowler's balls, runs and wickets against both">
        {!hasLefties ? (
          <p className="py-3 text-center text-sm text-muted">No left-handed batters in this innings. Mark a player as left-handed on their profile to see this.</p>
        ) : (
          <Table
            head={['Bowler', 'vs left', 'vs right']}
            rows={handSplit.map((h) => [personName(h.id), `${h.left.balls}b ${h.left.runs}r ${h.left.wickets}w`, `${h.right.balls}b ${h.right.runs}r ${h.right.wickets}w`])}
          />
        )}
      </ChartCard>

      <ChartCard title="Wagon wheel" subtitle={`${batName} — where the runs went, and where catches were taken`}>
        {hitters.length === 0 && caughtAt.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">No shot directions recorded in this innings.</p>
        ) : (
          <>
            {hitters.length > 0 && <ChoiceChips options={[{ value: 'all', label: 'All batters' }, ...hitters.map((id) => ({ value: id, label: personName(id) }))]} value={batter} onChange={setBatter} row />}
            <div className="mt-2">
              <WagonWheel key={batter} left={batter !== 'all' && lefties.has(batter)} shots={boundaries.map((b) => ({ shot: b.shot!, runs: b.bat }))} outs={batterOuts} />
            </div>
          </>
        )}
      </ChartCard>

      {zones.length > 0 && (
        <ChartCard title="Where the boundaries went" subtitle={`${batName} — fours and sixes by fielding region`}>
          <BarList slot={slot} rows={zones.map((z) => ({ label: z.region, value: z.fours + z.sixes }))} />
          <p className="mt-2 text-xs text-muted">{zones.map((z) => `${z.region}: ${z.fours}×4, ${z.sixes}×6`).join(' · ')}</p>
        </ChartCard>
      )}


      <ChartCard title="Player impact" subtitle="Points from batting, bowling and fielding — the same formula as the player-of-the-match suggestion">
        {impact.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {[
                ['Batting', 'var(--series-1)'],
                ['Bowling', 'var(--series-2)'],
                ['Fielding', 'rgb(var(--text-muted))'],
              ].map(([name, c]) => (
                <span key={name} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                  {name}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {impact.map((x) => (
                <div key={x.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{personName(x.id)}</span>
                    <strong>{x.total}</strong>
                  </div>
                  <span className="mt-0.5 flex h-3 gap-0.5 overflow-hidden rounded-r" style={{ width: `${(Math.max(0, x.total) / maxImpact) * 100}%`, minWidth: 3 }}>
                    {[
                      { n: x.bat, c: 'var(--series-1)' },
                      { n: x.bowl, c: 'var(--series-2)' },
                      { n: x.field, c: 'rgb(var(--text-muted))' },
                    ]
                      .filter((q) => q.n > 0)
                      .map((q, k) => (
                        <span key={k} style={{ flex: q.n, background: q.c }} />
                      ))}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </ChartCard>

      <ChartCard title="Fielding" subtitle={`${bowlingSide(file, inn).name} — catches, run-outs and stumpings`}>
        {fielding.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">No catches or run-outs in this innings.</p>
        ) : (
          <Table head={['Player', 'Catches', 'Run-outs', 'Stumpings']} rows={fielding.map((f) => [personName(f.id), f.catches, f.runOuts, f.stumpings])} />
        )}
      </ChartCard>

      <ChartCard title="Extras" subtitle={`${s.extras.total} extra run${s.extras.total === 1 ? '' : 's'} given to ${batName}`}>
        <BarList
          slot={bowlSlot}
          rows={[
            { label: 'Wides', value: s.extras.wd },
            { label: 'No-balls', value: s.extras.nb },
            { label: 'Byes', value: s.extras.b },
            { label: 'Leg-byes', value: s.extras.lb },
            { label: 'Penalty', value: s.extras.pen },
          ]}
        />
      </ChartCard>
    </>
  )
}
