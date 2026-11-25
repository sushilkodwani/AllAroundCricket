import { describe, expect, it } from 'vitest'
import type { Match, Season } from '../types'
import { memoryKV } from './cache'
import { addMatch, createTeam, editMatch, matchesOf } from './domain'
import { fakeBackend } from './fakeBackend'
import { P } from './paths'
import { cleanSeason, createSeason, deleteSeason, filterBySeason, seasonDates, seasonRecord, seasonsOf, setSeasonArchived, suggestSeason, updateSeason } from './seasons'
import { Store } from './store'

function setup() {
  const store = new Store(fakeBackend(), memoryKV(), 5)
  store.actor = { role: 'admin', personId: 'admin' }
  store.write('people.json', { schemaVersion: 1, people: [] }, 'seed')
  const team = createTeam(store, { name: 'Latitude Lions', color: '#000' })
  const add = (date: string, extra: Partial<Parameters<typeof addMatch>[2]> = {}) => addMatch(store, team.id, { date, time: '10:00', opponent: 'Rivals', matchType: 'friendly', ...extra })
  return { store, teamId: team.id, add }
}

const season = (o: Partial<Season>): Season => ({ id: 's', teamId: 't', name: 'S', archived: false, createdAt: '', updatedAt: '', ...o })
const match = (o: Partial<Match>): Match => ({ id: 'm', teamId: 't', date: '2026-10-01', opponent: 'X', matchType: 'friendly', squad: [], cancelled: false, lifecycle: 'scheduled', createdAt: '', updatedAt: '', ...o })

describe('creating and editing seasons', () => {
  it('creates a season, keeps its dates and lists it', () => {
    const { store, teamId } = setup()
    const s = createSeason(store, teamId, { name: '  LL-26-27 ', startDate: '2026-10-01', endDate: '2027-03-31' })
    expect(s).toMatchObject({ name: 'LL-26-27', teamId, archived: false, startDate: '2026-10-01', endDate: '2027-03-31' })
    expect(seasonsOf(store, teamId)).toEqual([s])
  })

  it('refuses an empty or repeated name and dates the wrong way round', () => {
    expect(() => cleanSeason({ name: ' ' }, [])).toThrow('Enter a name')
    expect(() => cleanSeason({ name: 'll-26-27' }, [season({ name: 'LL-26-27' })])).toThrow('already has a season')
    expect(() => cleanSeason({ name: 'A', startDate: '2027-01-01', endDate: '2026-01-01' }, [])).toThrow('cannot end before')
    expect(() => cleanSeason({ name: 'A', startDate: '01/01/2026' }, [])).toThrow('Pick the dates')
    expect(cleanSeason({ name: 'A', startDate: '', endDate: '' }, [])).toEqual({ name: 'A', startDate: undefined, endDate: undefined })
  })

  it('renames, may keep its own name, and closes and reopens', () => {
    const { store, teamId } = setup()
    const a = createSeason(store, teamId, { name: 'A' })
    const b = createSeason(store, teamId, { name: 'B' })
    expect(updateSeason(store, teamId, a.id, { name: 'A', endDate: '2027-03-01' }).endDate).toBe('2027-03-01')
    expect(() => updateSeason(store, teamId, a.id, { name: 'b' })).toThrow('already has a season')
    setSeasonArchived(store, teamId, b.id, true)
    expect(seasonsOf(store, teamId).find((x) => x.id === b.id)!.archived).toBe(true)
    setSeasonArchived(store, teamId, b.id, false)
    expect(seasonsOf(store, teamId).find((x) => x.id === b.id)!.archived).toBe(false)
  })

  it('stays out of other roles’ hands: a player cannot create a season', () => {
    const { store, teamId } = setup()
    store.actor = { role: 'viewer', personId: 'someone' }
    expect(() => createSeason(store, teamId, { name: 'Nope' })).toThrow('can’t create')
  })
})

