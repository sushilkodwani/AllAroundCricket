import { describe, expect, it } from 'vitest'
import type { ExpenseLine, FundEntry, Match, PlayerShare } from '../types'
import { memoryKV } from './cache'
import {
  addAdjustment,
  addContribution,
  addMatch,
  addRefund,
  completeMatch,
  createTeam,
  deleteFundEntry,
  deleteMatch,
  fundsOf,
  getMatch,
  matchesOf,
  reopenMatch,
  setSquad,
  settleShare,
  submitExpenses,
  teamsOf,
} from './domain'
import { fakeBackend } from './fakeBackend'
import { balanceOf, duesOf, negativeBalances, pendingDues, teamFund } from './funds'
import { carrySettlements, computeSplit, validateSplit } from './split'
import { canMarkComplete, computeTeamStats, matchStatus, winPercent } from './stats'
import { Store } from './store'

const line = (categoryId: string, total: number, excluded: string[] = [], mode: ExpenseLine['mode'] = 'mandatory'): ExpenseLine => ({
  categoryId,
  categoryName: categoryId,
  mode,
  total,
  excludedPersonIds: excluded,
})
const squad11 = ['rahul', 'vikram', 'amit', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11']

describe('computeSplit — the worked example (PLAN §15.3)', () => {
  const lines = [line('fee', 3000), line('balls', 600), line('bfast', 550, ['amit'], 'optional')]
  const res = computeSplit({ lines, payerIds: squad11, available: { rahul: 1000, vikram: 200, amit: 0 } })
  const share = (id: string) => res.shares.find((s) => s.personId === id)!

  it('rounds each head up and reports the extra', () => {
    expect(res.perLine.fee).toEqual({ participants: 11, perHead: 273 })
    expect(res.perLine.balls).toEqual({ participants: 11, perHead: 55 })
    expect(res.perLine.bfast).toEqual({ participants: 10, perHead: 55 })
    expect(res.total).toBe(4150)
    expect(res.roundingExtra).toBe(8)
    expect(res.shares.reduce((s, x) => s + x.total, 0)).toBe(4158)
  })
  it('pays from funds first and leaves the rest pending', () => {
    expect(share('rahul')).toMatchObject({ total: 383, fromFunds: 383, pending: 0, settled: true, settledMethod: 'funds' })
    expect(share('vikram')).toMatchObject({ total: 383, fromFunds: 200, pending: 183, settled: false })
    expect(share('amit')).toMatchObject({ total: 328, fromFunds: 0, pending: 328, settled: false })
    expect(share('amit').byCategory.bfast).toBeUndefined()
  })
})

describe('computeSplit — edges', () => {
  it('non-payers get no share and the others pay more', () => {
    const res = computeSplit({ lines: [line('fee', 1000)], payerIds: ['a', 'b'], available: {} })
    expect(res.shares.map((s) => s.total)).toEqual([500, 500])
    expect(res.shares.find((s) => s.personId === 'c')).toBeUndefined()
  })
  it('one payer pays everything; empty lines are skipped', () => {
    const res = computeSplit({ lines: [line('fee', 700), line('bfast', 0, [], 'optional')], payerIds: ['a'], available: { a: 100 } })
    expect(res.shares[0]).toMatchObject({ total: 700, fromFunds: 100, pending: 600 })
    expect(res.shares[0].byCategory.bfast).toBeUndefined()
  })
  it('validates mandatory lines, payers and participants', () => {
    expect(validateSplit([line('fee', 0)], ['a'])[0]).toMatch(/required/)
    expect(validateSplit([line('fee', 100)], [])[0]).toMatch(/At least one player/)
    expect(validateSplit([line('fee', 100, ['a'])], ['a'])[0]).toMatch(/nobody is sharing/)
    expect(validateSplit([line('fee', 2_000_000)], ['a'])[0]).toMatch(/10,00,000/)
    expect(validateSplit([line('fee', 100), line('b', 0, [], 'optional')], ['a'])).toEqual([])
  })
  it('keeps a manual settlement only when the amount due is unchanged', () => {
    const prev: PlayerShare[] = [
      { personId: 'a', byCategory: {}, total: 383, fromFunds: 200, pending: 183, settled: true, settledMethod: 'upi', settledAt: '2026-11-22' },
      { personId: 'b', byCategory: {}, total: 383, fromFunds: 0, pending: 383, settled: true, settledMethod: 'cash', settledAt: '2026-11-22' },
    ]
    const next: PlayerShare[] = [
      { personId: 'a', byCategory: {}, total: 383, fromFunds: 200, pending: 183, settled: false },
      { personId: 'b', byCategory: {}, total: 400, fromFunds: 0, pending: 400, settled: false },
    ]
    const out = carrySettlements(next, prev)
    expect(out.shares[0]).toMatchObject({ settled: true, settledMethod: 'upi' })
    expect(out.shares[1].settled).toBe(false)
    expect(out.reopened).toEqual([{ personId: 'b', was: 383, now: 400 }])
  })
})

describe('funds', () => {
  const e = (type: FundEntry['type'], personId: string, amount: number, matchId?: string): FundEntry => ({
    id: `${type}-${personId}-${amount}-${matchId ?? ''}`,
    teamId: 't',
    type,
    personId,
    amount,
    date: '2026-11-01',
    matchId,
    createdAt: '',
    updatedAt: '',
  })
  const entries = [e('contribution', 'a', 1000), e('match_deduction', 'a', 383, 'm1'), e('refund', 'a', 100), e('adjustment', 'a', -17), e('contribution', 'b', 200)]
  it('derives balances', () => {
    expect(balanceOf(entries, 'a')).toBe(500)
    expect(balanceOf(entries, 'a', 'm1')).toBe(883)
    expect(teamFund(entries)).toBe(700)
    expect(negativeBalances([...entries, e('refund', 'b', 300)])).toEqual(['b'])
  })
})

// ---------- the full flow through the domain functions ----------
function setup() {
  const backend = fakeBackend()
  const store = new Store(backend, memoryKV(), 5)
  store.actor = { role: 'admin', personId: 'admin' }
  store.write('people.json', { schemaVersion: 1, people: [] }, 'seed')
  const team = createTeam(store, { name: 'Royal Cricket Club', color: '#000' })
  const match = addMatch(store, team.id, { date: '2026-01-10', time: '10:00', opponent: 'Lions', matchType: 'friendly' })
  setSquad(store, team.id, match.id, squad11)
  return { backend, store, teamId: team.id, matchId: match.id }
}
const cash = (personId: string, amount: number) => ({ personId, amount, date: '2026-01-01', method: 'cash' as const })
const example = [line('fee', 3000), line('balls', 600), line('bfast', 550, ['amit'], 'optional')]

describe('match lifecycle and the fund ledger', () => {
  it('submits, deducts from funds, settles and completes', () => {
    const { store, teamId, matchId } = setup()
    addContribution(store, teamId, cash('rahul', 1000))
    addContribution(store, teamId, cash('vikram', 200))
    submitExpenses(store, teamId, matchId, { lines: example, payerIds: squad11 })

    let m = getMatch(store, teamId, matchId)!
    expect(m.lifecycle).toBe('settling')
    expect(m.expense!.roundingExtra).toBe(8)
    expect(balanceOf(fundsOf(store, teamId), 'rahul')).toBe(617)
    expect(balanceOf(fundsOf(store, teamId), 'vikram')).toBe(0)
    // Rounding is never booked to the fund: only what was really deducted leaves it.
    expect(teamFund(fundsOf(store, teamId))).toBe(617)
    expect(pendingDues(matchesOf(store, teamId))).toBe(4158 - 583)
    expect(teamsOf(store)[0].stats).toMatchObject({ settlingMatches: 1, playersToSettle: 10, fundBalance: 617, pendingDues: 3575 })
    expect(() => completeMatch(store, teamId, matchId)).toThrow(/still to settle/)
    expect(() => deleteMatch(store, teamId, matchId)).toThrow()
    expect(() => setSquad(store, teamId, matchId, ['rahul'])).toThrow(/locked/)

    for (const s of m.expense!.shares.filter((x) => !x.settled)) settleShare(store, teamId, matchId, s.personId, { method: 'upi', date: '2026-01-11' })
    m = completeMatch(store, teamId, matchId, { result: 'won' })
    expect(m.lifecycle).toBe('completed')
    expect(teamsOf(store)[0].stats).toMatchObject({ played: 1, won: 1, settlingMatches: 0, pendingDues: 0, form: ['won'] })

    expect(reopenMatch(store, teamId, matchId).lifecycle).toBe('settling')
  })

  it('re-submitting replaces the deductions instead of double-counting', () => {
    const { store, teamId, matchId } = setup()
    addContribution(store, teamId, cash('rahul', 1000))
    submitExpenses(store, teamId, matchId, { lines: example, payerIds: squad11 })
    submitExpenses(store, teamId, matchId, { lines: [line('fee', 3300), line('balls', 600)], payerIds: squad11 })
    const deductions = fundsOf(store, teamId).filter((x) => x.type === 'match_deduction' && x.personId === 'rahul')
    expect(deductions).toHaveLength(1)
    expect(deductions[0].amount).toBe(300 + 55)
    expect(balanceOf(fundsOf(store, teamId), 'rahul')).toBe(645)
  })

  it('a contribution can settle dues, oldest first, as far as it goes', () => {
    const { store, teamId, matchId } = setup()
    submitExpenses(store, teamId, matchId, { lines: [line('fee', 1100)], payerIds: squad11 })
    expect(duesOf(matchesOf(store, teamId), 'vikram')[0].pending).toBe(100)
    const out = addContribution(store, teamId, cash('vikram', 500), [matchId])
    expect(out.settled).toBe(1)
    const share = getMatch(store, teamId, matchId)!.expense!.shares.find((s) => s.personId === 'vikram')!
    expect(share).toMatchObject({ fromFunds: 100, pending: 0, settled: true, settledMethod: 'funds' })
    expect(balanceOf(fundsOf(store, teamId), 'vikram')).toBe(400)
    // Declining keeps the money in the balance.
    addContribution(store, teamId, cash('amit', 500))
    expect(balanceOf(fundsOf(store, teamId), 'amit')).toBe(500)
    expect(duesOf(matchesOf(store, teamId), 'amit')).toHaveLength(1)
  })

  it('never lets a balance go below zero', () => {
    const { store, teamId, matchId } = setup()
    addContribution(store, teamId, cash('rahul', 1000))
    submitExpenses(store, teamId, matchId, { lines: example, payerIds: squad11 })
    const contribution = fundsOf(store, teamId).find((x) => x.type === 'contribution')!
    expect(() => deleteFundEntry(store, teamId, contribution.id)).toThrow(/below ₹0/)
    expect(() => addRefund(store, teamId, cash('rahul', 700))).toThrow(/more than/)
    expect(() => addAdjustment(store, teamId, { personId: 'rahul', amount: -700, date: '2026-01-02', note: 'fix' })).toThrow(/below ₹0/)
    expect(() => addAdjustment(store, teamId, { personId: 'rahul', amount: -17, date: '2026-01-02', note: '' })).toThrow(/note/)
    addRefund(store, teamId, cash('rahul', 617))
    expect(balanceOf(fundsOf(store, teamId), 'rahul')).toBe(0)
  })

  it('completes without a split only from the match day', () => {
    const { store, teamId } = setup()
    const future = addMatch(store, teamId, { date: '2999-01-01', time: '10:00', opponent: 'Later', matchType: 'friendly' })
    expect(canMarkComplete(future)).toBe(false)
    expect(() => completeMatch(store, teamId, future.id, { noExpenseSplit: true })).toThrow(/match day/)
    const past = addMatch(store, teamId, { date: '2026-01-05', time: '10:00', opponent: 'Earlier', matchType: 'friendly' })
    const done = completeMatch(store, teamId, past.id, { noExpenseSplit: true, result: 'lost' })
    expect(done).toMatchObject({ lifecycle: 'completed', noExpenseSplit: true })
    expect(reopenMatch(store, teamId, past.id).lifecycle).toBe('scheduled')
  })
})

describe('stats', () => {
  const m = (patch: Partial<Match>): Match => ({
    id: Math.random().toString(36),
    teamId: 't',
    date: '2026-06-10',
    opponent: 'X',
    matchType: 'friendly',
    squad: [],
    cancelled: false,
    lifecycle: 'scheduled',
    createdAt: '',
    updatedAt: '',
    ...patch,
  })
  it('status is explicit, never guessed from the date', () => {
    expect(matchStatus(m({ date: '2026-06-11' }), '2026-06-10', '09:00')).toBe('upcoming')
    expect(matchStatus(m({ date: '2026-06-10', time: '18:00' }), '2026-06-10', '09:00')).toBe('upcoming')
    expect(matchStatus(m({ date: '2026-06-10', time: '07:00' }), '2026-06-10', '09:00')).toBe('awaiting')
    expect(matchStatus(m({ date: '2026-06-01' }), '2026-06-10', '09:00')).toBe('awaiting')
    expect(matchStatus(m({ date: '2026-06-01', lifecycle: 'completed' }), '2026-06-10')).toBe('completed')
    expect(matchStatus(m({ cancelled: true }), '2026-06-10')).toBe('cancelled')
  })
  it('counts only completed matches as played', () => {
    const matches = [
      m({ date: '2026-06-01', lifecycle: 'completed', result: 'won' }),
      m({ date: '2026-06-02', lifecycle: 'completed', result: 'lost' }),
      m({ date: '2026-06-03', lifecycle: 'completed', result: 'won' }),
      m({ date: '2026-06-04', result: 'won' }), // result typed in but not completed
      m({ date: '2026-06-20', time: '10:00', opponent: 'Next' }),
      m({ date: '2026-06-05', cancelled: true }),
    ]
    const s = computeTeamStats([], matches, [], '2026-06-10', '09:00')
    expect(s).toMatchObject({ matchesTotal: 5, played: 3, won: 2, lost: 1, upcoming: 1, awaitingCompletion: 1, form: ['won', 'lost', 'won'] })
    expect(s.nextMatch?.opponent).toBe('Next')
    expect(winPercent(s)).toBe(67)
    expect(winPercent({ won: 0, lost: 0, tied: 0 })).toBeNull()
  })
})
