import { describe, expect, it } from 'vitest'
import type { BowlStyle, ScoreFile } from '../types'
import { batAgg, bowlAgg, busiestRegion, byOverOfInnings, inYear, playerData, progression, startAndAfter, wicketsSpread, winPct, type PlayerCtx } from './playerAnalysis'
import { addBall, endInnings, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']
const play = (f: ScoreFile, ...xs: (number | BallInput)[]) => xs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)

function match(id: string): ScoreFile {
  let f = newScore({ matchId: id, teamId: 't', overs: 2, home: { name: 'H', shortName: 'H', xi: H }, away: { name: 'A', shortName: 'A', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  // h1: 4, dot, wide, 6, a single with a direction; then h2 blocks the last ball
  f = play(f, 4, 0, { kind: 'wd' }, 6, { bat: 1, shot: [0.6, 0.3] }, 0)
  f = endInnings(f)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
  f = play(f, 0, 4, { bat: 0, wicket: { kind: 'bowled' } })
  f = setCrease(f, { striker: 'a3' })
  f = play(f, 1, 0, 0)
  f = endInnings(f)
  return f
}

const ctx: PlayerCtx = {
  styleOf: (id) => ({ a1: 'rf', a2: 'ro' } as Record<string, BowlStyle>)[id],
  leftOf: (id) => id === 'a3',
  pitchOf: () => 'turf',
  dateOf: (m) => (m === 'm1' ? '2025-05-01' : '2026-04-01'),
  opponentOf: () => 'A',
}

describe('player analysis', () => {
  const files = [match('m1'), match('m2')]
  const d = playerData(files, 'h1', ctx)

  it('collects batting balls and innings, latest first, without counting wides as faced', () => {
    expect(d.batInns).toHaveLength(2)
    expect(d.batInns[0].date).toBe('2026-04-01')
    const one = d.batInns[0]
    expect(one.position).toBe(1)
    expect([one.runs, one.balls]).toEqual([11, 4])
    expect(one.progress[one.progress.length - 1]).toBe(one.runs)
    const a = batAgg(d.batBalls.filter((b) => b.matchId === 'm1'))
    expect(a.balls).toBe(one.balls)
    expect(a.runs).toBe(one.runs)
    expect(a.fours).toBe(1)
    expect(a.sixes).toBe(1)
    expect(d.batBalls.every((b) => b.style === 'rf' || b.style === 'ro' || b.style === 'unknown')).toBe(true)
  })

  it('works out the average progress, early strike rate and busiest region', () => {
    const p = progression(d.batInns)
    expect(p.slice(0, 4)).toEqual([4, 4, 10, 11])
    const s = startAndAfter(d.batInns, 2)
    expect(s.start).toBe(200) // 4 + 0 off the first two balls
    expect(busiestRegion(d.batBalls, false)?.runs).toBe(2) // only the two singles had a direction
  })

  it('collects bowling: wickets, the batter’s position, the over of the innings and the spread', () => {
    expect(d.bowlInns).toHaveLength(2)
    const a = bowlAgg(d.bowlBalls)
    expect(a.wickets).toBe(2)
    expect(a.fours).toBe(2)
    expect(a.dots).toBe(8) // the wicket ball is a dot too
    expect(d.bowlBalls.find((b) => b.wicket)?.victim).toBe(1)
    expect(d.bowlBalls.find((b) => b.striker === 'a3')?.left).toBe(true)
    const overs = byOverOfInnings(d.bowlBalls)
    expect(overs[0]).toMatchObject({ over: 1, overs: 2, wickets: 2 })
    expect(wicketsSpread(d.bowlInns)).toEqual([0, 2, 0, 0, 0, 0])
  })

  it('filters by year and works out how often the side won', () => {
    expect(inYear(d, '2025').batInns).toHaveLength(1)
    const w = winPct(d.batInns, () => true)
    expect(w?.of).toBe(2)
  })
})
