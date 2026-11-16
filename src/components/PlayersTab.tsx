// A team's master list (PLAN §7.3): add / remove / re-add players, bulk add,
// the player sheet, and the share message for a newly added player.
import { useMemo, useState } from 'react'
import { fmtDate } from '../lib/dates'
import { addExistingPlayer, addNewPlayer, changeNumber, lookupPlayer, removePlayer, renamePerson, type PlayerLookup } from '../lib/domain'
import { maskPhone, normalizePhone } from '../lib/phone'
import { lastPlayed, playedCount } from '../lib/stats'
import { RoleTag } from './Profile'
import { useApp, type TeamData } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import type { Person, Team } from '../types'
import { SwipeRow } from './SwipeRow'
import { Avatar, Confirm, Empty, ErrorNote, Field, PhoneInput, Pill, Sheet, Toggle } from './ui'

function shareText(name: string, team: Team, owner: string, repo: string): string {
  const link = `${window.location.origin}${window.location.pathname}`
  return [
    `Hi ${name}! You’ve been added to ${team.name} on AllAroundCricket.`,
    '',
    `1. Open ${link} on your phone and add it to your Home Screen.`,
    `2. Open the app and enter: repo owner “${owner}”, repo name “${repo}”, the access token (I’ll send it separately), and your 10-digit mobile number.`,
    '3. Set your own 6-digit PIN.',
  ].join('\n')
}

