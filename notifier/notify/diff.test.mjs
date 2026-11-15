import { describe, expect, it } from 'vitest'
import { buildMessage, expenseEvents, recipients, topicFor } from './diff.mjs'

const share = (personId, total, fromFunds) => ({ personId, byCategory: {}, total, fromFunds, pending: total - fromFunds, settled: total === fromFunds })
const match = (patch = {}) => ({ id: 'm1', teamId: 't1', date: '2026-11-22', opponent: 'Lions', squad: ['rahul', 'vikram', 'amit', 'bench', 'admin'], cancelled: false, lifecycle: 'settling', ...patch })
const expense = (shares, submittedAt = 'T1') => ({ status: 'submitted', submittedAt, lines: [{ categoryId: 'fee', total: 4150 }], payerIds: shares.map((s) => s.personId), shares })

const first = expense([share('rahul', 383, 383), share('vikram', 383, 200), share('amit', 328, 0), share('admin', 383, 0)])
const people = ['rahul', 'vikram', 'amit', 'bench', 'admin'].map((id) => ({ id, name: id, access: 'view', teamIds: ['t1'] }))
const credentials = people.map((p) => ({ personId: p.id, sessionEpoch: 1 }))
const sub = (personId, deviceId = `${personId}-phone`, sessionEpoch = 1) => ({ personId, deviceId, sessionEpoch, endpoint: `https://push/${deviceId}`, keys: {} })
const team = { id: 't1', name: 'Royal Cricket Club', shortName: 'RCC' }

describe('expenseEvents', () => {
  it('first submit → "posted" for the whole squad', () => {
    const events = expenseEvents([match({ lifecycle: 'scheduled', expense: { status: 'draft' } })], [match({ expense: first })])
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('posted')
    expect(events[0].personIds.sort()).toEqual(['admin', 'amit', 'bench', 'rahul', 'vikram'])
  })
  it('re-submit → "updated" only for people whose share changed', () => {
    const second = expense([share('rahul', 383, 383), share('vikram', 400, 200), share('amit', 328, 0), share('admin', 383, 0)], 'T2')
    const events = expenseEvents([match({ expense: first })], [match({ expense: second })])
    expect(events).toEqual([expect.objectContaining({ kind: 'updated', personIds: ['vikram'] })])
  })
  it('nothing for settling, completing or an unchanged re-save', () => {
    const settled = { ...first, shares: first.shares.map((s) => ({ ...s, settled: true })) }
    expect(expenseEvents([match({ expense: first })], [match({ expense: settled, lifecycle: 'completed' })])).toEqual([])
    expect(expenseEvents([match({ expense: first })], [match({ expense: { ...first, submittedAt: 'T2' } })])).toEqual([])
    expect(expenseEvents([], [match({ lifecycle: 'scheduled' })])).toEqual([])
  })
})

describe('recipients', () => {
  const event = expenseEvents([], [match({ expense: first })])[0]
  it('skips the admin who submitted, stale sessions and people without access', () => {
    const subscriptions = [sub('rahul'), sub('rahul', 'rahul-tablet'), sub('vikram', 'old-phone', 0), sub('amit'), sub('admin'), sub('stranger')]
    const blocked = people.map((p) => (p.id === 'amit' ? { ...p, access: 'none' } : p))
    const out = recipients(event, { people: blocked, credentials, subscriptions, actorId: 'admin' })
    // Rahul gets it on both devices; Vikram's phone was logged out by a PIN reset; Amit has no access.
    expect(out.map((s) => s.deviceId)).toEqual(['rahul-phone', 'rahul-tablet'])
  })
})

describe('buildMessage', () => {
  const event = expenseEvents([], [match({ expense: first })])[0]
  const ctx = (id, extra = {}) => ({ team, person: people.find((p) => p.id === id), fundEntries: [{ personId: 'rahul', type: 'contribution', amount: 1000 }, { personId: 'rahul', type: 'match_deduction', amount: 383 }], ...extra })
  it('fully covered by the fund', () => {
    const msg = buildMessage(event, 'rahul', ctx('rahul'))
    expect(msg.title).toBe('💰 vs Lions · Sun 22 Nov — expenses posted')
    expect(msg.body).toBe('Your share ₹383 was paid from your fund ✓. Fund left: ₹617.')
    expect(msg.tag).toBe('match-m1')
    expect(msg.url).toBe('#/teams/t1/matches/m1')
  })
  it('partly covered, no fund, and not paying', () => {
    expect(buildMessage(event, 'vikram', ctx('vikram')).body).toBe('Your share ₹383: ₹200 from your fund, ₹183 to pay the admin.')
    expect(buildMessage(event, 'amit', ctx('amit')).body).toBe('Your share is ₹328 — please pay the admin.')
    expect(buildMessage(event, 'bench', ctx('bench')).body).toBe('Match total ₹4,150. You’re not paying for this one.')
  })
  it('adds the team name for someone in several teams', () => {
    const msg = buildMessage(event, 'rahul', ctx('rahul', { person: { id: 'rahul', teamIds: ['t1', 't2'] } }))
    expect(msg.title).toBe('💰 RCC vs Lions · Sun 22 Nov — expenses posted')
  })
  it('update message shows the old and new share', () => {
    const second = expense([share('rahul', 383, 383), share('vikram', 400, 383), share('amit', 328, 0), share('admin', 383, 0)], 'T2')
    const upd = expenseEvents([match({ expense: first })], [match({ expense: second })])[0]
    expect(buildMessage(upd, 'vikram', ctx('vikram')).body).toBe('Expenses updated — your share is now ₹400 (was ₹383). ₹17 to pay.')
    expect(buildMessage(upd, 'vikram', ctx('vikram')).title).toMatch(/expenses updated$/)
  })
  it('topic header is short and URL-safe', () => {
    expect(topicFor('3bb03d66-0567-407f-a286-cdc05caebbd9')).toMatch(/^[A-Za-z0-9]{1,32}$/)
  })
})
