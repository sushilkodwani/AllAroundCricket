// Match analysis charts (PLAN §26), drawn as plain SVG. Colour follows the
// team in every chart: our side = series 1 (blue), the opponent = series 2
// (orange). Text always uses the app's text colours, never a series colour.
import { useState, type ReactNode } from 'react'

export interface Series {
  name: string
  /** 1 = our team, 2 = the opponent. */
  slot: 1 | 2
  /** One value per over (index 0 = over 1). */
  values: number[]
  /** Wickets that fell in each over, for the markers. */
  wickets?: number[]
}

const color = (slot: 1 | 2) => `var(--series-${slot})`
const W = 340
const H = 190
const M = { l: 30, r: 10, t: 10, b: 24 }
const PW = W - M.l - M.r
const PH = H - M.t - M.b

/** Round tick step so the axis shows at most five clean values above zero. */
function niceStep(v: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) if (v / s <= 5) return s
  return 1000
}
const niceMax = (v: number): number => niceStep(v) * Math.max(1, Math.ceil(v / niceStep(v)))

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="font-semibold">{title}</h3>
      {subtitle && <p className="min-h-[20px] text-sm text-muted">{subtitle}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

export function Legend({ items }: { items: { name: string; slot: 1 | 2 }[] }) {
  if (items.length < 2) return null
  return (
    <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((s) => (
        <span key={s.slot} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(s.slot) }} />
          {s.name}
        </span>
      ))}
    </div>
  )
}

function Axes({ max, overs }: { max: number; overs: number }) {
  const tickStep = niceStep(max)
  const ticks: number[] = []
  for (let t = 0; t <= max + 1e-9; t += tickStep) ticks.push(t)
  const step = overs <= 10 ? 1 : overs <= 20 ? 2 : overs <= 30 ? 5 : 10
  const xs: number[] = []
  for (let o = step; o <= overs; o += step) xs.push(o)
  if (step > 1 && xs[0] !== 1) xs.unshift(1)
  return (
    <g fontSize="9" fill="rgb(var(--text-muted))">
      {ticks.map((t) => {
        const y = M.t + PH - (t / max) * PH
        return (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" />
            <text x={M.l - 4} y={y + 3} textAnchor="end">
              {t}
            </text>
          </g>
        )
      })}
      {xs.map((o) => (
        <text key={o} x={M.l + ((o - 0.5) / overs) * PW} y={H - 8} textAnchor="middle">
          {o}
        </text>
      ))}
      <text x={W - M.r} y={H - 0.5} textAnchor="end" fontSize="8">
        overs
      </text>
    </g>
  )
}

/** Tap or hover anywhere on the plot to read one over. */
function useOverProbe(overs: number) {
  const [over, setOver] = useState<number | null>(null)
  const probe = {
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - r.left) / r.width) * W
      const o = Math.floor(((x - M.l) / PW) * overs)
      setOver(o >= 0 && o < overs ? o : null)
    },
    onPointerLeave: () => setOver(null),
  }
  const band = over === null ? null : <rect x={M.l + (over / overs) * PW} y={M.t} width={PW / overs} height={PH} fill="rgb(var(--text))" opacity="0.07" />
  return { over, probe, band }
}

const readout = (series: Series[], over: number | null, fmt: (v: number) => string, idle: string) =>
  over === null
    ? idle
    : `Over ${over + 1}: ` +
      series
        .filter((s) => s.values[over] !== undefined)
        .map((s) => `${s.name} ${fmt(s.values[over])}${s.wickets?.[over] ? ` (${s.wickets[over]} wkt)` : ''}`)
        .join(' · ')

