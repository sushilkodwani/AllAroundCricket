// Shot stickers: a filled side-on silhouette of the batter for each kind of
// shot — helmet, gloves, pads, shoes and bat — drawn here as SVG from a few
// joint positions per pose (no image files). One colour in two tones: the far
// arm and leg slightly darker, so it reads as a figure. Facing the bowler on
// the right; mirrored for left-handers. The selected sticker swings its bat once.
import { useState } from 'react'
import { SHOT_LABELS, type ShotType } from '../types'

type P = [number, number]

interface Pose {
  head: P
  neck: P
  hip: P
  /** Front (near) knee and foot, back (far) knee and foot. */
  fk: P
  ff: P
  bk: P
  bf: P
  /** Front elbow; the back arm bends a little behind it. */
  elbow: P
  hands: P
  /** Toe of the bat. */
  toe: P
  /** A ball off the edge (only the edge sticker). */
  ball?: P
}

const POSES: Record<ShotType, Pose> = {
  drive: { head: [34, 12], neck: [31, 18], hip: [23, 34], fk: [34, 43], ff: [40, 58], bk: [16, 46], bf: [10, 58], elbow: [37, 25], hands: [37, 33], toe: [42, 53] },
  defence: { head: [34, 14], neck: [31, 20], hip: [24, 36], fk: [34, 45], ff: [38, 58], bk: [17, 47], bf: [13, 58], elbow: [37, 27], hands: [37, 35], toe: [38, 55] },
  lofted: { head: [29, 12], neck: [27, 18], hip: [24, 34], fk: [32, 45], ff: [36, 58], bk: [18, 46], bf: [13, 58], elbow: [33, 11], hands: [27, 6], toe: [11, 4] },
  cut: { head: [27, 13], neck: [26, 19], hip: [23, 35], fk: [31, 46], ff: [34, 58], bk: [20, 47], bf: [18, 58], elbow: [33, 23], hands: [39, 25], toe: [56, 30] },
  pull: { head: [29, 12], neck: [27, 18], hip: [25, 34], fk: [33, 42], ff: [37, 51], bk: [23, 47], bf: [22, 58], elbow: [35, 20], hands: [31, 22], toe: [11, 22] },
  hook: { head: [28, 14], neck: [27, 20], hip: [25, 36], fk: [32, 46], ff: [35, 58], bk: [21, 47], bf: [19, 58], elbow: [35, 13], hands: [31, 11], toe: [11, 5] },
  sweep: { head: [33, 24], neck: [30, 29], hip: [23, 41], fk: [33, 46], ff: [37, 58], bk: [19, 57], bf: [8, 58], elbow: [36, 37], hands: [40, 43], toe: [57, 53] },
  flick: { head: [33, 12], neck: [30, 18], hip: [24, 34], fk: [34, 44], ff: [38, 58], bk: [17, 46], bf: [12, 58], elbow: [36, 26], hands: [35, 34], toe: [29, 52] },
  glance: { head: [33, 13], neck: [30, 19], hip: [24, 35], fk: [33, 45], ff: [37, 58], bk: [17, 47], bf: [13, 58], elbow: [35, 27], hands: [33, 35], toe: [23, 50] },
  edge: { head: [34, 14], neck: [31, 20], hip: [24, 36], fk: [34, 45], ff: [38, 58], bk: [17, 47], bf: [13, 58], elbow: [37, 27], hands: [37, 35], toe: [43, 53], ball: [16, 22] },
  scoop: { head: [33, 25], neck: [30, 30], hip: [23, 42], fk: [33, 47], ff: [37, 58], bk: [18, 52], bf: [11, 58], elbow: [37, 33], hands: [35, 27], toe: [29, 9] },
  other: { head: [27, 13], neck: [26, 19], hip: [25, 35], fk: [30, 47], ff: [33, 58], bk: [21, 47], bf: [19, 58], elbow: [31, 27], hands: [31, 34], toe: [33, 53] },
}

