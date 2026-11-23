// A player's detailed analysis, in four tabs: Batting, Bowling, Compare and
// Face off. Everything is worked out from the ball-by-ball score files (see
// lib/playerAnalysis.ts); a section only shows when there is something in it.
import { useMemo, useState, type ReactNode } from 'react'
import { TrendBars } from '../components/charts'
import { WagonWheel, WicketDonut } from '../components/matchViz'
import { Bars, DataTable, FilterChips, Insights, Panel, ProgressChart, Tiles } from '../components/playerViz'
import { SearchSelect, Segmented } from '../components/ui'
import { careerStats, type Career } from '../lib/career'
import { fmtDayMonth } from '../lib/dates'
import {
  CAUGHT,
  avg,
  batAgg,
  bowlAgg,
  busiestRegion,
  byOverOfInnings,
  econ,
  fmt,
  groupBy,
  innsRow,
  paceOf,
  pct,
  progression,
  sr,
  startAndAfter,
  styleLabel,
  topBy,
  wicketsSpread,
  winPct,
  type BatBall,
  type BatInn,
  type BowlBall,
  type BowlInn,
  type PaceKey,
  type PhaseKey,
  type PlayerData,
} from '../lib/playerAnalysis'
import { mins } from '../lib/minutes'
import { oversText } from '../lib/scoring'
import { navigate } from '../state/router'
import { PITCH_LABELS, WICKET_LABELS, type Match, type PitchType, type ScoreFile, type WicketKind } from '../types'

const PHASES: { value: PhaseKey | 'any'; label: string }[] = [
  { value: 'any', label: 'All overs' },
  { value: 'pp', label: 'Powerplay' },
  { value: 'mid', label: 'Middle' },
  { value: 'death', label: 'Death' },
]
const PACE: { value: PaceKey | 'any'; label: string }[] = [
  { value: 'any', label: 'All bowling' },
  { value: 'pace', label: 'Pace' },
  { value: 'spin', label: 'Spin' },
]
const PACE_LABEL: Record<PaceKey, string> = { pace: 'Pace', spin: 'Spin', unknown: 'Not recorded' }
const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold">{children}</strong>
export const f1 = (n: number | null) => fmt(n, 1)
const scoreText = (i: { runs: number; notOut: boolean }) => `${i.runs}${i.notOut ? '*' : ''}`
const innsLabel = (inn: number) => (inn === 0 ? 'Batting first' : 'Chasing')
const bowlInnsLabel = (inn: number) => (inn === 0 ? 'Bowling first' : 'Defending')
export const NUM_COLOR = (runs: number) => (runs === 0 ? 'rgb(var(--text-muted) / 0.6)' : runs === 4 ? 'var(--series-1)' : runs === 6 ? 'var(--series-2)' : 'rgb(var(--text) / 0.75)')
export const openMatch = (m?: Match) => m && navigate(`/teams/${m.teamId}/matches/${m.id}/live?tab=scorecard`)

export interface TabProps {
  personId: string
  d: PlayerData
  name: string
  personName: (id: string) => string
  left: boolean
  matchOf: (id: string) => Match | undefined
  career?: Career
}

export function FormList<T extends { matchId: string; date: string; opponent: string }>({ items, text, sub, matchOf }: { items: T[]; text: (x: T) => string; sub?: (x: T) => string; matchOf: (id: string) => Match | undefined }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 5)
  return (
    <div>
      <div className="-mx-4 divide-y divide-line border-y border-line">
        {shown.map((x, n) => (
          <button key={n} className="row w-full px-4 active:bg-alt" onClick={() => openMatch(matchOf(x.matchId))}>
            <span className="w-16 shrink-0 text-left font-semibold">{text(x)}</span>
            <span className="min-w-0 flex-1 truncate text-left text-sm">vs {x.opponent}</span>
            <span className="shrink-0 text-right text-xs text-muted">
              {sub && <span className="block">{sub(x)}</span>}
              {fmtDayMonth(x.date)}
            </span>
          </button>
        ))}
      </div>
      {items.length > 5 && (
        <button className="mt-2 w-full text-center text-sm font-semibold text-accent" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `View all ${items.length}`}
        </button>
      )}
    </div>
  )
}

