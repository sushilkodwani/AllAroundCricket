// The opponent's playing XI, picked on the match screen before the day (like our
// squad). Start scoring then opens with these players and this captain ticked.
import { useEffect, useMemo, useState } from 'react'
import { AddPlayerSheet, BulkPlayersSheet } from '../components/scoring'
import { Screen } from '../components/Screen'
import { Avatar, Empty, ErrorNote } from '../components/ui'
import { addOpponentPlayers, ensureOpponent, opponentsOf, setOpponentXi } from '../lib/domain'
import { maskPhone } from '../lib/phone'
import { P } from '../lib/paths'
import { useApp, useTeam } from '../state/AppContext'
import { goBack, useSheet } from '../state/router'

export function OpponentXiPicker({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { canManage, store, people, personName, toast } = useApp()
  const isAdmin = canManage(teamId)
  const sheet = useSheet()
  const data = useTeam(teamId)
  const match = data.matches.find((m) => m.id === matchId)
  const backTo = `/teams/${teamId}/matches/${matchId}`
  const opponents = store ? opponentsOf(store) : []
  const opponent = match ? (opponents.find((o) => o.id === match.opponentId) ?? opponents.find((o) => o.name.toLowerCase() === match.opponent.toLowerCase())) : undefined
  const [sel, setSel] = useState<string[] | null>(null)
  const [captain, setCaptain] = useState<string | undefined | null>(null)
  const [error, setError] = useState<string | null>(null)
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])

  // Older matches were saved with just a name: give them an opponent record.
  const needsOpponent = isAdmin && !!store && !!match && !opponent && store.has(P.opponents)
  useEffect(() => {
    if (needsOpponent) ensureOpponent(store!, match!.opponent)
  }, [needsOpponent, store, match])

  if (!match || !store || !isAdmin) {
    return (
      <Screen title="Opponent playing XI" back={backTo}>
        {data.ready || !isAdmin ? <Empty icon="🤷" title="Match not found" /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>}
      </Screen>
    )
  }

  const pool = [...(opponent?.playerIds ?? [])].sort((a, b) => personName(a).localeCompare(personName(b)))
  const xi = (sel ?? match.opponentXi ?? []).filter((id) => !match.squad.includes(id))
  const cap = captain === null ? match.opponentCaptainId : captain
  const capOk = cap && xi.includes(cap) ? cap : undefined
  // Always from the latest pick, so quick taps never undo each other.
  const current = (prev: string[] | null) => (prev ?? match.opponentXi ?? []).filter((id) => !match.squad.includes(id))
  const toggle = (id: string) => setSel((prev) => (current(prev).includes(id) ? current(prev).filter((x) => x !== id) : [...current(prev), id]))
  const add = (ids: string[]) => {
    const free = ids.filter((id) => !match.squad.includes(id))
    if (free.length < ids.length) toast('Some players are in our squad, so they were left out')
    if (opponent) addOpponentPlayers(store, opponent.id, free)
    setSel((prev) => [...new Set([...current(prev), ...free])])
  }

  function save() {
    setError(null)
    try {
      setOpponentXi(store!, teamId, matchId, xi, capOk)
      toast(xi.length ? `${match!.opponent}: ${xi.length} player${xi.length === 1 ? '' : 's'} picked` : 'Opponent XI cleared')
      goBack(backTo)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Screen
      title={`${match.opponent} XI`}
      back={backTo}
      footer={
        <button className="btn-primary w-full" disabled={xi.length > 11 || !opponent} onClick={save}>
          Save ({xi.length}/11{capOk ? ', captain picked' : ''})
        </button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted">Tick who is playing for {match.opponent} and tap C for their captain. Start scoring opens with them picked; you can still change it there.</p>
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0">
            {match.opponent} ({xi.length})
          </h2>
          <div className="flex gap-1">
            <button className="btn-ghost min-h-[36px]" disabled={!opponent} onClick={() => sheet.open('addplayer')}>
              + Add player
            </button>
            <button className="btn-ghost min-h-[36px]" disabled={!opponent} onClick={() => sheet.open('bulkplayers')}>
              Bulk add
            </button>
          </div>
        </div>
        {pool.length === 0 ? (
          <div className="card px-4 py-5 text-center text-sm text-muted">No players saved for {match.opponent} yet. Add them with a name (the mobile number is optional) — they are remembered for next time.</div>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {pool.map((id) => {
              const on = xi.includes(id)
              const taken = match.squad.includes(id)
              const isCaptain = capOk === id
              return (
                <div key={id} className="flex items-center">
                  <button className="row min-w-0 flex-1 active:bg-alt disabled:opacity-40" disabled={taken} aria-pressed={on} onClick={() => toggle(id)}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm font-bold ${on ? 'border-brand bg-brand text-on-brand' : 'border-line'}`}>{on ? '✓' : ''}</span>
                    <Avatar name={personName(id)} personId={id} size={32} />
                    <span className="min-w-0 flex-1 truncate">{personName(id)}</span>
                    <span className="text-xs text-muted">{taken ? 'in our squad' : maskPhone(byId.get(id)?.phoneLast4)}</span>
                  </button>
                  {on && (
                    <button
                      className={`mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${isCaptain ? 'border-brand bg-brand text-on-brand' : 'border-chip-line bg-chip text-ink'}`}
                      aria-pressed={isCaptain}
                      aria-label={`${isCaptain ? 'Captain' : 'Make captain'}: ${personName(id)}`}
                      onClick={() => setCaptain(id)}
                    >
                      C
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {xi.length > 11 && <ErrorNote>{xi.length} picked — a side plays 11 at most.</ErrorNote>}
        <ErrorNote>{error}</ErrorNote>
      </div>

      {sheet.name === 'addplayer' && (
        <AddPlayerSheet
          title={`Add player — ${match.opponent}`}
          phoneOptional
          onClose={sheet.close}
          onAdded={(person, existed) => {
            add([person.id])
            toast(existed ? `Already in the app: ${person.name} — added` : `${person.name} added`)
            sheet.close()
          }}
        />
      )}
      {sheet.name === 'bulkplayers' && (
        <BulkPlayersSheet
          title={`Bulk add players — ${match.opponent}`}
          phoneOptional
          onClose={sheet.close}
          onAdded={(persons, existing) => {
            add(persons.map((p) => p.id))
            toast(`${persons.length} player${persons.length === 1 ? '' : 's'} added${existing ? `, ${existing} already in the app` : ''}`)
            sheet.close()
          }}
        />
      )}
    </Screen>
  )
}
