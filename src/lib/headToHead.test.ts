import { describe, expect, it } from 'vitest'
import type { Match, ScoreFile } from '../types'
import { headToHeadOf } from './headToHead'

const match = (id: string, date: string, result?: Match['result']): Match => ({ id, teamId: 't', date, opponent: 'X', matchType: 'league', squad: [], cancelled: false, lifecycle: 'completed', result, createdAt: 'x', updatedAt: 'x' }) as Match
const ball = (striker: string, bat: number) => ({ t: 'ball' as const, id: Math.random().toString(), striker, nonStriker: striker + 'b', bowler: 'z', kind: 'legal' as const, bat, byes: 0, at: 'x' })
function file(id: string, homeFirst: boolean, home: number, away: number, winner: 'home' | 'away', text: string): ScoreFile {
  const inn = (side: 'home' | 'away', runs: number) => ({ batting: side, overs: 20, events: [ball(side === 'home' ? 'h1' : 'a1', runs)], crease: {}, closed: true })
  const sides = homeFirst ? [inn('home', home), inn('away', away)] : [inn('away', away), inn('home', home)]
  return { schemaVersion: 1, matchId: id, teamId: 't', overs: 20, home: { name: 'Us', shortName: 'US', xi: ['h1', 'h1b'] }, away: { name: 'X', shortName: 'X', xi: ['a1', 'a1b'] }, toss: { wonBy: 'home', chose: 'bat' }, innings: sides, status: 'finished', result: { winner, text }, startedAt: 'x', updatedAt: 'x' } as unknown as ScoreFile
}

describe('head to head', () => {
  const matches = [match('m1', '2026-01-01', 'lost'), match('m2', '2026-02-01', 'won'), match('m3', '2026-03-01', 'won'), match('m4', '2026-04-01', 'won'), match('m5', '2026-05-01')]
  const files = [file('m2', true, 150, 120, 'home', 'Us won by 30 runs'), file('m3', false, 101, 100, 'home', 'Us won by 8 wickets'), file('m1', true, 90, 91, 'away', 'X won by 9 wickets')]
  const h = headToHeadOf(matches, files)

  it('counts results, win %, the form and the current streak', () => {
    expect([h.played, h.won, h.lost, h.winPct]).toEqual([4, 3, 1, 75])
    expect(h.form.map((f) => f.result)).toEqual(['won', 'won', 'won', 'lost'])
    expect(h.streak).toEqual({ result: 'won', count: 3 })
  })

  it('splits batting first and chasing, and finds the extremes', () => {
    expect(h.battingFirst).toEqual({ played: 2, won: 1 })
    expect(h.chasing).toEqual({ played: 1, won: 1 })
    expect(h.highest?.runs).toBe(150)
    expect(h.lowest?.runs).toBe(90) // the 101 was a won chase, so it does not count as low
    expect(h.theirHighest?.runs).toBe(120)
    expect(h.biggestWin?.text).toBe('Us won by 8 wickets') // a wicket counts as 10 runs, so 8 wickets beats 30 runs
    expect(h.heaviestLoss?.text).toBe('X won by 9 wickets')
    expect(h.ourBat[0].bat.runs).toBe(341)
  })
})
