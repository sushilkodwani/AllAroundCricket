import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { battersOf, chaseOf, fieldingOf, kpisOf, phaseStats, phasesOf, spellsOf } from './analysis'
import { addBall, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']
const play = (f: ScoreFile, ...inputs: (number | BallInput)[]) => inputs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)

function firstInnings(): ScoreFile {
  let f = newScore({ matchId: 'm', teamId: 't', overs: 2, home: { name: 'Home', shortName: 'HOM', xi: H }, away: { name: 'Away', shortName: 'AWY', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  f = play(f, 1, 0, 4, 0, 6, { bat: 0, wicket: { kind: 'caught', who: 'h2', fielder: 'a3' } })
  return f
}

describe('phases', () => {
  it('splits a 20-over innings 6 / 9 / 5', () => {
    expect(phasesOf(20).map((p) => [p.from, p.to])).toEqual([[1, 6], [7, 15], [16, 20]])
  })
  it('scales for shorter games and falls back to one phase for tiny ones', () => {
    expect(phasesOf(10).map((p) => [p.from, p.to])).toEqual([[1, 3], [4, 7], [8, 10]])
    expect(phasesOf(2)).toHaveLength(1)
  })
})

describe('innings numbers', () => {
  it('adds phases up to the innings total', () => {
    const f = play(firstInnings())
    const lines = phaseStats(f, 0)
    expect(lines.reduce((s, l) => s + l.runs, 0)).toBe(11)
    expect(lines.reduce((s, l) => s + l.balls, 0)).toBe(6)
    expect(lines[0].wickets).toBe(1)
  })
  it('works out a bowler’s spell', () => {
    const [s] = spellsOf(firstInnings(), 0)
    expect(s.id).toBe('a1')
    expect(s).toMatchObject({ balls: 6, runs: 11, wickets: 1, dots: 3 })
    expect(s.overs).toEqual([{ over: 1, runs: 11, wickets: 1 }])
  })
  it('lists every ball a batter faced', () => {
    const bs = battersOf(firstInnings(), 0)
    expect(bs.reduce((s, b) => s + b.balls, 0)).toBe(6)
    expect(bs.reduce((s, b) => s + b.runs, 0)).toBe(11)
  })
  it('credits the catch to the fielder', () => {
    expect(fieldingOf(firstInnings(), 0)).toEqual([{ id: 'a3', catches: 1, runOuts: 0, stumpings: 0 }])
  })
  it('counts dots and boundaries', () => {
    const k = kpisOf(firstInnings(), 0)
    expect(k.boundaryPct).toBe(33)
    expect(k.bestOver).toEqual({ over: 1, runs: 11 })
  })
})

describe('the chase', () => {
  it('shows the rate scored against the rate still needed after each over', () => {
    let f = firstInnings()
    f = play(setCrease(f, { striker: 'h3', nonStriker: 'h1', bowler: 'a2' }), 0, 0, 0, 0, 0, 0)
    f = startSecondInnings(f)
    f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h3' })
    f = play(f, 6, 0, 0, 0, 0, 0)
    const c = chaseOf(f)
    expect(c).toHaveLength(1)
    expect(c[0].current).toBeCloseTo(6)
    expect(c[0].required).toBeGreaterThan(0)
  })
  it('is empty before a second innings', () => {
    expect(chaseOf(firstInnings())).toEqual([])
  })
})
