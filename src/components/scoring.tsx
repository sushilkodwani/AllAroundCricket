// Pieces shared by the scoring setup, the scoring pad and the scorecard viewer.
import { useRef, useState, type ReactNode } from 'react'
import { findOrCreatePlayer } from '../lib/domain'
import { pressureOf } from '../lib/insights'
import { normalizePhone } from '../lib/phone'
import { BATTER_POS, ballToken, ballTone, type BallTone } from '../lib/scorecard'
import { useApp } from '../state/AppContext'
import type { BallEvent, Person, ScoreFile } from '../types'
import { ErrorNote, Field, PhoneInput, Sheet } from './ui'

const TONE: Record<BallTone, string> = {
  wicket: 'bg-bad text-white',
  six: 'bg-brand text-on-brand',
  four: 'bg-ink text-bg',
  extra: 'border border-chip-line bg-chip text-ink',
  plain: 'bg-alt text-ink',
}

/** One delivery as a round chip: • 1 4 6 W wd nb+2 … */
export function BallChip({ ball, onClick }: { ball: BallEvent; onClick?: () => void }) {
  const token = ballToken(ball)
  const cls = `flex h-9 min-w-[36px] shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold ${TONE[ballTone(ball)]}`
  return onClick ? (
    <button className={cls} onClick={onClick} aria-label={`Edit ball: ${token}`}>
      {token}
    </button>
  ) : (
    <span className={cls}>{token}</span>
  )
}

/**
 * Name + mobile number, both required. A number that is already known reuses
 * that person and says so, instead of creating a duplicate.
 */
export function AddPlayerSheet({ title, onClose, onAdded }: { title: string; onClose: () => void; onAdded: (person: Person, existed: boolean) => void }) {
  const { store } = useApp()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!store) return
    const p = normalizePhone(phone)
    if (!name.trim()) return setError('Enter the player’s name.')
    if (!p.ok) return setError(p.error)
    setBusy(true)
    setError(null)
    try {
      const { person, existed } = await findOrCreatePlayer(store, name, p.phone)
      onAdded(person, existed)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Name">
          <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Mobile number" hint="Required. If this number is already in the app, that player is used.">
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Add player'}
        </button>
      </form>
    </Sheet>
  )
}

// ---------- ground map ----------
/** Extends a tap to the boundary rope, along the line from the batter through the tap. */
export function toBoundary(p: [number, number]): [number, number] {
  const [bx, by] = BATTER_POS
  let dx = p[0] - bx
  let dy = p[1] - by
  const len = Math.hypot(dx, dy)
  if (len < 0.02) return [0, 1]
  dx /= len
  dy /= len
  // Solve |B + t·d| = 1 for t > 0.
  const bd = bx * dx + by * dy
  const t = -bd + Math.sqrt(bd * bd - (bx * bx + by * by) + 1)
  return [Math.round((bx + t * dx) * 100) / 100, Math.round((by + t * dy) * 100) / 100]
}

export interface GroundShot {
  shot: [number, number]
  runs: number
}

/**
 * The outfield seen from above: bowler's end at the bottom, batter at the top
 * of the pitch. With `onPick` it is an input (tap where the ball went);
 * with `shots` it is a wagon wheel.
 */
