// A team we play against (PLAN §29): its players, our matches against it and
// its players' stats from those matches. Everyone can look; only the admin edits.
import { useMemo, useState } from 'react'
import { MatchRow } from '../components/match'
import { AddPlayerSheet } from '../components/scoring'
import { Screen } from '../components/Screen'
import { batsText, RoleTag } from '../components/Profile'
import { GroundMap } from '../components/scoring'
import { sideCareers, StatsTables, useScores } from '../components/StatsTab'
import { Avatar, Confirm, Empty, Segmented } from '../components/ui'
import { batStrikeRate, bestBowling, bowlEconomy, bowlOvers, formOf, highScore } from '../lib/career'
import { addOpponentPlayers, deleteOpponent, matchesOf, opponentsOf, removeOpponentPlayer } from '../lib/domain'
import { maskPhone } from '../lib/phone'
import { sortMatchesAsc } from '../lib/stats'
import { useApp, useTeamsLoaded } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import { BOWL_LABELS, WICKET_LABELS, type Match, type Opponent, type WicketKind } from '../types'
import { PlayerStatsView } from './PlayerStats'

const OPP_COLOR = '#475569'
type Tab = 'players' | 'matches' | 'stats'

/** Matches of the teams this person can see that were played against the opponent. */
export function useOpponentMatches(opponent: Opponent | undefined): Match[] {
  const { teams, myTeams, store } = useApp()
  // “With us” = the teams this person plays in or runs (everyone's, when they have none).
  const ids = (myTeams.length ? myTeams : teams).map((t) => t.id)
  useTeamsLoaded(ids)
  const key = ids.join(',')
  const version = store?.getVersion() ?? 0
  return useMemo(() => {
    if (!store || !opponent) return []
    const name = opponent.name.toLowerCase()
    return key
      .split(',')
      .filter(Boolean)
      .flatMap((id) => matchesOf(store, id))
      .filter((m) => !m.cancelled && (m.opponentId ? m.opponentId === opponent.id : m.opponent.toLowerCase() === name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, opponent, key, version])
}

/** "Played 3 · we won 2 · they won 1" from completed or scored results. */
export function headToHead(matches: Match[]): { played: number; won: number; lost: number } {
  const done = matches.filter((m) => m.result)
  return { played: done.length, won: done.filter((m) => m.result === 'won').length, lost: done.filter((m) => m.result === 'lost').length }
}

export function OpponentDetail({ opponentId }: { opponentId: string }) {
  const { store, isAdmin, isSuper, me, people, teams, personName, toast } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const route = useRoute()
  const sheet = useSheet()
  const opponent = store ? opponentsOf(store).find((o) => o.id === opponentId) : undefined
  const matches = useOpponentMatches(opponent)
  const q = route.query.get('tab')
  const tab: Tab = q === 'matches' || q === 'stats' ? q : 'players'

  if (!opponent || !store) {
    return (
      <Screen title="Team" back="/teams">
        <Empty icon="🤷" title="Team not found" />
      </Screen>
    )
  }

  const byId = new Map(people.map((p) => [p.id, p]))
  const players = [...opponent.playerIds].sort((a, b) => personName(a).localeCompare(personName(b)))
  const sorted = sortMatchesAsc(matches).reverse()
  const h = headToHead(matches)

  return (
    <Screen title={opponent.name} back="/teams">
      <div className="px-4 pt-3">
        <p className="mb-3 text-sm text-muted">
          Opponent team · {h.played === 0 ? 'no results against them yet' : `played ${h.played} · we won ${h.won} · they won ${h.lost}`}
        </p>
        {matches.some((m) => m.scoring) && (
          <button className="btn-secondary mb-3 w-full" onClick={() => navigate(`/opponents/${opponent.id}/scout`)}>
            🔍 Scouting sheet
          </button>
        )}
        <Segmented<Tab>
          value={tab}
          onChange={(t) => navigate(withQuery(route, { tab: t, sheet: null, arg: null }), { replace: true })}
          options={[
            { value: 'players', label: `Players (${players.length})` },
            { value: 'matches', label: `Matches (${matches.length})` },
            { value: 'stats', label: 'Stats' },
          ]}
        />
      </div>

      {tab === 'players' && (
        <div className="flex flex-col gap-3 p-4">
          {isAdmin && (
            <button className="btn-primary" onClick={() => sheet.open('addplayer')}>
              + Add player
            </button>
          )}
          {players.length === 0 ? (
            <Empty icon="👥" title="No players saved" text={isAdmin ? 'Add them here, or when you start scoring a match against this team.' : 'Players appear once a match against this team is scored.'} />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {players.map((id) => (
                <div key={id} className="row">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => navigate(`/opponents/${opponent.id}/players/${id}`)}>
                    <Avatar name={personName(id)} personId={id} color={OPP_COLOR} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{personName(id)}</span>
                      {isAdmin && <span className="block text-xs text-muted">{maskPhone(byId.get(id)?.phoneLast4)}</span>}
                    </span>
                  </button>
                  {isAdmin && (
                    <button
                      className="btn-ghost min-h-[36px] text-muted"
                      aria-label={`Remove ${personName(id)} from ${opponent.name}`}
                      onClick={() => {
                        removeOpponentPlayer(store, opponent.id, id)
                        toast(`${personName(id)} removed from ${opponent.name}`, () => addOpponentPlayers(store, opponent.id, [id]))
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="px-1 text-xs text-muted">Opponent players have no login. Removing one here keeps their past scorecards and stats.</p>
        </div>
      )}

      {tab === 'matches' && (
        <div className="p-4">
          {sorted.length === 0 ? (
            <Empty icon="📅" title="No matches against this team" />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {sorted.map((m) => (
                <MatchRow key={m.id} match={m} team={teams.find((t) => t.id === m.teamId)} showTeam />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'stats' && <StatsTables matches={matches} side="away" onOpen={(id) => navigate(`/opponents/${opponent.id}/players/${id}`)} />}

      {isAdmin && (isSuper || opponent.createdBy === me?.id) && (
        <div className="px-4 pb-6">
          <button className="btn-ghost w-full text-bad" onClick={() => setConfirmDelete(true)}>
            Delete this opponent
          </button>
        </div>
      )}
      {confirmDelete && (
        <Confirm
          title={`Delete ${opponent.name}?`}
          message={matches.length ? `Your ${matches.length} match${matches.length === 1 ? '' : 'es'} against them stay, with their name. Their saved player list is deleted (the players stay in the app).` : 'Their saved player list is deleted (the players stay in the app).'}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            try {
              deleteOpponent(store, opponent.id)
              toast(`${opponent.name} deleted`)
              navigate('/teams', { replace: true })
            } catch (e) {
              toast((e as Error).message)
            }
          }}
        />
      )}

      {sheet.name === 'addplayer' && isAdmin && (
        <AddPlayerSheet
          title={`Add player — ${opponent.name}`}
          onClose={sheet.close}
          onAdded={(person, existed) => {
            addOpponentPlayers(store, opponent.id, [person.id])
            toast(existed ? `Already in the app: ${person.name} — added` : `${person.name} added`)
            sheet.close()
          }}
        />
      )}
    </Screen>
  )
}

export function OpponentPlayerStats({ opponentId, personId }: { opponentId: string; personId: string }) {
  const { store } = useApp()
  const opponent = store ? opponentsOf(store).find((o) => o.id === opponentId) : undefined
  const matches = useOpponentMatches(opponent)
  return <PlayerStatsView personId={personId} matches={matches} back={`/opponents/${opponentId}?tab=stats`} teamName={opponent?.name ?? ''} color={OPP_COLOR} />
}

// ---------- scouting (PLAN §46) ----------
/** Their players' records from every scored match against them, best first. */
function useScouting(opponent: Opponent | undefined) {
  const matches = useOpponentMatches(opponent)
  const { files, scored, ready } = useScores(matches)
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const careers = useMemo(() => sideCareers(files, 'away'), [stamp])
  const batters = careers.filter((c) => c.bat.innings > 0).sort((a, b) => b.bat.runs - a.bat.runs)
  const bowlers = careers.filter((c) => c.bowl.balls > 0).sort((a, b) => b.bowl.wickets - a.bowl.wickets || a.bowl.runs - b.bowl.runs)
  return { matches, scored, ready, batters, bowlers }
}

/** Short "know your opponent" card for the match page; hidden until there is a scored match against them. */
export function ScoutCard({ opponentId }: { opponentId: string }) {
  const { store, personName } = useApp()
  const opponent = store ? opponentsOf(store).find((o) => o.id === opponentId) : undefined
  const { scored, ready, batters, bowlers } = useScouting(opponent)
  if (!opponent || !ready || scored.length === 0 || (batters.length === 0 && bowlers.length === 0)) return null
  const h = headToHead(scored)
  return (
    <div className="card flex flex-col gap-2 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Know your opponent</h2>
        <span className="text-xs text-muted">
          from {scored.length} scored match{scored.length === 1 ? '' : 'es'}
          {h.played > 0 && ` · we won ${h.won}, they won ${h.lost}`}
        </span>
      </div>
      {batters.length > 0 && (
        <p>
          <span className="text-muted">Watch their batters:</span>{' '}
          {batters
            .slice(0, 3)
            .map((c) => `${personName(c.id)} (${c.bat.runs} runs, SR ${batStrikeRate(c)})`)
            .join(', ')}
        </p>
      )}
      {bowlers.length > 0 && (
        <p>
          <span className="text-muted">Their main bowlers:</span>{' '}
          {bowlers
            .slice(0, 3)
            .map((c) => `${personName(c.id)} (${c.bowl.wickets} wkt${c.bowl.wickets === 1 ? '' : 's'}, econ ${bowlEconomy(c)})`)
            .join(', ')}
        </p>
      )}
      <button className="btn-secondary" onClick={() => navigate(`/opponents/${opponent.id}/scout`)}>
        Full scouting sheet
      </button>
    </div>
  )
}

export function OpponentScout({ opponentId }: { opponentId: string }) {
  const { store, people, personName } = useApp()
  const opponent = store ? opponentsOf(store).find((o) => o.id === opponentId) : undefined
  const { scored, ready, batters, bowlers } = useScouting(opponent)
  const back = `/opponents/${opponentId}`
  const person = (id: string) => people.find((p) => p.id === id)

  if (!opponent) {
    return (
      <Screen title="Scouting" back="/teams">
        <Empty icon="🤷" title="Team not found" />
      </Screen>
    )
  }
  return (
    <Screen title={`Scouting: ${opponent.name}`} back={back}>
      <div className="flex flex-col gap-4 p-4">
        {!ready ? (
          <p className="p-10 text-center text-sm text-muted">Loading…</p>
        ) : scored.length === 0 ? (
          <Empty icon="🔍" title="Nothing to scout yet" text="Once a match against this team has been scored ball by ball, their batters and bowlers show up here." />
        ) : (
          <>
            <p className="text-sm text-muted">
              From {scored.length} scored match{scored.length === 1 ? '' : 'es'} against {opponent.name}. Tap a player for their full record.
            </p>
            <section>
              <h2 className="section-title">Their batters</h2>
              <div className="flex flex-col gap-3">
                {batters.slice(0, 6).map((c) => {
                  const outs = (Object.keys(c.dismissals) as WicketKind[]).sort((a, b) => (c.dismissals[b] ?? 0) - (c.dismissals[a] ?? 0)).map((k) => `${WICKET_LABELS[k].toLowerCase()} ${c.dismissals[k]}`)
                  const form = formOf(c, scored)
                  return (
                    <button key={c.id} className="card p-3 text-left active:bg-alt" onClick={() => navigate(`/opponents/${opponent.id}/players/${c.id}`)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-semibold">
                          <span className="truncate">{personName(c.id)}</span>
                          <RoleTag person={person(c.id)} />
                        </span>
                        <span className="shrink-0 text-sm">
                          <strong>{c.bat.runs}</strong> runs · SR {batStrikeRate(c)} · HS {highScore(c)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {batsText(person(c.id))} · {c.bat.fours} fours, {c.bat.sixes} sixes · form {form.bat.join(', ')}
                      </p>
                      {outs.length > 0 && <p className="text-xs text-muted">Gets out: {outs.join(', ')}</p>}
                      {(c.shots.length > 0 || c.outAt.length > 0) && (
                        <div className="mx-auto mt-2 max-w-[220px]">
                          <GroundMap left={person(c.id)?.batsLeft} shots={c.shots} marks={c.outAt} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 px-1 text-xs text-muted">Maps: blue = fours, orange = sixes, ✕ = where they were caught or run out.</p>
            </section>
            <section>
              <h2 className="section-title">Their bowlers</h2>
              <div className="card divide-y divide-line overflow-hidden">
                {bowlers.slice(0, 6).map((c) => (
                  <button key={c.id} className="row active:bg-alt" onClick={() => navigate(`/opponents/${opponent.id}/players/${c.id}`)}>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="truncate">{personName(c.id)}</span>
                        <RoleTag person={person(c.id)} />
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {person(c.id)?.bowlStyle ? `${BOWL_LABELS[person(c.id)!.bowlStyle!]} · ` : ''}form {formOf(c, scored).bowl.join(', ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      <span className="block">
                        <strong>{c.bowl.wickets}</strong> wkt{c.bowl.wickets === 1 ? '' : 's'} · econ {bowlEconomy(c)}
                      </span>
                      <span className="block text-xs text-muted">
                        {bowlOvers(c)} ov · best {bestBowling(c)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </Screen>
  )
}