function YearBars({ rows, label }: { rows: { year: string; value: number }[]; label: string }) {
  if (rows.length < 2) return null // one year: the overall figures already say it
  const top = rows.reduce((a, b) => (b.value > a.value ? b : a))
  return (
    <Panel title="Year by year">
      <Bars bars={rows.map((r) => ({ label: r.year, value: r.value, note: `${r.year}: ${r.value} ${label}` }))} />
      {rows.length > 1 && top.value > 0 && <Insights items={[<>Most {label} in <B>{top.year}</B></>]} />}
    </Panel>
  )
}

const yearsSorted = <T extends { date: string }>(xs: T[]) => groupBy([...xs].sort((a, b) => a.date.localeCompare(b.date)), (x) => x.date.slice(0, 4))

// ======================================================================
// Batting
// ======================================================================
export function BattingTab({ personId, d, name, personName, left, matchOf }: TabProps) {
  const [wheelPace, setWheelPace] = useState<PaceKey | 'any'>('any')
  const [wheelPhase, setWheelPhase] = useState<PhaseKey | 'any'>('any')
  const [runsPace, setRunsPace] = useState<PaceKey | 'any'>('any')
  const inns = d.batInns
  if (!inns.length) return <p className="card px-4 py-5 text-center text-sm text-muted">Has not batted in these matches.</p>

  const all = batAgg(d.batBalls)
  const total = innsRow(inns)
  const last5 = inns.slice(0, 5)
  const last5Balls = d.batBalls.filter((b) => last5.some((i) => i.matchId === b.matchId && i.inn === b.inn))
  const l5 = batAgg(last5Balls)
  const l5row = innsRow(last5)
  const early = startAndAfter(inns, 15)
  const curve = progression(inns)
  const trend = [...inns].reverse().slice(-12).map((i) => ({ label: fmtDayMonth(i.date), value: i.runs, hollow: i.notOut, note: `vs ${i.opponent}` }))

  // wagon wheel
  const wheelBalls = d.batBalls.filter((b) => (wheelPace === 'any' || paceOf(b.style === 'unknown' ? undefined : b.style) === wheelPace) && (wheelPhase === 'any' || b.phase === wheelPhase))
  const shots = wheelBalls.filter((b) => b.shot && b.faced && b.bat > 0).map((b) => ({ shot: b.shot!, runs: b.bat }))
  const outsAt = wheelBalls.filter((b) => b.at).map((b) => b.at!)
  const fielder = busiestRegion(wheelBalls, left)
  const anyShots = d.batBalls.some((b) => b.shot || b.at)

  // types of runs
  const pace = (b: BatBall) => paceOf(b.style === 'unknown' ? undefined : b.style)
  const typed = batAgg(d.batBalls.filter((b) => runsPace === 'any' || pace(b) === runsPace))
  const byStyle = groupBy(
    d.batBalls.filter((b) => b.style !== 'unknown'),
    (b) => b.style,
  )
  const faced = (xs: BatBall[]) => xs.filter((b) => b.faced).length
  const dotTop = topBy(byStyle, (xs) => (faced(xs) >= 12 ? pct(batAgg(xs).dots, faced(xs)) : null))
  const boundTop = topBy(byStyle, (xs) => {
    const a = batAgg(xs)
    return a.balls >= 12 ? (a.fours + a.sixes) / a.balls : null
  })
  const byBowler = groupBy(d.batBalls, (b) => b.bowler)
  const mostRunsOff = topBy(byBowler, (xs) => batAgg(xs).runs)
  const mostOutBy = topBy(byBowler, (xs) => batAgg(xs).outs)

  // batting position
  const byPos = groupBy(inns, (i) => i.position)
  const positions = [...byPos.keys()].sort((a, b) => a - b)
  const usual = topBy(byPos, (xs) => xs.length)
  const bestPos = topBy(byPos, (xs) => avg(innsRow(xs).runs, innsRow(xs).outs), Math.min(2, inns.length))

  // first vs second innings
  const byInn = groupBy(inns, (i) => i.inn)
  const win30 = winPct(inns, (i) => i.runs >= 30)
  const winLow = winPct(inns, (i) => i.runs < 10 && !i.notOut)

  // bowling types, pace v spin, pitch
  const styleRows = [...groupBy(d.batBalls, (b) => b.style).entries()].map(([k, xs]) => ({ k, a: batAgg(xs) })).sort((a, b) => b.a.balls - a.a.balls)
  const paceRows = [...groupBy(d.batBalls, pace).entries()].map(([k, xs]) => ({ k, a: batAgg(xs) })).sort((a, b) => b.a.balls - a.a.balls)
  const pitchRows = [...groupBy(inns.filter((i) => i.pitch), (i) => i.pitch as PitchType).entries()]

  // dismissals
  const kinds: Partial<Record<WicketKind, number>> = {}
  for (const i of inns) if (i.out) kinds[i.out.kind] = (kinds[i.out.kind] ?? 0) + 1
  const caughtBy = topBy(
    groupBy(
      d.batBalls.filter((b) => b.out && CAUGHT.includes(b.out) && b.style !== 'unknown'),
      (b) => b.style,
    ),
    (xs) => xs.length,
  )

  const years = [...yearsSorted(inns).entries()].map(([year, xs]) => ({ year, value: xs.reduce((s, i) => s + i.runs, 0) }))
  const timed = inns.filter((i) => i.minutes !== undefined)
  const timedMs = timed.reduce((s, i) => s + (i.minutes ?? 0), 0)

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Current form" sub="Last 5 innings, latest first">
        <FormList items={inns} matchOf={matchOf} text={(i) => `${scoreText(i)} (${i.balls})`} sub={(i) => `${i.out ? WICKET_LABELS[i.out.kind] : 'not out'}${i.minutes ? ` · ${mins(i.minutes)} min` : ''}`} />
        <div className="mt-3">
          <Tiles
            items={[
              ['Runs in last 5 innings', l5row.runs],
              ['Caught out in last 5', last5.filter((i) => i.out && CAUGHT.includes(i.out.kind)).length],
              ['Not out in last 5', l5row.notOuts],
              ['Strike rate', f1(sr(l5.runs, l5.balls))],
              ['Average', f1(avg(l5row.runs, l5row.outs))],
              ['4s / 6s', `${l5.fours} / ${l5.sixes}`],
            ]}
          />
        </div>
      </Panel>

      {trend.length > 1 && (
        <Panel title={`Runs in each match (last ${trend.length})`}>
          <TrendBars points={trend} />
        </Panel>
      )}

      <Panel title="Playing style" sub="Average score after each ball faced">
        <ProgressChart values={curve} mark={15} />
        <div className="mt-2">
          <Tiles
            items={[
              ['SR in first 15 balls', f1(early.start)],
              ['SR after 15 balls', f1(early.after)],
              ['Balls per boundary', all.fours + all.sixes ? (all.balls / (all.fours + all.sixes)).toFixed(1) : '–'],
            ]}
          />
        </div>
      </Panel>

      {d.batBalls.some((b) => b.phase !== 'all') && (
        <Panel title="By phase of the innings">
          <DataTable
            head={['', 'Runs', 'Balls', 'SR', 'Outs', 'Dot %', '4s', '6s']}
            rows={(['pp', 'mid', 'death'] as const)
              .map((k) => ({ k, a: batAgg(d.batBalls.filter((b) => b.phase === k)) }))
              .filter((r) => r.a.balls > 0)
              .map(({ k, a }) => [PHASES.find((p) => p.value === k)!.label, a.runs, a.balls, f1(sr(a.runs, a.balls)), a.outs, `${pct(a.dots, a.balls)}%`, a.fours, a.sixes])}
            note="Powerplay = the overs set when each match started (older matches: 30% of the overs). Death = the last quarter of the overs."
          />
        </Panel>
      )}

      {anyShots && (
        <Panel title="Wagon wheel" sub="Where the runs went, and where catches were taken">
          <FilterChips options={PACE} value={wheelPace} onChange={setWheelPace} />
          <FilterChips options={PHASES} value={wheelPhase} onChange={setWheelPhase} />
          {shots.length || outsAt.length ? (
            <WagonWheel key={`${wheelPace}${wheelPhase}`} shots={shots} outs={outsAt} left={left} />
          ) : (
            <p className="py-6 text-center text-sm text-muted">No recorded shots for this filter.</p>
          )}
          {fielder && (
            <Insights
              items={[
                <>
                  Place your best fielder at <B>{fielder.region}</B> ({fielder.share}% of the runs with a direction)
                </>,
              ]}
            />
          )}
        </Panel>
      )}

      <Panel title="Types of runs" sub={`${typed.balls} balls faced`}>
        <FilterChips options={PACE} value={runsPace} onChange={setRunsPace} />
        <Bars
          axis="balls"
          bars={(
            [
              ['Dots', typed.dots, 0],
              ['1s', typed.ones, 1],
              ['2s', typed.twos, 2],
              ['3s', typed.threes, 3],
              ['4s', typed.fours, 4],
              ['6s', typed.sixes, 6],
            ] as const
          ).map(([label, value, r]) => ({ label, value, color: NUM_COLOR(r), note: `${label}: ${value} (${pct(value, typed.balls)}% of balls)` }))}
        />
        <Insights
          items={[
            dotTop && (
              <>
                Plays {dotTop.value}% dot balls against <B>{styleLabel(dotTop.key)}</B>
              </>
            ),
            boundTop && (
              <>
                Hits boundaries most often against <B>{styleLabel(boundTop.key)}</B> (one every {(1 / boundTop.value).toFixed(1)} balls)
              </>
            ),
            mostRunsOff && mostRunsOff.value > 0 && (
              <>
                Most runs scored off <B>{personName(mostRunsOff.key)}</B> ({mostRunsOff.value})
              </>
            ),
          ]}
        />
      </Panel>

      <Panel title="Batting position" sub="Runs at each position">
        <Bars
          bars={positions.map((p) => {
            const r = innsRow(byPos.get(p)!)
            return { label: String(p), value: r.runs, note: `No. ${p}: ${r.inns} inns, ${r.runs} runs, avg ${f1(avg(r.runs, r.outs))}, SR ${f1(sr(r.runs, r.balls))}` }
          })}
          axis="batting position"
        />
        <Insights
          items={[
            usual && (
              <>
                Bats most often at <B>No. {usual.key}</B> ({usual.value} of {inns.length} innings)
              </>
            ),
            bestPos && positions.length > 1 && (
              <>
                Best average at <B>No. {bestPos.key}</B> ({bestPos.value.toFixed(1)})
              </>
            ),
          ]}
        />
      </Panel>

      <Panel title="Batting first or chasing">
        <DataTable
          head={['', 'Inns', 'Runs', 'Avg', 'SR', 'HS', 'NO']}
          rows={[0, 1]
            .filter((k) => byInn.has(k))
            .map((k) => {
              const r = innsRow(byInn.get(k)!)
              return [innsLabel(k), r.inns, r.runs, f1(avg(r.runs, r.outs)), f1(sr(r.runs, r.balls)), `${r.best}${r.bestNotOut ? '*' : ''}`, r.notOuts]
            })}
        />
        <Insights
          items={[
            win30 && (
              <>
                The team won <B>{win30.pct}%</B> of the {win30.of} match{win30.of === 1 ? '' : 'es'} when {name} scored 30+
              </>
            ),
            winLow && (
              <>
                The team won <B>{winLow.pct}%</B> when {name} was out for under 10
              </>
            ),
          ]}
        />
      </Panel>

      <Panel title="Against each bowling type">
        <DataTable
          head={['Bowling', 'Balls', 'Runs', 'Outs', 'Avg', 'SR']}
          rows={styleRows.map(({ k, a }) => [styleLabel(k), a.balls, a.runs, a.outs, f1(avg(a.runs, a.outs)), f1(sr(a.runs, a.balls))])}
          note={styleRows.some((r) => r.k === 'unknown') ? 'Not recorded = the bowler’s style is not on their profile yet.' : undefined}
        />
      </Panel>

      <Panel title="Pace v spin">
        <DataTable
          head={['', 'Runs', 'Balls', 'Avg', 'SR', '4s', '6s', 'Dot %']}
          rows={paceRows.map(({ k, a }) => [PACE_LABEL[k], a.runs, a.balls, f1(avg(a.runs, a.outs)), f1(sr(a.runs, a.balls)), a.fours, a.sixes, `${pct(a.dots, a.balls)}%`])}
        />
      </Panel>

      {pitchRows.length > 0 && (
        <Panel title="By pitch type" sub="From the ground of each match">
          <DataTable
            head={['Pitch', 'Inns', 'Runs', 'Avg', 'SR']}
            rows={pitchRows.map(([p, xs]) => {
              const r = innsRow(xs)
              return [PITCH_LABELS[p], r.inns, r.runs, f1(avg(r.runs, r.outs)), f1(sr(r.runs, r.balls))]
            })}
          />
        </Panel>
      )}

      {total.outs > 0 && (
        <Panel title="How they get out">
          <WicketDonut kinds={kinds} />
          <Insights
            items={[
              caughtBy && (
                <>
                  Caught out most often against <B>{styleLabel(caughtBy.key)}</B>
                </>
              ),
              mostOutBy && mostOutBy.value >= 2 && (
                <>
                  Out most often to <B>{personName(mostOutBy.key)}</B> ({mostOutBy.value} times)
                </>
              ),
            ]}
          />
        </Panel>
      )}

      {d.stands.length > 0 && (
        <Panel title="Top 5 partnerships">
          <div className="-mx-4 divide-y divide-line border-y border-line">
            {d.stands.slice(0, 5).map((s, n) => (
              <button key={n} className="row w-full px-4 active:bg-alt" onClick={() => openMatch(matchOf(s.matchId))}>
                <span className="w-14 shrink-0 text-left">
                  <span className="block text-lg font-bold leading-tight">
                    {s.runs}
                    {s.unbroken ? '*' : ''}
                  </span>
                  <span className="text-xs text-muted">({s.balls})</span>
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">with {personName(s.partner)}</span>
                  <span className="block text-xs text-muted">
                    {name.split(' ')[0]} {s.mine} · {personName(s.partner).split(' ')[0]} {s.theirs}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  <span className="block">vs {s.opponent}</span>
                  {fmtDayMonth(s.date)}
                </span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <YearBars rows={years} label="runs" />

      <Panel title="Overall batting">
        <Tiles
          items={[
            ['Innings', total.inns],
            ['Not outs', total.notOuts],
            ['Runs', total.runs],
            ['Highest', `${total.best}${total.bestNotOut ? '*' : ''}`],
            ['Average', fmt(avg(total.runs, total.outs))],
            ['Strike rate', fmt(sr(all.runs, all.balls))],
            ['30s', inns.filter((i) => i.runs >= 30 && i.runs < 50).length],
            ['50s', inns.filter((i) => i.runs >= 50 && i.runs < 100).length],
            ['100s', inns.filter((i) => i.runs >= 100).length],
            ['4s', all.fours],
            ['6s', all.sixes],
            ['Dot balls', all.dots],
            ['Ducks', inns.filter((i) => i.runs === 0 && !i.notOut).length],
            ['Balls', all.balls],
            ['Dot %', `${pct(all.dots, all.balls)}%`],
            ...(timed.length
              ? ([
                  ['Minutes batted', mins(timedMs)],
                  ['Minutes per innings', mins(timedMs / timed.length)],
                  ['Runs per 10 min', ((timed.reduce((s, i) => s + i.runs, 0) * 600_000) / Math.max(1, timedMs)).toFixed(1)],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
        {timed.length > 0 && timed.length < inns.length && <p className="mt-1 text-xs text-muted">Minutes from the {timed.length} innings scored live.</p>}
      </Panel>
    </div>
  )
}

// ======================================================================
// Bowling
// ======================================================================
type OverView = 'overs' | 'econ' | 'wickets'
type Hand = 'any' | 'right' | 'left'

export function BowlingTab({ personId, d, name, personName, matchOf, career }: TabProps) {
  const [overView, setOverView] = useState<OverView>('wickets')
  const [hand, setHand] = useState<Hand>('any')
  const inns = d.bowlInns
  void personId
  const fielding = career && (
    <Panel title="Fielding">
      <Tiles
        items={[
          ['Catches', career.field.catches],
          ['Stumpings', career.field.stumpings],
          ['Run outs', career.field.runOuts],
        ]}
      />
    </Panel>
  )
  if (!inns.length)
    return (
      <div className="flex flex-col gap-4">
        <p className="card px-4 py-5 text-center text-sm text-muted">Has not bowled in these matches.</p>
        {fielding}
      </div>
    )

  const all = bowlAgg(d.bowlBalls)
  const last5 = inns.slice(0, 5)
  const l5 = last5.reduce((s, i) => ({ w: s.w + i.wickets, c: s.c + i.caught, f: s.f + i.fours, x: s.x + i.sixes }), { w: 0, c: 0, f: 0, x: 0 })
  const best = (xs: BowlInn[]) => xs.reduce<BowlInn | null>((b, i) => (!b || i.wickets > b.wickets || (i.wickets === b.wickets && i.runs < b.runs) ? i : b), null)
  const best5 = best(last5)
  const bestAll = best(inns)
  const trend = [...inns].reverse().slice(-12).map((i) => ({ label: fmtDayMonth(i.date), value: i.wickets, note: `${i.wickets}/${i.runs} vs ${i.opponent}` }))

  // overs of the innings
  const overs = byOverOfInnings(d.bowlBalls).filter((o) => o.overs > 0)
  const byPhase = groupBy(
    d.bowlBalls.filter((b) => b.phase !== 'all'),
    (b) => b.phase,
  )
  const PH: Record<PhaseKey, string> = { pp: 'the powerplay', mid: 'the middle overs', death: 'the death overs', all: 'the innings' }
  const wkPhase = topBy(byPhase, (xs) => bowlAgg(xs).wickets)
  const ecoPhase = topBy(byPhase, (xs) => (bowlAgg(xs).balls >= 12 ? econ(bowlAgg(xs).runs, bowlAgg(xs).balls) : null), 1, true)

  // wickets
  const kinds: Partial<Record<WicketKind, number>> = {}
  for (const b of d.bowlBalls) if (b.wicket) kinds[b.wicket] = (kinds[b.wicket] ?? 0) + 1
  const wByInn = [0, 1].map((k) => inns.filter((i) => i.inn === k).reduce((s, i) => s + i.wickets, 0))

  // right v left
  const handAgg = (l: boolean) => bowlAgg(d.bowlBalls.filter((b) => b.left === l))
  const R = handAgg(false)
  const L = handAgg(true)

  const byInn = groupBy(inns, (i) => i.inn)
  const pitchRows = [...groupBy(inns.filter((i) => i.pitch), (i) => i.pitch as PitchType).entries()]
  const victims = d.bowlBalls.filter((b) => b.victim)
  const vpos = (from: number, to: number) => victims.filter((b) => b.victim! >= from && b.victim! <= to).length
  const spread = wicketsSpread(inns)
  const win3 = winPct(inns, (i) => i.wickets >= 3)
  const lose0 = winPct(inns, (i) => i.wickets === 0)

  const wheelBalls = d.bowlBalls.filter((b) => hand === 'any' || b.left === (hand === 'left'))
  const shots = wheelBalls.filter((b) => b.shot && b.bat > 0).map((b) => ({ shot: b.shot!, runs: b.bat }))
  const boundaryRuns = all.fours * 4 + all.sixes * 6

  const years = [...yearsSorted(inns).entries()].map(([year, xs]) => ({ year, value: xs.reduce((s, i) => s + i.wickets, 0) }))
  const totals = inns.reduce((s, i) => ({ maidens: s.maidens + i.maidens, threes: s.threes + (i.wickets >= 3 ? 1 : 0) }), { maidens: 0, threes: 0 })
  const oversBowled = all.balls / 6

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Current form" sub="Last 5 innings, latest first">
        <FormList items={inns} matchOf={matchOf} text={(i) => `${i.wickets}/${i.runs}`} sub={(i) => `${oversText(i.balls)} ov`} />
        <div className="mt-3">
          <Tiles
            items={[
              ['Wickets in last 5 innings', l5.w],
              [`Caught out of ${l5.w} wickets`, l5.c],
              ['Boundaries given in last 5', l5.f + l5.x],
              ['Best in last 5', best5 ? `${best5.wickets}/${best5.runs}` : '–'],
              ['4s given', l5.f],
              ['6s given', l5.x],
            ]}
          />
        </div>
      </Panel>

      {trend.length > 1 && (
        <Panel title={`Wickets in each match (last ${trend.length})`}>
          <TrendBars points={trend} slot={2} />
        </Panel>
      )}

      <Panel title="Which overs they bowl" sub="By over of the innings">
        <Segmented
          options={[
            { value: 'wickets', label: 'Wickets' },
            { value: 'overs', label: 'Overs' },
            { value: 'econ', label: 'Economy' },
          ]}
          value={overView}
          onChange={setOverView}
        />
        <div className="mt-2">
          <Bars
            axis="over of the innings"
            color={overView === 'wickets' ? 'var(--series-2)' : 'var(--series-1)'}
            bars={overs.map((o) => ({
              label: String(o.over),
              value: overView === 'wickets' ? o.wickets : overView === 'overs' ? o.overs : Number((econ(o.runs, o.balls) ?? 0).toFixed(1)),
              note: `Over ${o.over}: bowled ${o.overs} time${o.overs === 1 ? '' : 's'}, ${o.runs} runs, ${o.wickets} wkt, econ ${fmt(econ(o.runs, o.balls))}`,
            }))}
          />
        </div>
        <Insights
          items={[
            wkPhase && wkPhase.value > 0 && (
              <>
                Most wickets in <B>{PH[wkPhase.key]}</B> ({wkPhase.value})
              </>
            ),
            ecoPhase && (
              <>
                Best economy in <B>{PH[ecoPhase.key]}</B> ({ecoPhase.value.toFixed(2)})
              </>
            ),
          ]}
        />
      </Panel>

      {all.wickets > 0 && (
        <Panel title="Types of wickets">
          <WicketDonut kinds={kinds} />
          <Insights
            items={[
              wByInn[0] !== wByInn[1] && (
                <>
                  Takes more wickets <B>{wByInn[0] > wByInn[1] ? 'bowling first' : 'defending a total'}</B> ({Math.max(...wByInn)} v {Math.min(...wByInn)})
                </>
              ),
            ]}
          />
        </Panel>
      )}

      <Panel title="Right- v left-handed batters">
        <Tiles
          cols={2}
          items={[
            ['Wickets — right-handers', `${R.wickets} (${pct(R.wickets, all.wickets)}%)`],
            ['Wickets — left-handers', `${L.wickets} (${pct(L.wickets, all.wickets)}%)`],
            ['Economy — right', fmt(econ(R.runs, R.balls))],
            ['Economy — left', fmt(econ(L.runs, L.balls))],
            ['Average — right', fmt(avg(R.runs, R.wickets))],
            ['Average — left', fmt(avg(L.runs, L.wickets))],
            ['Strike rate — right', fmt(R.wickets ? R.balls / R.wickets : null, 1)],
            ['Strike rate — left', fmt(L.wickets ? L.balls / L.wickets : null, 1)],
          ]}
        />
        <p className="mt-1 text-xs text-muted">Strike rate = balls per wicket. Batters count as right-handed unless their profile says left.</p>
      </Panel>

      <Panel title="Bowling first or defending">
        <DataTable
          head={['', 'Inns', 'Overs', 'Runs', 'Wkts', 'Avg', 'Econ']}
          rows={[0, 1]
            .filter((k) => byInn.has(k))
            .map((k) => {
              const xs = byInn.get(k)!
              const b = xs.reduce((s, i) => s + i.balls, 0)
              const r = xs.reduce((s, i) => s + i.runs, 0)
              const w = xs.reduce((s, i) => s + i.wickets, 0)
              return [bowlInnsLabel(k), xs.length, oversText(b), r, w, f1(avg(r, w)), fmt(econ(r, b))]
            })}
        />
      </Panel>

      {pitchRows.length > 0 && (
        <Panel title="By pitch type" sub="From the ground of each match">
          <DataTable
            head={['Pitch', 'Inns', 'Overs', 'Wkts', 'Avg', 'Econ']}
            rows={pitchRows.map(([p, xs]) => {
              const b = xs.reduce((s, i) => s + i.balls, 0)
              const r = xs.reduce((s, i) => s + i.runs, 0)
              const w = xs.reduce((s, i) => s + i.wickets, 0)
              return [PITCH_LABELS[p], xs.length, oversText(b), w, f1(avg(r, w)), fmt(econ(r, b))]
            })}
          />
        </Panel>
      )}

      {victims.length > 0 && (
        <Panel title="Who they get out" sub="Wickets by the batter’s position">
          <Bars
            color="var(--series-2)"
            axis="batting position"
            bars={Array.from({ length: Math.max(...victims.map((b) => b.victim!)) }, (_, i) => {
              const n = victims.filter((b) => b.victim === i + 1).length
              return { label: String(i + 1), value: n, note: `No. ${i + 1}: ${n} wicket${n === 1 ? '' : 's'}` }
            })}
          />
          <Tiles
            items={[
              ['Top order (1–3)', `${pct(vpos(1, 3), victims.length)}%`],
              ['Middle (4–7)', `${pct(vpos(4, 7), victims.length)}%`],
              ['Lower (8–11)', `${pct(vpos(8, 11), victims.length)}%`],
            ]}
          />
        </Panel>
      )}

      <Panel title="Wickets in an innings">
        <Bars color="var(--series-2)" axis="wickets" bars={['0', '1', '2', '3', '4', '5+'].map((label, i) => ({ label, value: spread[i], note: `${label} wicket${label === '1' ? '' : 's'}: ${spread[i]} innings` }))} />
        <Insights
          items={[
            win3 && (
              <>
                The team won <B>{win3.pct}%</B> of the {win3.of} match{win3.of === 1 ? '' : 'es'} when {name} took 3+ wickets
              </>
            ),
            lose0 && (
              <>
                The team lost <B>{100 - lose0.pct}%</B> when {name} went wicketless
              </>
            ),
          ]}
        />
      </Panel>

      <Panel title="Types of runs given" sub={`${all.runs} runs off ${oversText(all.balls)} overs`}>
        <Bars
          axis="balls"
          bars={(
            [
              ['Dots', all.dots, 0],
              ['1s', all.ones, 1],
              ['2s', all.twos, 2],
              ['3s', all.threes, 3],
              ['4s', all.fours, 4],
              ['6s', all.sixes, 6],
            ] as const
          ).map(([label, value, r]) => ({ label, value, color: NUM_COLOR(r), note: `${label}: ${value}` }))}
        />
        <Insights
          items={[
            all.runs > 0 && (
              <>
                <B>{pct(boundaryRuns, all.runs)}%</B> of the runs given came in boundaries
              </>
            ),
          ]}
        />
      </Panel>

      {d.bowlBalls.some((b) => b.shot) && (
        <Panel title="Wagon wheel — runs given" sub="Where batters hit this bowler">
          <FilterChips
            options={[
              { value: 'any' as Hand, label: 'All batters' },
              { value: 'right' as Hand, label: 'Right-handers' },
              { value: 'left' as Hand, label: 'Left-handers' },
            ]}
            value={hand}
            onChange={setHand}
          />
          {shots.length ? <WagonWheel key={hand} shots={shots} left={hand === 'left'} /> : <p className="py-6 text-center text-sm text-muted">No recorded shots for this filter.</p>}
          {hand === 'any' && d.bowlBalls.some((b) => b.left && b.shot) && <p className="mt-1 text-xs text-muted">Shown as recorded. Pick right- or left-handers to see off and leg side for them.</p>}
        </Panel>
      )}

      <Panel title="Extras">
        <Tiles
          items={[
            ['Wides', all.wides],
            ['No-balls', all.noBalls],
            ['Overs per wide', all.wides ? (oversBowled / all.wides).toFixed(1) : '–'],
          ]}
        />
      </Panel>

      <YearBars rows={years} label="wickets" />

      <Panel title="Overall bowling">
        <Tiles
          items={[
            ['Innings', inns.length],
            ['Overs', oversText(all.balls)],
            ['Maidens', totals.maidens],
            ['Wickets', all.wickets],
            ['Runs', all.runs],
            ['Best', bestAll ? `${bestAll.wickets}/${bestAll.runs}` : '–'],
            ['Average', fmt(avg(all.runs, all.wickets))],
            ['Economy', fmt(econ(all.runs, all.balls))],
            ['Strike rate', fmt(all.wickets ? all.balls / all.wickets : null, 1)],
            ['3+ wickets', totals.threes],
            ['Dot balls', all.dots],
            ['Dot %', `${pct(all.dots, all.balls)}%`],
            ['4s given', all.fours],
            ['6s given', all.sixes],
            ['Wd / Nb', `${all.wides} / ${all.noBalls}`],
          ]}
        />
      </Panel>

      {fielding}
    </div>
  )
}

export type { BatInn, BowlBall }
