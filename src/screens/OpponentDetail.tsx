// A team we play against (PLAN §29): its players, our matches against it and
// its players' stats from those matches. Everyone can look; only the admin edits.
import { useMemo } from 'react'
import { MatchRow } from '../components/match'
import { AddPlayerSheet } from '../components/scoring'
import { Screen } from '../components/Screen'
import { StatsTables } from '../components/StatsTab'
import { Avatar, Empty, Segmented } from '../components/ui'
import { addOpponentPlayers, matchesOf, opponentsOf, removeOpponentPlayer } from '../lib/domain'
import { maskPhone } from '../lib/phone'
import { sortMatchesAsc } from '../lib/stats'
import { useApp, useTeamsLoaded } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import type { Match, Opponent } from '../types'
import { PlayerStatsView } from './PlayerStats'

const OPP_COLOR = '#475569'
type Tab = 'players' | 'matches' | 'stats'

/** Matches of the teams this person can see that were played against the opponent. */
export function useOpponentMatches(opponent: Opponent | undefined): Match[] {
  const { teams, store } = useApp()
  const ids = teams.map((t) => t.id)
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
  const { store, isAdmin, people, teams, personName, toast } = useApp()
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
                    <Avatar name={personName(id)} color={OPP_COLOR} size={36} />
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
