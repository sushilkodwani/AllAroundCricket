// Seasons: a team's periods ("LL-26-27"). The list shows every season with its record; a season
// has its matches (add new ones or bring in existing ones) and an Insights tab, which is the
// team's Stats screen over just that season's matches.
import { useState } from 'react'
import { MatchForm } from '../components/MatchForm'
import { MatchRow } from '../components/match'
import { HeaderButton, Screen } from '../components/Screen'
import { StatsTables } from '../components/StatsTab'
import { Confirm, Empty, ErrorNote, Field, Pill, Segmented, Sheet } from '../components/ui'
import { fmtDate } from '../lib/dates'
import { assignSeason } from '../lib/domain'
import { P } from '../lib/paths'
import { createSeason, deleteSeason, seasonDates, seasonRecord, setSeasonArchived, updateSeason, type SeasonInput } from '../lib/seasons'
import { sortMatchesAsc } from '../lib/stats'
import { useApp, useFile, useTeam } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import type { Match, Season, SeasonsFile } from '../types'

const recordText = (matches: Match[]) => {
  const r = seasonRecord(matches)
  return `${r.total} match${r.total === 1 ? '' : 'es'}${r.played > 0 ? ` · ${r.won}W ${r.lost}L${r.tied ? ` ${r.tied}T` : ''}` : ''}`
}

/** Name and dates; used to create a season and to edit one. */
function SeasonForm({ title, initial, submit, onSave, onClose }: { title: string; initial?: Season; submit: string; onSave: (input: SeasonInput) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStart] = useState(initial?.startDate ?? '')
  const [endDate, setEnd] = useState(initial?.endDate ?? '')
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          try {
            onSave({ name, startDate, endDate })
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <Field label="Name" hint="For example: LL-26-27.">
          <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Starts (optional)" hint="With dates, a new match falls into the right season by itself.">
          <input className="input" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Ends (optional)">
          <input className="input" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={!name.trim()}>
          {submit}
        </button>
      </form>
    </Sheet>
  )
}

