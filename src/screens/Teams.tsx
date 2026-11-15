import { useState } from 'react'
import { InstallBanner } from '../components/InstallBanner'
import { HeaderButton, Screen } from '../components/Screen'
import { liveStats, TeamCard } from '../components/TeamCard'
import { TeamSheet } from '../components/TeamSheet'
import { Empty } from '../components/ui'
import { getPref } from '../lib/session'
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
          {sorted.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      )}

      {sheet.name === 'team' && isAdmin && <TeamSheet onClose={sheet.close} onCreated={(t) => sheet.replaceWith(`/teams/${t.id}`)} />}
    </Screen>
  )
}

export const openTeam = (id: string) => navigate(`/teams/${id}`)