describe('matches and seasons', () => {
  it('adds a match straight into a season and moves it with the edit form', () => {
    const { store, teamId, add } = setup()
    const a = createSeason(store, teamId, { name: 'A' })
    const b = createSeason(store, teamId, { name: 'B' })
    const m = add('2026-10-10', { seasonId: a.id })
    expect(m.seasonId).toBe(a.id)
    const moved = editMatch(store, teamId, m.id, { date: m.date, time: '10:00', opponent: 'Rivals', matchType: 'friendly', seasonId: b.id })
    expect(moved.seasonId).toBe(b.id)
    const cleared = editMatch(store, teamId, m.id, { date: m.date, time: '10:00', opponent: 'Rivals', matchType: 'friendly', seasonId: '' })
    expect(cleared.seasonId).toBeUndefined()
  })

  it('deleting a season keeps its matches and takes them out of it', () => {
    const { store, teamId, add } = setup()
    const a = createSeason(store, teamId, { name: 'A' })
    const b = createSeason(store, teamId, { name: 'B' })
    add('2026-10-10', { seasonId: a.id })
    add('2026-10-17', { seasonId: a.id })
    add('2026-10-24', { seasonId: b.id })
    deleteSeason(store, teamId, a.id)
    expect(seasonsOf(store, teamId).map((x) => x.name)).toEqual(['B'])
    const ms = matchesOf(store, teamId)
    expect(ms).toHaveLength(3)
    expect(ms.filter((m) => m.seasonId === a.id)).toHaveLength(0)
    expect(ms.filter((m) => m.seasonId === b.id)).toHaveLength(1)
    expect(ms.filter((m) => !m.seasonId)).toHaveLength(2)
  })

  it('is one file per team, in the data repo’s layout', () => {
    expect(P.seasons('abc')).toBe('teams/abc/seasons.json')
  })
})

describe('filter, suggestion and record', () => {
  const ms = [match({ id: '1', seasonId: 'a' }), match({ id: '2', seasonId: 'b' }), match({ id: '3' })]
  it('filters by season, none, or all', () => {
    expect(filterBySeason(ms, 'a').map((m) => m.id)).toEqual(['1'])
    expect(filterBySeason(ms, 'none').map((m) => m.id)).toEqual(['3'])
    expect(filterBySeason(ms, 'all')).toHaveLength(3)
    expect(filterBySeason(ms, null)).toHaveLength(3)
    expect(filterBySeason(ms, '')).toHaveLength(3)
  })

  it('suggests the one open season whose dates cover the match, or the only open season without dates', () => {
    const a = season({ id: 'a', startDate: '2026-10-01', endDate: '2027-03-31' })
    const b = season({ id: 'b', startDate: '2027-04-01', endDate: '2027-09-30' })
    expect(suggestSeason([a, b], '2026-12-25')).toBe('a')
    expect(suggestSeason([a, b], '2027-05-01')).toBe('b')
    expect(suggestSeason([a, b], '2025-01-01')).toBe('')
    expect(suggestSeason([a, { ...b, startDate: '2026-12-01' }], '2026-12-25')).toBe('') // two cover it: unclear
    expect(suggestSeason([a, { ...b, archived: true }], '2027-05-01')).toBe('') // closed seasons are not suggested
    expect(suggestSeason([season({ id: 'x' })], '2026-12-25')).toBe('x') // the only open season, no dates
    expect(suggestSeason([season({ id: 'x' }), season({ id: 'y' })], '2026-12-25')).toBe('')
    expect(suggestSeason([a, season({ id: 'x' })], '2025-01-01')).toBe('') // a dated season exists, so no guess
  })

  it('works out a record, leaving cancelled matches out', () => {
    const r = seasonRecord([match({ result: 'won' }), match({ result: 'won' }), match({ result: 'lost' }), match({ result: 'tied' }), match({ result: 'no_result' }), match({}), match({ cancelled: true, result: 'won' })])
    expect(r).toEqual({ played: 5, won: 2, lost: 1, tied: 1, upcoming: 1, total: 6 })
  })

  it('writes the dates out', () => {
    const f = (iso: string) => iso.slice(0, 4)
    expect(seasonDates({ startDate: '2026-10-01', endDate: '2027-03-31' }, f)).toBe('2026 – 2027')
    expect(seasonDates({ startDate: '2026-10-01' }, f)).toBe('From 2026')
    expect(seasonDates({ endDate: '2027-03-31' }, f)).toBe('Until 2027')
    expect(seasonDates({}, f)).toBe('')
  })
})