/** Runs per over as columns; a dot above a column for each wicket in that over. */
export function Manhattan({ series }: { series: Series[] }) {
  const overs = Math.max(1, ...series.map((s) => s.values.length))
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)))
  const { over, probe, band } = useOverProbe(overs)
  const slotW = PW / overs
  const barW = Math.max(1.5, Math.min(24, (slotW - 2) / series.length - (series.length > 1 ? 1 : 0)))
  return (
    <ChartCard title="Runs per over" subtitle={readout(series, over, (v) => `${v}`, 'Tap an over to see its runs. ● = wicket')}>
      <Legend items={series} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label="Runs per over" {...probe}>
        <Axes max={max} overs={overs} />
        {band}
        {series.map((s, si) =>
          s.values.map((v, i) => {
            const h = (v / max) * PH
            const x = M.l + i * slotW + (slotW - barW * series.length - (series.length - 1)) / 2 + si * (barW + 1)
            const y = M.t + PH - h
            const r = Math.min(2, barW / 2, h)
            return (
              <g key={`${si}-${i}`}>
                {h > 0 && <path d={`M${x},${M.t + PH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${M.t + PH} Z`} fill={color(s.slot)} />}
                {Array.from({ length: s.wickets?.[i] ?? 0 }, (_, w) => (
                  <circle key={w} cx={x + barW / 2} cy={y - 5 - w * 7} r="2.6" fill="rgb(var(--text))" stroke="rgb(var(--surface))" strokeWidth="1" />
                ))}
              </g>
            )
          }),
        )}
      </svg>
    </ChartCard>
  )
}

/** One line per innings; `values[i]` is the value at the end of over i+1. */
/** pace draws a thin straight guide from 0 to 	o over overs overs (the chase's required pace). */
export function LineChart({ title, series, decimals = 0, idle, fromZero = true, pace }: { title: string; series: Series[]; decimals?: number; idle: string; fromZero?: boolean; pace?: { label: string; to: number; overs: number } }) {
  const overs = Math.max(1, pace?.overs ?? 0, ...series.map((s) => s.values.length))
  const max = niceMax(Math.max(1, pace?.to ?? 0, ...series.flatMap((s) => s.values)))
  const { over, probe, band } = useOverProbe(overs)
  const px = (i: number) => M.l + ((i + 0.5) / overs) * PW
  const py = (v: number) => M.t + PH - (v / max) * PH
  return (
    <ChartCard title={title} subtitle={readout(series, over, (v) => (decimals ? v.toFixed(decimals) : `${v}`), idle)}>
      <Legend items={series} />
      {pace && (
        <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <span className="h-px w-4 bg-muted" />
          {pace.label}
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label={title} {...probe}>
        <Axes max={max} overs={overs} />
        {band}
        {pace && <line x1={M.l} y1={py(0)} x2={M.l + (pace.overs / overs) * PW} y2={py(pace.to)} stroke="rgb(var(--text-muted))" strokeWidth="1" />}
        {series.map((s) => {
          if (s.values.length === 0) return null
          const pts = s.values.map((v, i) => `${px(i)},${py(v)}`)
          const d = `M${fromZero ? `${M.l},${py(0)} L` : ''}${pts.join(' L')}`
          const last = s.values.length - 1
          return (
            <g key={s.slot}>
              <path d={d} fill="none" stroke={color(s.slot)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) =>
                s.wickets?.[i] ? <circle key={i} cx={px(i)} cy={py(v)} r="3.2" fill="rgb(var(--text))" stroke="rgb(var(--surface))" strokeWidth="1.5" /> : null,
              )}
              <circle cx={px(last)} cy={py(s.values[last])} r="4" fill={color(s.slot)} stroke="rgb(var(--surface))" strokeWidth="2" />
              {over !== null && s.values[over] !== undefined && over !== last && <circle cx={px(over)} cy={py(s.values[over])} r="4" fill={color(s.slot)} stroke="rgb(var(--surface))" strokeWidth="2" />}
            </g>
          )
        })}
      </svg>
    </ChartCard>
  )
}

/** Horizontal bars with the value at the tip — for counts with names (shot sizes, wicket types). */
export function BarList({ rows, slot }: { rows: { label: string; value: number }[]; slot: 1 | 2 }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.every((r) => r.value === 0)) return <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate text-muted">{r.label}</span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="h-3.5 rounded-r" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 3 : 0, maxWidth: 'calc(100% - 28px)', background: color(slot) }} />
            <span className="font-medium">{r.value}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
