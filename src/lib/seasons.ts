// Seasons: a period a team plays in ("LL-26-27"). A match belongs to at most one season of its
// team. Seasons live in teams/<id>/seasons.json; a match carries `seasonId`. A season's analysis is
// worked out from its matches, so nothing else is stored.
import type { Match, Season, SeasonsFile } from '../types'
import { nowStamp } from './dates'
import { assignSeason, matchesOf } from './domain'
import { P } from './paths'
import type { Store } from './store'
import { uuid } from './uuid'

export const seasonsOf = (s: Store, teamId: string): Season[] => s.get<SeasonsFile>(P.seasons(teamId))?.seasons ?? []
const putSeasons = (s: Store, teamId: string, seasons: Season[], msg: string) => s.write(P.seasons(teamId), { schemaVersion: 1, seasons }, msg)

export interface SeasonInput {
  name: string
  startDate?: string
  endDate?: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Checks a season's name and dates; returns the cleaned input or throws a message for the form. */
export function cleanSeason(input: SeasonInput, others: Season[]): SeasonInput {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (!name) throw new Error('Enter a name, for example LL-26-27.')
  if (others.some((o) => o.name.toLowerCase() === name.toLowerCase())) throw new Error('This team already has a season with this name.')
  const startDate = input.startDate?.trim() || undefined
  const endDate = input.endDate?.trim() || undefined
  if ((startDate && !ISO.test(startDate)) || (endDate && !ISO.test(endDate))) throw new Error('Pick the dates again.')
  if (startDate && endDate && endDate < startDate) throw new Error('The season cannot end before it starts.')
  return { name, startDate, endDate }
}

export function createSeason(s: Store, teamId: string, input: SeasonInput): Season {
  const clean = cleanSeason(input, seasonsOf(s, teamId))
  const now = nowStamp()
  const season: Season = { id: uuid(), teamId, ...clean, archived: false, createdAt: now, updatedAt: now }
  if (!putSeasons(s, teamId, [...seasonsOf(s, teamId), season], `Create season ${season.name}`)) throw new Error('You can’t create seasons for this team.')
  return season
}

export function updateSeason(s: Store, teamId: string, seasonId: string, input: SeasonInput): Season {
  const all = seasonsOf(s, teamId)
  const cur = all.find((x) => x.id === seasonId)
  if (!cur) throw new Error('Season not found.')
  const clean = cleanSeason(input, all.filter((x) => x.id !== seasonId))
  const next: Season = { ...cur, name: clean.name, startDate: clean.startDate, endDate: clean.endDate, updatedAt: nowStamp() }
  putSeasons(s, teamId, all.map((x) => (x.id === seasonId ? next : x)), `Edit season ${next.name}`)
  return next
}

export function setSeasonArchived(s: Store, teamId: string, seasonId: string, archived: boolean): void {
  const all = seasonsOf(s, teamId)
  const cur = all.find((x) => x.id === seasonId)
  if (!cur) return
  putSeasons(s, teamId, all.map((x) => (x.id === seasonId ? { ...x, archived, updatedAt: nowStamp() } : x)), `${archived ? 'Close' : 'Reopen'} season ${cur.name}`)
}

/** Deletes the season. Its matches stay, they just no longer belong to a season. */
export function deleteSeason(s: Store, teamId: string, seasonId: string): void {
  const all = seasonsOf(s, teamId)
  const cur = all.find((x) => x.id === seasonId)
  if (!cur) return
  const ids = matchesOf(s, teamId).filter((m) => m.seasonId === seasonId).map((m) => m.id)
  if (ids.length > 0) assignSeason(s, teamId, ids, undefined, `Delete season ${cur.name}`)
  putSeasons(s, teamId, all.filter((x) => x.id !== seasonId), `Delete season ${cur.name}`)
}

// ---------- helpers ----------
/** 'all' (or empty): every match; 'none': matches in no season; otherwise one season. */
export function filterBySeason(matches: Match[], filter: string | null | undefined): Match[] {
  if (!filter || filter === 'all') return matches
  if (filter === 'none') return matches.filter((m) => !m.seasonId)
  return matches.filter((m) => m.seasonId === filter)
}

/**
 * The season a new match on `date` most likely belongs to: the one open season whose dates cover it,
 * or, when no season has dates, the only open season. Empty when it is not clear.
 */
export function suggestSeason(seasons: Season[], date: string): string {
  const open = seasons.filter((x) => !x.archived)
  const covering = open.filter((x) => (x.startDate || x.endDate) && (!x.startDate || date >= x.startDate) && (!x.endDate || date <= x.endDate))
  if (covering.length === 1) return covering[0].id
  if (covering.length === 0 && open.length === 1 && !open[0].startDate && !open[0].endDate) return open[0].id
  return ''
}

export interface SeasonRecord {
  /** Matches with a result. */
  played: number
  won: number
  lost: number
  tied: number
  /** Matches still to play (upcoming, not cancelled). */
  upcoming: number
  total: number
}

/** The won / lost record of a set of matches (cancelled ones are left out). */
export function seasonRecord(matches: Match[]): SeasonRecord {
  const r: SeasonRecord = { played: 0, won: 0, lost: 0, tied: 0, upcoming: 0, total: 0 }
  for (const m of matches) {
    if (m.cancelled) continue
    r.total++
    if (m.result === 'won') r.won++
    else if (m.result === 'lost') r.lost++
    else if (m.result === 'tied') r.tied++
    if (m.result === 'won' || m.result === 'lost' || m.result === 'tied' || m.result === 'draw' || m.result === 'no_result') r.played++
    else r.upcoming++
  }
  return r
}

/** "1 Oct 2026 – 31 Mar 2027", "From 1 Oct 2026", or "". */
export function seasonDates(x: Pick<Season, 'startDate' | 'endDate'>, fmt: (iso: string) => string): string {
  if (x.startDate && x.endDate) return `${fmt(x.startDate)} – ${fmt(x.endDate)}`
  if (x.startDate) return `From ${fmt(x.startDate)}`
  if (x.endDate) return `Until ${fmt(x.endDate)}`
  return ''
}