/** `exact` keeps the tapped spot (a catch in the ring) instead of stretching it to the rope; `marks` are ✕ points. */
export function GroundMap({
  left,
  shots = [],
  marks = [],
  picked,
  onPick,
  exact,
  children,
}: {
  left?: boolean
  shots?: GroundShot[]
  marks?: [number, number][]
  picked?: [number, number] | null
  onPick?: (p: [number, number]) => void
  exact?: boolean
  children?: ReactNode
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [bx, by] = BATTER_POS
  const off = left ? 1 : -1 // screen side of the off side
  return (
    <svg
      ref={ref}
      viewBox="-1.12 -1.12 2.24 2.24"
      className={`mx-auto block w-full max-w-[340px] select-none ${onPick ? 'cursor-crosshair touch-none' : ''}`}
      role={onPick ? 'button' : 'img'}
      aria-label={onPick ? 'Ground map: tap where the ball went' : 'Wagon wheel'}
      onPointerDown={(e) => {
        if (!onPick || !ref.current) return
        const r = ref.current.getBoundingClientRect()
        const x = ((e.clientX - r.left) / r.width) * 2.24 - 1.12
        const y = ((e.clientY - r.top) / r.height) * 2.24 - 1.12
        if (!exact) return onPick(toBoundary([x, y]))
        // Inside the rope: keep the spot, pulled back onto the field if the tap was outside it.
        const d = Math.hypot(x, y)
        const k = d > 1 ? 1 / d : 1
        onPick([Math.round(x * k * 100) / 100, Math.round(y * k * 100) / 100])
      }}
    >
      <circle r="1" fill="var(--turf)" stroke="rgb(var(--border))" strokeWidth="0.02" />
      <circle r="0.48" fill="none" stroke="rgb(var(--border))" strokeWidth="0.012" />
      <rect x="-0.05" y="-0.18" width="0.1" height="0.36" rx="0.01" fill="var(--pitch)" />
      <g fontSize="0.085" fill="rgb(var(--text-muted))" textAnchor="middle" fontWeight="600">
        <text x={off * 0.74} y="-0.1">
          OFF
        </text>
        <text x={-off * 0.74} y="-0.1">
          LEG
        </text>
        <text x="0" y="0.92">
          bowler’s end
        </text>
      </g>
      {shots.map((s, i) => (
        <line key={i} x1={bx} y1={by} x2={s.shot[0]} y2={s.shot[1]} stroke={s.runs === 6 ? 'var(--series-2)' : 'var(--series-1)'} strokeWidth="0.022" strokeLinecap="round" />
      ))}
      {marks.map((m, i) => (
        <g key={`m${i}`} stroke="rgb(var(--danger))" strokeWidth="0.03" strokeLinecap="round">
          <line x1={m[0] - 0.045} y1={m[1] - 0.045} x2={m[0] + 0.045} y2={m[1] + 0.045} />
          <line x1={m[0] - 0.045} y1={m[1] + 0.045} x2={m[0] + 0.045} y2={m[1] - 0.045} />
        </g>
      ))}
      {picked && !exact && (
        <>
          <line x1={bx} y1={by} x2={picked[0]} y2={picked[1]} stroke="rgb(var(--brand-text))" strokeWidth="0.03" strokeLinecap="round" />
          <circle cx={picked[0]} cy={picked[1]} r="0.06" fill="rgb(var(--brand))" stroke="rgb(var(--surface))" strokeWidth="0.02" />
        </>
      )}
      {picked && exact && <circle cx={picked[0]} cy={picked[1]} r="0.06" fill="rgb(var(--danger))" stroke="rgb(var(--surface))" strokeWidth="0.02" />}
      <circle cx={bx} cy={by} r="0.035" fill="rgb(var(--text))" />
      {children}
    </svg>
  )
}

/** Pressure meter (PLAN §41): how tied down the batting side is right now. */
export function PressureStrip({ file, idx }: { file: ScoreFile; idx: number }) {
  const p = pressureOf(file, idx)
  if (!p) return null
  const items: [string, string][] = [
    ['Dot balls', `${p.dotPct}%`],
    ['Since a boundary', `${p.sinceBoundary} ball${p.sinceBoundary === 1 ? '' : 's'}`],
    [`Last ${p.lastBalls} balls`, `${p.lastRuns} run${p.lastRuns === 1 ? '' : 's'}`],
  ]
  return (
    <div className="card grid grid-cols-3 divide-x divide-line py-2 text-center">
      {items.map(([label, value]) => (
        <div key={label} className="px-1">
          <p className="text-sm font-semibold">{value}</p>
          <p className="text-[11px] text-muted">{label}</p>
        </div>
      ))}
    </div>
  )
}