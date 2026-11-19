import { describe, expect, it } from 'vitest'
import type { FundEntry, Match } from '../types'
import { duesByPlayer, fundTimeline, matchCosts, monthlyFlow, shortMonth, spendByCategory } from './funds'
import { rollingAverage } from './season'

const e = (id: string, type: FundEntry['type'], amount: number, date: string, personId = 'p1'): FundEntry => ({ id, teamId: 't', type, personId, amount, date, createdAt: `${date}T0${id}`, updatedAt: '' })
const entries = [e('1', 'contribution', 1000, '2026-09-05'), e('2', 'match_deduction', 300, '2026-09-20'), e('3', 'contribution', 500, '2026-10-02', 'p2'), e('4', 'refund', 100, '2026-10-10'), e('5', 'adjustment', -50, '2026-10-11')]

const match = (id: string, date: string, lines: [string, number][], shares: { personId: string; pending: number; settled: boolean }[] = [], lifecycle: Match['lifecycle'] = 'settling'): Match =>
  ({ id, teamId: 't', date, opponent: 'X', matchType: 'league', squad: [], cancelled: false, lifecycle, createdAt: '', updatedAt: '', expense: { status: 'submitted', payerIds: [], roundingExtra: 0, updatedAt: '', lines: lines.map(([categoryName, total]) => ({ categoryId: categoryName, categoryName, mode: 'optional', total, excludedPersonIds: [] })), shares: shares.map((s) => ({ ...s, byCategory: {}, total: s.pending, fromFunds: 0 })) } }) as Match

describe('fund charts', () => {
  it('builds the fund balance over time', () => {
    expect(fundTimeline(entries).map((p) => p.balance)).toEqual([1000, 700, 1200, 1100, 1050])
  })
  it('splits each month into money in and money out', () => {
    expect(monthlyFlow(entries)).toEqual([
      { month: '2026-09', moneyIn: 1000, moneyOut: 300 },
      { month: '2026-10', moneyIn: 500, moneyOut: 150 },
    ])
    expect(shortMonth('2026-10')).toBe('Oct 26')
  })
  it('totals match costs and spending by category', () => {
    const ms = [match('b', '2026-10-01', [['Ground', 800], ['Balls', 200]]), match('a', '2026-09-01', [['Ground', 700]])]
    expect(matchCosts(ms).map((x) => [x.match.id, x.total])).toEqual([['a', 700], ['b', 1000]])
    expect(spendByCategory(ms)).toEqual([{ name: 'Ground', total: 1500 }, { name: 'Balls', total: 200 }])
  })
  it('lists who owes what, only for matches still being settled', () => {
    const ms = [
      match('a', '2026-09-01', [['Ground', 700]], [{ personId: 'p1', pending: 100, settled: false }, { personId: 'p2', pending: 50, settled: true }]),
      match('b', '2026-10-01', [['Ground', 700]], [{ personId: 'p1', pending: 40, settled: false }, { personId: 'p3', pending: 300, settled: false }], 'completed'),
    ]
    expect(duesByPlayer(ms)).toEqual([{ personId: 'p1', total: 100 }])
  })
})

describe('rolling average', () => {
  it('averages each value with the two before it', () => {
    expect(rollingAverage([10, 20, 30, 0])).toEqual([10, 15, 20, 50 / 3])
  })
})
