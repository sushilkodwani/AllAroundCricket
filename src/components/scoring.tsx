// Pieces shared by the scoring setup, the scoring pad and the scorecard viewer.
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { findOrCreatePlayer } from '../lib/domain'
import { pressureOf } from '../lib/insights'
import { maskPhone, normalizePhone } from '../lib/phone'
import { BATTER_POS, ballToken, ballTone, shotRegion, type BallTone } from '../lib/scorecard'
import { useApp } from '../state/AppContext'
import type { BallEvent, Person, ScoreFile } from '../types'
import { parseBulk } from '../lib/bulk'
import { ErrorNote, Field, PhoneInput, Sheet } from './ui'

const TONE: Record<BallTone, string> = {
  wicket: 'bg-bad text-white',
  six: 'bg-brand text-on-brand',
  four: 'bg-ink text-bg',
  extra: 'border border-chip-line bg-chip text-ink',
  plain: 'bg-alt text-ink',
}

/** One delivery as a round chip: • 1 4 6 W wd nb+2 … */
export function BallChip({ ball, onClick, small }: { ball: BallEvent; onClick?: () => void; small?: boolean }) {
  const token = ballToken(ball)
  const size = small ? 'h-6 min-w-[24px] px-1 text-[10px]' : 'h-9 min-w-[36px] px-1.5 text-xs'
  const cls = `flex ${size} shrink-0 items-center justify-center rounded-full font-bold ${TONE[ballTone(ball)]}`
  return onClick ? (
    <button className={cls} onClick={onClick} aria-label={`Edit ball: ${token}`}>
      {token}
    </button>
  ) : (
    <span className={cls}>{token}</span>
  )
}

/**
 * Name + mobile number. A number that is already known reuses that person and says so, instead of
 * creating a duplicate. With `phoneOptional` (opponents' players) the number may be left empty.
 */
