import { useEffect, useMemo, useState } from 'react'
import { InstallBanner } from '../components/InstallBanner'
import { HeaderButton, Screen } from '../components/Screen'
import { liveStats, TeamCard } from '../components/TeamCard'
import { TeamSheet } from '../components/TeamSheet'
import { Avatar, Empty } from '../components/ui'
import { ensureOpponent, matchesOf, opponentsOf } from '../lib/domain'
import { P } from '../lib/paths'
import { getPref } from '../lib/session'
import type { Opponent } from '../types'
import { headToHead, useOpponentMatches } from './OpponentDetail'
import { useApp, useTeamsLoaded } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import { TokenExpiryBanner } from './Settings'

export function Teams() {
  const { teams, isAdmin, refresh, store } = useApp()
  const sheet = useSheet()
  const [refreshing, setRefreshing] = useState(false)
  const showArchived = isAdmin && getPref('showArchived', false)

  const visible = teams.filter((t) => showArchived || !t.archived)
  // Team files load in the background so cards can show fresh next/last match and the personal line.
  useTeamsLoaded(visible.map((t) => t.id))

  // Nearest upcoming match first, then by name.
  const sorted = [...visible].sort((a, b) => {
    const na = liveStats(store, a).nextMatch
    const nb = liveStats(store, b).nextMatch
    const ka = na ? na.date + (na.time ?? '') : '9999'
    const kb = nb ? nb.date + (nb.time ?? '') : '9999'
    return ka.localeCompare(kb) || a.name.localeCompare(b.name)
  })

  // Teams we play against, below our own. A name that is also one of our teams is not repeated.
  const mine = new Set(teams.map((t) => t.name.toLowerCase()))
  const others = (store ? opponentsOf(store) : []).filter((o) => !mine.has(o.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name))

  // Opponents of matches added before opponent teams existed get a record too (admin only — it is a write).
  const missing = useMemo(() => {
    if (!store || !isAdmin || !store.has(P.opponents)) return ''
    const known = new Set(opponentsOf(store).map((o) => o.name.toLowerCase()))
    const names = teams.flatMap((t) => matchesOf(store, t.id)).map((m) => m.opponent)
    return [...new Set(names.filter((n) => !known.has(n.toLowerCase())))].join('|')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, isAdmin, teams, store?.getVersion()])
  useEffect(() => {
    if (store) for (const name of missing.split('|').filter(Boolean)) ensureOpponent(store, name)
  }, [store, missing])

  async function doRefresh() {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  return (
    <Screen
      title="Teams"
      actions={
        <>
          <HeaderButton label="Refresh from GitHub" onClick={() => void doRefresh()}>
            <span className={refreshing ? 'animate-spin' : ''}>⟳</span>
          </HeaderButton>
          {isAdmin && (
            <button className="mr-2 min-h-[36px] rounded-full bg-white px-3 text-sm font-semibold text-brand" onClick={() => sheet.open('team')}>
              + Team
            </button>
          )}
        </>
      }
    >
      <InstallBanner />
      <TokenExpiryBanner />
      {sorted.length === 0 ? (
        <Empty
          icon="🏏"
          title="No teams yet"
          text={isAdmin ? 'Create your first team, then add players and matches.' : 'Your admin hasn’t added you to a team yet.'}
          action={
            isAdmin ? (
              <button className="btn-primary" onClick={() => sheet.open('team')}>
                + Create a team
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          {others.length > 0 && <h2 className="section-title !pb-0">{sorted.length === 1 ? 'My team' : 'My teams'}</h2>}
          {sorted.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <section className="px-4 pb-4">
          <h2 className="section-title">Other teams ({others.length})</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {others.map((o) => (
              <OtherTeamRow key={o.id} opponent={o} />
            ))}
          </div>
        </section>
      )}

      {sheet.name === 'team' && isAdmin && <TeamSheet onClose={sheet.close} onCreated={(t) => sheet.replaceWith(`/teams/${t.id}`)} />}
    </Screen>
  )
}

function OtherTeamRow({ opponent }: { opponent: Opponent }) {
  const matches = useOpponentMatches(opponent)
  const h = headToHead(matches)
  return (
    <button className="row active:bg-alt" onClick={() => navigate(`/opponents/${opponent.id}`)}>
      <Avatar name={opponent.name} color="#475569" size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{opponent.name}</span>
        <span className="block truncate text-xs text-muted">
          {opponent.playerIds.length} player{opponent.playerIds.length === 1 ? '' : 's'} · {matches.length} match{matches.length === 1 ? '' : 'es'}
          {h.played > 0 && ` · we won ${h.won}, they won ${h.lost}`}
        </span>
      </span>
      <span className="text-muted">›</span>
    </button>
  )
}

export const openTeam =(id: string) => navigate(`/teams/${id}`)
