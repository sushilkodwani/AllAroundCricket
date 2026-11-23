// Match analysis visuals: partnership cards, the wickets donut and the large wagon wheel.
import { useId, useState } from 'react'
import { wagonSlices } from '../lib/analysis'
import { mins, pairKey } from '../lib/minutes'
import { BATTER_POS, type Partnership } from '../lib/scorecard'
import { WICKET_LABELS, type WicketKind } from '../types'
import { Avatar } from './ui'

// ---------- partnerships ----------
function ScoreBox({ label, score, wickets, over, right }: { label: string; score: number; wickets: number; over?: string; right?: boolean }) {
  return (
    <div className={`min-w-0 flex-1 rounded-xl bg-alt px-3 py-2 ${right ? 'text-right' : ''}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="truncate">
        <span className="font-semibold">
          {score}/{wickets}
        </span>
        {over !== undefined && <span className="text-sm text-muted"> {over} ov</span>}
      </div>
    </div>
  )
}

/** One card per stand: both batters with their share, the stand in the middle, and the score it began and ended at. */
export function PartnershipCards({ partnerships, name, color, minutes }: { partnerships: Partnership[]; name: (id: string) => string; color?: string; minutes?: Map<string, number> }) {
  if (partnerships.length === 0) return <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
  const max = Math.max(1, ...partnerships.map((p) => Math.max(p.aRuns, p.bRuns)))
  return (
    <div className="flex flex-col gap-3">
      {partnerships.map((p, n) => (
        <div key={n} className="rounded-2xl border border-line p-3">
          <div className="flex items-center gap-2">
            <Avatar name={name(p.a)} personId={p.a} color={color} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{name(p.a)}</div>
              <div className="text-sm">
                {p.aRuns} <span className="text-muted">({p.aBalls})</span>
              </div>
            </div>
            <div className="shrink-0 px-1 text-center">
              <div className="text-lg font-bold leading-tight">
                {p.runs}
                {p.unbroken ? '*' : ''}
              </div>
              <div className="text-xs text-muted">({p.balls})</div>
              {minutes?.has(pairKey(p.a, p.b)) && <div className="text-xs text-muted">{mins(minutes.get(pairKey(p.a, p.b))!)} min</div>}
            </div>
            <div className="min-w-0 flex-1 text-right">
              <div className="truncate text-sm font-medium">{name(p.b)}</div>
              <div className="text-sm">
                {p.bRuns} <span className="text-muted">({p.bBalls})</span>
              </div>
            </div>
            <Avatar name={name(p.b)} personId={p.b} color={color} size={40} />
          </div>
          {/* Each batter's runs grow out from the middle: left batter to the left, right batter to the right. */}
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-alt" aria-hidden="true">
            <div className="flex flex-1 justify-end">
              <div className="h-full rounded-l-full" style={{ width: `${(p.aRuns / max) * 100}%`, background: 'var(--series-1)' }} />
            </div>
            <div className="w-0.5 bg-surface" />
            <div className="flex-1">
              <div className="h-full rounded-r-full" style={{ width: `${(p.bRuns / max) * 100}%`, background: 'var(--series-2)' }} />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <ScoreBox label="Start" score={p.start.score} wickets={p.start.wickets} over={p.start.over} />
            <span className="shrink-0 text-muted" aria-hidden="true">
              ›
            </span>
            <ScoreBox label={p.unbroken ? 'Now (not out)' : 'End'} score={p.end.score} wickets={p.end.wickets} over={p.end.over} right />
          </div>
        </div>
      ))}
      <p className="text-xs text-muted">Runs (balls). Extras count in the stand’s total but not in either batter’s share. * = still batting.{minutes ? ' Minutes come from when each ball was entered.' : ''}</p>
    </div>
  )
}

// ---------- wickets donut ----------
const KIND_ORDER = Object.keys(WICKET_LABELS) as WicketKind[]
/** Each way of getting out keeps its own colour in every match. */
export const kindColor = (k: WicketKind) => `var(--series-${(KIND_ORDER.indexOf(k) % 8) + 1})`

const point = (deg: number, r: number): [number, number] => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r]

function arc(from: number, to: number, outer: number, inner: number): string {
  const big = to - from > 180 ? 1 : 0
  const [x1, y1] = point(from, outer)
  const [x2, y2] = point(to, outer)
  const [x3, y3] = point(to, inner)
  const [x4, y4] = point(from, inner)
  return `M${x1},${y1} A${outer},${outer} 0 ${big} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${big} 0 ${x4},${y4} Z`
}

/** How the wickets fell, as a ring with the total in the middle. Tap a slice or a legend row to read it. */
export function WicketDonut({ kinds }: { kinds: Partial<Record<WicketKind, number>> }) {
  const rows = KIND_ORDER.filter((k) => (kinds[k] ?? 0) > 0)
    .map((k) => ({ kind: k, value: kinds[k]!, label: WICKET_LABELS[k] }))
    .sort((a, b) => b.value - a.value)
  const [active, setActive] = useState<WicketKind | null>(null)
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (total === 0) return <p className="py-3 text-center text-sm text-muted">No wickets yet</p>
  let at = 0
  const pick = rows.find((r) => r.kind === active)
  return (
    <div>
      <p className="min-h-[20px] text-sm text-muted">{pick ? `${pick.label}: ${pick.value} of ${total} (${Math.round((pick.value / total) * 100)}%)` : 'Tap a slice to read it.'}</p>
      <div className="mt-1 flex items-center gap-4">
        <svg viewBox="-1.05 -1.05 2.1 2.1" className="w-[44%] max-w-[200px] shrink-0" role="img" aria-label={`Wickets: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}>
          {rows.length === 1 ? (
            <path d={`${arc(0, 180, 1, 0.58)} ${arc(180, 359.999, 1, 0.58)}`} fill={kindColor(rows[0].kind)} onClick={() => setActive(rows[0].kind)} />
          ) : (
            rows.map((r) => {
              const from = at
              at += (r.value / total) * 360
              return (
                <path
                  key={r.kind}
                  d={arc(from, at, 1, 0.58)}
                  fill={kindColor(r.kind)}
                  stroke="rgb(var(--surface))"
                  strokeWidth="0.04"
                  opacity={active && active !== r.kind ? 0.35 : 1}
                  onClick={() => setActive(active === r.kind ? null : r.kind)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(r.kind)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
                  className="cursor-pointer"
                />
              )
            })
          )}
          <text y="0.02" textAnchor="middle" fontSize="0.42" fontWeight="700" fill="rgb(var(--text))">
            {total}
          </text>
          <text y="0.3" textAnchor="middle" fontSize="0.16" fill="rgb(var(--text-muted))">
            {total === 1 ? 'wicket' : 'wickets'}
          </text>
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.kind}>
              <button className={`flex w-full items-center gap-2 text-left ${active && active !== r.kind ? 'opacity-50' : ''}`} onClick={() => setActive(active === r.kind ? null : r.kind)}>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: kindColor(r.kind) }} />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="font-semibold">{r.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------- wagon wheel ----------
export interface WheelShot {
  shot: [number, number]
  runs: number
}
type Show = 'all' | 'small' | 'fours' | 'sixes' | 'outs'

/** Line colour by shot size: 1s–3s, fours, sixes. */
export const shotColor = (runs: number) => (runs === 6 ? 'var(--series-2)' : runs === 4 ? 'var(--series-1)' : 'rgb(var(--text) / 0.75)')

/**
 * A large wagon wheel: every recorded shot (1s–3s when the scorer marked them, fours, sixes) and catch,
 * with the share of those runs that went into each 45° slice. Filters below it.
 */
export function WagonWheel({ shots, outs = [], left = false }: { shots: WheelShot[]; outs?: [number, number][]; left?: boolean }) {
  const [show, setShow] = useState<Show>('all')
  const clip = useId().replace(/:/g, '')
  const [bx, by] = BATTER_POS
  const flip = left ? -1 : 1
  // A point at angle d (leg positive) and distance r from the batter, as the screen sees it.
  const dir = (d: number, r: number): [number, number] => [bx + Math.sin((d * Math.PI) / 180) * r * flip, by + Math.cos((d * Math.PI) / 180) * r]

  const small = shots.filter((s) => s.runs < 4)
  const fours = shots.filter((s) => s.runs === 4)
  const sixes = shots.filter((s) => s.runs === 6)
  const lines = show === 'small' ? small : show === 'fours' ? fours : show === 'sixes' ? sixes : show === 'outs' ? [] : shots
  const marks = show === 'all' || show === 'outs' ? outs : []
  const { pct } = wagonSlices(lines, left)
  const top = lines.length ? pct.indexOf(Math.max(...pct)) : -1

  const chips: { key: Show; label: string; dot: string; n: number }[] = [
    { key: 'all', label: 'All', dot: 'rgb(var(--text))', n: shots.length + outs.length },
    ...(small.length ? [{ key: 'small' as Show, label: '1s–3s', dot: 'rgb(var(--text) / 0.75)', n: small.length }] : []),
    { key: 'fours', label: 'Fours', dot: 'var(--series-1)', n: fours.length },
    { key: 'sixes', label: 'Sixes', dot: 'var(--series-2)', n: sixes.length },
    ...(outs.length ? [{ key: 'outs' as Show, label: 'Caught at', dot: 'rgb(var(--danger))', n: outs.length }] : []),
  ]

  return (
    <div>
      <svg viewBox="-1.09 -1.09 2.18 2.18" className="-mx-1 block w-[calc(100%+0.5rem)] select-none" role="img" aria-label={`Wagon wheel: ${small.length ? `${small.length} other scoring shots, ` : ''}${fours.length} fours, ${sixes.length} sixes`}>
        <circle r="1.07" fill="var(--field)" stroke="var(--series-4)" strokeWidth="0.02" />
        <circle r="0.97" fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="0.012" />
        <clipPath id={clip}>
          <circle r="0.97" />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          {/* the busiest slice */}
          {top >= 0 && pct[top] > 0 && (
            <polygon points={`${bx},${by} ${dir(-180 + 45 * top, 3).join(',')} ${dir(-135 + 45 * top, 3).join(',')}`} fill="var(--series-1)" opacity="0.14" />
          )}
          {[-135, -90, -45, 0, 45, 90, 135, 180].map((d) => {
            const p = dir(d, 3)
            return <line key={d} x1={bx} y1={by} x2={p[0]} y2={p[1]} stroke="#fff" strokeOpacity="0.45" strokeWidth="0.007" />
          })}
          {[...lines].sort((a, b) => a.runs - b.runs).map((s, i) => (
            <line key={i} x1={bx} y1={by} x2={s.shot[0]} y2={s.shot[1]} stroke={shotColor(s.runs)} strokeWidth={s.runs < 4 ? 0.011 : 0.014} strokeLinecap="round" />
          ))}
          {marks.map((m, i) => (
            <g key={`o${i}`}>
              <line x1={bx} y1={by} x2={m[0]} y2={m[1]} stroke="rgb(var(--danger))" strokeWidth="0.012" strokeDasharray="0.03 0.025" />
              <g stroke="rgb(var(--danger))" strokeWidth="0.024" strokeLinecap="round">
                <line x1={m[0] - 0.035} y1={m[1] - 0.035} x2={m[0] + 0.035} y2={m[1] + 0.035} />
                <line x1={m[0] - 0.035} y1={m[1] + 0.035} x2={m[0] + 0.035} y2={m[1] - 0.035} />
              </g>
            </g>
          ))}
        </g>
        <circle r="0.5" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.008" />
        <rect x="-0.055" y="-0.2" width="0.11" height="0.4" rx="0.01" fill="var(--pitch)" />
        <circle cx={bx} cy={by} r="0.03" fill="rgb(var(--text))" />
        <g textAnchor="middle" fontWeight="600" stroke="var(--field)" strokeWidth="0.03" paintOrder="stroke">
          {lines.length > 0 &&
            pct.map((v, i) => {
              const [x, y] = dir(-157.5 + 45 * i, 0.62)
              return (
                <text key={i} x={x} y={y + 0.03} fontSize={i === top ? 0.1 : 0.085} fontWeight={i === top ? 800 : 600} fill="rgb(var(--text))">
                  {v}%
                </text>
              )
            })}
          <text x={dir(-90, 0.3)[0]} y={by + 0.02} fontSize="0.07" fill="rgb(var(--text-muted))">
            Off
          </text>
          <text x={dir(90, 0.3)[0]} y={by + 0.02} fontSize="0.07" fill="rgb(var(--text-muted))">
            Leg
          </text>
        </g>
      </svg>
      <p className="mt-1 text-center text-xs text-muted">
        {show === 'outs' ? 'Where catches were taken (✕).' : `Share of ${show === 'small' ? 'runs in 1s, 2s and 3s' : show === 'fours' ? 'runs in fours' : show === 'sixes' ? 'runs in sixes' : small.length ? 'runs' : 'boundary runs'} in each slice. Bowler’s end at the bottom.`}
      </p>
      <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Show">
        {chips.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={show === c.key}
            className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm ${show === c.key ? 'border-ink font-semibold' : 'border-line text-muted'}`}
            onClick={() => setShow(c.key)}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: c.dot }} />
            {c.label} <span className="text-muted">{c.n}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

