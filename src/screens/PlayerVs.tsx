// Compare (two players side by side) and Face off (one player against one
// opponent, ball by ball). Blue is always the player whose page this is,
// orange the one picked. Everything comes from the ball-by-ball score files.
import { useMemo, useState } from 'react'
import { WagonWheel, WicketDonut } from '../components/matchViz'
import { Bars, Butterfly, DataTable, Insights, PairBars, Panel, PlayerPicker, ProgressChart, Tiles, VsHeader, VsRows } from '../components/playerViz'
import { Segmented } from '../components/ui'
import { fmtDayMonth } from '../lib/dates'
import {
  CAUGHT,
  avg,
  awardsOf,
  batAgg,
  bowlAgg,
  byOverOfInnings,
  econ,
  fmt,
  groupBy,
  innsRow,
  paceOf,
  pct,
  playerData,
  progression,
  sr,
  styleLabel,
  wicketsSpread,
  type BatBall,
  type BowlBall,
  type PlayerCtx,
  type PlayerData,
  type StyleKey,
} from '../lib/playerAnalysis'
import { oversText } from '../lib/scoring'
import { WICKET_LABELS, type Match, type ScoreFile, type WicketKind } from '../types'
import { FormList, NUM_COLOR, f1, openMatch } from './PlayerTabs'

type Mode = 'bat' | 'bowl'
const KINDS = Object.keys(WICKET_LABELS) as WicketKind[]
const runsOf = (a: { dots: number; ones: number; twos: number; threes: number; fours: number; sixes: number }) => [a.dots, a.ones, a.twos, a.threes, a.fours, a.sixes]
const RUN_LABELS = ['Dots', '1s', '2s', '3s', '4s', '6s']
const pctOf = (xs: number[]) => {
  const t = xs.reduce((s, v) => s + v, 0)
  return xs.map((v) => (t ? Math.round((v * 1000) / t) / 10 : 0))
}
const first = (n: string) => n.split(' ')[0]

// ---------- figures for one player ----------
function batFigures(d: PlayerData) {
  const a = batAgg(d.batBalls)
  const r = innsRow(d.batInns)
  const inns = d.batInns
  return {
    a,
    r,
    thirties: inns.filter((i) => i.runs >= 30 && i.runs < 50).length,
    fifties: inns.filter((i) => i.runs >= 50 && i.runs < 100).length,
    hundreds: inns.filter((i) => i.runs >= 100).length,
    ducks: inns.filter((i) => i.runs === 0 && !i.notOut).length,
    fast: inns.filter((i) => i.balls >= 10 && i.runs * 100 >= 200 * i.balls).length,
    winning30: inns.filter((i) => i.runs >= 30 && i.won).length,
  }
}
function bowlFigures(d: PlayerData) {
  const a = bowlAgg(d.bowlBalls)
  const inns = d.bowlInns
  const best = inns.reduce<(typeof inns)[number] | null>((b, i) => (!b || i.wickets > b.wickets || (i.wickets === b.wickets && i.runs < b.runs) ? i : b), null)
  return { a, inns, best, threes: inns.filter((i) => i.wickets >= 3).length, maidens: inns.reduce((s, i) => s + i.maidens, 0) }
}

