import { describe, expect, it } from 'vitest'
import type { AiFile, Match, Person } from '../types'
import { canWrite } from './access'
import { aiConfigOf, aiOff, aiOn, canPlan, canReview, findReport, generateReport, playerWait, removeAiKey, reportsOf, saveAiConfig, setAiEnabled } from './ai'
import { planPrompt, playerPrompt, reviewPrompt, type AiCtx } from './aiPrompts'
import { memoryKV } from './cache'
import { todayISO } from './dates'
import { addMatch, createTeam } from './domain'
import { fakeBackend } from './fakeBackend'
import { askGemini, explainFailure, textOf } from './gemini'
import { P } from './paths'
import { Store } from './store'

const KEY = 'AIzaSyFAKEFAKEFAKEFAKEFAKE12345678'
const person = (id: string): Person => ({ id, name: id.toUpperCase(), access: 'view', isGuest: false, teamIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }) as Person
const answer = (text: string): typeof fetch => (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })) as typeof fetch

function setup() {
  const store = new Store(fakeBackend(), memoryKV(), 5)
  store.actor = { role: 'super', personId: 'boss' }
  store.write(P.people, { schemaVersion: 1, people: [person('boss'), person('a1'), person('v1')] }, 'seed')
  store.actor = { role: 'admin', personId: 'a1' }
  const team = createTeam(store, { name: 'Latitude Lions', color: '#000' })
  const today = todayISO()
  const match = addMatch(store, team.id, { date: today, time: '23:59', opponent: 'Rivals', matchType: 'friendly' as Match['matchType'], overs: 20 })
  return { store, team, match }
}

describe('gemini client', () => {
  it('pulls the text out of an answer and explains failures', () => {
    expect(textOf({ candidates: [{ content: { parts: [{ text: ' Hello ' }, { text: 'there' }] } }] })).toBe('Hello there')
    expect(() => textOf({ candidates: [] })).toThrow(/empty/)
    expect(() => textOf({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/declined/)
    expect(explainFailure(429, null)).toMatch(/limit/)
    expect(explainFailure(400, { error: { message: 'API key not valid', status: 'INVALID_ARGUMENT' } })).toMatch(/key was not accepted/)
    expect(explainFailure(503, null)).toMatch(/busy/)
  })
  it('sends the key in a header, never in the address', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await askGemini({ key: KEY, model: 'gemini-3.1-flash-lite', system: 's', prompt: 'p', fetcher })).toBe('ok')
    expect(seen!.url).not.toContain(KEY)
    expect(seen!.headers['x-goog-api-key']).toBe(KEY)
  })
  it('falls back to another model when one is retired or busy', async () => {
    const tried: string[] = []
    const fetcher = (async (url: string) => {
      const model = decodeURIComponent(String(url).split('/models/')[1].split(':')[0])
      tried.push(model)
      if (model === 'old-model') return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'no longer available' } }), { status: 404 })
      if (model === 'gemini-flash-latest') return new Response('{}', { status: 503 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from the last model' }] } }] }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await askGemini({ key: KEY, model: 'old-model', system: 's', prompt: 'p', fetcher })).toBe('from the last model')
    expect(tried[0]).toBe('old-model')
    expect(tried).toHaveLength(2)
    expect(tried[1]).toBe('gemini-3.1-flash-lite')
  })
  it('does not switch models for a bad key or the free limit', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls++
      return new Response('{}', { status: 429 })
    }) as unknown as typeof fetch
    await expect(askGemini({ key: KEY, model: 'm', system: 's', prompt: 'p', fetcher })).rejects.toThrow(/limit/)
    expect(calls).toBe(1)
  })
  it('turns a network failure and an error status into messages', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(askGemini({ key: KEY, model: 'm', system: 's', prompt: 'p', fetcher: down })).rejects.toThrow(/Could not reach/)
    const busy = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    await expect(askGemini({ key: KEY, model: 'm', system: 's', prompt: 'p', fetcher: busy })).rejects.toThrow(/limit/)
  })
})