// ---------- the list ----------
export function Seasons({ teamId }: { teamId: string }) {
  const { canManage, store } = useApp()
  const data = useTeam(teamId)
  const sheet = useSheet()
  const seasons = useFile<SeasonsFile>(P.seasons(teamId))?.seasons ?? []
  const isAdmin = canManage(teamId)
  const back = `/teams/${teamId}?tab=matches`
  if (!data.team) {
    return (
      <Screen title="Seasons" back="/teams">
        <Empty icon="🤷" title="Team not found" />
      </Screen>
    )
  }
  const inSeason = (id: string) => data.matches.filter((m) => m.seasonId === id)
  const loose = data.matches.filter((m) => !m.cancelled && !m.seasonId)
  const open = seasons.filter((s) => !s.archived)
  const closed = seasons.filter((s) => s.archived)
  const row = (s: Season) => (
    <button key={s.id} className="row active:bg-alt" onClick={() => navigate(`/teams/${teamId}/seasons/${s.id}`)}>
      <span className="text-xl" aria-hidden="true">
        📆
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{s.name}</span>
        <span className="block truncate text-xs text-muted">{[seasonDates(s, fmtDate), recordText(inSeason(s.id))].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="text-muted">›</span>
    </button>
  )

  return (
    <Screen title="Seasons" back={back}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">{data.team.name}</p>
        {isAdmin && (
          <button className="btn-primary" onClick={() => sheet.open('new')}>
            + New season
          </button>
        )}
        {seasons.length === 0 && (
          <Empty icon="📆" title="No seasons yet" text={isAdmin ? 'Create one, such as LL-26-27, then put matches in it. Each season gets its own analysis.' : 'No admin has set up a season yet.'} />
        )}
        {open.length > 0 && <div className="card divide-y divide-line overflow-hidden">{open.map(row)}</div>}
        {closed.length > 0 && (
          <section>
            <h2 className="section-title">Closed</h2>
            <div className="card divide-y divide-line overflow-hidden">{closed.map(row)}</div>
          </section>
        )}
        {seasons.length > 0 && loose.length > 0 && (
          <button className="card flex items-center gap-3 px-4 py-3 text-left active:bg-alt" onClick={() => navigate(`/teams/${teamId}?tab=matches&season=none`)}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Matches in no season</span>
              <span className="block text-xs text-muted">
                {loose.length} match{loose.length === 1 ? '' : 'es'}. Open a season to bring them in.
              </span>
            </span>
            <span className="text-muted">›</span>
          </button>
        )}
      </div>

      {sheet.name === 'new' && isAdmin && store && (
        <SeasonForm
          title="New season"
          submit="Create"
          onClose={sheet.close}
          onSave={(input) => {
            const s = createSeason(store, teamId, input)
            sheet.replaceWith(`/teams/${teamId}/seasons/${s.id}`)
          }}
        />
      )}
    </Screen>
  )
}

// ---------- one season ----------
type Tab = 'matches' | 'insights'

export function SeasonDetail({ teamId, seasonId }: { teamId: string; seasonId: string }) {
  const { canManage, store, toast } = useApp()
  const data = useTeam(teamId)
  const route = useRoute()
  const sheet = useSheet()
  const seasons = useFile<SeasonsFile>(P.seasons(teamId))?.seasons ?? []
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isAdmin = canManage(teamId)
  const season = seasons.find((s) => s.id === seasonId)
  const tab: Tab = route.query.get('stab') === 'insights' ? 'insights' : 'matches'
  const list = `/teams/${teamId}/seasons`

  if (!data.team || !season || !store) {
    return (
      <Screen title="Season" back={list}>
        {data.ready || !data.team ? <Empty icon="🤷" title="Season not found" text="It may have been deleted." /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>}
      </Screen>
    )
  }
  const team = data.team
  const matches = data.matches.filter((m) => m.seasonId === seasonId)
  const r = seasonRecord(matches)
  const decided = r.won + r.lost + r.tied
  const sorted = sortMatchesAsc(matches)
  const upcoming = sorted.filter((m) => !m.cancelled && !m.result && m.scoring !== 'finished' && m.lifecycle !== 'completed' && m.date >= new Date().toISOString().slice(0, 10))
  const rest = sorted.filter((m) => !upcoming.includes(m)).reverse()
  const others = sortMatchesAsc(data.matches.filter((m) => !m.cancelled && m.seasonId !== seasonId)).reverse()
  const seasonName = (id?: string) => seasons.find((s) => s.id === id)?.name

  return (
    <Screen
      title={season.name}
      back={list}
      actions={
        isAdmin ? (
          <HeaderButton label="Season options" onClick={() => sheet.open('seasonmenu')}>
            ⋯
          </HeaderButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 p-4 pb-0">
        <div className="card p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{team.name}</span>
            {seasonDates(season, fmtDate) && <span>· {seasonDates(season, fmtDate)}</span>}
            {season.archived && <Pill>Closed</Pill>}
          </p>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[
              ['Matches', r.total],
              ['Won', r.won],
              ['Lost', r.lost],
              ['Win rate', decided > 0 ? `${Math.round((r.won * 100) / decided)}%` : '–'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-alt px-1 py-2.5">
                <p className="text-lg font-bold leading-tight">{value}</p>
                <p className="mt-0.5 text-[11px] text-muted">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <Segmented<Tab>
          value={tab}
          onChange={(t) => navigate(withQuery(route, { stab: t === 'matches' ? null : t, sheet: null, arg: null }), { replace: true })}
          options={[
            { value: 'matches', label: `Matches (${r.total})` },
            { value: 'insights', label: 'Insights' },
          ]}
        />
      </div>

      {tab === 'insights' ? (
        data.ready ? <StatsTables matches={matches} side="home" onOpen={(pid) => navigate(`/teams/${teamId}/players/${pid}`)} /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          {isAdmin && !team.archived && (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary" onClick={() => sheet.open('match')}>
                + Add match
              </button>
              <button className="btn-secondary" disabled={others.length === 0} onClick={() => { setPicked(new Set()); sheet.open('bring') }}>
                Add existing
              </button>
            </div>
          )}
          {matches.length === 0 && <Empty icon="📅" title="No matches in this season" text={isAdmin ? 'Add a new match here, or bring in matches you already have.' : 'No matches have been put in this season yet.'} />}
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
          {rest.length > 0 && (
            <section>
              <h2 className="section-title">Played</h2>
              <div className="card divide-y divide-line overflow-hidden">
                {rest.map((m) => (
                  <MatchRow key={m.id} match={m} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {sheet.name === 'match' && isAdmin && <MatchForm team={team} matches={data.matches} seasonId={seasonId} onClose={sheet.close} onSaved={(m) => sheet.replaceWith(`/teams/${teamId}/matches/${m.id}`)} />}

      {sheet.name === 'bring' && isAdmin && (
        <Sheet title="Add matches to this season" onClose={sheet.close}>
          <div className="flex flex-col gap-3">
            <div className="card max-h-[55vh] divide-y divide-line overflow-y-auto">
              {others.map((m) => {
                const on = picked.has(m.id)
                const where = seasonName(m.seasonId)
                return (
                  <label key={m.id} className="row cursor-pointer active:bg-alt">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={on}
                      onChange={() => setPicked((p) => {
                        const n = new Set(p)
                        if (on) n.delete(m.id)
                        else n.add(m.id)
                        return n
                      })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        vs {m.opponent}
                      </span>
                      <span className="block text-xs text-muted">
                        {fmtDate(m.date)}
                        {where ? ` · now in ${where}` : ' · no season'}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            <button
              className="btn-primary"
              disabled={picked.size === 0}
              onClick={() => {
                assignSeason(store, teamId, [...picked], seasonId, `Add matches to season ${season.name}`)
                toast(`${picked.size} match${picked.size === 1 ? '' : 'es'} added to ${season.name}`)
                sheet.close()
              }}
            >
              {picked.size === 0 ? 'Pick matches' : `Add ${picked.size} match${picked.size === 1 ? '' : 'es'}`}
            </button>
          </div>
        </Sheet>
      )}

      {sheet.name === 'seasonmenu' && isAdmin && (
        <Sheet title={season.name} onClose={sheet.close}>
          <div className="flex flex-col gap-2">
            <button className="btn-secondary" onClick={() => navigate(withQuery(route, { sheet: 'editseason' }), { replace: true })}>
              Edit name and dates
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setSeasonArchived(store, teamId, seasonId, !season.archived)
                sheet.close()
              }}
            >
              {season.archived ? 'Reopen season' : 'Close season'}
            </button>
            <button className="btn-danger" onClick={() => { sheet.close(); setConfirmDelete(true) }}>
              Delete season
            </button>
          </div>
        </Sheet>
      )}
      {sheet.name === 'editseason' && isAdmin && (
        <SeasonForm
          title="Edit season"
          submit="Save"
          initial={season}
          onClose={sheet.close}
          onSave={(input) => {
            updateSeason(store, teamId, seasonId, input)
            sheet.close()
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          title={`Delete ${season.name}?`}
          message={`${r.total === 0 ? 'The season has no matches.' : `Its ${r.total} match${r.total === 1 ? '' : 'es'} stay, but no longer belong to a season.`} This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteSeason(store, teamId, seasonId)
            setConfirmDelete(false)
            navigate(list, { replace: true })
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Screen>
  )
}
