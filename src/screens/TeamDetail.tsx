import { useState } from 'react'
import { MatchRow } from '../components/match'
import { MatchForm } from '../components/MatchForm'
import { PlayersTab } from '../components/PlayersTab'
import { HeaderButton, Screen } from '../components/Screen'
import { StatsTab } from '../components/StatsTab'
import { TeamSheet } from '../components/TeamSheet'
import { ChoiceChips, Confirm, Empty, ErrorNote, Segmented, Sheet, TeamLogo } from '../components/ui'
import { deleteTeam, setTeamArchived } from '../lib/domain'
import { P } from '../lib/paths'
import { filterBySeason } from '../lib/seasons'
import { matchStatus, sortMatchesAsc } from '../lib/stats'
import { useApp, useFile, useTeam, type TeamData } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import type { SeasonsFile, Team } from '../types'

type Tab = 'players' | 'matches' | 'stats'

export function TeamDetail({ teamId }: { teamId: string }) {
  const { canManage, teams, store, toast } = useApp()
  const isAdmin = canManage(teamId)
  const route = useRoute()
  const sheet = useSheet()
  const data = useTeam(teamId)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const q = route.query.get('tab')
  const tab: Tab = q === 'matches' || q === 'stats' ? q : 'players'

  const team = teams.find((t) => t.id === teamId)
  if (!team) {
    return (
      <Screen title="Team" back="/teams">
        <Empty icon="🤷" title="Team not found" text="It may have been removed or archived." />
      </Screen>
    )
  }
  const full = { ...data, team }

  return (
    <Screen
      title={team.name}
      icon={team.logo ? <TeamLogo team={team} size={32} rounded="rounded-lg" /> : undefined}
      back="/teams"
      actions={
        isAdmin ? (
          <HeaderButton label="Team options" onClick={() => sheet.open('teammenu')}>
            ⋯
          </HeaderButton>
        ) : undefined
      }
    >
      <div className="px-4 pt-3">
        <Segmented<Tab>
          value={tab}
          onChange={(t) => navigate(withQuery(route, { tab: t, sheet: null, arg: null }), { replace: true })}
          options={[
            { value: 'players', label: `Players (${data.members.filter((m) => m.status === 'active').length})` },
            { value: 'matches', label: `Matches (${data.matches.filter((m) => !m.cancelled).length})` },
            { value: 'stats', label: 'Stats' },
          ]}
        />
      </div>

      {!data.ready ? <p className="p-10 text-center text-sm text-muted">Loading…</p> : tab === 'players' ? <PlayersTab data={full} /> : tab === 'stats' ? <StatsTab data={full} /> : <MatchesTab data={full} />}

      {sheet.name === 'teammenu' && isAdmin && (
        <Sheet title={team.name} onClose={sheet.close}>
          <div className="flex flex-col gap-2">
            <button className="btn-secondary" onClick={() => navigate(withQuery(route, { sheet: 'editteam' }), { replace: true })}>
              Edit team
            </button>
            <button className="btn-secondary" onClick={() => navigate(`/teams/${team.id}/categories`)}>
              Expense categories
            </button>
            {team.archived ? (
              <button
                className="btn-secondary"
                onClick={() => {
                  try {
                    setTeamArchived(store!, team.id, false)
                    toast(`${team.name} restored`)
                    sheet.close()
                  } catch (e) {
                    setError((e as Error).message)
                  }
                }}
              >
                Restore team
              </button>
            ) : (
              <button className="btn-danger" onClick={() => setConfirmArchive(true)}>
                Archive team
              </button>
            )}
            {data.ready && (
              <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
                Delete team
              </button>
            )}
            <ErrorNote>{error}</ErrorNote>
          </div>
        </Sheet>
      )}
      {sheet.name === 'editteam' && isAdmin && <TeamSheet team={team} onClose={sheet.close} />}

      {confirmArchive && (
        <Confirm
          title={`Archive ${team.name}?`}
          message="The team is hidden from everyone but nothing is deleted. Type the team name to confirm."
          requireText={team.name}
          confirmLabel="Archive"
          danger
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() => {
            setTeamArchived(store!, team.id, true)
            setConfirmArchive(false)
            toast(`${team.name} archived`)
            navigate('/teams', { replace: true })
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          title={`Delete ${team.name}?`}
          message={
            data.matches.length > 0
              ? `This deletes the team with its ${data.matches.length} match${data.matches.length === 1 ? '' : 'es'}, scores, expenses, fund records and categories. It can’t be undone in the app (archiving hides the team but keeps everything). Players stay in Users. Type the team name to confirm.`
              : 'The team is deleted completely. Players stay in Users. Type the team name to confirm.'
          }
          requireText={team.name}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            try {
              deleteTeam(store!, team.id)
              toast(`${team.name} deleted`)
              navigate('/teams', { replace: true })
            } catch (e) {
              setError((e as Error).message)
            }
            setConfirmDelete(false)
          }}
        />
      )}
    </Screen>
  )
}

