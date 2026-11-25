import { describe, expect, it } from 'vitest'
import type { Match, ScoreFile } from '../types'
import { bowlerDots, dismissalKinds, extrasConceded, formOf, phaseSplit, scoringMix } from './teamCharts'
import { addBall, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']
const play = (f: ScoreFile, ...inputs: (number | BallInput)[]) => inputs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)
const over = (f: ScoreFile, bowler: string, ...runs: number[]) => play(setCrease(f, { bowler }), ...runs)

/** 10-over game: powerplay 1–3, middle 4–7, death 8–10. Home bat first and score 6 in over 1 and 12 in over 8. */
function longGame(id: string, text = 'Home won by 5 runs'): ScoreFile {
  let f = newScore({ matchId: id, teamId: 't', overs: 10, home: { name: 'Home', shortName: 'HOM', xi: H }, away: { name: 'Away', shortName: 'AWY', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  f = play(f, 1, 1, 1, 1, 1, 1)
  const bowl = (o: number) => A[(o - 1) % 4]
  for (let o = 2; o <= 7; o++) f = over(f, bowl(o), 0, 0, 0, 0, 0, 0)
  f = over(f, bowl(8), 6, 6, 0, 0, 0, 0)
  f = over(f, bowl(9), 0, 0, 0, 0, 0, 0)
  f = over(f, bowl(10), 0, 0, 0, 0, 0, 0)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h3' })
  f = play(f, 4, 0, 0, 0, 0, 0)
  f.status = 'finished'
  f.result = { winner: 'home', text }
  return f
}

const match = (id: string, date: string): Match => ({ id, date }) as Match

describe('form strip', () => {
  it('reads result, margin and scores from the point of view of one side, oldest first', () => {
    const a = longGame('a', 'Home won by 5 runs')
    const b = longGame('b', 'Away won by 4 wickets')
    b.result = { winner: 'away', text: 'Away won by 4 wickets' }
    const t = longGame('t', 'Match tied')
    t.result = { text: 'Match tied' }
    const home = formOf([b, a, t], [match('a', '2026-10-01'), match('b', '2026-10-05'), match('t', '2026-10-03')], 'home')
    expect(home.map((p) => p.matchId)).toEqual(['a', 't', 'b'])
    expect(home.map((p) => p.result)).toEqual(['W', 'T', 'L'])
    expect(home[0]).toMatchObject({ margin: '5 runs', runsMargin: 5, scoreFor: 18, scoreAgainst: 4, opponent: 'Away' })
    expect(home[2].margin).toBe('4 wkts')
    expect(formOf([a], [match('a', '2026-10-01')], 'away')[0]).toMatchObject({ result: 'L', opponent: 'Home', scoreFor: 4, scoreAgainst: 18 })
  })
  it('skips matches that are not finished', () => {
    const f = longGame('x')
    f.status = 'live' as ScoreFile['status']
    expect(formOf([f], [match('x', '2026-10-01')], 'home')).toEqual([])
  })
})

describe('phase breakdown', () => {
  it('adds up scoring rate and concession rate per phase', () => {
    const rows = phaseSplit([longGame('a'), longGame('b')], 'home')
    expect(rows.map((r) => r.key)).toEqual(['pp', 'mid', 'death'])
    const pp = rows[0]
    // home: 6 runs in the first over of 18 balls -> 6 * 6 / 18 = 2
    expect(pp.batRate).toBeCloseTo(2)
    // away scored 4 in the first over only; a chase over covers 6 balls of the powerplay
    expect(pp.bowlRate).toBeCloseTo(4)
    expect(rows[2].batRate).toBeCloseTo(4)
    expect(pp.matches).toBe(2)
  })
  it('shows only the side asked for', () => {
    const rows = phaseSplit([longGame('a')], 'away')
    expect(rows[0].batRate).toBeCloseTo(4)
    expect(rows[0].bowlRate).toBeCloseTo(2)
  })
  it('has nothing for a game too short to have phases', () => {
    const f = newScore({ matchId: 's', teamId: 't', overs: 2, home: { name: 'H', shortName: 'H', xi: H }, away: { name: 'A', shortName: 'A', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
    expect(phaseSplit([f], 'home')).toEqual([])
  })
})

/** 2 overs a side. Home over 1: 0 1 2 4 6 wd 3. Over 2: nb+1, leg-bye, bowled, caught, three dots. Away reply: 0 0 run out. */
function tiny(): ScoreFile {
  let f = newScore({ matchId: 'tiny', teamId: 't', overs: 2, home: { name: 'Home', shortName: 'HOM', xi: H }, away: { name: 'Away', shortName: 'AWY', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  f = play(f, 0, 1, 2, 4, 6, { kind: 'wd' }, 3)
  f = setCrease(f, { bowler: 'a2' })
  f = play(f, { kind: 'nb', bat: 1 }, { byes: 1, byeType: 'lb' }, { wicket: { kind: 'bowled' } })
  f = setCrease(f, { striker: 'h3' })
  f = play(f, { wicket: { kind: 'caught', fielder: 'a3' } })
  f = setCrease(f, { striker: 'h4' })
  f = play(f, 0, 0, 0)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h3' })
  f = play(f, 0, 0, { wicket: { kind: 'run_out', fielder: 'h4' } })
  return f
}

describe('scoring mix', () => {
  it('sorts every delivery into dots, runs, boundaries and extras', () => {
    const m = scoringMix([tiny()], 'home', true)
    expect(m).toMatchObject({ dot: 6, one: 1, two: 1, other: 1, four: 1, six: 1, extras: 3, total: 14 })
    expect(m.dotPct).toBe(50) // 6 of 12 legal balls
    expect(m.boundaryPct).toBe(17) // 2 of 12
  })
  it('reads the bowling side from the other innings', () => {
    expect(scoringMix([tiny()], 'home', false).total).toBe(3)
  })
})

describe('dismissals and dot balls', () => {
  it('counts how a side lost and took wickets', () => {
    const d = dismissalKinds([tiny()], 'home')
    expect(d.lost).toEqual({ bowled: 1, caught: 1 })
    expect(d.taken).toEqual({ run_out: 1 })
  })
  it('counts dot balls per bowler, leaving out no-balls and not charging byes', () => {
    const d = bowlerDots([tiny()], 'away')
    expect(d.get('a1')).toEqual({ dots: 1, balls: 6 })
    expect(d.get('a2')).toEqual({ dots: 6, balls: 6 })
    expect(bowlerDots([tiny()], 'home').get('h3')).toEqual({ dots: 3, balls: 3 })
  })
})

describe('extras conceded', () => {
  it('counts wides and no-balls by the bowling side, per match', () => {
    const [p] = extrasConceded([tiny()], [match('tiny', '2026-10-01')], 'home')
    expect(p).toMatchObject({ wides: 0, noBalls: 0, total: 0, opponent: 'Away' })
    const [q] = extrasConceded([tiny()], [match('tiny', '2026-10-01')], 'away')
    expect(q).toMatchObject({ wides: 1, noBalls: 1, total: 2, opponent: 'Home' })
  })
})
