// Before the first ball (PLAN §24.2): overs, both playing XIs, and the toss.
import { useEffect, useMemo, useState } from 'react'
import { AddPlayerSheet } from '../components/scoring'
import { Screen } from '../components/Screen'
import { Avatar, ChoiceChips, Empty, ErrorNote, Field, NumberInput, Pill } from '../components/ui'
import { addOpponentPlayers, ensureOpponent, opponentsOf } from '../lib/domain'
import { maskPhone } from '../lib/phone'
import { P } from '../lib/paths'
import { startScoring } from '../lib/scoreDomain'
import { useApp, useFile, useTeam } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import type { ScoreFile, SideKey } from '../types'

export function ScoringSetup({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { isAdmin, store, people, personName, toast } = useApp()
  const sheet = useSheet()
  const data = useTeam(teamId)
  const match = data.matches.find((m) => m.id === matchId)
  const existing = useFile<ScoreFile>(P.scoring(teamId, matchId))
  const base = `/teams/${teamId}/matches/${matchId}`

  const opponents = store ? opponentsOf(store) : []
  const opponent = match ? (opponents.find((o) => o.id === match.opponentId) ?? opponents.find((o) => o.name.toLowerCase() === match.opponent.toLowerCase())) : undefined

  // Older matches were saved with just a name: give them an opponent record.
  const needsOpponent = isAdmin && !!store && !!match && !opponent && store.has(P.opponents)
  useEffect(() => {
    if (needsOpponent) ensureOpponent(store!, match!.opponent)
  }, [needsOpponent, store, match])

  // Scoring already running → this screen has nothing to do.
  useEffect(() => {
    if (existing) navigate(`${base}/score`, { replace: true })
  }, [existing, base])

  const [overs, setOvers] = useState('')
  const [ours, setOurs] = useState<string[] | null>(null)
  const [theirs, setTheirs] = useState<string[] | null>(null)
  const [extraOurs, setExtraOurs] = useState<string[]>([])
  const [wonBy, setWonBy] = useState<SideKey | undefined>()
  const [chose, setChose] = useState<'bat' | 'bowl' | undefined>()
  const [error, setError] = useState<string | null>(null)

  const oversValue = overs || (match?.overs ? String(match.overs) : '')
  const ourPool = useMemo(() => {
    if (!match) return []
    const active = data.members.filter((m) => m.status === 'active').map((m) => m.personId)
    return [...new Set([...match.squad, ...active, ...extraOurs])].sort((a, b) => personName(a).localeCompare(personName(b)))
  }, [match, data.members, extraOurs, personName])
  const ourXi = ours ?? match?.squad ?? []
  const theirPool = opponent?.playerIds ?? []
  const theirXi = (theirs ?? (theirPool.length <= 11 ? theirPool : [])).filter((id) => !ourXi.includes(id))
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])

  if (!isAdmin) {
    return (
      <Screen title="Live scoring" back={base}>
        <Empty icon="🔒" title="Admin only" text="Only the admin can score a match." />
      </Screen>
    )
  }
  if (!data.team || !match) {
    return (
      <Screen title="Live scoring" back={base}>
        <p className="p-10 text-center text-sm text-muted">{data.ready ? 'Match not found.' : 'Loading…'}</p>
      </Screen>
    )
  }
  const team = data.team

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  function start() {
    setError(null)
    if (!store || !opponent) return setError('The opponent team is still loading. Try again.')
    if (!wonBy || !chose) return setError('Record the toss: who won it and what they chose.')
    try {
      startScoring(store, {
        teamId,
        matchId,
        overs: Number(oversValue),
        opponentId: opponent.id,
        home: { name: team.name, shortName: team.shortName, xi: ourXi },
        away: { name: opponent.name, shortName: opponent.shortName, xi: theirXi },
        toss: { wonBy, chose },
      })
      navigate(`${base}/score`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const sides: { key: SideKey; name: string; pool: string[]; xi: string[]; set: (v: string[]) => void; color?: string }[] = [
    { key: 'home', name: team.name, pool: ourPool, xi: ourXi, set: setOurs, color: team.color },
    { key: 'away', name: match.opponent, pool: theirPool, xi: theirXi, set: setTheirs },
  ]

  return (
    <Screen
      title="Start live scoring"
      back={base}
      footer={
        <button className="btn-primary w-full" onClick={start}>
          Start match
        </button>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        <p className="text-sm text-muted">
          {team.shortName} vs {match.opponent}. Pick who is playing on both sides, record the toss, then start.
        </p>

        <Field label="Overs per innings">
          <NumberInput value={oversValue} onChange={setOvers} maxLength={3} placeholder="20" ariaLabel="Overs per innings" />
        </Field>

        {sides.map((side) => (
          <section key={side.key}>
            <div className="flex items-center justify-between">
              <h2 className="section-title">
                {side.name} — playing ({side.xi.length})
              </h2>
              <button className="btn-ghost min-h-[36px]" onClick={() => sheet.open('addplayer', side.key)}>
                + Add player
              </button>
            </div>
            {side.pool.length === 0 ? (
              <div className="card px-4 py-5 text-center text-sm text-muted">
                {side.key === 'away' ? 'No players saved for this opponent yet. Add them with name and mobile number — they are remembered for next time.' : 'No players yet.'}
              </div>
            ) : (
              <div className="card divide-y divide-line overflow-hidden">
                {side.pool.map((id) => {
                  const on = side.xi.includes(id)
                  const taken = side.key === 'away' && ourXi.includes(id)
                  return (
                    <button key={id} className="row active:bg-alt disabled:opacity-40" disabled={taken} aria-pressed={on} onClick={() => side.set(toggle(side.xi, id))}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm font-bold ${on ? 'border-brand bg-brand text-on-brand' : 'border-line'}`}>{on ? '✓' : ''}</span>
                      <Avatar name={personName(id)} color={side.color} size={32} />
                      <span className="min-w-0 flex-1 truncate">{personName(id)}</span>
                      <span className="text-xs text-muted">{taken ? 'in our XI' : maskPhone(byId.get(id)?.phoneLast4)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        ))}

        <section>
          <h2 className="section-title">Toss</h2>
          <div className="card flex flex-col gap-3 p-4">
            <div>
              <span className="label">Won by</span>
              <ChoiceChips
                options={[
                  { value: 'home' as SideKey, label: team.name },
                  { value: 'away' as SideKey, label: match.opponent },
                ]}
                value={wonBy}
                onChange={setWonBy}
              />
            </div>
            <div>
              <span className="label">Chose to</span>
              <ChoiceChips
                options={[
                  { value: 'bat' as const, label: 'Bat' },
                  { value: 'bowl' as const, label: 'Bowl' },
                ]}
                value={chose}
                onChange={setChose}
              />
            </div>
            {wonBy && chose && (
              <p className="text-sm">
                <Pill tone="brand">Batting first</Pill> {(chose === 'bat') === (wonBy === 'home') ? team.name : match.opponent}
              </p>
            )}
          </div>
        </section>

        <ErrorNote>{error}</ErrorNote>
      </div>

      {sheet.name === 'addplayer' && (
        <AddPlayerSheet
          title={`Add player — ${sheet.arg === 'home' ? team.name : match.opponent}`}
          onClose={sheet.close}
          onAdded={(person, existed) => {
            if (sheet.arg === 'home') {
              setExtraOurs((x) => [...new Set([...x, person.id])])
              setOurs([...new Set([...ourXi, person.id])])
            } else if (opponent && store) {
              if (ourXi.includes(person.id)) {
                toast(`${person.name} is in our XI — remove them there first`)
                return sheet.close()
              }
              addOpponentPlayers(store, opponent.id, [person.id])
              setTheirs([...new Set([...theirXi, person.id])])
            }
            toast(existed ? `Already in the app: ${person.name} — added` : `${person.name} added`)
            sheet.close()
          }}
        />
      )}
    </Screen>
  )
}