export function PlayersTab({ data }: { data: TeamData & { team: Team } }) {
  const { people, isAdmin, store, toast } = useApp()
  const sheet = useSheet()
  const [query, setQuery] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)
  const { team, members, matches } = data

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const active = members
    .filter((m) => m.status === 'active')
    .map((m) => byId.get(m.personId))
    .filter((p): p is Person => !!p)
    .sort((a, b) => a.name.localeCompare(b.name))
  const removed = members
    .filter((m) => m.status === 'removed')
    .map((m) => byId.get(m.personId))
    .filter((p): p is Person => !!p)
    .sort((a, b) => a.name.localeCompare(b.name))

  const q = query.trim().toLowerCase()
  const shown = q ? active.filter((p) => p.name.toLowerCase().includes(q)) : active
  const selected = sheet.name === 'player' ? byId.get(sheet.arg ?? '') : undefined

  function remove(p: Person) {
    if (!store) return
    removePlayer(store, team.id, p.id)
    toast(`${p.name} removed from ${team.name}`, () => addExistingPlayer(store, team.id, p.id))
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {isAdmin && (
        <div className="flex gap-2">
          <button className="btn-primary flex-1" onClick={() => sheet.open('add')}>
            + Add player
          </button>
          <button className="btn-secondary" onClick={() => sheet.open('bulk')}>
            Bulk add
          </button>
        </div>
      )}

      {active.length > 10 && <input className="input" type="search" placeholder="Search players" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />}

      {active.length === 0 ? (
        <Empty icon="👥" title="No players yet" text={isAdmin ? 'Add players with their name and mobile number. Each one gets view-only access automatically.' : 'The admin hasn’t added players yet.'} />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {shown.map((p) => {
            const played = playedCount(matches, p.id)
            return (
              <SwipeRow key={p.id} disabled={!isAdmin} onAction={() => remove(p)}>
                <button className="row active:bg-alt" onClick={() => sheet.open('player', p.id)}>
                  <Avatar name={p.name} color={team.color} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="truncate">{p.name}</span>
                      <RoleTag person={p} />
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {played} match{played === 1 ? '' : 'es'} played
                      {isAdmin && ` · ${maskPhone(p.phoneLast4)}`}
                    </span>
                  </span>
                  {isAdmin && p.access === 'none' && <Pill tone="warn">No access</Pill>}
                </button>
              </SwipeRow>
            )
          })}
          {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No player matches “{query}”.</p>}
        </div>
      )}

      {isAdmin && removed.length > 0 && (
        <>
          <div className="flex items-center justify-between px-1">
            <span className="text-sm text-muted">Show removed players ({removed.length})</span>
            <Toggle label="Show removed players" checked={showRemoved} onChange={setShowRemoved} />
          </div>
          {showRemoved && (
            <div className="card divide-y divide-line overflow-hidden">
              {removed.map((p) => (
                <div key={p.id} className="row">
                  <Avatar name={p.name} />
                  <span className="min-w-0 flex-1 truncate text-muted">{p.name}</span>
                  <button
                    className="btn-secondary min-h-[36px]"
                    onClick={() => {
                      addExistingPlayer(store!, team.id, p.id)
                      toast(`${p.name} is back in ${team.name}`)
                    }}
                  >
                    Re-add
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {sheet.name === 'add' && isAdmin && <AddPlayerSheet team={team} onClose={sheet.close} />}
      {sheet.name === 'bulk' && isAdmin && <BulkAddSheet team={team} onClose={sheet.close} />}
      {selected && <PlayerSheet person={selected} data={data} onClose={sheet.close} onRemove={() => remove(selected)} />}
    </div>
  )
}

function AddPlayerSheet({ team, onClose }: { team: Team; onClose: () => void }) {
  const { store, session } = useApp()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<Extract<PlayerLookup, { kind: 'removed' | 'elsewhere' }> | null>(null)
  const [grant, setGrant] = useState(true)
  // The typed number stays in memory just long enough to offer a WhatsApp link; it is never stored.
  const [added, setAdded] = useState<{ name: string; phone: string } | null>(null)
  if (!store) return null

  async function submit() {
    setError(null)
    const p = normalizePhone(phone)
    if (!name.trim()) return setError('Enter the player’s name.')
    if (!p.ok) return setError(p.error)
    setBusy(true)
    try {
      const res = await lookupPlayer(store!, team.id, p.phone)
      if (res.kind === 'active') throw new Error(`Already in this team (${res.person.name}).`)
      if (res.kind === 'new') {
        const person = addNewPlayer(store!, team.id, name, p.phone, res.phoneHash)
        setAdded({ name: person.name, phone: p.phone })
      } else {
        setFound(res)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function confirmExisting() {
    if (!found) return
    try {
      addExistingPlayer(store!, team.id, found.person.id, { grantAccess: found.person.access === 'none' && grant })
      setAdded({ name: found.person.name, phone })
      setFound(null)
    } catch (e) {
      setError((e as Error).message)
      setFound(null)
    }
  }

  if (added) {
    const text = shareText(added.name, team, session?.owner ?? '', session?.repo ?? '')
    return (
      <Sheet title="Player added" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <p className="rounded-xl bg-ok/15 px-3 py-2 text-sm text-ok">{added.name} added — they can now onboard with their number.</p>
          <p className="text-sm text-muted">Send them the app link and steps. Share the access token separately and privately.</p>
          <div className="flex flex-wrap gap-2">
            {'share' in navigator && (
              <button className="btn-primary flex-1" onClick={() => void navigator.share({ text }).catch(() => {})}>
                Share…
              </button>
            )}
            <a className="btn-secondary flex-1" href={`https://wa.me/91${added.phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <CopyButton text={text} />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-secondary flex-1"
              onClick={() => {
                setAdded(null)
                setName('')
                setPhone('')
              }}
            >
              Add another
            </button>
            <button className="btn-primary flex-1" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="Add player" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Name">
          <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Mobile number (10 digits)" hint="Gives this number view-only access automatically.">
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Add player'}
        </button>
      </form>

      {found && (
        <Confirm
          title={found.kind === 'removed' ? `Re-add ${found.person.name}?` : `Add ${found.person.name} to this team?`}
          message={
            found.kind === 'removed'
              ? `${found.person.name} was in ${team.name} before.`
              : `This number belongs to ${found.person.name}${found.teamNames.length ? ` (${found.teamNames.join(', ')})` : found.person.isGuest ? ' (guest)' : ''}.`
          }
          confirmLabel={found.kind === 'removed' ? 'Re-add' : 'Add'}
          onCancel={() => setFound(null)}
          onConfirm={confirmExisting}
        >
          {found.person.access === 'none' && !found.person.isGuest && (
            <label className="mt-3 flex min-h-[44px] items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={grant} onChange={(e) => setGrant(e.target.checked)} />
              Their access is switched off — turn it back on
            </label>
          )}
        </Confirm>
      )}
    </Sheet>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="btn-secondary flex-1"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => {})
      }
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

interface BulkLine {
  raw: string
  name: string
  phone?: string
  error?: string
}

/** Each line: a name followed by a 10-digit number, e.g. "Rahul Sharma 9876543210". */
export function parseBulk(text: string): BulkLine[] {
  const seen = new Set<string>()
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^(.*?)[\s,;:-]*((?:\+?91[\s-]*)?0?[\d][\d\s-]{8,})$/)
      const name = (m ? m[1] : raw).replace(/[\s,;:-]+$/, '').trim()
      if (!m) return { raw, name, error: 'No mobile number found' }
      const p = normalizePhone(m[2])
      if (!p.ok) return { raw, name, error: p.error }
      if (!name) return { raw, name, error: 'Name is missing' }
      if (seen.has(p.phone)) return { raw, name, error: 'Same number as a line above' }
      seen.add(p.phone)
      return { raw, name, phone: p.phone }
    })
}

function BulkAddSheet({ team, onClose }: { team: Team; onClose: () => void }) {
  const { store, toast } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = useMemo(() => parseBulk(text), [text])
  const valid = lines.filter((l) => l.phone)

  async function addAll() {
    if (!store) return
    setBusy(true)
    let added = 0
    let skipped = 0
    for (const line of valid) {
      try {
        const res = await lookupPlayer(store, team.id, line.phone!)
        if (res.kind === 'new') addNewPlayer(store, team.id, line.name, line.phone!, res.phoneHash)
        else if (res.kind === 'active') {
          skipped++
          continue
        } else addExistingPlayer(store, team.id, res.person.id)
        added++
      } catch {
        skipped++
      }
    }
    setBusy(false)
    toast(`${added} player${added === 1 ? '' : 's'} added${skipped ? `, ${skipped} skipped (already in the team)` : ''}`)
    onClose()
  }

  return (
    <Sheet title="Bulk add players" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="One player per line" hint="Name followed by the 10-digit number.">
          <textarea className="input min-h-[140px] py-2 font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Rahul Sharma 9876543210\nVikram Rao 98765 43211'} />
        </Field>
        {lines.length > 0 && (
          <div className="card divide-y divide-line overflow-hidden text-sm">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{l.name || l.raw}</span>
                {l.phone ? <span className="shrink-0 text-ok">✓ {maskPhone(l.phone.slice(-4))}</span> : <span className="shrink-0 text-bad">{l.error}</span>}
              </div>
            ))}
          </div>
        )}
        <button className="btn-primary" disabled={busy || valid.length === 0} onClick={() => void addAll()}>
          {busy ? 'Adding…' : `Add ${valid.length} valid player${valid.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Sheet>
  )
}

function PlayerSheet({ person, data, onClose, onRemove }: { person: Person; data: TeamData & { team: Team }; onClose: () => void; onRemove: () => void }) {
  const { store, isAdmin, allTeams, toast } = useApp()
  const [name, setName] = useState(person.name)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const teams = allTeams.filter((t) => person.teamIds.includes(t.id))
  const played = playedCount(data.matches, person.id)
  const last = lastPlayed(data.matches, person.id)
  const others = teams.filter((t) => t.id !== data.team.id)

  async function saveNumber() {
    const p = normalizePhone(phone)
    if (!p.ok) return setError(p.error)
    try {
      await changeNumber(store!, person.id, p.phone)
      setPhone('')
      setError(null)
      toast('Number changed')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title={person.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={person.name} color={data.team.color} size={52} />
          <div className="min-w-0 text-sm">
            <div className="truncate text-muted">{teams.map((t) => t.name).join(', ') || 'No active team'}</div>
            <div>
              {played} match{played === 1 ? '' : 'es'} played for {data.team.shortName}
            </div>
            <div className="text-muted">{last ? `Last played ${fmtDate(last.date)} vs ${last.opponent}` : 'Hasn’t played yet'}</div>
          </div>
        </div>

        <button className="btn-primary" onClick={() => navigate(`/teams/${data.team.id}/players/${person.id}`, { replace: true })}>
          View profile and stats
        </button>

        {isAdmin && store && (
          <>
            <Field label="Name" hint={others.length ? `Also changes the name in ${others.map((t) => t.name).join(', ')}.` : undefined}>
              <div className="flex gap-2">
                <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
                <button
                  className="btn-secondary"
                  disabled={!name.trim() || name.trim() === person.name}
                  onClick={() => {
                    try {
                      renamePerson(store, person.id, name)
                      toast('Name saved')
                    } catch (e) {
                      setError((e as Error).message)
                    }
                  }}
                >
                  Save
                </button>
              </div>
            </Field>
            <Field label={`Change number (now ${maskPhone(person.phoneLast4)})`}>
              <div className="flex gap-2">
                <PhoneInput value={phone} onChange={setPhone} placeholder="New 10-digit number" ariaLabel="New mobile number" />
                <button className="btn-secondary" disabled={phone.length !== 10} onClick={() => void saveNumber()}>
                  Save
                </button>
              </div>
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => navigate(`/settings/users?sheet=user&arg=${person.id}`)}>
                Access &amp; PIN
              </button>
              <button className="btn-danger flex-1" onClick={() => setConfirmRemove(true)}>
                Remove from team
              </button>
            </div>
          </>
        )}
      </div>

      {confirmRemove && (
        <Confirm
          title={`Remove ${person.name} from ${data.team.name}?`}
          message="Past matches keep their name."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false)
            onClose()
            onRemove()
          }}
        />
      )}
    </Sheet>
  )
}