describe('rules', () => {
  it('the plan is for the match day; the review is for a completed match', () => {
    const m = { date: '2026-05-10', lifecycle: 'scheduled', cancelled: false } as Match
    expect(canPlan(m, '2026-05-10')).toBe(true)
    expect(canPlan(m, '2026-05-09')).toBe(false)
    expect(canPlan({ ...m, lifecycle: 'completed' }, '2026-05-10')).toBe(false)
    expect(canPlan({ ...m, cancelled: true }, '2026-05-10')).toBe(false)
    expect(canReview(m)).toBe(false)
    expect(canReview({ ...m, lifecycle: 'completed' })).toBe(true)
  })
  it('a player’s plan waits seven days', () => {
    const day = 86_400_000
    const t0 = Date.parse('2026-05-01T10:00:00Z')
    const r = { createdAt: '2026-05-01T10:00:00Z' } as never
    expect(playerWait(undefined).ready).toBe(true)
    expect(playerWait(r, t0 + 1000)).toMatchObject({ ready: false, daysLeft: 7 })
    expect(playerWait(r, t0 + 6.5 * day)).toMatchObject({ ready: false, daysLeft: 1 })
    expect(playerWait(r, t0 + 7 * day).ready).toBe(true)
  })
})

describe('the key and the reports', () => {
  it('only the super admin sets the key', () => {
    const { store } = setup()
    expect(() => saveAiConfig(store, { key: KEY, model: '' })).toThrow(/super admin/)
    store.actor = { role: 'super', personId: 'boss' }
    expect(() => saveAiConfig(store, { key: 'short', model: '' })).toThrow(/Gemini key/)
    saveAiConfig(store, { key: KEY, model: '' })
    expect(aiConfigOf(store)).toMatchObject({ geminiKey: KEY, model: 'gemini-3.1-flash-lite' })
    removeAiKey(store)
    expect(aiConfigOf(store)!.geminiKey).toBe('')
  })

  it('an admin makes a match plan on the day; the team can read it; a viewer cannot make one', async () => {
    const { store, team, match } = setup()
    await expect(generateReport(store, { kind: 'plan', teamId: team.id, matchId: match.id }, answer('x'))).rejects.toThrow(/not set up/)
    store.actor = { role: 'super', personId: 'boss' }
    saveAiConfig(store, { key: KEY, model: '' })
    store.actor = { role: 'admin', personId: 'a1' }
    const r = await generateReport(store, { kind: 'plan', teamId: team.id, matchId: match.id }, answer('## Toss\n- Bat first'))
    expect(findReport(reportsOf(store, team.id), 'plan', match.id)?.text).toContain('Bat first')
    expect(r.createdBy).toBe('a1')
    // A new plan replaces the old one.
    await generateReport(store, { kind: 'plan', teamId: team.id, matchId: match.id }, answer('second'))
    expect(reportsOf(store, team.id).filter((x) => x.kind === 'plan')).toHaveLength(1)
    // A viewer can read the file but the write guard refuses their writes.
    const file = store.get<AiFile>(P.ai(team.id))
    store.actor = { role: 'viewer', personId: 'v1' }
    expect(store.write(P.ai(team.id), { ...file!, reports: [] }, 'x')).toBe(false)
    // The review is not available before the match is complete.
    store.actor = { role: 'admin', personId: 'a1' }
    await expect(generateReport(store, { kind: 'review', teamId: team.id, matchId: match.id }, answer('x'))).rejects.toThrow(/marked complete/)
  })

  it('a player makes their own plan, once a week, and nothing else in the file', async () => {
    const { store, team, match } = setup()
    store.actor = { role: 'super', personId: 'boss' }
    saveAiConfig(store, { key: KEY, model: '' })
    // The player's own plan.
    store.actor = { role: 'viewer', personId: 'v1' }
    const mine = await generateReport(store, { kind: 'player', teamId: team.id, personId: 'v1' }, answer('my plan'))
    expect(mine.createdBy).toBe('v1')
    await expect(generateReport(store, { kind: 'player', teamId: team.id, personId: 'v1' }, answer('again'))).rejects.toThrow(/again in 7 days/)
    // Not someone else's, and not a plan or review.
    await expect(generateReport(store, { kind: 'player', teamId: team.id, personId: 'a1' }, answer('x'))).rejects.toThrow(/can’t save/)
    await expect(generateReport(store, { kind: 'plan', teamId: team.id, matchId: match.id }, answer('x'))).rejects.toThrow(/can’t save/)
    // The guard also holds a week back, so the app can't be talked round.
    const file = store.get<AiFile>(P.ai(team.id))!
    const early = { ...file, reports: [{ ...mine, text: 'sneaky', createdAt: new Date(Date.parse(mine.createdAt) + 86_400_000).toISOString() }] }
    expect(canWrite({ role: 'viewer', personId: 'v1' }, P.ai(team.id), file, early, store.lookup)).toBe(false)
    const later = { ...file, reports: [{ ...mine, text: 'a week on', createdAt: new Date(Date.parse(mine.createdAt) + 7 * 86_400_000).toISOString() }] }
    expect(canWrite({ role: 'viewer', personId: 'v1' }, P.ai(team.id), file, later, store.lookup)).toBe(true)
    // Another player cannot write v1's plan.
    expect(canWrite({ role: 'viewer', personId: 'other' }, P.ai(team.id), file, later, store.lookup)).toBe(false)
  })

  it('an admin cannot make or change a player’s plan', async () => {
    const { store, team } = setup()
    store.actor = { role: 'super', personId: 'boss' }
    saveAiConfig(store, { key: KEY, model: '' })
    store.actor = { role: 'admin', personId: 'a1' }
    await expect(generateReport(store, { kind: 'player', teamId: team.id, personId: 'v1' }, answer('x'))).rejects.toThrow(/can’t save/)
    // Their own plan, as a player, is fine.
    await generateReport(store, { kind: 'player', teamId: team.id, personId: 'a1' }, answer('mine'))
    // A player's plan, once saved, is not theirs to overwrite or delete.
    store.actor = { role: 'viewer', personId: 'v1' }
    await generateReport(store, { kind: 'player', teamId: team.id, personId: 'v1' }, answer('plan'))
    const file = store.get<AiFile>(P.ai(team.id))!
    const admin = { role: 'admin' as const, personId: 'a1' }
    expect(canWrite(admin, P.ai(team.id), file, { ...file, reports: file.reports.map((r) => (r.personId === 'v1' ? { ...r, text: 'edited' } : r)) }, store.lookup)).toBe(false)
    expect(canWrite(admin, P.ai(team.id), file, { ...file, reports: file.reports.filter((r) => r.personId !== 'v1') }, store.lookup)).toBe(false)
  })
})

