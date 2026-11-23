import { describe, expect, it } from 'vitest'
import type { Innings, ScoreFile } from '../types'
import { GAP_CAP, inningsMinutes, mins, pairKey } from './minutes'
import { addBall, newScore, setCrease } from './scoring'

/** An innings whose balls were entered `gaps` ms apart (gaps[i] = time before ball i+1). */
function innings(gaps: number[], wicketAt = -1): Innings {
  let f: ScoreFile = newScore({ matchId: 'm', teamId: 't', overs: 5, home: { name: 'H', shortName: 'H', xi: ['h1', 'h2', 'h3'] }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2'] }, toss: { wonBy: 'home', chose: 'bat' } })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  gaps.forEach((_, i) => {
    if (i > 0 && i % 6 === 0) f = setCrease(f, { bowler: (i / 6) % 2 ? 'a2' : 'a1' })
    f = addBall(f, i === wicketAt ? { bat: 0, wicket: { kind: 'bowled' } } : { bat: 0 })
    if (i === wicketAt) f = setCrease(f, { striker: 'h3' })
  })
  let t = Date.parse('2026-11-01T07:30:00Z')
  const inn = f.innings[0]
  const events = inn.events.map((e, i) => {
    t += gaps[i]
    return { ...e, at: new Date(t).toISOString() }
  })
  return { ...inn, events }
}

describe('minutes on the field', () => {
  it('adds up each batter’s time, each stand and each over', () => {
    // 8 balls a minute apart; h1 is bowled on ball 3 and h3 comes in.
    const m = inningsMinutes(innings(Array(8).fill(60_000), 2))
    expect(m.timed).toBe(true)
    expect(mins(m.total)).toBe(8)
    expect(mins(m.batters.get('h1')!)).toBe(3)
    expect(mins(m.batters.get('h2')!)).toBe(8)
    expect(mins(m.batters.get('h3')!)).toBe(5)
    expect(mins(m.stands.get(pairKey('h2', 'h1'))!)).toBe(3)
    expect(m.overs.map(mins)).toEqual([6, 2])
  })

  it('caps a break so it never lands on one batter', () => {
    const m = inningsMinutes(innings([60_000, 60_000, 60_000, 40 * 60_000, 60_000, 60_000, 60_000]))
    expect(m.total).toBe(6 * 60_000 + GAP_CAP)
  })

  it('shows nothing when the balls were typed in afterwards', () => {
    expect(inningsMinutes(innings(Array(12).fill(1_000))).timed).toBe(false)
    expect(inningsMinutes(innings([60_000, 60_000])).timed).toBe(false) // too few balls to say
  })
})