function MatchesTab({ data }: { data: TeamData & { team: Team } }) {
  const { canManage } = useApp()
  const isAdmin = canManage(data.team.id)
  const sheet = useSheet()
  const route = useRoute()
  const [showCancelled, setShowCancelled] = useState(false)
  const { team, matches: all } = data
  const seasons = useFile<SeasonsFile>(P.seasons(team.id))?.seasons ?? []
  // The season filter lives in the address (?season=<id> or none), so it survives a reload and Back.
  const asked = route.query.get('season')
  const filter = asked === 'none' || seasons.some((x) => x.id === asked) ? (asked as string) : 'all'
  const matches = filterBySeason(all, filter)
  const hasLoose = all.some((m) => !m.seasonId)
  const seasonOptions = [
    { value: 'all', label: 'All seasons' },
    ...[...seasons].sort((a, b) => Number(a.archived) - Number(b.archived)).map((x) => ({ value: x.id, label: x.name })),
    ...(hasLoose ? [{ value: 'none', label: 'No season' }] : []),
  ]

  const sorted = sortMatchesAsc(matches)
  const upcoming = sorted.filter((m) => matchStatus(m) === 'upcoming')
  const past = sorted.filter((m) => !m.cancelled && matchStatus(m) !== 'upcoming').reverse()
  const cancelled = sorted.filter((m) => m.cancelled).reverse()

  return (
    <div className="flex flex-col gap-3 p-4">
      {isAdmin && !team.archived && (
        <button className="btn-primary" onClick={() => sheet.open('match')}>
          + Add match
        </button>
      )}

      {(isAdmin || seasons.length > 0) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Season</span>
            <button className="text-sm font-semibold text-accent" onClick={() => navigate(`/teams/${team.id}/seasons`)}>
              {seasons.length === 0 ? 'Set up seasons ›' : 'Seasons ›'}
            </button>
          </div>
          {seasons.length > 0 && <ChoiceChips row options={seasonOptions} value={filter} onChange={(v) => navigate(withQuery(route, { season: v === 'all' ? null : v }), { replace: true })} />}
        </div>
      )}

      {all.length === 0 && <Empty icon="📅" title="No matches yet" text={isAdmin ? 'Add an upcoming fixture or a match you already played.' : 'No matches have been added yet.'} />}
      {all.length > 0 && matches.length === 0 && <Empty icon="📆" title="No matches here" text={filter === 'none' ? 'Every match is in a season.' : 'No matches have been put in this season yet.'} />}

      {upcoming.length > 0 && (
        <section>
          <h2 className="section-title">Upcoming</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {upcoming.map((m) => (
              <MatchRow key={m.id} match={m} />
            ))}
          </div>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h2 className="section-title">Past</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {past.map((m) => (
              <MatchRow key={m.id} match={m} />
            ))}
          </div>
        </section>
      )}
      {cancelled.length > 0 && (
        <section>
          <button className="section-title flex w-full items-center justify-between" onClick={() => setShowCancelled((v) => !v)} aria-expanded={showCancelled}>
            <span>Cancelled ({cancelled.length})</span>
            <span>{showCancelled ? '▾' : '▸'}</span>
          </button>
          {showCancelled && (
            <div className="card divide-y divide-line overflow-hidden opacity-70">
              {cancelled.map((m) => (
                <MatchRow key={m.id} match={m} />
              ))}
            </div>
          )}
        </section>
      )}

      {sheet.name === 'match' && isAdmin && (
        <MatchForm team={team} matches={all} seasonId={filter !== 'all' && filter !== 'none' ? filter : undefined} onClose={sheet.close} onSaved={(m) => sheet.replaceWith(`/teams/${team.id}/matches/${m.id}`)} />
      )}
    </div>
  )
}