// ======================================================================
// Compare
// ======================================================================
export function CompareTab({ personId, d, files, ctx, personName, players, matchOf }: { personId: string; d: PlayerData; files: ScoreFile[]; ctx: PlayerCtx; personName: (id: string) => string; players: string[]; matchOf: (id: string) => Match | undefined }) {
  const [other, setOther] = useState('')
  const [picking, setPicking] = useState(false)
  const [mode, setMode] = useState<Mode>('bat')
  const [wheelOf, setWheelOf] = useState<0 | 1>(0)
  const [posView, setPosView] = useState<'runs' | 'avg' | 'sr'>('runs')
  const [overView, setOverView] = useState<'wickets' | 'econ'>('wickets')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const od = useMemo(() => (other ? playerData(files, other, ctx) : null), [other, files])
  const names: [string, string] = [personName(personId), other ? personName(other) : '']
  const short: [string, string] = [first(names[0]), first(names[1])]

  const picker = picking && (
    <PlayerPicker
      title="Compare with"
      ids={players.filter((id) => id !== personId)}
      name={personName}
      value={other}
      onClose={() => setPicking(false)}
      onPick={(id) => {
        setOther(id)
        setWheelOf(0)
        setPicking(false)
      }}
    />
  )
  const header = <VsHeader a={personId} b={other || undefined} name={personName} onPick={() => setPicking(true)} pickLabel="Pick a player" />

  if (!od)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="card px-4 py-5 text-center text-sm text-muted">Tap “Pick a player” to compare {names[0]} with anyone from these matches.</p>
        {picker}
      </div>
    )

  const ds = [d, od] as const
  return (
    <div className="flex flex-col gap-4">
      {header}
      <Segmented
        options={[
          { value: 'bat', label: 'Batting' },
          { value: 'bowl', label: 'Bowling' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'bat' ? <CompareBatting ds={ds} names={names} short={short} ctx={ctx} ids={[personId, other]} matchOf={matchOf} wheelOf={wheelOf} setWheelOf={setWheelOf} posView={posView} setPosView={setPosView} /> : <CompareBowling ds={ds} names={names} short={short} matchOf={matchOf} wheelOf={wheelOf} setWheelOf={setWheelOf} overView={overView} setOverView={setOverView} />}
      {picker}
    </div>
  )
}

function CompareBatting({
  ds,
  names,
  short,
  ctx,
  ids,
  matchOf,
  wheelOf,
  setWheelOf,
  posView,
  setPosView,
}: {
  ds: readonly [PlayerData, PlayerData]
  names: [string, string]
  short: [string, string]
  ctx: PlayerCtx
  ids: [string, string]
  matchOf: (id: string) => Match | undefined
  wheelOf: 0 | 1
  setWheelOf: (v: 0 | 1) => void
  posView: 'runs' | 'avg' | 'sr'
  setPosView: (v: 'runs' | 'avg' | 'sr') => void
}) {
  const [A, Bf] = ds.map(batFigures)
  const aw = ds.map(awardsOf)
  const row = (label: string, f: (x: ReturnType<typeof batFigures>, k: number) => [string, number | null], better?: 'high' | 'low') => {
    const [a, av] = f(A, 0)
    const [b, bv] = f(Bf, 1)
    return { label, a, b, av, bv, better }
  }
  const n = (v: number): [string, number] => [String(v), v]
  const r = (v: number | null, dd = 2): [string, number | null] => [fmt(v, dd), v]

  // out types
  const kinds = (x: PlayerData) => {
    const m: Partial<Record<WicketKind, number>> = {}
    for (const i of x.batInns) if (i.out) m[i.out.kind] = (m[i.out.kind] ?? 0) + 1
    return m
  }
  const ka = kinds(ds[0])
  const kb = kinds(ds[1])

  // batting position
  const maxPos = Math.max(0, ...ds.flatMap((x) => x.batInns.map((i) => i.position)))
  const posLabels = Array.from({ length: maxPos }, (_, i) => String(i + 1))
  const posVal = (x: PlayerData) =>
    posLabels.map((_, i) => {
      const rr = innsRow(x.batInns.filter((b) => b.position === i + 1))
      return posView === 'runs' ? rr.runs : posView === 'avg' ? (avg(rr.runs, rr.outs) ?? 0) : (sr(rr.runs, rr.balls) ?? 0)
    })

  // out between runs
  const buckets = [
    ['0–9', 0, 9],
    ['10–19', 10, 19],
    ['20–29', 20, 29],
    ['30–49', 30, 49],
    ['50+', 50, 9999],
  ] as const
  const outsIn = (x: PlayerData) => buckets.map(([, lo, hi]) => x.batInns.filter((i) => !i.notOut && i.runs >= lo && i.runs <= hi).length)

  // bowling types (pace / spin, then each style)
  const byPace = (x: PlayerData, k: 'pace' | 'spin') => batAgg(x.batBalls.filter((b) => paceOf(b.style === 'unknown' ? undefined : b.style) === k))
  const styles = [...new Set(ds.flatMap((x) => x.batBalls.map((b) => b.style)))].filter((s): s is StyleKey => s !== 'unknown')
  const styleAgg = (x: PlayerData, s: StyleKey) => batAgg(x.batBalls.filter((b) => b.style === s))

  const wheelBalls = ds[wheelOf].batBalls.filter((b) => b.shot && b.faced && b.bat > 0)

  return (
    <>
      <Panel title="Batting figures">
        <VsRows
          rows={[
            row('Matches', (_, k) => n(ds[k].matches.length)),
            row('Innings', (x) => n(x.r.inns)),
            row('Not outs', (x) => n(x.r.notOuts)),
            row('Runs', (x) => n(x.r.runs), 'high'),
            row('Highest', (x) => [`${x.r.best}${x.r.bestNotOut ? '*' : ''}`, x.r.inns ? x.r.best : null], 'high'),
            row('Average', (x) => r(avg(x.r.runs, x.r.outs)), 'high'),
            row('Strike rate', (x) => r(sr(x.a.runs, x.a.balls)), 'high'),
            row('30s', (x) => n(x.thirties), 'high'),
            row('50s', (x) => n(x.fifties), 'high'),
            row('100s', (x) => n(x.hundreds), 'high'),
            row('Ducks', (x) => n(x.ducks), 'low'),
            row('4s', (x) => n(x.a.fours), 'high'),
            row('6s', (x) => n(x.a.sixes), 'high'),
            row('Dot ball %', (x) => [`${pct(x.a.dots, x.a.balls)}%`, x.a.balls ? pct(x.a.dots, x.a.balls) : null], 'low'),
            row('Balls per boundary', (x) => r(x.a.fours + x.a.sixes ? x.a.balls / (x.a.fours + x.a.sixes) : null, 1), 'low'),
          ]}
        />
        <p className="mt-2 text-xs text-muted">A dot marks the better figure.</p>
      </Panel>

      <Panel title="Awards and badges">
        <VsRows
          rows={[
            { label: 'Player of the match', a: String(aw[0].potm), b: String(aw[1].potm), av: aw[0].potm, bv: aw[1].potm, better: 'high' },
            { label: 'Best batter award', a: String(aw[0].batter), b: String(aw[1].batter), av: aw[0].batter, bv: aw[1].batter, better: 'high' },
            { label: 'Best bowler award', a: String(aw[0].bowler), b: String(aw[1].bowler), av: aw[0].bowler, bv: aw[1].bowler, better: 'high' },
            row('Fast innings (SR 200+, 10+ balls)', (x) => n(x.fast), 'high'),
            row('30+ in a win', (x) => n(x.winning30), 'high'),
          ]}
        />
      </Panel>

      <Panel title="Playing style" sub="Average score after each ball faced">
        <ProgressChart values={progression(ds[0].batInns)} second={progression(ds[1].batInns)} names={names} mark={15} />
      </Panel>

      <Panel title="Types of runs" sub="Share of balls faced">
        <PairBars labels={RUN_LABELS} a={pctOf(runsOf(A.a))} b={pctOf(runsOf(Bf.a))} names={names} fmt={(v) => `${v}%`} />
      </Panel>

      <Panel title="How they get out">
        <Butterfly rows={KINDS.map((k) => ({ label: WICKET_LABELS[k], a: ka[k] ?? 0, b: kb[k] ?? 0 }))} names={names} />
      </Panel>

      <Panel title="Out between runs" sub="The score they were out on">
        <PairBars labels={buckets.map((b) => b[0])} a={outsIn(ds[0])} b={outsIn(ds[1])} names={names} axis="runs when out" />
      </Panel>

      {maxPos > 0 && (
        <Panel title="Batting position">
          <Segmented
            options={[
              { value: 'runs', label: 'Runs' },
              { value: 'avg', label: 'Average' },
              { value: 'sr', label: 'Strike rate' },
            ]}
            value={posView}
            onChange={setPosView}
          />
          <div className="mt-2">
            <PairBars labels={posLabels} a={posVal(ds[0])} b={posVal(ds[1])} names={names} axis="batting position" />
          </div>
        </Panel>
      )}

      <Panel title="Against pace and spin">
        <VsRows
          rows={(['pace', 'spin'] as const).flatMap((k) => {
            const [x, y] = [byPace(ds[0], k), byPace(ds[1], k)]
            const L = k === 'pace' ? 'Pace' : 'Spin'
            return [
              { label: `${L} — strike rate`, a: f1(sr(x.runs, x.balls)), b: f1(sr(y.runs, y.balls)), av: sr(x.runs, x.balls), bv: sr(y.runs, y.balls), better: 'high' as const },
              { label: `${L} — average`, a: f1(avg(x.runs, x.outs)), b: f1(avg(y.runs, y.outs)), av: avg(x.runs, x.outs), bv: avg(y.runs, y.outs), better: 'high' as const },
            ]
          })}
        />
        {styles.length > 0 && (
          <div className="mt-3">
            <DataTable
              head={['Bowling', `${short[0]} SR`, `${short[1]} SR`, `${short[0]} avg`, `${short[1]} avg`]}
              rows={styles.map((s) => {
                const [x, y] = [styleAgg(ds[0], s), styleAgg(ds[1], s)]
                return [styleLabel(s), f1(sr(x.runs, x.balls)), f1(sr(y.runs, y.balls)), f1(avg(x.runs, x.outs)), f1(avg(y.runs, y.outs))]
              })}
              note="Strike rate and average against each bowling style on the bowlers’ profiles."
            />
          </div>
        )}
      </Panel>

      <Panel title="Current form" sub="Last 5 innings each, latest first">
        {ds.map((x, k) => (
          <div key={k} className={k ? 'mt-4' : ''}>
            <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--series-${k + 1})` }} />
              {names[k]}
            </p>
            {x.batInns.length ? <FormList items={x.batInns} matchOf={matchOf} text={(i) => `${i.runs}${i.notOut ? '*' : ''} (${i.balls})`} sub={(i) => (i.out ? WICKET_LABELS[i.out.kind] : 'not out')} /> : <p className="text-sm text-muted">Has not batted.</p>}
          </div>
        ))}
      </Panel>

      <Panel title="Wagon wheel">
        <Segmented
          options={[
            { value: '0', label: short[0] },
            { value: '1', label: short[1] },
          ]}
          value={String(wheelOf) as '0' | '1'}
          onChange={(v) => setWheelOf(Number(v) as 0 | 1)}
        />
        <div className="mt-2">{wheelBalls.length ? <WagonWheel key={wheelOf} shots={wheelBalls.map((b) => ({ shot: b.shot!, runs: b.bat }))} outs={ds[wheelOf].batBalls.filter((b) => b.at).map((b) => b.at!)} left={ctx.leftOf(ids[wheelOf])} /> : <p className="py-6 text-center text-sm text-muted">No recorded shots for {names[wheelOf]}.</p>}</div>
      </Panel>
    </>
  )
}

function CompareBowling({
  ds,
  names,
  short,
  matchOf,
  wheelOf,
  setWheelOf,
  overView,
  setOverView,
}: {
  ds: readonly [PlayerData, PlayerData]
  names: [string, string]
  short: [string, string]
  matchOf: (id: string) => Match | undefined
  wheelOf: 0 | 1
  setWheelOf: (v: 0 | 1) => void
  overView: 'wickets' | 'econ'
  setOverView: (v: 'wickets' | 'econ') => void
}) {
  const F = ds.map(bowlFigures)
  if (!F[0].inns.length && !F[1].inns.length) return <p className="card px-4 py-5 text-center text-sm text-muted">Neither has bowled in these matches.</p>
  // Someone who never bowled has no figures (and never "wins" a row with zero wides).
  const row = (label: string, f: (x: ReturnType<typeof bowlFigures>) => [string, number | null], better?: 'high' | 'low') => {
    const g = (x: ReturnType<typeof bowlFigures>): [string, number | null] => (x.inns.length ? f(x) : ['–', null])
    const [a, av] = g(F[0])
    const [b, bv] = g(F[1])
    return { label, a, b, av, bv, better }
  }
  const n = (v: number): [string, number] => [String(v), v]
  const kinds = (x: PlayerData) => {
    const m: Partial<Record<WicketKind, number>> = {}
    for (const b of x.bowlBalls) if (b.wicket) m[b.wicket] = (m[b.wicket] ?? 0) + 1
    return m
  }
  const [ka, kb] = ds.map(kinds)
  const overs = ds.map((x) => byOverOfInnings(x.bowlBalls))
  const maxOver = Math.max(0, ...overs.map((o) => o.length))
  const overLabels = Array.from({ length: maxOver }, (_, i) => String(i + 1))
  const overVal = (k: number) => overLabels.map((_, i) => {
    const o = overs[k][i]
    if (!o) return 0
    return overView === 'wickets' ? o.wickets : (econ(o.runs, o.balls) ?? 0)
  })
  const hand = (x: PlayerData, left: boolean) => bowlAgg(x.bowlBalls.filter((b) => b.left === left))
  const wheelBalls = ds[wheelOf].bowlBalls.filter((b) => b.shot && b.bat > 0)

  return (
    <>
      <Panel title="Bowling figures">
        <VsRows
          rows={[
            row('Innings', (x) => n(x.inns.length)),
            row('Overs', (x) => [oversText(x.a.balls), x.a.balls]),
            row('Wickets', (x) => n(x.a.wickets), 'high'),
            row('Runs given', (x) => n(x.a.runs)),
            row('Average', (x) => [f1(avg(x.a.runs, x.a.wickets)), avg(x.a.runs, x.a.wickets)], 'low'),
            row('Economy', (x) => [fmt(econ(x.a.runs, x.a.balls)), econ(x.a.runs, x.a.balls)], 'low'),
            row('Strike rate (balls per wicket)', (x) => [f1(x.a.wickets ? x.a.balls / x.a.wickets : null), x.a.wickets ? x.a.balls / x.a.wickets : null], 'low'),
            row('Best', (x) => [x.best ? `${x.best.wickets}/${x.best.runs}` : '–', x.best ? x.best.wickets * 1000 - x.best.runs : null], 'high'),
            row('3+ wickets', (x) => n(x.threes), 'high'),
            row('Maidens', (x) => n(x.maidens), 'high'),
            row('Dot ball %', (x) => [`${pct(x.a.dots, x.a.balls)}%`, x.a.balls ? pct(x.a.dots, x.a.balls) : null], 'high'),
            row('Boundaries given', (x) => n(x.a.fours + x.a.sixes)),
            row('Wides / no-balls', (x) => [`${x.a.wides} / ${x.a.noBalls}`, x.a.wides + x.a.noBalls], 'low'),
          ]}
        />
        <p className="mt-2 text-xs text-muted">A dot marks the better figure.</p>
      </Panel>

      <Panel title="Types of wickets">
        <Butterfly rows={KINDS.map((k) => ({ label: WICKET_LABELS[k], a: ka[k] ?? 0, b: kb[k] ?? 0 }))} names={names} />
      </Panel>

      {maxOver > 0 && (
        <Panel title="Which overs they bowl" sub="By over of the innings">
          <Segmented
            options={[
              { value: 'wickets', label: 'Wickets' },
              { value: 'econ', label: 'Economy' },
            ]}
            value={overView}
            onChange={setOverView}
          />
          <div className="mt-2">
            <PairBars labels={overLabels} a={overVal(0)} b={overVal(1)} names={names} axis="over of the innings" />
          </div>
        </Panel>
      )}

      <Panel title="Wickets in an innings">
        <PairBars labels={['0', '1', '2', '3', '4', '5+']} a={wicketsSpread(ds[0].bowlInns)} b={wicketsSpread(ds[1].bowlInns)} names={names} axis="wickets" />
      </Panel>

      <Panel title="Types of runs given" sub="Share of balls bowled">
        <PairBars labels={RUN_LABELS} a={pctOf(runsOf(F[0].a))} b={pctOf(runsOf(F[1].a))} names={names} fmt={(v) => `${v}%`} />
      </Panel>

      <Panel title="Right- v left-handed batters">
        <VsRows
          rows={[false, true].flatMap((left) => {
            const [x, y] = [hand(ds[0], left), hand(ds[1], left)]
            const L = left ? 'Left' : 'Right'
            return [
              { label: `${L}-handers — wickets`, a: String(x.wickets), b: String(y.wickets), av: x.wickets, bv: y.wickets, better: 'high' as const },
              { label: `${L}-handers — economy`, a: fmt(econ(x.runs, x.balls)), b: fmt(econ(y.runs, y.balls)), av: econ(x.runs, x.balls), bv: econ(y.runs, y.balls), better: 'low' as const },
            ]
          })}
        />
      </Panel>

      <Panel title="Current form" sub="Last 5 innings each, latest first">
        {ds.map((x, k) => (
          <div key={k} className={k ? 'mt-4' : ''}>
            <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--series-${k + 1})` }} />
              {names[k]}
            </p>
            {x.bowlInns.length ? <FormList items={x.bowlInns} matchOf={matchOf} text={(i) => `${i.wickets}/${i.runs}`} sub={(i) => `${oversText(i.balls)} ov`} /> : <p className="text-sm text-muted">Has not bowled.</p>}
          </div>
        ))}
      </Panel>

      <Panel title="Wagon wheel — runs given">
        <Segmented
          options={[
            { value: '0', label: short[0] },
            { value: '1', label: short[1] },
          ]}
          value={String(wheelOf) as '0' | '1'}
          onChange={(v) => setWheelOf(Number(v) as 0 | 1)}
        />
        <div className="mt-2">{wheelBalls.length ? <WagonWheel key={wheelOf} shots={wheelBalls.map((b) => ({ shot: b.shot!, runs: b.bat }))} /> : <p className="py-6 text-center text-sm text-muted">No recorded shots off {names[wheelOf]}.</p>}</div>
      </Panel>
    </>
  )
}

