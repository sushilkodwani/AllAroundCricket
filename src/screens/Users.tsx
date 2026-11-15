// Settings → Users (admin): access, PIN resets, numbers, and guests (PLAN §7.7, §20.5).
import { useMemo, useState } from 'react'
import { Screen } from '../components/Screen'
import { Avatar, Confirm, Empty, ErrorNote, Field, PhoneInput, Pill, Sheet, Toggle } from '../components/ui'
import { credentialOf } from '../lib/access'
import { fmtStamp, money } from '../lib/dates'
import { changeNumber, convertGuest, matchesOf, renamePerson, resetPin, setAccess } from '../lib/domain'
import { duesTotal } from '../lib/funds'
import { maskPhone, normalizePhone } from '../lib/phone'
import { useApp, useTeamsLoaded } from '../state/AppContext'
import { useSheet } from '../state/router'
import type { Credential, Person } from '../types'

type Filter = 'all' | 'access' | 'no_access' | 'no_team' | 'no_pin' | 'guests'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'access', label: 'Has access' },
  { value: 'no_access', label: 'No access' },
  { value: 'no_team', label: 'No active team' },
  { value: 'no_pin', label: 'PIN not set' },
  { value: 'guests', label: 'Guests' },
]

export function pinStatus(cred: Credential | undefined): string {
  if (cred?.pin) return `PIN set ${fmtStamp(cred.pinSetAt)}`
  if (cred?.resetAt) return `Reset ${fmtStamp(cred.resetAt)} — waiting for new PIN`
  return 'PIN not set yet'
}

