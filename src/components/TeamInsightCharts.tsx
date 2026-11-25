// Team → Stats charts, second batch: scoring mix, dismissals, batting and bowling scatters,
// the player × phase heatmap, extras conceded and batting first against chasing.
// Plain SVG/HTML from the app's chart kit; text always wears text colours, never a series colour.
import { useMemo, useState } from 'react'
import { type Career } from '../lib/career'
import { fmtDayMonth } from '../lib/dates'
import { phaseProfile, type FirstVsChase } from '../lib/season'
import { MIX_KEYS, MIX_LABELS, bowlerDots, dismissalKinds, extrasConceded, scoringMix, type MixCounts } from '../lib/teamCharts'
import { useApp } from '../state/AppContext'
import { WICKET_LABELS, type Match, type ScoreFile, type SideKey, type WicketKind } from '../types'
import { BarList, ChartCard, TrendBars } from './charts'

const slotOf = (side: SideKey): 1 | 2 => (side === 'home' ? 1 : 2)
const otherSlot = (side: SideKey): 1 | 2 => (side === 'home' ? 2 : 1)
const first = (name: string) => name.split(' ')[0]

// ---------- scoring mix ----------
const MIX_COLOR: Record<(typeof MIX_KEYS)[number], string> = {
  dot: 'rgb(var(--text-muted) / 0.35)',
  one: 'var(--series-1)',
  two: 'var(--series-3)',
  other: 'var(--series-4)',
  four: 'var(--series-2)',
  six: 'var(--series-7)',
  extras: 'var(--series-5)',
}

function MixBar({ title, mix }: { title: string; mix: MixCounts }) {
  const [on, setOn] = useState<(typeof MIX_KEYS)[number] | null>(null)
  if (mix.total === 0) return null
  const say = (k: (typeof MIX_KEYS)[number]) => `${MIX_LABELS[k]}: ${mix[k]} of ${mix.total} balls (${Math.round((mix[k] * 100) / mix.total)}%)`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <strong className="text-sm">{title}</strong>
        <span className="text-xs text-muted">
          dot balls {mix.dotPct}% · boundary balls {mix.boundaryPct}%
        </span>
      </div>
      <div className="flex h-5 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={MIX_KEYS.map(say).join('; ')}>
        {MIX_KEYS.filter((k) => mix[k] > 0).map((k) => (
          <button key={k} type="button" className="h-full min-w-[2px] rounded-sm" style={{ flexGrow: mix[k], flexBasis: 0, background: MIX_COLOR[k], opacity: on && on !== k ? 0.4 : 1 }} aria-label={say(k)} onClick={() => setOn(on === k ? null : k)} />
        ))}
      </div>
      <p className="min-h-[18px] text-xs text-muted">{on ? say(on) : 'Tap a segment to read it.'}</p>
    </div>
  )
}

/** Every delivery by what it went for — when we bat and when we bowl — with the dot-ball and boundary shares. */
export function ScoringMix({ files, side }: { files: ScoreFile[]; side: SideKey }) {
  const bat = useMemo(() => scoringMix(files, side, true), [files, side])
  const bowl = useMemo(() => scoringMix(files, side, false), [files, side])
  if (bat.total + bowl.total === 0) return null
  const we = side === 'home' ? 'We bat' : 'They bat'
  const they = side === 'home' ? 'We bowl' : 'They bowl'
  return (
    <ChartCard title="How the runs come" subtitle="Every delivery by what it went for, over all scored matches">
      <div className="flex flex-col gap-4">
        <MixBar title={we} mix={bat} />
        <MixBar title={they} mix={bowl} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {MIX_KEYS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: MIX_COLOR[k] }} />
            {MIX_LABELS[k]}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">Extras are wides, no-balls, byes and leg-byes. Dot and boundary shares are of legal balls.</p>
    </ChartCard>
  )
}

