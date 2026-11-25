import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { playerData, type PlayerCtx } from './playerAnalysis'
import { teamRanks } from './playerInsights'
import { addBall, endInnings, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'
import { buildReport, pagesOf, type ReportInput } from './seasonReport'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']
const play = (f: ScoreFile, ...xs: (number | BallInput)[]) => xs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)

/** Home make 12 (h1 scores 11 off 4 balls); away chase 13 and lose: 0, 4, bowled, 1, 0, 0. h1 bowls all six. */
function game(id: string): ScoreFile {
  let f = newScore({ matchId: id, teamId: 't', overs: 2, home: { name: 'H', shortName: 'H', xi: H }, away: { name: 'A', shortName: 'A', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  f = play(f, 4, 0, { kind: 'wd' }, 6, { bat: 1 }, 0)
  f = endInnings(f)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
  f = play(f, 0, 4, { bat: 0, wicket: { kind: 'bowled' } })
  f = setCrease(f, { striker: 'a3' })
  f = play(f, 1, 0, 0)
  f.status = 'finished'
  f.result = { winner: 'home', text: 'x' }
  return f
}

const dates: Record<string, string> = { m1: '2026-10-01', m2: '2026-10-08', m3: '2026-10-15' }
const ctx: PlayerCtx = { styleOf: () => undefined, leftOf: () => false, pitchOf: () => undefined, dateOf: (m) => dates[m], opponentOf: () => 'Rivals' }
const files = ['m3', 'm1', 'm2'].map(game) // out of date order on purpose

function input(personId: string): ReportInput {
  return {
    d: playerData(files, personId, ctx),
    files,
    personId,
    name: (id) => id.toUpperCase(),
    matchOf: (id) => ({ date: dates[id], opponent: 'Rivals', time: id === 'm3' ? '21:30' : '07:00', venue: 'North' }),
    ranks: teamRanks(files, personId, ctx),
    archetypes: [],
    badges: 2,
    meta: { name: 'Hari One', team: 'Home XI', color: '#123456', jersey: 7 },
  }
}

describe('season report', () => {
  const r = buildReport(input('h1'))

  it('puts the headline numbers first and says which season', () => {
    expect(r.label).toBe('2026 season')
    expect(r.headline.slice(0, 4)).toEqual([['Matches', '3'], ['Won', '3'], ['Runs', '33'], ['Wickets', '3']])
    expect(r.headline.at(-1)).toEqual(['Badges', '2'])
  })

  it('lists batting match by match, oldest first, with the phases, mix and how they got out', () => {
    expect(r.bat!.perMatch.map((b) => b.value)).toEqual([11, 11, 11])
    expect(r.bat!.mix.find((m) => m.label === '4s')!.value).toBe(3)
    expect(r.bat!.mix.find((m) => m.label === '6s')!.value).toBe(3)
    expect(r.bat!.outs).toEqual([{ label: 'Not out', value: 3 }])
    expect(r.bat!.best).toBe('11* vs Rivals')
    expect(r.bat!.partners[0]).toMatchObject({ name: 'H2', stands: 3 })
    expect(r.bat!.phases).toEqual([]) // a 2-over match has no powerplay, middle or death
  })

  it('lists bowling match by match with the way each wicket fell', () => {
    expect(r.bowl!.perMatch.map((b) => b.value)).toEqual([1, 1, 1])
    expect(r.bowl!.kinds).toEqual([{ label: 'Bowled', value: 3 }])
    expect(r.bowl!.best).toBe('1/5 vs Rivals')
  })

  it('gathers the insights: moments, with and without, time of day and ground', () => {
    const x = r.insights
    expect(x.chases).toBe(3)
    expect(x.best.length).toBeGreaterThan(0)
    expect(x.best.every((m) => m.delta > 0)).toBe(true)
    expect(x.withWithout[0]).toEqual({ label: 'With you in the XI', played: 3, won: 3 })
    expect(x.time.map((t) => t.label)).toEqual(['Morning', 'Evening / night'])
    expect(x.venue).toEqual([expect.objectContaining({ label: 'North', matches: 3 })])
  })

  it('has every page for a batter and bowler, and only the overview for someone with nothing', () => {
    expect(pagesOf(r)).toEqual(['overview', 'batting', 'bowling', 'insights'])
    const none = buildReport(input('a4'))
    expect(none.bat).toBeNull()
    expect(none.bowl).toBeNull()
    expect(pagesOf(none)).toEqual(['overview', 'insights']) // a4 played, so the team's record with and without them is there
    expect(pagesOf(buildReport(input('nobody')))).toEqual(['overview'])
  })
})
