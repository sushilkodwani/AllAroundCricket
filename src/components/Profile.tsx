// Player profile (PLAN §39): role, batting hand, bowling style and jersey
// number, shown as a card wherever a player is looked at.
import { useState } from 'react'
import { batAverage, batStrikeRate, bestBowling, bowlEconomy, highScore, type Career } from '../lib/career'
import { updateProfile } from '../lib/domain'
import { setPersonPhoto, useImage } from '../lib/images'
import { P } from '../lib/paths'
import { useApp } from '../state/AppContext'
import { BOWL_LABELS, ROLE_LABELS, ROLE_SHORT, type BowlStyle, type Person, type PlayerRole } from '../types'
import { PhotoPicker } from './PhotoPicker'
import { ChoiceChips, ErrorNote, Field, NumberInput, Pill, Sheet } from './ui'

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/** Small role marker for lists: "WK", "AR"… */
export function RoleTag({ person }: { person?: Person | null }) {
  if (!person?.role) return null
  return <span className="rounded bg-alt px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">{ROLE_SHORT[person.role]}</span>
}

export const batsText = (p?: Person | null) => (p?.batsLeft === undefined ? 'Batting hand not set' : p.batsLeft ? 'Left-hand bat' : 'Right-hand bat')

export function ProfileCard({ person, name, teamName, color, career, onEdit }: { person?: Person | null; name: string; teamName: string; color?: string; career?: Career; onEdit?: () => void }) {
  const bg = color ?? '#475569'
  const { store } = useApp()
  const photo = useImage(store, person ? P.personPhoto(person.id) : null, person?.photo)
  const numbers: [string, string | number][] = career
    ? [
        ['Matches', career.matches],
        ['Runs', career.bat.runs],
        ['High score', highScore(career)],
        ['Bat avg', batAverage(career)],
        ['Strike rate', batStrikeRate(career)],
        ['Wickets', career.bowl.wickets],
        ['Best bowling', bestBowling(career)],
        ['Economy', bowlEconomy(career)],
      ]
    : []
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-4 p-4 text-white" style={{ background: bg }}>
        {photo ? (
          <div className="relative h-16 w-16 shrink-0">
            <img src={photo} alt={`Photo of ${name}`} className="h-16 w-16 rounded-2xl border-2 border-white/40 object-cover" />
            {person?.jersey !== undefined && (
              <span className="absolute -bottom-1.5 -right-1.5 min-w-[24px] rounded-full bg-white px-1.5 text-center text-xs font-bold leading-6" style={{ color: bg }} aria-label={`Jersey number ${person.jersey}`}>
                {person.jersey}
              </span>
            )}
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl font-bold" aria-label={person?.jersey !== undefined ? `Jersey number ${person.jersey}` : undefined}>
            {person?.jersey !== undefined ? person.jersey : initialsOf(name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-bold">{name}</p>
          <p className="truncate text-sm opacity-90">{teamName}</p>
          <p className="mt-1 text-sm font-semibold">{person?.role ? ROLE_LABELS[person.role] : 'Role not set'}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
        <Pill>{batsText(person)}</Pill>
        <Pill>{person?.bowlStyle ? BOWL_LABELS[person.bowlStyle] : 'Bowling style not set'}</Pill>
        {career && career.potm > 0 && <Pill tone="ok">🏆 {career.potm} player of the match</Pill>}
        {onEdit && (
          <button className="ml-auto min-h-[32px] font-semibold text-accent" onClick={onEdit}>
            Edit profile
          </button>
        )}
      </div>
      {numbers.length > 0 && (
        <div className="grid grid-cols-4 gap-y-3 border-t border-line px-2 py-3 text-center">
          {numbers.map(([label, value], n) => (
            <div key={n}>
              <p className="font-semibold">{value}</p>
              <p className="text-[11px] text-muted">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ROLES = (Object.keys(ROLE_LABELS) as PlayerRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }))

export function ProfileSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const { store, toast } = useApp()
  const saved = useImage(store, P.personPhoto(person.id), person.photo)
  // undefined = unchanged; a data URL = new picture; null = remove.
  const [photo, setPhoto] = useState<string | null | undefined>(undefined)
  const [role, setRole] = useState<PlayerRole | undefined>(person.role)
  const [hand, setHand] = useState<'left' | 'right' | undefined>(person.batsLeft === undefined ? undefined : person.batsLeft ? 'left' : 'right')
  const [bowl, setBowl] = useState<BowlStyle | ''>(person.bowlStyle ?? '')
  const [jersey, setJersey] = useState(person.jersey !== undefined ? String(person.jersey) : '')
  const [error, setError] = useState<string | null>(null)

  function save() {
    try {
      const ok = updateProfile(store!, person.id, { role, batsLeft: hand === undefined ? undefined : hand === 'left', bowlStyle: bowl || undefined, jersey: jersey === '' ? undefined : Number(jersey) })
      if (!ok) throw new Error('You can only edit your own profile.')
      if (photo !== undefined && (photo ?? null) !== (saved ?? null) && !setPersonPhoto(store!, person.id, photo)) throw new Error('You can only change your own photo.')
      toast('Profile saved')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title={`Profile — ${person.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <PhotoPicker label="Photo" current={photo === undefined ? saved : photo} onChange={setPhoto} fallback={initialsOf(person.name)} />
        <div>
          <span className="label">Role</span>
          <ChoiceChips options={ROLES} value={role} onChange={(r) => setRole(r === role ? undefined : r)} />
        </div>
        <div>
          <span className="label">Bats</span>
          <ChoiceChips
            options={[
              { value: 'right', label: 'Right-handed' },
              { value: 'left', label: 'Left-handed' },
            ]}
            value={hand}
            onChange={(v) => setHand(v === hand ? undefined : v)}
          />
        </div>
        <label className="block">
          <span className="label">Bowls</span>
          <select className="input" value={bowl} onChange={(e) => setBowl(e.target.value as BowlStyle | '')}>
            <option value="">Not set / doesn’t bowl</option>
            {(Object.keys(BOWL_LABELS) as BowlStyle[]).map((k) => (
              <option key={k} value={k}>
                {BOWL_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <Field label="Jersey number (optional)">
          <NumberInput value={jersey} onChange={setJersey} maxLength={3} ariaLabel="Jersey number" />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" onClick={save}>
          Save profile
        </button>
      </div>
    </Sheet>
  )
}
