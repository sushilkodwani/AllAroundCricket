import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { handSplitOf, matchupsOf, momentumOf, swingOf, zonesOf } from './analysis'
import { bestStands, byGround, byOpponent, firstVsChase, phaseProfile } from './season'
import { addBall, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']
const play = (f: ScoreFile, ...inputs: (number | BallInput)[]) => inputs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)

/** Home 12 off 2 overs, away chase 2 overs and fall short; finished, home win. */
function game(id = 'm1', homeName = 'Home', awayName = 'Away', toss: 'home' | 'away' = 'home'): ScoreFile {
  let f = newScore({ matchId: id, teamId: 't', overs: 2, home: { name: homeName, shortName: 'HOM', xi: H }, away: { name: awayName, shortName: 'AWY', xi: A }, toss: { wonBy: toss, chose: toss === 'home' ? 'bat' : 'bowl' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  f = play(f, 4, 0, 6, { bat: 0, shot: undefined }, 1, 1)
  f = setCrease(f, { bowler: 'a2' })
  f = play(f, 0, 0, 0, 0, 0, 0)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h3' })
  f = play(f, 1, 0, 0, 0, 0, 0)
  f = setCrease(f, { bowler: 'h4' })
  f = play(f, 0, 0, 0, 0, 0, 0)
  f.status = 'finished'
  f.result = { winner: f.innings[0].batting, text: 'won' }
  return f
}

describe('across matches', () => {
  it('splits results by batting first or chasing and by the toss', () => {
    const r = firstVsChase([game('1'), game('2', 'Home', 'Away', 'away')], 'home')
    expect(r.battingFirst.played).toBe(2)
    expect(r.tossWon.played).toBe(1)
    expect(r.tossLost.played).toBe(1)
    expect(r.battingFirst.won).toBe(2)
  })
  it('groups by opponent', () => {
    const rows = byOpponent([game('1', 'Home', 'Rivals'), game('2', 'Home', 'Rivals'), game('3', 'Home', 'Others')], 'home')
    expect(rows[0]).toMatchObject({ name: 'Rivals', played: 2, won: 2 })
    expect(rows[1].name).toBe('Others')
  })
  it('groups by ground and ignores matches with no ground', () => {
    const matches = [{ id: '1', venue: 'Park' }, { id: '2', venue: 'Park' }, { id: '3' }] as never[]
    const rows = byGround([game('1'), game('2'), game('3')], matches)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ venue: 'Park', played: 2, batFirstWinPct: 100 })
  })
  it('keeps the best stand for each wicket', () => {
    const s = bestStands([game('1')], 'home')
    expect(s[0]).toMatchObject({ wicket: 1, runs: 12 })
  })
  it('adds up a player’s phases (needs a long enough innings)', () => {
    expect(phaseProfile([game()], 'h1').every((p) => p.bat.balls === 0)).toBe(true)
  })
})

describe('inside a match', () => {
  const f = game()
  it('pairs batters with bowlers', () => {
    const m = matchupsOf(f, 0)
    expect(m.reduce((s, x) => s + x.runs, 0)).toBe(12)
    expect(m.find((x) => x.bowler === 'a1' && x.batter === 'h1')?.balls).toBeGreaterThan(0)
  })
  it('gives a rolling rate per over', () => {
    const p = momentumOf(f, 0)
    expect(p).toHaveLength(2)
    expect(p[1].rolling).toBeCloseTo(6)
  })
  it('splits a bowler’s figures by batting hand', () => {
    const [a1] = handSplitOf(f, 0, new Set(['h2']))
    expect(a1.left.balls + a1.right.balls).toBe(6)
    expect(a1.left.balls).toBeGreaterThan(0)
  })
  it('counts boundaries by region only when a direction was recorded', () => {
    expect(zonesOf(f, 0, new Set())).toEqual([])
  })
  it('tracks the chase against the par pace', () => {
    const s = swingOf(f)
    expect(s).toHaveLength(2)
    expect(s[0].ahead).toBeLessThan(0)
    expect(s[1].chance).toBeLessThanOrEqual(5)
  })
})
