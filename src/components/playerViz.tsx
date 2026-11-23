// Small building blocks for a player's analysis tabs: stat tiles, a one-line
// insight, a plain table, vertical bars with a tap-to-read line, and the
// "average innings" line (runs against balls faced).
import { useState, type ReactNode } from 'react'
import { Avatar, Sheet } from './ui'

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

/** Average runs after each ball faced, as a line (two lines when comparing); a guide marks ball `mark` (e.g. 15). */
export function ProgressChart({ values, second, names, mark }: { values: number[]; second?: number[]; names?: [string, string]; mark?: number }) {
  const [at, setAt] = useState<number | null>(null)
  const lines = [values, ...(second ? [second] : [])]
  if (lines.every((l) => l.length < 2)) return <p className="py-3 text-center text-sm text-muted">Needs a few more innings</p>
  const n = Math.max(...lines.map((l) => l.length))
  const max = niceMax(Math.max(1, ...lines.flat()))
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
  const read = (i: number) =>
    second && names
      ? `After ${i + 1} ball${i ? "s" : ""}: ` + lines.map((l, k) => `${names[k]} ${l[i] !== undefined ? l[i].toFixed(1) : "–"}`).join(" · ")
      : `After ${i + 1} ball${i ? "s" : ""}: ${values[i]?.toFixed(1) ?? "–"} runs on average`
  return (
    <div>
      {second && names && <Legend names={names} />}
      <p className="min-h-[20px] text-sm text-muted">{at !== null ? read(at) : "Tap the line to read a ball."}</p>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full touch-pan-y select-none" role="img" aria-label="Average runs against balls faced" onPointerMove={(e) => e.pointerType === "mouse" && setAt(pick(e))} onPointerLeave={() => setAt(null)} onClick={(e) => setAt(pick(e))}>
        <g fontSize="9" fill="rgb(var(--text-muted))">
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1={CM.l} x2={CW - CM.r} y1={py(v)} y2={py(v)} stroke="var(--grid)" />
              <text x={CM.l - 4} y={py(v) + 3} textAnchor="end">
                {v}
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
        {at !== null && <line x1={px(at)} x2={px(at)} y1={CM.t} y2={CM.t + ph} stroke="rgb(var(--text))" opacity="0.15" />}
        {lines.map((l, k) =>
          l.length > 1 ? (
            <g key={k}>
              <path d={`M${l.map((v, i) => `${px(i)},${py(v)}`).join(" L")}`} fill="none" stroke={SERIES[k]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {at !== null && l[at] !== undefined && <circle cx={px(at)} cy={py(l[at])} r="4" fill={SERIES[k]} stroke="rgb(var(--surface))" strokeWidth="2" />}
            </g>
          ) : null,
        )}
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

// ---------- two players side by side ----------
/** This player = series 1 (blue), the one they are compared with = series 2 (orange). */
export const SERIES = ['var(--series-1)', 'var(--series-2)'] as const

export function Legend({ names }: { names: [string, string] }) {
  return (
    <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {names.map((n, k) => (
        <span key={k} className="inline-flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[k] }} />
          <span className="truncate">{n}</span>
        </span>
      ))}
    </div>
  )
}

/** Two bars per label (blue = first player, orange = second). Tap a group to read both. */
export function PairBars({ labels, a, b, names, fmt = (v) => String(Math.round(v * 10) / 10), axis }: { labels: string[]; a: number[]; b: number[]; names: [string, string]; fmt?: (v: number) => string; axis?: string }) {
  const [at, setAt] = useState<number | null>(null)
  if ([...a, ...b].every((v) => !v)) return <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
  const max = niceMax(Math.max(1, ...a, ...b))
  const pw = CW - CM.l - CM.r
  const ph = CH - CM.t - CM.b
  const slot = pw / labels.length
  const bw = Math.min(16, Math.max(3, (slot - 6) / 2))
  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((((e.clientX - r.left) / r.width) * CW - CM.l) / pw) * labels.length)
    return i >= 0 && i < labels.length ? i : null
  }
  return (
    <div>
      <Legend names={names} />
      <p className="min-h-[20px] text-sm text-muted">{at !== null ? `${labels[at]}: ${names[0]} ${fmt(a[at] ?? 0)} · ${names[1]} ${fmt(b[at] ?? 0)}` : 'Tap a pair of bars to read them.'}</p>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full touch-pan-y select-none" role="img" aria-label={labels.map((l, i) => `${l}: ${fmt(a[i] ?? 0)} v ${fmt(b[i] ?? 0)}`).join(', ')} onClick={(e) => setAt(pick(e))} onPointerMove={(e) => e.pointerType === 'mouse' && setAt(pick(e))} onPointerLeave={() => setAt(null)}>
        <g fontSize="9" fill="rgb(var(--text-muted))">
          {[0, max / 2, max].map((v) => {
            const y = CM.t + ph - (v / max) * ph
            return (
              <g key={v}>
                <line x1={CM.l} x2={CW - CM.r} y1={y} y2={y} stroke="var(--grid)" />
                <text x={CM.l - 4} y={y + 3} textAnchor="end">
                  {fmt(v)}
                </text>
              </g>
            )
          })}
        </g>
        {at !== null && <rect x={CM.l + at * slot} y={CM.t} width={slot} height={ph} fill="rgb(var(--text))" opacity="0.07" />}
        {labels.map((l, i) => {
          const cx = CM.l + i * slot + slot / 2
          return (
            <g key={i}>
              {[a[i] ?? 0, b[i] ?? 0].map((v, k) => {
                const h = (v / max) * ph
                if (h <= 0) return null
                const x = cx + (k === 0 ? -bw - 1 : 1)
                const y = CM.t + ph - h
                const r = Math.min(2, bw / 2, h)
                return <path key={k} d={`M${x},${CM.t + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${CM.t + ph} Z`} fill={SERIES[k]} />
              })}
              <text x={cx} y={CH - CM.b + 12} textAnchor="middle" fontSize="9" fill="rgb(var(--text-muted))">
                {l}
              </text>
            </g>
          )
        })}
      </svg>
      {axis && <p className="-mt-1 text-center text-[11px] text-muted">{axis}</p>}
    </div>
  )
}

/** Mirrored bars: the first player's grow left from the middle, the second's grow right. */
export function Butterfly({ rows, names }: { rows: { label: string; a: number; b: number }[]; names: [string, string] }) {
  const shown = rows.filter((r) => r.a || r.b)
  if (!shown.length) return <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
  const max = Math.max(1, ...shown.flatMap((r) => [r.a, r.b]))
  const totals = [shown.reduce((s, r) => s + r.a, 0), shown.reduce((s, r) => s + r.b, 0)]
  return (
    <div>
      <Legend names={names} />
      <div className="mt-1 flex flex-col gap-1.5">
        {shown.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
            <div className="flex items-center justify-end gap-1.5">
              <span className="font-semibold">{r.a || ''}</span>
              <span className="h-3.5 rounded-l" style={{ width: `${(r.a / max) * 80}%`, minWidth: r.a ? 3 : 0, background: SERIES[0] }} />
            </div>
            <span className="w-24 text-center text-xs text-muted">{r.label}</span>
            <div className="flex items-center gap-1.5">
              <span className="h-3.5 rounded-r" style={{ width: `${(r.b / max) * 80}%`, minWidth: r.b ? 3 : 0, background: SERIES[1] }} />
              <span className="font-semibold">{r.b || ''}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 grid grid-cols-2 text-xs text-muted">
        <span>Total {totals[0]}</span>
        <span className="text-right">Total {totals[1]}</span>
      </p>
    </div>
  )
}

/** A figure for both players on one row, the better one in bold (`better`: which way is better). */
export function VsRows({ rows }: { rows: { label: string; a: string; b: string; av: number | null; bv: number | null; better?: 'high' | 'low' }[] }) {
  return (
    <div className="-mx-4 divide-y divide-line border-y border-line">
      {rows.map((r) => {
        const w = !r.better || r.av === null || r.bv === null || r.av === r.bv ? 0 : (r.better === 'high' ? r.av > r.bv : r.av < r.bv) ? 1 : -1
        return (
          <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2 text-sm">
            <span className={`flex items-center gap-1.5 ${w > 0 ? 'font-bold' : ''}`}>
              {r.a}
              {w > 0 && <span className="h-2 w-2 rounded-full" style={{ background: SERIES[0] }} aria-label="better" />}
            </span>
            <span className="text-center text-xs text-muted">{r.label}</span>
            <span className={`flex items-center justify-end gap-1.5 ${w < 0 ? 'font-bold' : ''}`}>
              {w < 0 && <span className="h-2 w-2 rounded-full" style={{ background: SERIES[1] }} aria-label="better" />}
              {r.b}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Full-height picker: search box over a grid of player photos (initials when there is none). */
export function PlayerPicker({ title, ids, name, value, onPick, onClose, note }: { title: string; ids: string[]; name: (id: string) => string; value?: string; onPick: (id: string) => void; onClose: () => void; note?: (id: string) => string | undefined }) {
  const [q, setQ] = useState('')
  const shown = ids.filter((id) => name(id).toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => name(a).localeCompare(name(b)))
  return (
    <Sheet title={title} onClose={onClose} full>
      <input className="input mb-3 w-full" type="search" placeholder="Search by player name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by player name" autoFocus />
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No player called “{q}”.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {shown.map((id) => (
            <button key={id} className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center active:bg-alt ${id === value ? 'border-brand bg-alt' : 'border-line'}`} onClick={() => onPick(id)} aria-pressed={id === value}>
              <Avatar name={name(id)} personId={id} size={56} />
              <span className="line-clamp-2 text-xs font-medium leading-tight">{name(id)}</span>
              {note?.(id) && <span className="text-[10px] leading-tight text-muted">{note(id)}</span>}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}

/** The two players at the top of Compare / Face off; tap the right-hand one to pick. */
export function VsHeader({ a, b, name, onPick, pickLabel }: { a: string; b?: string; name: (id: string) => string; onPick: () => void; pickLabel: string }) {
  return (
    <div className="card grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4">
      <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
        <span className="rounded-full p-0.5" style={{ boxShadow: `0 0 0 2px ${SERIES[0]}` }}>
          <Avatar name={name(a)} personId={a} size={64} />
        </span>
        <span className="line-clamp-2 text-sm font-semibold">{name(a)}</span>
      </div>
      <span className="rounded-full bg-alt px-2.5 py-1 text-xs font-bold text-muted">VS</span>
      <button className="flex min-w-0 flex-col items-center gap-1.5 text-center" onClick={onPick} aria-label={b ? `Change: ${name(b)}` : pickLabel}>
        {b ? (
          <span className="rounded-full p-0.5" style={{ boxShadow: `0 0 0 2px ${SERIES[1]}` }}>
            <Avatar name={name(b)} personId={b} size={64} />
          </span>
        ) : (
          <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full border-2 border-dashed border-line text-2xl text-muted">+</span>
        )}
        <span className="line-clamp-2 text-sm font-semibold">{b ? name(b) : pickLabel}</span>
        {b && <span className="text-[11px] font-semibold text-accent">Change</span>}
      </button>
    </div>
  )
}
