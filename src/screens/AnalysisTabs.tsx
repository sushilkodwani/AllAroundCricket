// The two analysis tabs (PLAN §26). "Analysis" is the quick read: a few charts
// anyone can take in at a glance. "Detailed" is for the keen: phases in depth,
// every bowler's spell, every batter's innings ball by ball, fielding, extras.
import { useState } from 'react'
import { BarList, ChartCard, LineChart, Manhattan, type Series } from '../components/charts'
import { BallChip, GroundMap } from '../components/scoring'
import { ChoiceChips, Empty } from '../components/ui'
import { battersOf, chaseOf, fieldingOf, kpisOf, phaseRange, phaseStats, spellsOf } from '../lib/analysis'
import { economy, fmtRate, strikeRate, type InningsSummary } from '../lib/scorecard'
import { BALLS, ballRuns, battingSide, bowlingSide, isBall } from '../lib/scoring'
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
  const chase = chaseOf(file)
  const chaseSeries: Series[] = chase.length
    ? [
        { name: `${battingSide(file, file.innings[1]).shortName} scoring rate`, slot: slot(1), values: chase.map((c) => c.current) },
        { name: 'Rate still needed', slot: slot(1) === 1 ? 2 : 1, values: chase.map((c) => c.required) },
      ]
    : []

  const wicketRows = (Object.keys(s.wicketKinds) as WicketKind[]).map((k) => ({ label: WICKET_LABELS[k], value: s.wicketKinds[k] ?? 0 })).sort((a, b) => b.value - a.value)
  const maxPair = Math.max(1, ...s.partnerships.map((p) => p.runs))
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
        <BarList slot={slot(idx)} rows={wicketRows} />
      </ChartCard>

      <ChartCard title="Partnerships" subtitle={`${battingSide(file, inn).name} — runs (balls)`}>
        {s.partnerships.length === 0 && <p className="py-3 text-center text-sm text-muted">Nothing yet</p>}
        <div className="flex flex-col gap-3">
          {s.partnerships.map((p, n) => (
            <div key={n} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: 'var(--series-1)' }} />
                  {personName(p.a)} <span className="text-muted">{p.aRuns} ({p.aBalls})</span>
                </span>
                <span className="min-w-0 truncate text-right">
                  {personName(p.b)} <span className="text-muted">{p.bRuns} ({p.bBalls})</span>
                  <span className="ml-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: 'var(--series-2)' }} />
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {/* One bar per partnership, split by who scored what; leftover runs are extras. */}
                <span className="flex h-3 gap-0.5 overflow-hidden rounded-r" style={{ width: `${(p.runs / maxPair) * 100}%`, minWidth: 3, maxWidth: 'calc(100% - 76px)' }}>
                  {[
                    { n: p.aRuns, c: 'var(--series-1)' },
                    { n: Math.max(0, p.runs - p.aRuns - p.bRuns), c: 'rgb(var(--border))' },
                    { n: p.bRuns, c: 'var(--series-2)' },
                  ]
                    .filter((x) => x.n > 0)
                    .map((x, k) => (
                      <span key={k} style={{ flex: x.n, background: x.c }} />
                    ))}
                </span>
                <span className="font-semibold">
                  {p.runs} ({p.balls}){p.unbroken ? '*' : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </ChartCard>
    </>
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
  const boundaries = inn.events.filter(isBall).filter((b) => b.shot && (batter === 'all' || b.striker === batter))
  const hitters = [...new Set(inn.events.filter(isBall).filter((b) => b.shot).map((b) => b.striker))]
  const maxOverRuns = Math.max(1, ...spells.flatMap((x) => x.overs.map((o) => o.runs)))

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

      <ChartCard title="Bowling spells" subtitle={`${bowlingSide(file, inn).name} — each bar is one over's runs; ● = a wicket in it`}>
        {spells.length === 0 && <p className="py-3 text-center text-sm text-muted">Nothing yet</p>}
        <div className="flex flex-col divide-y divide-line">
          {spells.map((b) => (
            <div key={b.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{personName(b.id)}</span>
                <span className="shrink-0 text-sm">
                  <strong>
                    {Math.floor(b.balls / BALLS)}.{b.balls % BALLS}-{b.maidens}-{b.runs}-{b.wickets}
                  </strong>{' '}
                  <span className="text-muted">
                    · econ {economy({ runs: b.runs, balls: b.balls })} · {b.dotPct}% dots
                  </span>
                </span>
              </div>
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
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">
                  {personName(b.id)}
                  {!b.out && <span className="text-muted"> *</span>}
                </span>
                <span className="shrink-0 text-sm">
                  <strong>
                    {b.runs} ({b.balls})
                  </strong>{' '}
                  <span className="text-muted">
                    · SR {strikeRate(b.runs, b.balls)} · {b.dotPct}% dots · {b.boundaryPct}% 4s/6s
                  </span>
                </span>
              </div>
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

      <ChartCard title="Wagon wheel" subtitle={`${batName} — where the fours and sixes went`}>
        {hitters.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">No boundary directions recorded in this innings.</p>
        ) : (
          <>
            <ChoiceChips options={[{ value: 'all', label: 'All' }, ...hitters.map((id) => ({ value: id, label: personName(id) }))]} value={batter} onChange={setBatter} />
            <div className="mt-2 flex gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: 'var(--series-1)' }} />
                Fours ({boundaries.filter((b) => b.bat === 4).length})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: 'var(--series-2)' }} />
                Sixes ({boundaries.filter((b) => b.bat === 6).length})
              </span>
            </div>
            <GroundMap left={batter !== 'all' && lefties.has(batter)} shots={boundaries.map((b) => ({ shot: b.shot!, runs: b.bat }))} />
          </>
        )}
      </ChartCard>

      {caughtAt.length > 0 && (
        <ChartCard title="Where catches were taken" subtitle={`✕ catches and run-out throws (${caughtAt.length} recorded)`}>
          <GroundMap marks={caughtAt} />
        </ChartCard>
      )}

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
