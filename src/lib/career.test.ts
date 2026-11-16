import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { batAverage, batStrikeRate, bestBowling, bowlEconomy, careerStats, highScore } from './career'
import { addBall, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

function match(id: string, first: (number | BallInput)[], second: (number | BallInput)[]): ScoreFile {
  let f = newScore({
    matchId: id,
    teamId: 't',
    overs: 1,
    home: { name: 'Home', shortName: 'HOM', xi: ['h1', 'h2', 'h3'] },
    away: { name: 'Away', shortName: 'AWY', xi: ['a1', 'a2', 'a3'] },
    toss: { wonBy: 'home', chose: 'bat' },
  })
  const play = (xs: (number | BallInput)[]) => {
    for (const x of xs) {
      f = addBall(f, typeof x === 'number' ? { bat: x } : x)
      const inn = f.innings[f.innings.length - 1]
      if (!inn.closed && !inn.crease.striker) f = setCrease(f, { striker: inn.batting === 'home' ? 'h3' : 'a3' })
    }
  }
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  play(first)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
  play(second)
  return f
}

describe('career stats', () => {
  // Match 1: h1 6 6 4 (16) then bowled; h3 0 0. Chase: a1 caught by h2 first ball, then dots.
  const m1 = match('m1', [6, 6, { bat: 4, shot: [1, 0] }, { wicket: { kind: 'bowled' } }, 0, 0], [{ wicket: { kind: 'caught', fielder: 'h2' } }, 0, 0, 0, 0, 0])
  // Match 2: h1 not out 2 2 2 2 2 2 (12*). Chase: a1 stumped by h3, rest dots.
  const m2 = match('m2', [2, 2, 2, 2, 2, 2], [{ wicket: { kind: 'stumped', fielder: 'h3' } }, 0, 0, 0, 0, 0])
  const all = careerStats([m1, m2])

  it('adds up batting over matches', () => {
    const h1 = all.get('h1')!
    expect(h1.matches).toBe(2)
    expect(h1.bat).toMatchObject({ innings: 2, notOuts: 1, runs: 28, balls: 10, fours: 1, sixes: 2 })
    expect(highScore(h1)).toBe('16')
    expect(batAverage(h1)).toBe('28.00') // out once
    expect(batStrikeRate(h1)).toBe('280.0')
    expect(h1.shots).toEqual([{ shot: [1, 0], runs: 4 }])
    expect(h1.byMatch.map((l) => l.bat)).toEqual([
      { runs: 16, balls: 4, notOut: false },
      { runs: 12, balls: 6, notOut: true },
    ])
  })
  it('a duck needs a dismissal; never out has no average', () => {
    expect(all.get('a1')!.bat.ducks).toBe(2)
    expect(all.get('h3')!.bat.ducks).toBe(0) // 0 not out
    expect(batAverage(all.get('h2')!)).toBe('–')
  })
  it('adds up bowling and keeps the best figures', () => {
    const h1 = all.get('h1')!
    expect(h1.bowl).toMatchObject({ innings: 2, balls: 12, runs: 0, wickets: 2, maidens: 2 })
    expect(bestBowling(h1)).toBe('1/0')
    expect(bowlEconomy(h1)).toBe('0.00')
    const a1 = all.get('a1')!
    expect(a1.bowl).toMatchObject({ innings: 2, balls: 12, runs: 28, wickets: 1 })
    expect(bestBowling(a1)).toBe('1/16')
  })
  it('credits catches and stumpings to the fielder', () => {
    expect(all.get('h2')!.field).toEqual({ catches: 1, stumpings: 0, runOuts: 0 })
    expect(all.get('h3')!.field).toEqual({ catches: 0, stumpings: 1, runOuts: 0 })
  })
  it('a player in the XI who did nothing still has the match counted', () => {
    expect(all.get('a3')!.matches).toBe(2)
  })
})
