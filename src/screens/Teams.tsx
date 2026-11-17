import { useEffect, useMemo, useState } from 'react'
import { InstallBanner } from '../components/InstallBanner'
import { HeaderButton, RefreshIcon, Screen } from '../components/Screen'
import { liveStats, TeamCard } from '../components/TeamCard'
import { TeamSheet } from '../components/TeamSheet'
import { Empty, Pill, SearchBox } from '../components/ui'
import { fmtDate, fmtDayMonth, fmtTime, relativeDay } from '../lib/dates'
import { ensureOpponent, matchesOf, opponentsOf } from '../lib/domain'
import { matchStatus, sortMatchesAsc } from '../lib/stats'
import { P } from '../lib/paths'
import { getPref } from '../lib/session'
import { RESULT_LABELS, RESULT_LETTER, type Opponent } from '../types'
import { headToHead, useOpponentMatches } from './OpponentDetail'
import { useApp, useTeamsLoaded } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import { TokenExpiryBanner } from './Settings'

export function Teams() {
  const { teams, isAdmin, refresh, store } = useApp()
  const sheet = useSheet()
  const [refreshing, setRefreshing] = useState(false)
  const showArchived = isAdmin && getPref('showArchived', false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const visible = teams.filter((t) => showArchived || !t.archived)
  const matchesQuery = (...names: string[]) => !q || names.some((n) => n.toLowerCase().includes(q))
  // Team files load in the background so cards can show fresh next/last match and the personal line.
  useTeamsLoaded(visible.map((t) => t.id))

  // Nearest upcoming match first, then by name.
  const sorted = visible.filter((t) => matchesQuery(t.name, t.shortName)).sort((a, b) => {
    const na = liveStats(store, a).nextMatch
    const nb = liveStats(store, b).nextMatch
    const ka = na ? na.date + (na.time ?? '') : '9999'
    const kb = nb ? nb.date + (nb.time ?? '') : '9999'
    return ka.localeCompare(kb) || a.name.localeCompare(b.name)
  })

  // Teams we play against, below our own. A name that is also one of our teams is not repeated.
  const mine = new Set(teams.map((t) => t.name.toLowerCase()))
  const others = (store ? opponentsOf(store) : []).filter((o) => !mine.has(o.name.toLowerCase()) && matchesQuery(o.name, o.shortName)).sort((a, b) => a.name.localeCompare(b.name))

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
            <RefreshIcon spinning={refreshing} />
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
      {visible.length === 0 && others.length === 0 && !q ? (
        <Empty
          icon='🏏'
          title='No teams yet'
          text={isAdmin ? 'Create your first team, then add players and matches.' : 'Your admin hasn’t added you to a team yet.'}
          action={
            isAdmin ? (
              <button className='btn-primary' onClick={() => sheet.open('team')}>
                + Create a team
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className='flex flex-col gap-3 p-4'>
          <SearchBox value={query} onChange={setQuery} placeholder='Search teams' />
          {q && sorted.length === 0 && others.length === 0 && <p className='py-8 text-center text-sm text-muted'>No team matches “{query.trim()}”.</p>}
          {sorted.length > 0 && <h2 className='section-title !pb-0'>{visible.length === 1 && !q ? 'My team' : 'My teams'}</h2>}
          {sorted.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
          {others.length > 0 && <h2 className='section-title !pb-0 !pt-3'>Other teams ({others.length})</h2>}
          {others.map((o) => (
            <OtherTeamCard key={o.id} opponent={o} />
          ))}
        </div>
      )}

      {sheet.name === 'team' && isAdmin && <TeamSheet onClose={sheet.close} onCreated={(t) => sheet.replaceWith(`/teams/${t.id}`)} />}
    </Screen>
  )
}

/** Same look as the My teams card: colour bar, short name, record, next and last match. */
function OtherTeamCard({ opponent }: { opponent: Opponent }) {
  const matches = useOpponentMatches(opponent)
  const h = headToHead(matches)
  const sorted = sortMatchesAsc(matches)
  const next = sorted.find((m) => matchStatus(m) === 'upcoming')
  const last = [...sorted].reverse().find((m) => matchStatus(m) !== 'upcoming')
  const form = sorted.filter((m) => m.result).slice(-5)
  const colour = '#475569'
  return (
    <button className='card flex w-full overflow-hidden text-left active:bg-alt' onClick={() => navigate(`/opponents/${opponent.id}`)} aria-label={`Open ${opponent.name}`}>
      <span className='w-1.5 shrink-0' style={{ background: colour }} />
      <span className='min-w-0 flex-1 space-y-1 px-3 py-3'>
        <span className='flex items-start gap-2'>
          <span className='rounded-md px-1.5 py-0.5 text-xs font-bold text-white' style={{ background: colour }}>
            {opponent.shortName}
          </span>
          <span className='min-w-0 flex-1 truncate font-semibold'>{opponent.name}</span>
          <Pill>Opponent</Pill>
        </span>
        <span className='block text-sm text-muted'>
          👥 {opponent.playerIds.length} player{opponent.playerIds.length === 1 ? '' : 's'} · 🏏 {matches.length} match{matches.length === 1 ? '' : 'es'} with us
        </span>
        {h.played > 0 && (
          <span className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
            <span>
              We won {h.won} · They won {h.lost}
            </span>
            <span className='flex items-center gap-1' aria-label={`Our results, latest last: ${form.map((m) => RESULT_LABELS[m.result!]).join(', ')}`}>
              <span className='text-xs text-muted'>Form</span>
              {form.map((m) => (
                <span key={m.id} className={`flex h-5 min-w-[20px] items-center justify-center rounded px-1 text-[10px] font-bold ${m.result === 'won' ? 'bg-ok text-white' : m.result === 'lost' ? 'bg-bad text-white' : 'bg-alt text-muted'}`}>
                  {RESULT_LETTER[m.result!]}
                </span>
              ))}
            </span>
          </span>
        )}
        <span className='block text-sm'>
          {next ? (
            <>
              📅 Next: {fmtDate(next.date, false)}
              {next.time && `, ${fmtTime(next.time)}`} · <span className='text-accent'>{relativeDay(next.date)}</span>
            </>
          ) : (
            <span className='text-muted'>No upcoming match</span>
          )}
        </span>
        {last && (
          <span className='block text-sm text-muted'>
            Last: {last.result ? RESULT_LABELS[last.result] : 'Result pending'} · {fmtDayMonth(last.date)}
          </span>
        )}
      </span>
    </button>
  )
}

export const openTeam =(id: string) => navigate(`/teams/${id}`)