// ---------- dismissals ----------
const rowsOf = (kinds: Partial<Record<WicketKind, number>>) =>
  (Object.keys(kinds) as WicketKind[])
    .map((k) => ({ label: WICKET_LABELS[k], value: kinds[k] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)

/** How our wickets fell and how we took theirs. */
export function Dismissals({ files, side }: { files: ScoreFile[]; side: SideKey }) {
  const d = useMemo(() => dismissalKinds(files, side), [files, side])
  const lost = rowsOf(d.lost)
  const taken = rowsOf(d.taken)
  if (lost.length + taken.length === 0) return null
  return (
    <ChartCard title="Wickets" subtitle="How the wickets fell, over all scored matches">
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1 text-sm font-semibold">{side === 'home' ? 'How we get out' : 'How they get out'}</p>
          <BarList rows={lost} slot={slotOf(side)} />
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">{side === 'home' ? 'How we take wickets' : 'How they take wickets'}</p>
          <BarList rows={taken} slot={otherSlot(side)} />
        </div>
      </div>
    </ChartCard>
  )
}

// ---------- scatter ----------
interface Dot {
  id: string
  label: string
  x: number
  y: number
  /** Bubble size: balls faced or bowled. */
  size: number
  tip: string
}

const SW = 340
const SH = 230
const SM = { l: 34, r: 12, t: 22, b: 34 }
const nice = (v: number, steps: number[]) => {
  const s = steps.find((x) => v / x <= 5) ?? steps[steps.length - 1]
  return { step: s, max: s * Math.max(1, Math.ceil(v / s)) }
}

/** Bubbles on two axes. Tap one to read it; a dashed line marks the average of x. */
function Scatter({ dots, xLabel, yLabel, avgX, avgLabel, onOpen, name }: { dots: Dot[]; xLabel: string; yLabel: string; avgX: number | null; avgLabel: string; onOpen: (id: string) => void; name: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const xs = nice(Math.max(1, ...dots.map((d) => d.x)), [1, 2, 5, 10, 20, 25, 50, 100])
  const ys = nice(Math.max(1, ...dots.map((d) => d.y)), [1, 2, 5, 10, 20, 25, 50, 100])
  const maxSize = Math.max(1, ...dots.map((d) => d.size))
  const px = (v: number) => SM.l + (v / xs.max) * (SW - SM.l - SM.r)
  const py = (v: number) => SH - SM.b - (v / ys.max) * (SH - SM.t - SM.b)
  const rad = (s: number) => 4 + 7 * Math.sqrt(s / maxSize)
  const ticks = (m: { step: number; max: number }) => Array.from({ length: Math.floor(m.max / m.step) + 1 }, (_, i) => i * m.step)
  // label the ones with the most on the y axis, plus the picked one, so the chart stays readable
  // (a label that would sit on top of one already placed is left out; the picked bubble always gets one)
  const top = new Set<string>()
  const boxes: { x0: number; x1: number; y: number }[] = []
  const order = sel ? [...dots].sort((a, b) => (a.id === sel ? -1 : b.id === sel ? 1 : 0) || b.y - a.y) : [...dots].sort((a, b) => b.y - a.y)
  for (const d of order) {
    if (top.size >= 5) break
    const w = d.label.length * 5.4
    const box = { x0: px(d.x) - w / 2, x1: px(d.x) + w / 2, y: py(d.y) - rad(d.size) - 3 }
    if (boxes.some((b) => Math.abs(b.y - box.y) < 11 && box.x0 < b.x1 && box.x1 > b.x0)) continue
    boxes.push(box)
    top.add(d.id)
  }
  const picked = dots.find((d) => d.id === sel)
  return (
    <div>
      <p className="min-h-[20px] text-sm text-muted">
        {picked ? (
          <>
            {picked.tip}{' '}
            <button type="button" className="font-medium text-brand underline" onClick={() => onOpen(picked.id)}>
              Open
            </button>
          </>
        ) : (
          'Tap a bubble to read it. Bigger bubble = more balls.'
        )}
      </p>
      <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full touch-pan-y" role="img" aria-label={name}>
        <g fontSize="9" fill="rgb(var(--text-muted))">
          {ticks(ys).map((t) => (
            <g key={`y${t}`}>
              <line x1={SM.l} x2={SW - SM.r} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={SM.l - 4} y={py(t) + 3} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {ticks(xs).map((t) => (
            <text key={`x${t}`} x={px(t)} y={SH - SM.b + 12} textAnchor="middle">
              {t}
            </text>
          ))}
          <text x={(SM.l + SW - SM.r) / 2} y={SH - 4} textAnchor="middle">
            {xLabel}
          </text>
          <text x={4} y={9} textAnchor="start">
            {yLabel}
          </text>
        </g>
        {avgX !== null && avgX <= xs.max && (
          <g>
            <line x1={px(avgX)} x2={px(avgX)} y1={SM.t} y2={SH - SM.b} stroke="rgb(var(--text-muted))" strokeWidth="1" strokeDasharray="3 3" />
            <text x={px(avgX) + 3} y={SM.t + 9} fontSize="8" fill="rgb(var(--text-muted))">
              {avgLabel}
            </text>
          </g>
        )}
        {[...dots]
          .sort((a, b) => b.size - a.size)
          .map((d) => (
            <g key={d.id} className="cursor-pointer" onClick={() => setSel(sel === d.id ? null : d.id)}>
              <circle cx={px(d.x)} cy={py(d.y)} r={Math.max(rad(d.size), 11)} fill="transparent" />
              <circle cx={px(d.x)} cy={py(d.y)} r={rad(d.size)} fill="var(--series-1)" fillOpacity={sel && sel !== d.id ? 0.35 : 0.8} stroke="rgb(var(--surface))" strokeWidth="1.5" />
              {(top.has(d.id) || sel === d.id) && (
                <text x={px(d.x)} y={py(d.y) - rad(d.size) - 3} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgb(var(--text))" stroke="rgb(var(--surface))" strokeWidth="2.5" paintOrder="stroke">
                  {d.label}
                </text>
              )}
            </g>
          ))}
      </svg>
    </div>
  )
}

/** Runs against strike rate: anchors sit left, hitters right, big scorers high. */
export function BatScatter({ careers, onOpen }: { careers: Career[]; onOpen: (id: string) => void }) {
  const { personName } = useApp()
  const rows = careers.filter((c) => c.bat.balls >= 12)
  if (rows.length < 2) return null
  const dots: Dot[] = rows.map((c) => {
    const sr = (c.bat.runs * 100) / c.bat.balls
    return { id: c.id, label: first(personName(c.id)), x: sr, y: c.bat.runs, size: c.bat.balls, tip: `${personName(c.id)}: ${c.bat.runs} runs off ${c.bat.balls} balls, strike rate ${sr.toFixed(1)}` }
  })
  const runs = rows.reduce((s, c) => s + c.bat.runs, 0)
  const balls = rows.reduce((s, c) => s + c.bat.balls, 0)
  return (
    <ChartCard title="Batters: runs against strike rate" subtitle="Anchors sit to the left, hitters to the right; big run-scorers are high up. Batters with 12+ balls.">
      <Scatter dots={dots} xLabel="strike rate" yLabel="runs" avgX={(runs * 100) / balls} avgLabel="team" onOpen={onOpen} name="Runs against strike rate" />
    </ChartCard>
  )
}

/** Wickets against economy, with each bowler's dot-ball share beside it. */
export function BowlScatter({ careers, files, side, onOpen }: { careers: Career[]; files: ScoreFile[]; side: SideKey; onOpen: (id: string) => void }) {
  const { personName } = useApp()
  const dots = useMemo(() => bowlerDots(files, side), [files, side])
  const rows = careers.filter((c) => c.bowl.balls >= 12)
  if (rows.length < 2) return null
  const points: Dot[] = rows.map((c) => {
    const eco = (c.bowl.runs * 6) / c.bowl.balls
    return { id: c.id, label: first(personName(c.id)), x: eco, y: c.bowl.wickets, size: c.bowl.balls, tip: `${personName(c.id)}: ${c.bowl.wickets} wickets, economy ${eco.toFixed(2)} (${Math.floor(c.bowl.balls / 6)}.${c.bowl.balls % 6} overs)` }
  })
  const runs = rows.reduce((s, c) => s + c.bowl.runs, 0)
  const balls = rows.reduce((s, c) => s + c.bowl.balls, 0)
  const table = rows
    .map((c) => ({ c, d: dots.get(c.id) }))
    .filter((x): x is { c: Career; d: { dots: number; balls: number } } => !!x.d && x.d.balls > 0)
    .map(({ c, d }) => ({ id: c.id, pct: Math.round((d.dots * 100) / d.balls), dots: d.dots, balls: d.balls }))
    .sort((a, b) => b.pct - a.pct)
  return (
    <ChartCard title="Bowlers: wickets against economy" subtitle="Tight and wicket-taking is bottom-right to top-left. Bowlers with 2+ overs.">
      <Scatter dots={points} xLabel="economy (runs per over)" yLabel="wickets" avgX={(runs * 6) / balls} avgLabel="team" onOpen={onOpen} name="Wickets against economy" />
      <p className="mb-1 mt-3 text-sm font-semibold">Dot-ball share</p>
      <div className="divide-y divide-line">
        {table.map((r) => (
          <button key={r.id} type="button" className="flex w-full items-center gap-2 py-1.5 text-sm active:bg-alt" onClick={() => onOpen(r.id)}>
            <span className="min-w-0 flex-1 truncate text-left">{personName(r.id)}</span>
            <span className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-alt">
              <span className="block h-full rounded-full" style={{ width: `${r.pct}%`, background: 'var(--series-1)' }} />
            </span>
            <strong className="w-10 text-right">{r.pct}%</strong>
            <span className="w-14 text-right text-xs text-muted">
              {r.dots}/{r.balls}
            </span>
          </button>
        ))}
      </div>
    </ChartCard>
  )
}

// ---------- player × phase heatmap ----------
const MIN_CELL = 6

function Heat({ title, note, head, rows, lowIsGood }: { title: string; note: string; head: string[]; rows: { id: string; cells: (number | null)[] }[]; lowIsGood?: boolean }) {
  const { personName } = useApp()
  const vals = rows.flatMap((r) => r.cells).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const shade = (v: number) => {
    const t = hi === lo ? 0.5 : (v - lo) / (hi - lo)
    return `color-mix(in srgb, var(--series-1) ${Math.round(12 + t * 58)}%, transparent)`
  }
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mb-1 text-xs text-muted">{note}</p>
      <table className="w-full table-fixed border-separate border-spacing-0.5 text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="w-[34%] text-left font-semibold" />
            {head.map((h) => (
              <th key={h} className="font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="truncate pr-1">{personName(r.id)}</td>
              {r.cells.map((v, i) => (
                <td key={i} className="rounded py-2 text-center font-medium" style={{ background: v === null ? 'transparent' : shade(v) }} aria-label={v === null ? 'not enough balls' : `${head[i]} ${v.toFixed(1)}`}>
                  {v === null ? <span className="text-muted">–</span> : v.toFixed(1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {lowIsGood && <p className="mt-1 text-[11px] text-muted">Darker = more runs conceded per over.</p>}
    </div>
  )
}

/** Batting strike rate and bowling economy for each player in the powerplay, middle and death overs. */
export function PhaseHeat({ careers, files }: { careers: Career[]; files: ScoreFile[] }) {
  const prof = useMemo(() => careers.map((c) => ({ id: c.id, runs: c.bat.runs, wkts: c.bowl.wickets, p: phaseProfile(files, c.id).filter((x) => x.key !== 'all') })), [careers, files])
  const head = prof[0]?.p.map((x) => x.label) ?? []
  const bat = prof
    .map((x) => ({ id: x.id, sort: x.runs, cells: x.p.map((q) => (q.bat.balls >= MIN_CELL ? (q.bat.runs * 100) / q.bat.balls : null)) }))
    .filter((r) => r.cells.some((v) => v !== null))
    .sort((a, b) => b.sort - a.sort)
  const bowl = prof
    .map((x) => ({ id: x.id, sort: x.wkts, cells: x.p.map((q) => (q.bowl.balls >= MIN_CELL ? (q.bowl.runs * 6) / q.bowl.balls : null)) }))
    .filter((r) => r.cells.some((v) => v !== null))
    .sort((a, b) => b.sort - a.sort)
  if (head.length === 0 || bat.length + bowl.length === 0) return null
  return (
    <ChartCard title="Who does well in which phase" subtitle={`Each player's rate in the powerplay, middle and death overs. A phase needs ${MIN_CELL}+ balls to show.`}>
      <div className="flex flex-col gap-5">
        <Heat title="Batting strike rate" note="Runs per 100 balls. Darker = faster." head={head} rows={bat} />
        <Heat title="Bowling economy" note="Runs per over." head={head} rows={bowl} lowIsGood />
      </div>
    </ChartCard>
  )
}

// ---------- extras conceded ----------
/** Wides and no-balls bowled in each match, oldest first. */
export function ExtrasTrend({ files, matches, side }: { files: ScoreFile[]; matches: Match[]; side: SideKey }) {
  const pts = useMemo(() => extrasConceded(files, matches, side), [files, matches, side])
  if (pts.length === 0) return null
  const wides = pts.reduce((s, p) => s + p.wides, 0)
  const nbs = pts.reduce((s, p) => s + p.noBalls, 0)
  return (
    <ChartCard title={side === 'home' ? 'Extras we bowl' : 'Extras they bowl'} subtitle={`${wides} wide${wides === 1 ? '' : 's'} and ${nbs} no-ball${nbs === 1 ? '' : 's'} in ${pts.length} match${pts.length === 1 ? '' : 'es'}`}>
      <TrendBars
        slot={otherSlot(side)}
        unit="matches"
        points={pts.map((p) => ({ label: p.date ? fmtDayMonth(p.date).replace(/\s/g, '') : '', value: p.total, note: `vs ${p.opponent}: ${p.wides} wides, ${p.noBalls} no-balls` }))}
      />
    </ChartCard>
  )
}

// ---------- batting first, chasing and the toss ----------
const pct = (won: number, played: number) => (played > 0 ? Math.round((won * 100) / played) : null)

/** Win rate for batting first, chasing and the toss, as bars. */
export function FirstVsChaseChart({ fc, side }: { fc: FirstVsChase; side: SideKey }) {
  const rows = [
    { label: 'Batting first', w: fc.battingFirst, avg: fc.battingFirst.avgRuns },
    { label: 'Chasing', w: fc.chasing, avg: fc.chasing.avgRuns },
    { label: 'Won the toss', w: fc.tossWon, avg: null },
    { label: 'Lost the toss', w: fc.tossLost, avg: null },
  ]
  return (
    <ChartCard title="Batting first, chasing and the toss" subtitle="Share of matches won">
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const p = pct(r.w.won, r.w.played)
          return (
            <div key={r.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted">
                  {r.w.won} of {r.w.played} won{r.avg !== null ? ` · avg ${Math.round(r.avg)} runs` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-r bg-alt">
                  <span className="block h-full rounded-r" style={{ width: `${p ?? 0}%`, minWidth: p ? 3 : 0, background: `var(--series-${slotOf(side)})` }} />
                </span>
                <strong className="w-10 text-right text-sm">{p === null ? '–' : `${p}%`}</strong>
              </div>
            </div>
          )
        })}
      </div>
    </ChartCard>
  )
}