export function Users() {
  const { people, config, creds, allTeams, store, toast, isAdmin } = useApp()
  const sheet = useSheet()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  useTeamsLoaded(filter === 'guests' ? allTeams.map((t) => t.id) : [])

  const teamName = (id: string) => allTeams.find((t) => t.id === id)?.name ?? ''
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people
      .filter((p) => p.id !== config?.adminPersonId)
      .filter((p) => (filter === 'guests' ? p.isGuest : !p.isGuest))
      .filter((p) => {
        if (filter === 'access') return p.access === 'view'
        if (filter === 'no_access') return p.access === 'none'
        if (filter === 'no_team') return p.teamIds.length === 0
        if (filter === 'no_pin') return !credentialOf(creds, p.id)?.pin
        return true
      })
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [people, config, creds, filter, query])

  if (!isAdmin || !store) return <Screen title="Users" back="/settings"><Empty icon="🔒" title="Admins only" /></Screen>

  const selected = sheet.name === 'user' ? people.find((p) => p.id === sheet.arg) : undefined

  function guestInfo(p: Person) {
    const teamIds = p.guestOfTeamIds ?? []
    let played = 0
    let dues = 0
    for (const id of teamIds) {
      const matches = matchesOf(store!, id)
      played += matches.filter((m) => !m.cancelled && m.squad.includes(p.id)).length
      dues += duesTotal(matches, p.id)
    }
    return { teams: teamIds.map(teamName).filter(Boolean), played, dues }
  }

  return (
    <Screen title="Users" back="/settings">
      <div className="flex flex-col gap-3 p-4">
        <input className="input" type="search" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {FILTERS.map((f) => (
            <button key={f.value} className={`shrink-0 ${filter === f.value ? 'chip-on' : 'chip'} min-h-[36px] px-3`} onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}>
              {f.label}
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <Empty icon="👥" title={filter === 'guests' ? 'No guests yet' : 'No users here'} text={filter === 'all' ? 'Players appear here when you add them to a team.' : undefined} />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {list.map((p) => {
              const g = p.isGuest ? guestInfo(p) : null
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => sheet.open('user', p.id)}>
                    <Avatar name={p.name} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {maskPhone(p.phoneLast4)}
                        {g
                          ? ` · ${g.played} match${g.played === 1 ? '' : 'es'}${g.teams.length ? ` · ${g.teams.join(', ')}` : ''}`
                          : ` · ${p.teamIds.map(teamName).filter(Boolean).join(', ') || 'No active team'}`}
                      </span>
                      <span className="block truncate text-xs text-muted">{g ? (g.dues > 0 ? `Owes ${money(g.dues)}` : 'Guest') : pinStatus(credentialOf(creds, p.id))}</span>
                    </span>
                  </button>
                  {!p.isGuest && (
                    <div className="flex flex-col items-end gap-1">
                      <Toggle
                        label={`Access for ${p.name}`}
                        checked={p.access === 'view'}
                        onChange={(on) => {
                          const before = p.access
                          setAccess(store, p.id, on ? 'view' : 'none')
                          toast(on ? `${p.name} can view again` : `${p.name} can no longer log in`, () => setAccess(store, p.id, before))
                        }}
                      />
                      <span className="text-[11px] text-muted">{p.access === 'view' ? 'View only' : 'No access'}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected && <UserSheet person={selected} onClose={sheet.close} />}
    </Screen>
  )
}

export function UserSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const { store, creds, allTeams, session, toast, people } = useApp()
  const [name, setName] = useState(person.name)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [teamForGuest, setTeamForGuest] = useState('')
  const [busy, setBusy] = useState(false)
  if (!store) return null

  const cred = credentialOf(creds, person.id)
  const teams = allTeams.filter((t) => person.teamIds.includes(t.id))
  const activeTeams = allTeams.filter((t) => !t.archived)

  async function run(fn: () => Promise<void> | void, done?: string) {
    setError(null)
    setBusy(true)
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function saveNumber() {
    const p = normalizePhone(phone)
    if (!p.ok) return setError(p.error)
    void run(async () => {
      await changeNumber(store!, person.id, p.phone)
      setPhone('')
    }, 'Number changed')
  }

  return (
    <Sheet title={person.isGuest ? 'Guest' : 'User'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Name" hint={teams.length > 1 ? `Also changes the name in ${teams.map((t) => t.name).join(', ')}.` : undefined}>
          <div className="flex gap-2">
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button className="btn-secondary" disabled={busy || !name.trim() || name.trim() === person.name} onClick={() => void run(() => renamePerson(store, person.id, name), 'Name saved')}>
              Save
            </button>
          </div>
        </Field>

        <Field label={person.phoneHash ? `Change number (now ${maskPhone(person.phoneLast4)})` : 'Add mobile number (10 digits)'}>
          <div className="flex gap-2">
            <PhoneInput value={phone} onChange={setPhone} placeholder="New 10-digit number" ariaLabel="New mobile number" />
            <button className="btn-secondary" disabled={busy || phone.length !== 10} onClick={saveNumber}>
              Save
            </button>
          </div>
        </Field>

        {!person.isGuest && (
          <>
            <div className="text-sm">
              <span className="text-muted">Teams: </span>
              {teams.length ? teams.map((t) => t.name).join(', ') : 'No active team — can’t log in'}
            </div>
            <div className="flex items-center justify-between">
              <span>
                <span className="block font-medium">Access</span>
                <span className="block text-xs text-muted">{person.access === 'view' ? 'View only' : 'No access — can’t log in. Stays in teams and past squads.'}</span>
              </span>
              <Toggle label="Access" checked={person.access === 'view'} onChange={(on) => setAccess(store, person.id, on ? 'view' : 'none')} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">{pinStatus(cred)}</span>
              <button className="btn-danger" onClick={() => setConfirmReset(true)}>
                Reset PIN
              </button>
            </div>
          </>
        )}

        {person.isGuest && (
          <Field label="Add to a team" hint="Makes this guest a regular team member with view access. Needs a mobile number.">
            <div className="flex gap-2">
              <select className="input" value={teamForGuest} onChange={(e) => setTeamForGuest(e.target.value)} aria-label="Team">
                <option value="">Choose team…</option>
                {activeTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary"
                disabled={busy || !teamForGuest}
                onClick={() =>
                  void run(async () => {
                    const fresh = people.find((x) => x.id === person.id)
                    if (!fresh?.phoneHash) throw new Error('Add a mobile number first — team members need one.')
                    await convertGuest(store, teamForGuest, person.id)
                    onClose()
                  }, `${person.name} added to the team`)
                }
              >
                Add
              </button>
            </div>
          </Field>
        )}

        <ErrorNote>{error}</ErrorNote>
        {person.isGuest && <Pill>Guests can’t log in</Pill>}
      </div>

      {confirmReset && (
        <Confirm
          title="Reset PIN?"
          message={`${person.name} will be logged out on all phones and must set a new PIN.`}
          confirmLabel="Reset PIN"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            resetPin(store, person.id, session!.personId)
            setConfirmReset(false)
            toast(`PIN reset for ${person.name}`)
          }}
        />
      )}
    </Sheet>
  )
}