export function AddPlayerSheet({ title, onClose, onAdded, phoneOptional }: { title: string; onClose: () => void; onAdded: (person: Person, existed: boolean) => void; phoneOptional?: boolean }) {
  const { store } = useApp()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!store) return
    const blank = !!phoneOptional && !phone.replace(/\D/g, '')
    const p = normalizePhone(phone)
    if (!name.trim()) return setError('Enter the player’s name.')
    if (!blank && !p.ok) return setError(p.error)
    setBusy(true)
    setError(null)
    try {
      const { person, existed } = await findOrCreatePlayer(store, name, !blank && p.ok ? p.phone : undefined)
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
        <Field
          label={phoneOptional ? 'Mobile number (optional)' : 'Mobile number'}
          hint={phoneOptional ? 'Can be left empty. If you enter one that is already in the app, that player is used.' : 'Required. If this number is already in the app, that player is used.'}
        >
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

/**
 * Several players at once, one per line: a name then the 10-digit number. Numbers already in the app reuse
 * that person. Used for opponent teams and the scoring set-up, where players are not team members.
 * With `phoneOptional` (opponents' players) a line may be just a name.
 */
export function BulkPlayersSheet({ title, onClose, onAdded, phoneOptional }: { title: string; onClose: () => void; onAdded: (persons: Person[], existing: number) => void; phoneOptional?: boolean }) {
  const { store } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lines = useMemo(() => parseBulk(text, phoneOptional), [text, phoneOptional])
  const valid = lines.filter((l) => !l.error)

  async function addAll() {
    if (!store) return
    setBusy(true)
    setError(null)
    const persons: Person[] = []
    let existing = 0
    try {
      for (const line of valid) {
        const r = await findOrCreatePlayer(store, line.name, line.phone)
        if (r.existed) existing++
        if (!persons.some((p) => p.id === r.person.id)) persons.push(r.person)
      }
      onAdded(persons, existing)
    } catch (e) {
      setError((e as Error).message)
      // Whoever was saved before the failure still counts.
      if (persons.length) onAdded(persons, existing)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field
          label="One player per line"
          hint={phoneOptional ? 'A name, then the 10-digit number if you have it. Numbers already in the app reuse that player.' : 'Name followed by the 10-digit number. Numbers already in the app reuse that player.'}
        >
          <textarea className="input min-h-[140px] py-2 font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={phoneOptional ? 'Rahul Sharma 9876543210\nVikram Rao' : 'Rahul Sharma 9876543210\nVikram Rao 98765 43211'} />
        </Field>
        {lines.length > 0 && (
          <div className="card divide-y divide-line overflow-hidden text-sm">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{l.name || l.raw}</span>
                {l.error ? <span className="shrink-0 text-bad">{l.error}</span> : <span className="shrink-0 text-ok">✓ {l.phone ? maskPhone(l.phone.slice(-4)) : 'no number'}</span>}
              </div>
            ))}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={busy || valid.length === 0} onClick={() => void addAll()}>
          {busy ? 'Adding…' : `Add ${valid.length} valid player${valid.length === 1 ? '' : 's'}`}
        </button>
      </div>
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
 * The fielding regions drawn on the map. Angles are degrees from straight back
 * past the bowler, leg side positive, and match `shotRegion` exactly.
 */
const REGIONS: { name: string; label: string; at: number; spans: [number, number][] }[] = [
  { name: 'straight down the ground', label: 'Straight', at: 0, spans: [[-12, 12]] },
  { name: 'long on', label: 'Long on', at: 31, spans: [[12, 50]] },
  { name: 'mid wicket', label: 'Mid wicket', at: 65, spans: [[50, 80]] },
  { name: 'square leg', label: 'Square leg', at: 97.5, spans: [[80, 115]] },
  { name: 'fine leg', label: 'Fine leg', at: 141.5, spans: [[115, 168]] },
  { name: 'behind the wicket', label: 'Behind', at: 180, spans: [[168, 180], [-180, -168]] },
  { name: 'third man', label: 'Third man', at: -141.5, spans: [[-168, -115]] },
  { name: 'point', label: 'Point', at: -97.5, spans: [[-115, -80]] },
  { name: 'cover', label: 'Cover', at: -65, spans: [[-80, -50]] },
  { name: 'long off', label: 'Long off', at: -31, spans: [[-50, -12]] },
]
const EDGES = [12, 50, 80, 115, 168]

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
  const clip = useId().replace(/:/g, '')
  // A point at angle d (leg positive) and distance r from the batter, as the screen sees it.
  const dir = (d: number, r: number): [number, number] => [bx + Math.sin((d * Math.PI) / 180) * r * (left ? -1 : 1), by + Math.cos((d * Math.PI) / 180) * r]
  const here = picked ? shotRegion(picked, left) : null
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
      <clipPath id={clip}>
        <circle r="1" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {/* the region the pick falls in */}
        {REGIONS.filter((r) => r.name === here).flatMap((r) =>
          r.spans.map(([a, b], i) => {
            const p = dir(a, 2)
            const q = dir(b, 2)
            return <polygon key={r.name + i} points={`${bx},${by} ${p[0]},${p[1]} ${q[0]},${q[1]}`} fill="rgb(var(--brand))" opacity="0.2" />
          }),
        )}
        {/* partition lines, mirrored on both sides */}
        {EDGES.flatMap((e) => [e, -e]).map((e) => {
          const p = dir(e, 2)
          return <line key={e} x1={bx} y1={by} x2={p[0]} y2={p[1]} stroke="rgb(var(--text-muted))" strokeOpacity="0.4" strokeWidth="0.01" strokeDasharray="0.03 0.03" />
        })}
      </g>
      <circle r="0.48" fill="none" stroke="rgb(var(--border))" strokeWidth="0.012" />
      <rect x="-0.05" y="-0.18" width="0.1" height="0.36" rx="0.01" fill="var(--pitch)" />
      <g fontSize="0.065" fill="rgb(var(--text-muted))" textAnchor="middle" fontWeight="600" stroke="var(--turf)" strokeWidth="0.03" paintOrder="stroke">
        {REGIONS.map((r) => {
          const [x, y] = dir(r.at, r.at === 180 ? 0.7 : 0.74)
          return (
            <text key={r.name} x={x} y={y + 0.02} fill={r.name === here ? 'rgb(var(--brand-text))' : undefined} fontWeight={r.name === here ? 800 : 600}>
              {r.label}
            </text>
          )
        })}
        <text x={off * 0.22} y="-0.04" fontSize="0.055">
          OFF
        </text>
        <text x={-off * 0.22} y="-0.04" fontSize="0.055">
          LEG
        </text>
        <text x="0" y="1.08" fontSize="0.07" stroke="none">
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