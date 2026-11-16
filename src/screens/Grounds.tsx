// Ground directory (PLAN §42): saved venues with a map link, pitch type, fee
// and who to contact. Used as venue suggestions and shown on the match page.
import { useState } from 'react'
import { Screen } from '../components/Screen'
import { ChoiceChips, Empty, ErrorNote, Field, NumberInput, Sheet } from '../components/ui'
import { money } from '../lib/dates'
import { deleteGround, groundsOf, saveGround } from '../lib/domain'
import { useApp } from '../state/AppContext'
import { useSheet } from '../state/router'
import { PITCH_LABELS, type Ground, type PitchType } from '../types'

const PITCHES = (Object.keys(PITCH_LABELS) as PitchType[]).map((value) => ({ value, label: PITCH_LABELS[value] }))

/** What the match page shows for a known venue. */
export function GroundInfo({ ground }: { ground: Ground }) {
  const facts = [ground.pitch ? `${PITCH_LABELS[ground.pitch]} pitch` : null, ground.fee ? `Fee ${money(ground.fee)}` : null, ground.contact ? `Contact: ${ground.contact}` : null].filter(Boolean)
  if (facts.length === 0 && !ground.mapUrl && !ground.notes) return null
  return (
    <div className="card flex flex-col gap-1.5 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">📍 {ground.name}</h2>
        {ground.mapUrl && (
          <a className="font-semibold text-accent" href={ground.mapUrl} target="_blank" rel="noopener noreferrer">
            Open map ↗
          </a>
        )}
      </div>
      {facts.length > 0 && <p className="text-muted">{facts.join(' · ')}</p>}
      {ground.notes && <p className="text-muted">{ground.notes}</p>}
    </div>
  )
}

export function Grounds() {
  const { store, isAdmin } = useApp()
  const sheet = useSheet()
  const grounds = store ? [...groundsOf(store)].sort((a, b) => a.name.localeCompare(b.name)) : []
  const editing = sheet.name === 'ground' ? grounds.find((g) => g.id === sheet.arg) : undefined

  return (
    <Screen title="Grounds" back="/settings">
      <div className="flex flex-col gap-3 p-4">
        {isAdmin && (
          <button className="btn-primary" onClick={() => sheet.open('ground')}>
            + Add ground
          </button>
        )}
        {grounds.length === 0 ? (
          <Empty icon="📍" title="No grounds saved" text="Save the grounds you play at. They are offered as the venue when you add a match, and players get a map link." />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {grounds.map((g) => (
              <button key={g.id} className="row active:bg-alt" disabled={!isAdmin} onClick={() => sheet.open('ground', g.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.name}</span>
                  <span className="block truncate text-xs text-muted">{[g.pitch ? PITCH_LABELS[g.pitch] : null, g.fee ? money(g.fee) : null, g.mapUrl ? 'map link' : null].filter(Boolean).join(' · ') || 'No details yet'}</span>
                </span>
                {isAdmin && <span className="text-muted">›</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {sheet.name === 'ground' && isAdmin && <GroundSheet ground={editing} onClose={sheet.close} />}
    </Screen>
  )
}

function GroundSheet({ ground, onClose }: { ground?: Ground; onClose: () => void }) {
  const { store, toast } = useApp()
  const [name, setName] = useState(ground?.name ?? '')
  const [mapUrl, setMapUrl] = useState(ground?.mapUrl ?? '')
  const [pitch, setPitch] = useState<PitchType | undefined>(ground?.pitch)
  const [fee, setFee] = useState(ground?.fee ? String(ground.fee) : '')
  const [contact, setContact] = useState(ground?.contact ?? '')
  const [notes, setNotes] = useState(ground?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  return (
    <Sheet title={ground ? 'Edit ground' : 'Add ground'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          try {
            saveGround(store!, { id: ground?.id, name, mapUrl, pitch, fee: Number(fee) || undefined, contact, notes })
            toast('Ground saved')
            onClose()
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <Field label="Name">
          <input className="input" value={name} maxLength={60} autoFocus={!ground} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Map link (optional)" hint="In Google Maps: Share → Copy link, then paste it here.">
          <input className="input" type="url" inputMode="url" value={mapUrl} placeholder="https://maps.app.goo.gl/…" onChange={(e) => setMapUrl(e.target.value)} />
        </Field>
        <div>
          <span className="label">Pitch</span>
          <ChoiceChips options={PITCHES} value={pitch} onChange={(p) => setPitch(p === pitch ? undefined : p)} />
        </div>
        <Field label="Usual fee in ₹ (optional)">
          <NumberInput value={fee} onChange={setFee} maxLength={6} ariaLabel="Ground fee" />
        </Field>
        <Field label="Contact person (optional)" hint="A name only. Phone numbers are never kept in the data repo.">
          <input className="input" value={contact} maxLength={40} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <textarea className="input min-h-[72px] py-2" value={notes} maxLength={300} placeholder="Parking, gate, booking rules…" onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={!name.trim()}>
          Save
        </button>
        {ground && (
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              deleteGround(store!, ground.id)
              onClose()
            }}
          >
            Delete ground
          </button>
        )}
      </form>
    </Sheet>
  )
}