const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const along = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const len = (v: P) => Math.hypot(v[0], v[1]) || 1
const pt = (p: P) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`

/** A limb: a thick line with rounded ends from a to b. */
function Limb({ a, b, w }: { a: P; b: P; w: number }) {
  return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
}

function Figure({ p, swing }: { p: Pose; swing: boolean }) {
  const shoulder = add(p.neck, [0, 2.5])
  const backShoulder = add(shoulder, [-2.5, 0.5])
  const backElbow = add(p.elbow, [-3, 2])
  // Which way the batter faces: where the front foot is from the hip.
  const face = p.ff[0] >= p.hip[0] ? 1 : -1
  const handleEnd = along(p.hands, p.toe, 6 / len(sub(p.toe, p.hands)))
  const hipMid = along(shoulder, p.hip, 0.55)
  return (
    <g>
      {/* far leg and arm: one group, one shade (no seams where they overlap) */}
      <g opacity="0.5">
        <Limb a={p.hip} b={p.bk} w={5.8} />
        <Limb a={p.bk} b={p.bf} w={5.2} />
        <ellipse cx={p.bf[0] - 1.2 * face} cy={p.bf[1] - 0.6} rx="3.4" ry="1.9" fill="currentColor" />
        <Limb a={backShoulder} b={backElbow} w={3.4} />
        <Limb a={backElbow} b={p.hands} w={3} />
      </g>
      {/* torso: broad chest narrowing to the hips */}
      <Limb a={p.neck} b={shoulder} w={4} />
      <Limb a={shoulder} b={hipMid} w={9.5} />
      <Limb a={hipMid} b={p.hip} w={7.5} />
      {/* near leg: thigh, padded shin, shoe */}
      <Limb a={p.hip} b={p.fk} w={6.6} />
      <Limb a={p.fk} b={p.ff} w={5.8} />
      <ellipse cx={p.ff[0] + 1.4 * face} cy={p.ff[1] - 0.6} rx="3.6" ry="2" fill="currentColor" />
      {/* helmet: dome, peak and grille */}
      <circle cx={p.head[0]} cy={p.head[1]} r="5" fill="currentColor" />
      <Limb a={add(p.head, [-1 * face, -2.8])} b={add(p.head, [6.2 * face, -1.6])} w={1.8} />
      <path d={`M${pt(add(p.head, [3.4 * face, -0.6]))} L${pt(add(p.head, [5.4 * face, 1.2]))} L${pt(add(p.head, [4 * face, 4.8]))}`} fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      {/* bat: handle and blade, swinging from the hands */}
      <g className={swing ? 'shot-swing' : undefined} style={{ transformOrigin: `${p.hands[0]}px ${p.hands[1]}px` }}>
        <Limb a={p.hands} b={handleEnd} w={1.8} />
        <line x1={handleEnd[0]} y1={handleEnd[1]} x2={p.toe[0]} y2={p.toe[1]} stroke="currentColor" strokeWidth="4.2" strokeLinecap="square" />
      </g>
      {/* near arm and gloves on top */}
      <Limb a={shoulder} b={p.elbow} w={3.8} />
      <Limb a={p.elbow} b={p.hands} w={3.3} />
      <circle cx={p.hands[0]} cy={p.hands[1]} r="2.6" fill="currentColor" />
      {p.ball && (
        <>
          <path d={`M${pt(along(p.toe, p.hands, 0.35))} Q${(p.ball[0] + p.toe[0]) / 2} ${p.ball[1] - 4} ${pt(p.ball)}`} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
          <circle cx={p.ball[0]} cy={p.ball[1]} r="2.2" fill="rgb(var(--danger))" />
        </>
      )}
    </g>
  )
}

export function ShotIcon({ type, size = 48, left = false, swing = false }: { type: ShotType; size?: number; left?: boolean; swing?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="shrink-0">
      <g transform={left ? 'translate(64 0) scale(-1 1)' : undefined}>
        <Figure p={POSES[type]} swing={swing} />
      </g>
    </svg>
  )
}

// ---------- pickers and tiles ----------

const SHOT_ORDER = Object.keys(SHOT_LABELS) as ShotType[]

/** Pick the shot played: a grid of stickers with names; tap again to clear. The picked one swings its bat. */
export function ShotPicker({ value, onChange, left }: { value: ShotType | undefined; onChange: (v: ShotType | undefined) => void; left?: boolean }) {
  const [swung, setSwung] = useState(0)
  return (
    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Shot played">
      {SHOT_ORDER.map((t) => {
        const on = value === t
        return (
          <button
            key={on ? `${t}-${swung}` : t}
            type="button"
            role="radio"
            aria-checked={on}
            className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 pb-1.5 pt-1 text-[11px] font-medium leading-tight ${on ? 'border-brand bg-brand/10 text-ink' : 'border-chip-line bg-chip text-muted'}`}
            onClick={() => {
              onChange(on ? undefined : t)
              setSwung((n) => n + 1)
            }}
          >
            <ShotIcon type={t} size={44} left={left} swing={on} />
            <span className={on ? 'font-semibold' : ''}>{SHOT_LABELS[t]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Results by shot, two tiles a row: the sticker, the name and a figure ("35 runs"). Tap a tile to read its note. */
export function ShotTiles({ rows, left }: { rows: { type: ShotType; value: string; note?: string }[]; left?: boolean }) {
  const [open, setOpen] = useState<ShotType | null>(null)
  if (!rows.length) return <p className="py-3 text-center text-sm text-muted">Nothing for this filter yet.</p>
  const pick = rows.find((r) => r.type === open)
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map((r) => (
          <button key={r.type} type="button" className={`flex items-center gap-2 rounded-xl px-2 py-2 text-left ${open === r.type ? 'bg-brand/10 ring-1 ring-brand' : 'bg-alt'}`} onClick={() => setOpen(open === r.type ? null : r.type)}>
            <span className="text-muted">
              <ShotIcon type={r.type} size={48} left={left} />
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 block text-sm font-semibold leading-tight">{SHOT_LABELS[r.type]}</span>
              <span className="block text-sm">{r.value}</span>
            </span>
          </button>
        ))}
      </div>
      {pick?.note && <p className="mt-2 text-sm text-muted">{pick.note}</p>}
    </div>
  )
}
