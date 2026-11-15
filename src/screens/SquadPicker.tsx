// Full-screen squad picker (PLAN §7.4, §20.2): tick everyone at once, add
// guests, save in one write.
import { useMemo, useState } from 'react'
import { Screen } from '../components/Screen'
import { Avatar, Empty, ErrorNote, Field, PhoneInput, Pill, Sheet } from '../components/ui'
import { fmtDayMonth } from '../lib/dates'
import { addGuest, isGuestIn, matchesOf, setSquad } from '../lib/domain'
import { normalizePhone } from '../lib/phone'
import { sortMatchesAsc } from '../lib/stats'
import { useApp, useTeam } from '../state/AppContext'
import { goBack, useSheet } from '../state/router'
import type { Person } from '../types'

export function SquadPicker({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { people, teams, store, allTeams, isAdmin } = useApp()
  const sheet = useSheet()
  const data = useTeam(teamId)
  const team = teams.find((t) => t.id === teamId)
  const match = data.matches.find((m) => m.id === matchId)
  const [sel, setSel] = useState<Set<string> | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const backTo = `/teams/${teamId}/matches/${matchId}`

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  if (!team || !match || !store || !isAdmin) {
    return (
      <Screen title="Pick squad" back={backTo}>
        {data.ready || !isAdmin ? <Empty icon="🤷" title="Match not found" /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>}
      </Screen>
    )
  }

  // Selection starts from the saved squad; local until Done.
  const selected = sel ?? new Set(match.squad)
  const activeIds = data.members.filter((m) => m.status === 'active').map((m) => m.personId)
  // Active members, plus anyone already selected who isn't one (left the team, or a guest).
  const extraIds = [...selected].filter((id) => !activeIds.includes(id))
  const candidates = [...activeIds, ...extraIds]
    .map((id) => byId.get(id))
    .filter((p): p is Person => !!p)
    .sort((a, b) => a.name.localeCompare(b.name))
  const q = query.trim().toLowerCase()
  const shown = q ? candidates.filter((p) => p.name.toLowerCase().includes(q)) : candidates

  // "Same as last match": the latest other match of this team that has a squad.
  const lastWithSquad = sortMatchesAsc(data.matches)
    .filter((m) => m.id !== match.id && !m.cancelled && m.squad.length > 0 && m.date <= match.date)
    .pop()

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSel(next)
  }

  function done() {
    try {
      setSquad(store!, teamId, matchId, [...selected])
      goBack(backTo)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const wantsEleven = (match.matchType === 'league' || match.matchType === 'tournament') && selected.size !== 11 && selected.size > 0

  return (
    <Screen
      title="Pick squad"
      back={backTo}
      footer={
        <div className="flex items-center gap-3">
          <span className="flex-1 text-sm">
            <strong>{selected.size} selected</strong>
            {wantsEleven && <span className="block text-xs text-warn">A {match.matchType} side is usually 11.</span>}
          </span>
          <button className="btn-primary px-8" onClick={done}>
            Done
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          vs {match.opponent} · {fmtDayMonth(match.date)}
        </p>
        <input className="input" type="search" placeholder="Search players" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />
        <div className="flex flex-wrap gap-2">
          <button className="chip min-h-[36px] px-3" onClick={() => setSel(new Set([...selected, ...activeIds]))}>
            Select all
          </button>
          <button className="chip min-h-[36px] px-3" onClick={() => setSel(new Set())}>
            Clear
          </button>
          {lastWithSquad && (
            <button className="chip min-h-[36px] px-3" onClick={() => setSel(new Set(lastWithSquad.squad))}>
              Same as last match
            </button>
          )}
        </div>
        <ErrorNote>{error}</ErrorNote>

        {candidates.length === 0 ? (
          <Empty icon="👥" title="No players in this team yet" text="Add players to the team first, or add a guest below." />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {shown.map((p) => {
              const on = selected.has(p.id)
              const guest = isGuestIn(data.members, p.id)
              return (
                <label key={p.id} className="row cursor-pointer active:bg-alt">
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-[rgb(155,28,31)]" checked={on} onChange={() => toggle(p.id)} />
                  <Avatar name={p.name} color={team.color} size={36} />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    {!guest && !activeIds.includes(p.id) && <span className="text-muted"> (left team)</span>}
                  </span>
                  {guest && <Pill>Guest</Pill>}
                </label>
              )
            })}
            {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No player matches “{query}”.</p>}
          </div>
        )}

        <button className="btn-secondary" onClick={() => sheet.open('guest')}>
          + Add guest
        </button>
      </div>

      {sheet.name === 'guest' && (
        <GuestSheet
          teamId={teamId}
          exclude={new Set([...activeIds, ...selected])}
          onClose={sheet.close}
          onPicked={(id) => {
            setSel(new Set([...selected, id]))
            sheet.close()
          }}
          lastPlayedFor={(id) => {
            const m = sortMatchesAsc(allTeams.flatMap((t) => matchesOf(store, t.id)))
              .filter((x) => x.squad.includes(id))
              .pop()
            return m ? `last played ${fmtDayMonth(m.date)}` : undefined
          }}
        />
      )}
    </Screen>
  )
}

/** Add a guest: pick a past guest / a member of another team, or type a new name (number optional). */
function GuestSheet({
  teamId,
  exclude,
  onClose,
  onPicked,
  lastPlayedFor,
}: {
  teamId: string
  exclude: Set<string>
  onClose: () => void
  onPicked: (personId: string) => void
  lastPlayedFor: (personId: string) => string | undefined
}) {
  const { people, store, allTeams, config } = useApp()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const q = name.trim().toLowerCase()
  const suggestions = people
    .filter((p) => !exclude.has(p.id) && p.id !== config?.adminPersonId)
    .filter((p) => p.guestOfTeamIds?.includes(teamId) || p.teamIds.some((t) => t !== teamId))
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8)

  async function create() {
    setError(null)
    let clean: string | undefined
    if (phone) {
      const p = normalizePhone(phone)
      if (!p.ok) return setError(p.error)
      clean = p.phone
    }
    setBusy(true)
    try {
      const person = await addGuest(store!, teamId, name, clean)
      onPicked(person.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add guest" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Someone playing this match who isn’t in the team’s master list. Guests can’t log in.</p>
        <Field label="Name">
          <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>

        {suggestions.length > 0 && (
          <div>
            <span className="label">Played before / other teams</span>
            <div className="card divide-y divide-line overflow-hidden">
              {suggestions.map((p) => {
                const teams = allTeams.filter((t) => p.teamIds.includes(t.id)).map((t) => t.shortName)
                return (
                  <button
                    key={p.id}
                    className="row active:bg-alt"
                    onClick={() => {
                      // Reuse the existing person; remember they guested for this team.
                      onPicked(p.id)
                    }}
                  >
                    <Avatar name={p.name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      <span className="block truncate text-xs text-muted">{[teams.length ? teams.join(', ') : 'Guest', lastPlayedFor(p.id)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="text-accent">Add</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <Field label="Mobile number (optional, 10 digits)">
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? 'Adding…' : 'Add new guest'}
        </button>
      </div>
    </Sheet>
  )
}
