// A dropped catch while scoring: who put it down, was it a hard chance, and where.
// Used by the "Dropped catch" button (a new ball) and when correcting an earlier ball.
import { useState } from 'react'
import { shotRegion } from '../lib/scorecard'
import type { BallEvent, Drop } from '../types'
import { useApp } from '../state/AppContext'
import { GroundMap } from './scoring'
import { ChoiceChips, Sheet, Toggle } from './ui'

export interface DropDraft {
  by?: string
  tough: boolean
  at?: [number, number]
}

export const draftOf = (d?: Drop | null): DropDraft => ({ by: d?.by, tough: !!d?.tough, at: d?.at })
export const dropOf = (d: DropDraft): Drop | undefined => (d.by ? { by: d.by, ...(d.at ? { at: d.at } : {}), ...(d.tough ? { tough: true } : {}) } : undefined)

export function DropFields({ fielders, draft, onChange, left }: { fielders: string[]; draft: DropDraft; onChange: (d: DropDraft) => void; left: boolean }) {
  const { personName } = useApp()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="label">Who dropped it?</span>
        <ChoiceChips options={fielders.map((id) => ({ value: id, label: personName(id) }))} value={draft.by} onChange={(by) => onChange({ ...draft, by })} />
      </div>
      <label className="flex items-center justify-between gap-3 rounded-xl bg-alt px-3 py-2">
        <span className="text-sm">
          <span className="font-semibold">A hard chance</span>
          <span className="block text-xs text-muted">Very fast, very low or a diving effort: counted separately.</span>
        </span>
        <Toggle label="A hard chance" checked={draft.tough} onChange={(tough) => onChange({ ...draft, tough })} />
      </label>
      <div>
        <span className="label">
          Where was it? (optional){draft.at ? ` — ${shotRegion(draft.at, left)}` : ''}
        </span>
        <div className="mx-auto max-w-[250px]">
          <GroundMap left={left} picked={draft.at ?? null} onPick={(at) => onChange({ ...draft, at })} exact marks={draft.at ? [draft.at] : []} />
        </div>
        {draft.at && (
          <button className="btn-ghost mt-1 w-full" onClick={() => onChange({ ...draft, at: undefined })}>
            Clear the spot
          </button>
        )}
      </div>
    </div>
  )
}

const RUNS = [0, 1, 2, 3, 4, 6]

/** The "Dropped catch" sheet: say who and where, then tap the runs that ball went for. */
export function DropSheet({ fielders, left, batter, onCommit, onClose }: { fielders: string[]; left: boolean; batter: string; onCommit: (input: { kind: 'legal' | 'nb'; bat: number; drop: Drop }) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<DropDraft>({ tough: false })
  const [noBall, setNoBall] = useState(false)
  const drop = dropOf(draft)
  return (
    <Sheet title="Dropped catch" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{batter} is given a life. This is the same ball: say who dropped it, then how many runs came off it.</p>
        <DropFields fielders={fielders} draft={draft} onChange={setDraft} left={left} />
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">It was a no-ball</span>
          <Toggle label="No ball" checked={noBall} onChange={setNoBall} />
        </label>
        <div>
          <span className="label">Runs off the bat on that ball{drop ? '' : ' — pick the fielder first'}</span>
          <div className="grid grid-cols-6 gap-2">
            {RUNS.map((n) => (
              <button key={n} className="flex min-h-[54px] items-center justify-center rounded-xl border border-chip-line bg-chip text-lg font-bold active:bg-line disabled:opacity-40" disabled={!drop} onClick={() => drop && onCommit({ kind: noBall ? 'nb' : 'legal', bat: n, drop })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/** The "a catch was dropped" part of correcting a ball. `value` null = no drop. */
export function EditDrop({ ball, fielders, left, draft, setDraft }: { ball: BallEvent; fielders: string[]; left: boolean; draft: DropDraft | null; setDraft: (d: DropDraft | null) => void }) {
  if (ball.kind === 'wd' || (ball.wicket && ['caught', 'caught_behind', 'caught_bowled'].includes(ball.wicket.kind))) return null
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <label className="flex items-center justify-between gap-3">
        <span className="font-semibold">A catch was dropped</span>
        <Toggle label="A catch was dropped" checked={!!draft} onChange={(on) => setDraft(on ? { tough: false } : null)} />
      </label>
      {draft && <DropFields fielders={fielders} draft={draft} onChange={setDraft} left={left} />}
    </div>
  )
}
