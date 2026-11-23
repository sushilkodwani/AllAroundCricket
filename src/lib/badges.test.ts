import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { badgesOf, earnedBadges } from './badges'
import { addBall, endInnings, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

const play = (f: ScoreFile, ...xs: (number | BallInput)[]) => xs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)

/** h1 hits three sixes and a four off one over (22), then takes a wicket and a catch. */
function match(id: string, potm = false): ScoreFile {
  let f = newScore({ matchId: id, teamId: 't', overs: 2, home: { name: 'H', shortName: 'H', xi: ['h1', 'h2', 'h3'] }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2', 'a3', 'a4', 'a5'] }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  f = play(f, 6, 6, 6, 4, 0, 0)
  f = endInnings(f)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
  f = play(f, { bat: 0, wicket: { kind: 'bowled' } })
  f = setCrease(f, { striker: 'a3' })
  f = play(f, { bat: 0, wicket: { kind: 'caught', fielder: 'h1' } })
  f = setCrease(f, { striker: 'a4' })
  f = play(f, 0, 0, 0, 0)
  f = endInnings(f)
  return potm ? { ...f, awards: { potm: 'h1' } } : f
}

describe('badges', () => {
  const dates: Record<string, string> = { m1: '2026-05-01', m2: '2026-06-01', m3: '2026-07-01', m4: '2026-08-01', m5: '2026-09-01' }
  const files = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => match(id, i === 4))
  const badges = badgesOf(files, 'h1', (m) => dates[m])
  const get = (id: string) => badges.find((b) => b.id === id)!

  it('awards one-innings feats with the first match they happened in, and counts repeats', () => {
    expect(get('sixhitter').earned).toEqual({ date: '2026-05-01', matchId: 'm1' })
    expect(get('sixhitter').times).toBe(5)
    expect(get('quickfire').earned).toBeNull() // 22 off 6 balls: fast, but under 25
    expect(get('thirty').earned).toBeNull()
    expect(get('firstwicket').times).toBe(5)
    expect(get('threefor').earned).toBeNull()
    expect(get('potm').earned?.matchId).toBe('m5')
  })

  it('earns count badges in the match the running total crosses the line, with progress until then', () => {
    expect(get('runs100').earned?.matchId).toBe('m5') // 22 a match: 110 after the fifth
    expect(get('runs250').progress).toEqual({ have: 110, need: 250 })
    expect(get('catches5').earned?.matchId).toBe('m5')
    expect(get('wkts10').earned?.matchId).toBe('m5') // 2 a match (the catch was off his bowling too)
    expect(get('wkts25').progress).toEqual({ have: 10, need: 25 })
  })

  it('lists earned badges latest first', () => {
    const e = earnedBadges(badges)
    expect(e[0].earned!.date >= e[e.length - 1].earned!.date).toBe(true)
  })
})