describe('the master switch', () => {
  it('switched off: nobody generates anything, saved reports stay', async () => {
    const { store, team, match } = setup()
    store.actor = { role: 'super', personId: 'boss' }
    saveAiConfig(store, { key: KEY, model: '' })
    store.actor = { role: 'admin', personId: 'a1' }
    await generateReport(store, { kind: 'plan', teamId: team.id, matchId: match.id }, answer('saved plan'))
    // Only the super admin can flip it.
    expect(() => setAiEnabled(store, false)).toThrow(/super admin/)
    store.actor = { role: 'super', personId: 'boss' }
    setAiEnabled(store, false)
    expect(aiOff(aiConfigOf(store))).toBe(true)
    expect(aiOn(aiConfigOf(store))).toBe(false)
    expect(aiConfigOf(store)!.geminiKey).toBe(KEY) // the key is kept
    store.actor = { role: 'admin', personId: 'a1' }
    await expect(generateReport(store, { kind: 'plan', teamId: team.id, matchId: match.id }, answer('x'))).rejects.toThrow(/switched off/)
    expect(findReport(reportsOf(store, team.id), 'plan', match.id)?.text).toBe('saved plan')
    // Saving a new key does not turn it back on.
    store.actor = { role: 'super', personId: 'boss' }
    saveAiConfig(store, { key: KEY + 'x', model: '' })
    expect(aiOff(aiConfigOf(store))).toBe(true)
    setAiEnabled(store, true)
    expect(aiOn(aiConfigOf(store))).toBe(true)
  })
})

describe('prompts', () => {
  const ctx: AiCtx = { teamName: 'Latitude Lions', files: [], matches: [], people: [person('a'), person('b')] }
  const match = { id: 'm', teamId: 't', date: '2026-05-10', opponent: 'Rivals', matchType: 'friendly', squad: ['a', 'b'], lifecycle: 'scheduled' } as unknown as Match
  it('carry the squad, the questions and no personal data', () => {
    const plan = planPrompt(ctx, match)
    expect(plan.prompt).toContain('Rivals')
    expect(plan.prompt).toContain('A: no scored matches yet')
    expect(plan.prompt).toContain('## Toss')
    expect(plan.prompt).not.toMatch(/bphoneb|bpinb/i)
    expect(reviewPrompt(ctx, { ...match, lifecycle: 'completed' }, undefined).prompt).toContain('no ball-by-ball record')
    expect(playerPrompt(ctx, 'a').prompt).toContain('second person')
  })
})
