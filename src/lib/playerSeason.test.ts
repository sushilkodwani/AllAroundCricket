import { describe, expect, it } from 'vitest'
import type { BatInn, BowlInn, PlayerData } from './playerAnalysis'
import { archetypesFor, consistencyOf, steadyLabel, wrappedOf, type Profile } from './playerSeason'

const bat = (runs: number, extra: Partial<BatInn> = {}): BatInn => ({ matchId: `m${runs}-${Math.random()}`, date: '2026-10-01', opponent: 'X', inn: 0, position: 3, runs, balls: runs + 2, fours: 0, sixes: 0, notOut: false, won: true, progress: [], ...extra })
const bowl = (wickets: number, runs: number, balls = 12): BowlInn => ({ matchId: `b${wickets}-${Math.random()}`, date: '2026-10-01', opponent: 'X', inn: 1, balls, runs, wickets, caught: 0, fours: 0, sixes: 0, wides: 0, noBalls: 0, maidens: 0, won: false })
const data = (batInns: BatInn[], bowlInns: BowlInn[] = []): PlayerData => ({ batBalls: [], batInns, bowlBalls: [], bowlInns, stands: [], catches: [], matches: [] })

describe('consistency', () => {
  it('works out the median, the starts that went on, ducks and a steadiness label', () => {
    const c = consistencyOf(data([bat(20), bat(22), bat(18), bat(40), bat(0)])).bat!
    expect(c).toMatchObject({ innings: 5, median: 20, best: 40, worst: 0, ducks: 1, starts: 4, kickedOn: 1 })
    expect(c.mean).toBeCloseTo(20)
    expect(c.label).toBe('Steady') // spread 0.64
  })
  it('labels steady and boom-or-bust, and holds back with too few innings', () => {
    expect(consistencyOf(data([bat(20), bat(21), bat(19), bat(20)])).bat!.label).toBe('Steady')
    expect(consistencyOf(data([bat(0), bat(0), bat(20), bat(60)])).bat!.label).toBe('Mixed') // spread 1.22
    expect(consistencyOf(data([bat(0), bat(0), bat(0), bat(60)])).bat!.label).toBe('Boom or bust')
    expect(consistencyOf(data([bat(20), bat(30), bat(40)])).bat!.label).toBeNull()
    expect(steadyLabel(0.79)).toBe('Steady')
    expect(steadyLabel(0.8)).toBe('Mixed')
    expect(steadyLabel(1.3)).toBe('Boom or bust')
  })
  it('counts wicket-taking and expensive spells, ignoring spells under an over', () => {
    const c = consistencyOf(data([], [bowl(2, 14), bowl(0, 22), bowl(1, 8), bowl(0, 3, 3)])).bowl!
    expect(c).toEqual({ innings: 3, withWicket: 2, expensive: 1 })
    expect(consistencyOf(data([])).bat).toBeNull()
    expect(consistencyOf(data([])).bowl).toBeNull()
  })
})

const batter = (o: Partial<NonNullable<Profile['bat']>> = {}): NonNullable<Profile['bat']> => ({ balls: 60, innings: 4, position: 4, deathShare: 0.1, deathBalls: 6, sr: 100, teamSr: 100, boundary: 15, teamBoundary: 15, runsRank: 5, runsOf: 10, ...o })
const bowler = (o: Partial<NonNullable<Profile['bowl']>> = {}): NonNullable<Profile['bowl']> => ({ balls: 36, wickets: 1, econ: 8, teamEcon: 8, wicketsRank: 5, wicketsOf: 8, deathShare: 0.1, deathBalls: 4, ...o })
const keys = (p: Profile) => archetypesFor(p).map((a) => a.key)

describe('archetypes', () => {
  it('needs enough balls before it says anything', () => {
    expect(keys({ bat: batter({ balls: 29 }), bowl: bowler({ balls: 17 }) })).toEqual([])
    expect(keys({ bat: batter({ innings: 2 }), bowl: null })).toEqual([])
  })
  it('picks one batting type, finisher first, then opener, hitter, anchor and a fallback', () => {
    expect(keys({ bat: batter({ deathBalls: 14, deathShare: 0.35 }), bowl: null })).toEqual(['finisher'])
    expect(keys({ bat: batter({ position: 1.5 }), bowl: null })).toEqual(['opener'])
    expect(keys({ bat: batter({ sr: 120, boundary: 20 }), bowl: null })).toEqual(['hitter'])
    expect(keys({ bat: batter({ sr: 120, boundary: 10 }), bowl: null })).toEqual(['steady']) // faster but not hitting boundaries
    expect(keys({ bat: batter({ balls: 80, innings: 4, sr: 95 }), bowl: null })).toEqual(['anchor'])
    expect(keys({ bat: batter({ balls: 40, innings: 4 }), bowl: null })).toEqual(['steady'])
  })
  it('picks a bowling type: strike bowler, miser, death bowler', () => {
    expect(keys({ bat: null, bowl: bowler({ wickets: 5, wicketsRank: 1 }) })).toEqual(['strike'])
    expect(keys({ bat: null, bowl: bowler({ wickets: 2, wicketsRank: 1, econ: 6.5 }) })).toEqual(['miser'])
    expect(keys({ bat: null, bowl: bowler({ deathBalls: 14, deathShare: 0.4 }) })).toEqual(['death'])
    expect(keys({ bat: null, bowl: bowler() })).toEqual([])
  })
  it('adds all-rounder, first, only when top half for both runs and wickets', () => {
    expect(keys({ bat: batter({ runsRank: 2, runsOf: 10 }), bowl: bowler({ wicketsRank: 3, wicketsOf: 8 }) })[0]).toBe('allround')
    expect(keys({ bat: batter({ runsRank: 9, runsOf: 10 }), bowl: bowler({ wicketsRank: 3, wicketsOf: 8 }) })).not.toContain('allround')
  })
})

describe('season card data', () => {
  it('sums the season and names the best innings and spell', () => {
    const d = data([bat(10), bat(45, { notOut: true, opponent: 'Rivals' })], [bowl(3, 12), bowl(1, 8)])
    d.batBalls = []
    d.matches = [
      { matchId: 'a', date: '2026-10-01', potm: true, batter: false, bowler: false },
      { matchId: 'b', date: '2026-11-01', potm: false, batter: false, bowler: false },
    ]
    const w = wrappedOf(d, 4, [{ key: 'x', emoji: '', label: 'Anchor', why: '' }])
    expect(w).toMatchObject({ label: '2026 season', matches: 2, potm: 1, badges: 4, archetype: 'Anchor' })
    expect(w.bat?.best).toEqual({ runs: 45, notOut: true, opponent: 'Rivals' })
    expect(w.bowl?.best).toMatchObject({ wickets: 3, runs: 12 })
  })
  it('says "All matches" when the data spans years, and has no bat or bowl block when there is none', () => {
    const d = data([])
    d.matches = [
      { matchId: 'a', date: '2025-10-01', potm: false, batter: false, bowler: false },
      { matchId: 'b', date: '2026-10-01', potm: false, batter: false, bowler: false },
    ]
    const w = wrappedOf(d, 0, [])
    expect(w.label).toBe('All matches')
    expect(w.bat).toBeNull()
    expect(w.bowl).toBeNull()
    expect(w.archetype).toBeNull()
  })
})
