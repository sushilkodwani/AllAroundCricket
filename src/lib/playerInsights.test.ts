import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { BAT_LINE, bestWorstSr, bucketOf, bowledAt, byTimeOfDay, byVenue, catchDuos, chaseBalls, clutchOf, facedBowlers, fastestOff, mostOuts, partnersOf, playerMoments, teamRanks, teammatesOf, tightOvers, winContribution } from './playerInsights'
import { playerData, type PlayerCtx } from './playerAnalysis'
import { addBall, endInnings, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']
const play = (f: ScoreFile, ...xs: (number | BallInput)[]) => xs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)

/** Home make 12 off 2 overs (h1 scores 11 off 4 balls); away chase 13 and lose: 0, 4, wicket, 1, 0, 0. h1 bowls all six. */
function game(id: string, homeWon = true): ScoreFile {
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
  f.result = { winner: homeWon ? 'home' : 'away', text: 'x' }
  return f
}

const ctx: PlayerCtx = { styleOf: () => undefined, leftOf: () => false, pitchOf: () => undefined, dateOf: (m) => `2026-0${m.slice(1)}-01`, opponentOf: () => 'A' }

describe('the chase, ball by ball', () => {
  const rows = chaseBalls(game('m1'))
  it('has a row for every ball and moves the chance the right way', () => {
    expect(rows).toHaveLength(6)
    expect(rows[1].delta).toBeGreaterThan(0) // a four
    expect(rows[2].delta).toBeLessThan(0) // a wicket
    expect(rows[2].wicket?.kind).toBe('bowled')
    expect(rows[0].at).toBe('0.1')
  })
  it('is empty without a chase', () => {
    const f = game('m1')
    f.innings = [f.innings[0]]
    expect(chaseBalls(f)).toEqual([])
  })
})

describe('moments and swing', () => {
  it('credits the bowler of the defending side with what cost the chasing side', () => {
    const f = game('m1')
    const { moments, matches } = playerMoments([f], 'h1')
    expect(moments.every((m) => m.kind === 'bowl')).toBe(true)
    expect(moments).toHaveLength(6)
    const wicket = moments.find((m) => m.wicket)!
    expect(wicket.delta).toBeGreaterThan(0)
    const sum = chaseBalls(f).reduce((s, r) => s + r.delta, 0)
    expect(matches[0].bowl).toBeCloseTo(-sum)
    expect(matches[0].total).toBeCloseTo(matches[0].bat + matches[0].bowl)
  })
  it('credits the chasing side’s batter with what helped, and ignores a player who was not in a chase', () => {
    const { moments } = playerMoments([game('m1')], 'a1')
    expect(moments.every((m) => m.kind === 'bat' && m.striker === 'a1')).toBe(true)
    expect(playerMoments([game('m1')], 'h2').moments).toEqual([]) // h2 never bowled or faced in the chase
  })
})

describe('team ranks', () => {
  const files = ['m1', 'm2', 'm3', 'm4'].map((m) => game(m))
  it('lists team-mates from the side the player was on', () => {
    expect(teammatesOf(files, 'h1').sort()).toEqual(H)
    expect(teammatesOf(files, 'a2').sort()).toEqual(A)
  })
  it('ranks a qualifying player and leaves the others without a rank', () => {
    const r = teamRanks(files, 'h1', ctx)
    const runs = r.bat.find((x) => x.key === 'runs')!
    expect(runs.value).toBe(44) // 11 a match
    expect(runs.rank).toBe(1)
    expect(runs.of).toBe(1) // only h1 faced 12+ balls
    expect(r.bowl.find((x) => x.key === 'wkts')!.value).toBe(4)
    expect(teamRanks(files, 'h3', ctx).bat.every((x) => x.rank === null && x.value === null)).toBe(true)
  })
})

describe('with and without', () => {
  const m1 = game('m1')
  const m2 = game('m2', false)
  const m3 = { ...game('m3'), home: { ...game('m3').home, xi: ['h2', 'h3', 'h4', 'h5'] } } as ScoreFile
  const files = [m1, m2, m3]
  it('compares the side’s record with and without the player, and by what they did', () => {
    const w = winContribution(files, playerData(files, 'h1', ctx), 'h1')
    expect(w.withIn).toEqual({ played: 2, won: 1 })
    expect(w.without).toEqual({ played: 1, won: 1 })
    expect(BAT_LINE).toBe(25)
    expect(w.batLow).toEqual({ played: 2, won: 1 }) // 11 in each of their two matches is under the line
    expect(w.batHigh.played).toBe(0)
    expect(w.wicket).toEqual({ played: 2, won: 1 })
  })
  it('leaves out ties and matches without a result', () => {
    const tie = { ...game('m4'), result: { text: 'tied' } } as ScoreFile
    expect(winContribution([tie], playerData([tie], 'h1', ctx), 'h1').withIn.played).toBe(0)
  })
})

