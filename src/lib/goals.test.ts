import { describe, expect, it } from 'vitest'
import type { Goal, Person } from '../types'
import { canWrite } from './access'
import { goalProgress, goalTitle } from './goals'
import type { PlayerData } from './playerAnalysis'

const ball = (date: string, bat: number, extra: Partial<{ out: 'bowled' }> = {}) => ({ matchId: date, date, opponent: 'X', inn: 0, over: 1, phase: 'pp' as const, bowler: 'b', style: 'rf' as const, bat, faced: true, ...extra })
const data: PlayerData = {
  batBalls: [ball('2025-05-01', 4), ball('2026-05-01', 6), ball('2026-05-01', 1, { out: 'bowled' })],
  batInns: [
    { matchId: 'a', date: '2025-05-01', opponent: 'X', inn: 0, position: 1, runs: 4, balls: 1, fours: 1, sixes: 0, notOut: true, won: null, progress: [4] },
    { matchId: 'b', date: '2026-05-01', opponent: 'X', inn: 0, position: 1, runs: 7, balls: 2, fours: 0, sixes: 1, notOut: false, won: null, progress: [6, 7] },
  ],
  bowlBalls: [],
  bowlInns: [],
  stands: [],
  matches: [],
  catches: [{ matchId: 'b', date: '2026-05-01' }],
}
const goal = (g: Partial<Goal>): Goal => ({ id: 'g', metric: 'runs', target: 10, period: 'all', createdAt: 'x', ...g })

describe('personal goals', () => {
  it('counts runs for the year picked or the whole career', () => {
    expect(goalProgress(goal({}), data)).toMatchObject({ value: 11, done: true, text: '11 of 10' })
    const year = goalProgress(goal({ period: 'year', year: '2026' }), data)
    expect(year).toMatchObject({ value: 7, done: false })
    expect(year.share).toBeCloseTo(0.7)
    expect(goalTitle(goal({ period: 'year', year: '2026' }))).toBe('10 runs in 2026')
  })

  it('handles rates and nothing-to-measure-yet', () => {
    expect(goalProgress(goal({ metric: 'sr', target: 300 }), data).value).toBeCloseTo(366.67, 1)
    expect(goalProgress(goal({ metric: 'econ', target: 7 }), data)).toMatchObject({ value: null, done: false })
    expect(goalProgress(goal({ metric: 'catches', target: 1 }), data).done).toBe(true)
    expect(goalTitle(goal({ metric: 'econ', target: 7 }))).toBe('Economy of 7 or less in all')
  })

  it('lets a player set goals on their own profile only', () => {
    const me: Person = { id: 'p1', name: 'Me', access: 'view', isGuest: false, teamIds: ['t'], createdAt: 'x', updatedAt: 'x' }
    const other: Person = { ...me, id: 'p2', name: 'Other' }
    const before = { schemaVersion: 1, people: [me, other] }
    const g = [goal({})]
    const viewer = { role: 'viewer' as const, personId: 'p1' }
    expect(canWrite(viewer, 'people.json', before, { schemaVersion: 1, people: [{ ...me, goals: g }, other] })).toBe(true)
    expect(canWrite(viewer, 'people.json', before, { schemaVersion: 1, people: [me, { ...other, goals: g }] })).toBe(false)
  })
})
