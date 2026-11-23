// Small building blocks for a player's analysis tabs: stat tiles, a one-line
// insight, a plain table, vertical bars with a tap-to-read line, and the
// "average innings" line (runs against balls faced).
import { useState, type ReactNode } from 'react'

/** Big number, small label — the overall-stats and current-form grids. */
export function Tiles({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <div className={`grid gap-2 ${cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-alt px-2 py-2.5 text-center">
          <p className="text-lg font-bold leading-tight">{value}</p>
          <p className="mt-0.5 text-[11px] leading-tight text-muted">{label}</p>
        </div>
      ))}
    </div>
  )
}

/** One finding, with the key part in bold: "Plays 45% dot balls against **Right-arm fast**". */
export function Insight({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border-l-4 border-brand bg-alt px-3 py-2 text-sm">{children}</p>
}

export function Insights({ items }: { items: (ReactNode | null | false | undefined)[] }) {
  const shown = items.filter(Boolean)
  if (!shown.length) return null
  return (
    <div className="mt-3 flex flex-col gap-2">
      {shown.map((x, i) => (
        <Insight key={i}>{x}</Insight>
      ))}
    </div>
  )
}

export function DataTable({ head, rows, note }: { head: string[]; rows: ReactNode[][]; note?: string }) {
  if (!rows.length) return <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              {head.map((h, i) => (
                <th key={h} className={`whitespace-nowrap px-1.5 py-1.5 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, n) => (
              <tr key={n}>
                {r.map((c, i) => (
                  <td key={i} className={`whitespace-nowrap px-1.5 py-2 ${i === 0 ? 'text-left font-medium' : 'text-right'}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  )
}

const CW = 340
const CH = 170
const CM = { l: 30, r: 8, t: 16, b: 22 }

function niceMax(v: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) if (v / s <= 4) return s * Math.max(1, Math.ceil(v / s))
  return Math.ceil(v)
}

export interface Bar {
  label: string
  value: number
  /** What a tap shows. */
  note?: string
  color?: string
}

/** Vertical bars with the value above each; tap a bar to read its note. */
export function Bars({ bars, idle, color = 'var(--series-1)', axis }: { bars: Bar[]; idle?: string; color?: string; axis?: string }) {
  const [at, setAt] = useState<number | null>(null)
  if (bars.every((b) => b.value === 0)) return <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
  const max = niceMax(Math.max(1, ...bars.map((b) => b.value)))
  const pw = CW - CM.l - CM.r
  const ph = CH - CM.t - CM.b
  const slot = pw / bars.length
  const bw = Math.min(34, Math.max(4, slot * 0.62))
  const fmtV = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
  return (
    <div>
      {(idle || bars.some((b) => b.note)) && <p className="min-h-[20px] text-sm text-muted">{at !== null ? (bars[at].note ?? `${bars[at].label}: ${fmtV(bars[at].value)}`) : (idle ?? 'Tap a bar to read it.')}</p>}
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        className="w-full touch-pan-y select-none"
        role="img"
        aria-label={bars.map((b) => `${b.label} ${fmtV(b.value)}`).join(', ')}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.floor(((((e.clientX - r.left) / r.width) * CW - CM.l) / pw) * bars.length)
          setAt(i >= 0 && i < bars.length ? i : null)
        }}
        onPointerLeave={() => setAt(null)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.floor(((((e.clientX - r.left) / r.width) * CW - CM.l) / pw) * bars.length)
          setAt(i >= 0 && i < bars.length && i !== at ? i : null)
        }}
      >
        <g fontSize="9" fill="rgb(var(--text-muted))">
          {[0, max / 2, max].map((s) => {
            const y = CM.t + ph - (s / max) * ph
            return (
              <g key={s}>
                <line x1={CM.l} x2={CW - CM.r} y1={y} y2={y} stroke="var(--grid)" />
                <text x={CM.l - 4} y={y + 3} textAnchor="end">
                  {fmtV(s)}
                </text>
              </g>
            )
          })}
        </g>
        {at !== null && <rect x={CM.l + at * slot} y={CM.t} width={slot} height={ph} fill="rgb(var(--text))" opacity="0.07" />}
        {bars.map((b, i) => {
          const h = (b.value / max) * ph
          const x = CM.l + i * slot + (slot - bw) / 2
          const y = CM.t + ph - h
          const r = Math.min(3, bw / 2, h)
          return (
            <g key={i}>
              {h > 0 && <path d={`M${x},${CM.t + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${CM.t + ph} Z`} fill={b.color ?? color} opacity={at !== null && at !== i ? 0.45 : 1} />}
              <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgb(var(--text))">
                {b.value > 0 ? fmtV(b.value) : ''}
              </text>
              <text x={CM.l + i * slot + slot / 2} y={CH - CM.b + 12} textAnchor="middle" fontSize="9" fill="rgb(var(--text-muted))">
                {b.label}
              </text>
            </g>
          )
        })}
      </svg>
      {axis && <p className="-mt-1 text-center text-[11px] text-muted">{axis}</p>}
    </div>
  )
}

/** Average runs after each ball faced, as a line; a guide marks ball `mark` (e.g. 15). */
export function ProgressChart({ values, mark }: { values: number[]; mark?: number }) {
  const [at, setAt] = useState<number | null>(null)
  if (values.length < 2) return <p className="py-3 text-center text-sm text-muted">Needs a few more innings</p>
  const n = values.length
  const max = niceMax(Math.max(1, ...values))
  const pw = CW - CM.l - CM.r
  const ph = CH - CM.t - CM.b
  const px = (i: number) => CM.l + (i / Math.max(1, n - 1)) * pw
  const py = (v: number) => CM.t + ph - (v / max) * ph
  const step = n <= 12 ? 2 : n <= 30 ? 5 : 10
  const ticks: number[] = []
  for (let b = step; b <= n; b += step) ticks.push(b)
  const pick = (e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((((e.clientX - r.left) / r.width) * CW - CM.l) / pw) * (n - 1))
    return i >= 0 && i < n ? i : null
  }
  return (
    <div>
      <p className="min-h-[20px] text-sm text-muted">{at !== null ? `After ${at + 1} ball${at ? 's' : ''}: ${values[at].toFixed(1)} runs on average` : 'Tap the line to read a ball.'}</p>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full touch-pan-y select-none" role="img" aria-label="Average runs against balls faced" onPointerMove={(e) => e.pointerType === 'mouse' && setAt(pick(e))} onPointerLeave={() => setAt(null)} onClick={(e) => setAt(pick(e))}>
        <g fontSize="9" fill="rgb(var(--text-muted))">
          {[0, max / 2, max].map((s) => (
            <g key={s}>
              <line x1={CM.l} x2={CW - CM.r} y1={py(s)} y2={py(s)} stroke="var(--grid)" />
              <text x={CM.l - 4} y={py(s) + 3} textAnchor="end">
                {s}
              </text>
            </g>
          ))}
          {ticks.map((b) => (
            <text key={b} x={px(b - 1)} y={CH - 8} textAnchor="middle">
              {b}
            </text>
          ))}
          <text x={CW - CM.r} y={CH - 0.5} textAnchor="end" fontSize="8">
            balls faced
          </text>
        </g>
        {mark && mark <= n && <line x1={px(mark - 1)} x2={px(mark - 1)} y1={CM.t} y2={CM.t + ph} stroke="rgb(var(--text-muted))" strokeDasharray="3 3" />}
        <path d={`M${values.map((v, i) => `${px(i)},${py(v)}`).join(' L')}`} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {at !== null && <circle cx={px(at)} cy={py(values[at])} r="4" fill="var(--series-1)" stroke="rgb(var(--surface))" strokeWidth="2" />}
      </svg>
    </div>
  )
}

/** Card with a title, an optional line under it, and the filters / content. */
export function Panel({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="font-semibold">{title}</h3>
      {sub && <p className="text-sm text-muted">{sub}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** Chips that sit in one sideways-scrolling row (filters inside a card). */
export function FilterChips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button key={o.value} className={`min-h-[32px] shrink-0 rounded-full border px-3 text-xs ${value === o.value ? 'border-ink bg-ink font-semibold text-bg' : 'border-line text-muted'}`} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