describe('time of day and ground', () => {
  it('buckets the start time', () => {
    expect([bucketOf('06:45'), bucketOf('11:59'), bucketOf('12:00'), bucketOf('16:59'), bucketOf('17:00'), bucketOf('21:30')]).toEqual(['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening'])
    expect([bucketOf(undefined), bucketOf(''), bucketOf('25:00'), bucketOf('late')]).toEqual([null, null, null, null])
  })
  const files = [game('m1'), game('m2'), game('m3')]
  const d = playerData(files, 'h1', ctx)
  const info = (id: string) => ({ m1: { time: '07:00', venue: 'North' }, m2: { time: '07:30', venue: 'North' }, m3: { time: '21:30', venue: 'South' } } as Record<string, { time: string; venue: string }>)[id]
  it('splits batting and bowling by bucket and ground', () => {
    const t = byTimeOfDay(d, info)
    expect(t.map((r) => [r.key, r.matches, r.runs, r.inns])).toEqual([
      ['morning', 2, 22, 2],
      ['evening', 1, 11, 1],
    ])
    expect(t[0].wickets).toBe(2)
    const v = byVenue(d, info)
    expect(v.map((r) => [r.label, r.matches])).toEqual([
      ['North', 2],
      ['South', 1],
    ])
  })
  it('names a best and worst bucket only with enough innings, balls and a real gap', () => {
    expect(bestWorstSr(byTimeOfDay(d, info))).toBeNull() // evening has one innings
    const a = { key: 'a', label: 'a', matches: 3, inns: 3, runs: 60, balls: 30, outs: 2, bowlBalls: 0, bowlRuns: 0, wickets: 0 }
    const b = { key: 'b', label: 'b', matches: 2, inns: 2, runs: 20, balls: 20, outs: 2, bowlBalls: 0, bowlRuns: 0, wickets: 0 }
    expect(bestWorstSr([a, b])).toMatchObject({ best: { key: 'a' }, worst: { key: 'b' } })
    expect(bestWorstSr([a, { ...b, runs: 39 }])).toBeNull() // 200 against 195: no real gap
  })
})

/** Home bat 2 overs: over 1 by a1 costs 1 run, over 2 by a2 starts with a catch (a3 the fielder). */
function tightGame(id: string): ScoreFile {
  let f = newScore({ matchId: id, teamId: 't', overs: 2, home: { name: 'H', shortName: 'H', xi: H }, away: { name: 'A', shortName: 'A', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  f = play(f, 1, 0, 0, 0, 0, 0)
  f = setCrease(f, { bowler: 'a2' })
  f = play(f, { wicket: { kind: 'caught', fielder: 'a3' } })
  f = setCrease(f, { striker: 'h3' })
  f = play(f, 0, 0, 0, 0, 0)
  return f
}

describe('nemesis and victims', () => {
  const files = [game('m1')]
  it('adds up each bowler faced and each batter bowled to', () => {
    const faced = facedBowlers(playerData(files, 'a1', ctx))
    expect(faced).toEqual([{ id: 'h1', balls: 3, runs: 4, outs: 1 }])
    expect(mostOuts(faced)).toEqual(faced)
    const at = bowledAt(playerData(files, 'h1', ctx))
    expect(at.find((r) => r.id === 'a1')).toEqual({ id: 'a1', balls: 3, runs: 4, outs: 1 })
    expect(mostOuts(at)[0].id).toBe('a1')
  })
  it('only calls someone a victim with 10+ balls', () => {
    expect(fastestOff(facedBowlers(playerData(files, 'a1', ctx)))).toEqual([])
    const four = ['m1', 'm2', 'm3', 'm4'].map((m) => game(m))
    expect(fastestOff(facedBowlers(playerData(four, 'a1', ctx)))[0]).toMatchObject({ id: 'h1', balls: 12, runs: 16 })
  })
  it('does not count a run out at the other end against the bowler', () => {
    const f = game('m1')
    const rows = facedBowlers(playerData([f], 'h1', ctx))
    expect(rows.every((r) => r.outs === 0)).toBe(true)
  })
})

describe('under pressure', () => {
  const files = [game('m1')]
  it('splits death and balance balls from everything, and leaves a short game without death overs', () => {
    const c = clutchOf(files, playerData(files, 'h1', ctx), 'h1')
    expect(c.death.bat.balls).toBe(0) // a 2-over match has no death phase
    expect(c.overall.bat.balls).toBe(4)
    expect(c.overall.bowl).toEqual({ balls: 6, runs: 5, wickets: 1 })
    expect(c.balance.bowl.balls).toBeLessThanOrEqual(6)
    expect(c.balance.bat.balls).toBe(0) // h1 did not bat in the chase
  })
})

describe('partners', () => {
  it('adds up batting stands with each partner', () => {
    const files = [game('m1'), game('m2')]
    const rows = partnersOf(playerData(files, 'h1', ctx))
    expect(rows[0]).toMatchObject({ id: 'h2', stands: 2 })
    expect(rows[0].runs).toBeGreaterThan(0)
  })
  it('finds who takes catches off a bowler and whose bowling a fielder took them off', () => {
    const f = [tightGame('t1')]
    expect(catchDuos(f, 'a2').offMe).toEqual([{ id: 'a3', n: 1 }])
    expect(catchDuos(f, 'a3').iTookFor).toEqual([{ id: 'a2', n: 1 }])
    expect(catchDuos(f, 'a1')).toEqual({ offMe: [], iTookFor: [] })
  })
  it('counts tight overs and the wickets in the over after them', () => {
    const t = tightOvers([tightGame('t1')], 'a1')
    expect(t).toMatchObject({ tight: 1, followed: 1, wickets: 1 })
    expect(t.by).toEqual([{ id: 'a2', overs: 1, wickets: 1 }])
    expect(tightOvers([tightGame('t1')], 'a2').tight).toBe(0) // a2's own over cost nothing but there is no over after it
  })
})