// ======================================================================
// Face off
// ======================================================================
interface Meeting {
  key: string
  matchId: string
  date: string
  opponent: string
  runs: number
  balls: number
  out?: WicketKind
}

function meetings<T extends BatBall | BowlBall>(balls: T[], runs: (b: T) => number, faced: (b: T) => boolean, out: (b: T) => WicketKind | undefined): Meeting[] {
  return [...groupBy(balls, (b) => `${b.matchId}:${b.inn}`).entries()]
    .map(([key, xs]) => ({
      key,
      matchId: xs[0].matchId,
      date: xs[0].date,
      opponent: xs[0].opponent,
      runs: xs.reduce((s, b) => s + runs(b), 0),
      balls: xs.filter(faced).length,
      out: xs.map(out).find(Boolean),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function FaceOffTab({ personId, d, personName, ctx, matchOf }: { personId: string; d: PlayerData; personName: (id: string) => string; ctx: PlayerCtx; matchOf: (id: string) => Match | undefined }) {
  const [pick, setPick] = useState('')
  const [picking, setPicking] = useState(false)
  const [mode, setMode] = useState<Mode>('bat')
  const asBat = [...groupBy(d.batBalls, (b) => b.bowler).entries()].map(([id, xs]) => ({ id, a: batAgg(xs) })).sort((x, y) => y.a.balls - x.a.balls)
  const asBowl = [...groupBy(d.bowlBalls, (b) => b.striker).entries()].map(([id, xs]) => ({ id, a: bowlAgg(xs) })).sort((x, y) => y.a.balls - x.a.balls)
  const ids = [...new Set([...asBat.map((x) => x.id), ...asBowl.map((x) => x.id)])]
  if (!ids.length) return <p className="card px-4 py-5 text-center text-sm text-muted">No head-to-heads yet.</p>

  const choose = (id: string) => {
    setPick(id)
    setPicking(false)
    // Open on the side where they actually met.
    setMode(asBat.some((x) => x.id === id) ? 'bat' : 'bowl')
  }
  const name = personName(personId)
  const them = pick ? personName(pick) : ''
  const batBalls = d.batBalls.filter((b) => b.bowler === pick)
  const bowlBalls = d.bowlBalls.filter((b) => b.striker === pick)
  const balls = mode === 'bat' ? batBalls : bowlBalls

  return (
    <div className="flex flex-col gap-4">
      <VsHeader a={personId} b={pick || undefined} name={personName} onPick={() => setPicking(true)} pickLabel="Pick an opponent" />

      {pick && (
        <>
          <Segmented
            options={[
              { value: 'bat', label: `${first(name)} batting` },
              { value: 'bowl', label: `${first(name)} bowling` },
            ]}
            value={mode}
            onChange={setMode}
          />
          {balls.length === 0 ? (
            <p className="card px-4 py-5 text-center text-sm text-muted">{mode === 'bat' ? `${name} has not faced ${them} yet.` : `${name} has not bowled to ${them} yet.`}</p>
          ) : mode === 'bat' ? (
            <FaceBat balls={batBalls} name={name} them={them} left={ctx.leftOf(personId)} matchOf={matchOf} />
          ) : (
            <FaceBowl balls={bowlBalls} name={name} them={them} left={ctx.leftOf(pick)} matchOf={matchOf} />
          )}
        </>
      )}

      {asBat.length > 0 && (
        <Panel title="Bowlers faced most" sub="Tap a name to see the head to head">
          <DataTable
            head={['Bowler', 'Runs', 'Balls', 'Out', 'SR']}
            rows={asBat.slice(0, 8).map(({ id, a }) => [
              <button key={id} className="max-w-[9rem] truncate text-left font-medium text-accent" onClick={() => choose(id)}>
                {personName(id)}
              </button>,
              a.runs,
              a.balls,
              a.outs,
              f1(sr(a.runs, a.balls)),
            ])}
          />
        </Panel>
      )}
      {asBowl.length > 0 && (
        <Panel title="Batters bowled to most" sub="Tap a name to see the head to head">
          <DataTable
            head={['Batter', 'Runs', 'Balls', 'Wkts', 'Econ']}
            rows={asBowl.slice(0, 8).map(({ id, a }) => [
              <button key={id} className="max-w-[9rem] truncate text-left font-medium text-accent" onClick={() => choose(id)}>
                {personName(id)}
              </button>,
              a.runs,
              a.balls,
              a.wickets,
              fmt(econ(a.runs, a.balls)),
            ])}
          />
        </Panel>
      )}

      {picking && (
        <PlayerPicker
          title="Pick an opponent"
          ids={ids}
          name={personName}
          value={pick}
          onClose={() => setPicking(false)}
          onPick={choose}
          note={(id) => {
            const fb = asBat.find((x) => x.id === id)?.a.balls ?? 0
            const bb = asBowl.find((x) => x.id === id)?.a.balls ?? 0
            return [fb ? `faced ${fb}` : '', bb ? `bowled ${bb}` : ''].filter(Boolean).join(' · ')
          }}
        />
      )}
    </div>
  )
}

function MeetingList({ items, text, matchOf }: { items: Meeting[]; text: (m: Meeting) => string; matchOf: (id: string) => Match | undefined }) {
  return (
    <div className="-mx-4 divide-y divide-line border-y border-line">
      {items.map((m) => (
        <button key={m.key} className="row w-full px-4 active:bg-alt" onClick={() => openMatch(matchOf(m.matchId))}>
          <span className="w-20 shrink-0 text-left font-semibold">{text(m)}</span>
          <span className="min-w-0 flex-1 truncate text-left text-sm">vs {m.opponent}</span>
          <span className="shrink-0 text-right text-xs text-muted">
            <span className="block">{m.out ? WICKET_LABELS[m.out] : 'no wicket'}</span>
            {fmtDayMonth(m.date)}
          </span>
        </button>
      ))}
    </div>
  )
}

function FaceBat({ balls, name, them, left, matchOf }: { balls: BatBall[]; name: string; them: string; left: boolean; matchOf: (id: string) => Match | undefined }) {
  const a = batAgg(balls)
  const meet = meetings(balls, (b) => b.bat, (b) => b.faced, (b) => b.out)
  const kinds: Partial<Record<WicketKind, number>> = {}
  for (const b of balls) if (b.out) kinds[b.out] = (kinds[b.out] ?? 0) + 1
  const shots = balls.filter((b) => b.shot && b.faced && b.bat > 0).map((b) => ({ shot: b.shot!, runs: b.bat }))
  const caught = balls.filter((b) => b.out && CAUGHT.includes(b.out)).length
  return (
    <>
      <Panel title={`${name} batting against ${them}`}>
        <Tiles
          items={[
            ['Innings met', meet.length],
            ['Runs', a.runs],
            ['Balls', a.balls],
            ['Out', a.outs],
            ['Average', f1(avg(a.runs, a.outs))],
            ['Strike rate', f1(sr(a.runs, a.balls))],
            ['Dot ball %', `${pct(a.dots, a.balls)}%`],
            ['4s', a.fours],
            ['6s', a.sixes],
          ]}
        />
        <Insights
          items={[
            a.outs > 0 && (
              <>
                {them} has got {name.split(' ')[0]} out <strong className="font-semibold">{a.outs === 1 ? 'once' : `${a.outs} times`}</strong> in {a.balls} balls{caught ? ` (${caught} caught)` : ''}
              </>
            ),
            a.outs === 0 && a.balls >= 6 && (
              <>
                Never out to {them} in <strong className="font-semibold">{a.balls} balls</strong>
              </>
            ),
          ]}
        />
      </Panel>
      <Panel title="Types of runs">
        <Bars axis="balls" bars={RUN_LABELS.map((label, i) => ({ label, value: runsOf(a)[i], color: NUM_COLOR([0, 1, 2, 3, 4, 6][i]), note: `${label}: ${runsOf(a)[i]}` }))} />
      </Panel>
      {a.outs > 0 && (
        <Panel title="How they got out">
          <WicketDonut kinds={kinds} />
        </Panel>
      )}
      {shots.length > 0 && (
        <Panel title="Wagon wheel" sub={`Only the balls from ${them}`}>
          <WagonWheel shots={shots} outs={balls.filter((b) => b.at).map((b) => b.at!)} left={left} />
        </Panel>
      )}
      <Panel title="Each meeting" sub="Runs (balls) off this bowler in each innings, latest first. Tap one for the scorecard.">
        <MeetingList items={meet} matchOf={matchOf} text={(m) => `${m.runs} (${m.balls})`} />
      </Panel>
    </>
  )
}

function FaceBowl({ balls, name, them, left, matchOf }: { balls: BowlBall[]; name: string; them: string; left: boolean; matchOf: (id: string) => Match | undefined }) {
  const a = bowlAgg(balls)
  const meet = meetings(balls, (b) => b.runs, (b) => b.legal, (b) => b.wicket)
  const kinds: Partial<Record<WicketKind, number>> = {}
  for (const b of balls) if (b.wicket) kinds[b.wicket] = (kinds[b.wicket] ?? 0) + 1
  const shots = balls.filter((b) => b.shot && b.bat > 0).map((b) => ({ shot: b.shot!, runs: b.bat }))
  return (
    <>
      <Panel title={`${name} bowling to ${them}`}>
        <Tiles
          items={[
            ['Innings met', meet.length],
            ['Runs given', a.runs],
            ['Balls', a.balls],
            ['Wickets', a.wickets],
            ['Economy', fmt(econ(a.runs, a.balls))],
            ['Average', f1(avg(a.runs, a.wickets))],
            ['Dot ball %', `${pct(a.dots, a.balls)}%`],
            ['4s given', a.fours],
            ['6s given', a.sixes],
          ]}
        />
        <Insights
          items={[
            a.wickets > 0 && (
              <>
                Has got {them} out <strong className="font-semibold">{a.wickets === 1 ? 'once' : `${a.wickets} times`}</strong> in {a.balls} balls
              </>
            ),
          ]}
        />
      </Panel>
      <Panel title="Types of runs given">
        <Bars axis="balls" bars={RUN_LABELS.map((label, i) => ({ label, value: runsOf(a)[i], color: NUM_COLOR([0, 1, 2, 3, 4, 6][i]), note: `${label}: ${runsOf(a)[i]}` }))} />
      </Panel>
      {a.wickets > 0 && (
        <Panel title="How they got them out">
          <WicketDonut kinds={kinds} />
        </Panel>
      )}
      {shots.length > 0 && (
        <Panel title="Wagon wheel" sub={`Where ${them} hit ${name.split(' ')[0]}`}>
          <WagonWheel shots={shots} left={left} />
        </Panel>
      )}
      <Panel title="Each meeting" sub="Latest first: runs given (balls). Tap one for the scorecard.">
        <MeetingList items={meet} matchOf={matchOf} text={(m) => `${m.runs} (${m.balls})`} />
      </Panel>
    </>
  )
}
