import { describe, expect, it } from 'vitest'
import { parseBulk } from './bulk'
import type { AppConfig, MatchesFile } from '../types'
import { canWrite } from './access'
import { memoryKV } from './cache'
import { findOrCreatePlayer, peopleOf, setLiveAuto } from './domain'
import { fakeBackend } from './fakeBackend'
import { Store } from './store'

const config = { schemaVersion: 2, appName: 'x', superAdminId: 's1', phoneSalt: 'salt', recovery: { salt: '', hash: '', iterations: 1 }, createdAt: 'x' } as unknown as AppConfig

async function storeWith(files: Record<string, unknown>) {
  const backend = fakeBackend()
  for (const [p, d] of Object.entries(files)) backend.remoteWrite(p, d)
  const store = new Store(backend, memoryKV(), 5)
  await store.refreshAll(Object.keys(files))
  store.actor = { role: 'super', personId: 's1' }
  return { store, backend }
}

describe('opponent players without a number', () => {
  it('reads name-only lines when the number is optional, and still needs one for club players', () => {
    const lines = parseBulk('Rahul Sharma 9876543210\nVikram Rao', true)
    expect(lines.map((l) => [l.name, l.phone ?? null, l.error ?? null])).toEqual([
      ['Rahul Sharma', '9876543210', null],
      ['Vikram Rao', null, null],
    ])
    expect(parseBulk('Vikram Rao')[0].error).toBe('No mobile number found')
  })

  it('creates a player with no number (a new one each time), and reuses one with a known number', async () => {
    const { store } = await storeWith({ 'config/app.json': config, 'people.json': { schemaVersion: 1, people: [] } })
    const a = await findOrCreatePlayer(store, 'Vikram Rao')
    const b = await findOrCreatePlayer(store, 'Vikram Rao')
    expect(a.person.id).not.toBe(b.person.id)
    expect(a.person.phoneHash).toBeUndefined()
    const c = await findOrCreatePlayer(store, 'Rahul', '9876543210')
    const d = await findOrCreatePlayer(store, 'Rahul S', '9876543210')
    expect(d.existed).toBe(true)
    expect(d.person.id).toBe(c.person.id)
    expect(peopleOf(store)).toHaveLength(3)
  })

  it('lets a one-match scorer add such a player', () => {
    const person = { id: 'n1', name: 'Vikram Rao', access: 'none', isGuest: true, teamIds: [], createdAt: 'x', updatedAt: 'x' }
    const scorer = { role: 'viewer' as const, personId: 'p1', scorerMatchIds: ['m1'] }
    expect(canWrite(scorer, 'people.json', { schemaVersion: 1, people: [] }, { schemaVersion: 1, people: [person] })).toBe(true)
  })
})

describe('live auto-refresh switch', () => {
  it('is turned on and off on the match record', async () => {
    const match = { id: 'm1', teamId: 't1', date: '2026-11-21', opponent: 'X', squad: [], cancelled: false, lifecycle: 'scheduled', createdAt: 'x', updatedAt: 'x' }
    const { store, backend } = await storeWith({ 'teams/t1/matches.json': { schemaVersion: 1, matches: [match] } })
    setLiveAuto(store, 't1', 'm1', true)
    await store.flush()
    expect(backend.json<MatchesFile>('teams/t1/matches.json')!.matches[0].liveAuto).toBe(true)
    setLiveAuto(store, 't1', 'm1', false)
    await store.flush()
    expect(backend.json<MatchesFile>('teams/t1/matches.json')!.matches[0].liveAuto).toBeUndefined()
  })
})

describe('wagon wheel slices', () => {
  it('puts straight drives, cover drives and pulls in the right slice and adds up the shares', async () => {
    const { wagonSlices, sliceOf } = await import('./analysis')
    // Batter at (0, -0.14); bowler's end is below. Straight past the bowler = just right of straight down.
    expect(sliceOf([0.05, 1])).toBe(4)
    expect(sliceOf([-0.05, 1])).toBe(3)
    // Square on the leg side (screen right for a right-hander) and the mirror image for a left-hander.
    expect(sliceOf([1, -0.2])).toBe(6)
    expect(sliceOf([1, -0.2], true)).toBe(1)
    const { runs, pct } = wagonSlices([
      { shot: [0.05, 1], runs: 4 },
      { shot: [0.05, 1], runs: 6 },
      { shot: [1, -0.2], runs: 6 },
    ])
    expect(runs[4]).toBe(10)
    expect(runs[6]).toBe(6)
    expect(pct[4]).toBe(63)
    expect(pct[6]).toBe(38)
  })
})

describe('directions for 1s, 2s and 3s', () => {
  it('is stored only when switched on, can be changed mid-match, and keeps a single’s direction', async () => {
    const { addBall, editBall, newScore, setAllDirections, setCrease } = await import('./scoring')
    const { wagonSlices } = await import('./analysis')
    const sides = { home: { name: 'H', shortName: 'H', xi: ['h1', 'h2'] }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2'] } }
    const base = { matchId: 'm', teamId: 't', overs: 2, ...sides, toss: { wonBy: 'home' as const, chose: 'bat' as const } }
    expect(newScore(base).allDirections).toBeUndefined()
    let f = newScore({ ...base, allDirections: true })
    expect(f.allDirections).toBe(true)
    f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
    f = addBall(f, { bat: 1, shot: [0.3, 0.4] })
    f = addBall(f, { bat: 2 }) // skipped
    const [single, two] = f.innings[0].events as import('../types').BallEvent[]
    expect(single.shot).toEqual([0.3, 0.4])
    expect(two.shot).toBeUndefined()
    // Correcting a single to a two keeps its direction; turning it into byes drops it.
    f = editBall(f, 0, single.id, { bat: 2, byes: 0, shot: [0.3, 0.4] })
    expect((f.innings[0].events[0] as import('../types').BallEvent).shot).toEqual([0.3, 0.4])
    f = editBall(f, 0, single.id, { bat: 0, byes: 1, shot: null })
    expect((f.innings[0].events[0] as import('../types').BallEvent).shot).toBeUndefined()
    f = setAllDirections(f, false)
    expect(f.allDirections).toBeUndefined()
    expect(setAllDirections(f, false)).toBe(f)
    // The wheel's shares count every run with a direction.
    expect(wagonSlices([{ shot: [0.05, 1], runs: 4 }, { shot: [0.05, 0.5], runs: 1 }, { shot: [1, -0.2], runs: 3 }]).pct).toEqual([0, 0, 0, 0, 63, 0, 38, 0])
  })
})

describe('powerplay overs set at the start', () => {
  it('splits the innings by the powerplay picked, including none at all', async () => {
    const { phasesOf, defaultPowerplay } = await import('./analysis')
    expect(defaultPowerplay(20)).toBe(6)
    expect(phasesOf(20).map((p) => [p.key, p.from, p.to])).toEqual([['pp', 1, 6], ['mid', 7, 15], ['death', 16, 20]])
    expect(phasesOf(20, 4).map((p) => [p.key, p.from, p.to])).toEqual([['pp', 1, 4], ['mid', 5, 15], ['death', 16, 20]])
    expect(phasesOf(10, 0).map((p) => p.key)).toEqual(['mid', 'death'])
    expect(phasesOf(8, 7).map((p) => [p.key, p.from, p.to])).toEqual([['pp', 1, 7], ['mid', 8, 8]])
  })

  it('is checked and stored when scoring starts', async () => {
    const { newScore } = await import('./scoring')
    const base = { matchId: 'm', teamId: 't', overs: 10, home: { name: 'H', shortName: 'H', xi: ['h1', 'h2'] }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2'] }, toss: { wonBy: 'home' as const, chose: 'bat' as const } }
    expect(newScore({ ...base, powerplay: 3 }).powerplay).toBe(3)
    expect(newScore({ ...base, powerplay: 0 }).powerplay).toBe(0)
    expect(newScore(base).powerplay).toBeUndefined()
    expect(() => newScore({ ...base, powerplay: 10 })).toThrow('between 0 and 9')
  })
})

describe('opponent playing XI picked beforehand', () => {
  it('is saved on the match with its captain, and cleared when emptied', async () => {
    const { setOpponentXi } = await import('./domain')
    const match = { id: 'm1', teamId: 't1', date: '2026-11-29', opponent: 'X', squad: [], cancelled: false, lifecycle: 'scheduled', createdAt: 'x', updatedAt: 'x' }
    const { store, backend } = await storeWith({ 'teams/t1/matches.json': { schemaVersion: 1, matches: [match] } })
    setOpponentXi(store, 't1', 'm1', ['o1', 'o2', 'o1'], 'o2')
    await store.flush()
    let m = backend.json<MatchesFile>('teams/t1/matches.json')!.matches[0]
    expect([m.opponentXi, m.opponentCaptainId]).toEqual([['o1', 'o2'], 'o2'])
    setOpponentXi(store, 't1', 'm1', ['o1'], 'o2') // captain no longer in the XI
    await store.flush()
    m = backend.json<MatchesFile>('teams/t1/matches.json')!.matches[0]
    expect(m.opponentCaptainId).toBeUndefined()
    setOpponentXi(store, 't1', 'm1', [])
    await store.flush()
    expect(backend.json<MatchesFile>('teams/t1/matches.json')!.matches[0].opponentXi).toBeUndefined()
    expect(() => setOpponentXi(store, 't1', 'm1', Array.from({ length: 12 }, (_, i) => `p${i}`))).toThrow('11 at most')
  })
})

describe('scorer handover', () => {
  const match = { id: 'm1', teamId: 't1', date: '2026-11-29', opponent: 'X', squad: [], cancelled: false, lifecycle: 'scheduled', scoring: 'live', scorerId: 'p1', createdAt: 'x', updatedAt: 'x' }
  const before = { schemaVersion: 1, matches: [match] }
  const scorer = { role: 'viewer' as const, personId: 'p1', scorerMatchIds: ['m1'] }
  it('lets the scorer pass scoring to someone else, but not leave the match without a scorer', () => {
    expect(canWrite(scorer, 'teams/t1/matches.json', before, { schemaVersion: 1, matches: [{ ...match, scorerId: 'p2' }] })).toBe(true)
    const { scorerId: _drop, ...noScorer } = match
    void _drop
    expect(canWrite(scorer, 'teams/t1/matches.json', before, { schemaVersion: 1, matches: [noScorer] })).toBe(false)
    expect(canWrite(scorer, 'teams/t1/matches.json', before, { schemaVersion: 1, matches: [{ ...match, scorerId: 'p2', squad: ['p9'] }] })).toBe(false)
  })
})

describe('UPI payment links', () => {
  it('builds a upi://pay link with the payee, amount and note', async () => {
    const { upiLink } = await import('./upi')
    const link = upiLink({ id: 'rohan@okicici', name: 'Rohan Deshpande' }, 605, 'SPS v Thane Titans 2026-11-15')
    expect(link.startsWith('upi://pay?')).toBe(true)
    const q = new URLSearchParams(link.slice('upi://pay?'.length))
    expect(Object.fromEntries(q)).toEqual({ pa: 'rohan@okicici', pn: 'Rohan Deshpande', am: '605.00', cu: 'INR', tn: 'SPS v Thane Titans 2026-11-15' })
    expect(link).not.toContain('+') // spaces as %20, which every UPI app reads
    expect(link).toContain('pa=rohan@okicici')
  })

  it('checks the UPI ID and the account name, and treats both empty as none', async () => {
    const { checkUpi } = await import('./upi')
    expect(checkUpi('', '')).toBeUndefined()
    expect(checkUpi(' rohan.d@okhdfcbank ', ' Rohan  D ')).toEqual({ id: 'rohan.d@okhdfcbank', name: 'Rohan D' })
    expect(() => checkUpi('9876543210', 'Rohan')).toThrow('UPI ID')
    expect(() => checkUpi('rohan@ybl', '')).toThrow('name')
  })
})

describe('saver mode', () => {
  it('turns on below 10% of the hour and gets stronger below 5%', async () => {
    const { saverLevel, liveRefreshMs, resumeGapMs, usageSyncAllowed, everyText } = await import('./saver')
    const r = (remaining: number) => ({ limit: 5000, remaining, resetAt: Date.now() + 3_600_000, at: Date.now() })
    expect(saverLevel(null)).toBe('normal')
    expect(saverLevel(r(1000))).toBe('normal')
    expect(saverLevel(r(400))).toBe('saver')
    expect(saverLevel(r(200))).toBe('critical')
    expect([liveRefreshMs('normal'), liveRefreshMs('saver'), liveRefreshMs('critical')]).toEqual([20_000, 60_000, 120_000])
    expect(resumeGapMs('critical')).toBeGreaterThan(resumeGapMs('saver'))
    expect([usageSyncAllowed('normal'), usageSyncAllowed('saver')]).toEqual([true, false])
    expect([everyText(20_000), everyText(60_000), everyText(120_000)]).toEqual(['20 s', 'minute', '2 minutes'])
  })
})

describe('extra scoring details', () => {
  it('stores the shot played and over/round the wicket, clearing the side when the over ends', async () => {
    const { addBall, newScore, setAsk, setCrease, undo } = await import('./scoring')
    let f = newScore({ matchId: 'm', teamId: 't', overs: 2, home: { name: 'H', shortName: 'H', xi: ['h1', 'h2', 'h3'] }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2'] }, toss: { wonBy: 'home', chose: 'bat' }, askShotType: true, askSide: true })
    expect([f.askShotType, f.askSide]).toEqual([true, true])
    f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1', side: 'round' })
    f = addBall(f, { bat: 4, shot: [0.5, 0.5], shotType: 'pull' })
    f = addBall(f, { kind: 'wd', shotType: 'drive' }) // no shot off a wide
    const [four, wide] = f.innings[0].events as import('../types').BallEvent[]
    expect([four.shotType, four.side]).toEqual(['pull', 'round'])
    expect([wide.shotType, wide.side]).toEqual([undefined, 'round'])
    for (let i = 0; i < 5; i++) f = addBall(f, { bat: 0 })
    expect(f.innings[0].crease.side).toBeUndefined() // a new over: asked again
    f = undo(f)
    expect(f.innings[0].crease.side).toBe('round') // undo brings it back
    expect(setAsk(f, 'askSide', false).askSide).toBeUndefined()
  })
})

describe('shots analysis', () => {
  it('adds up runs, dots, boundaries and dismissals for each shot, skipping wides and unrecorded balls', async () => {
    const { shotRows } = await import('../components/ShotsAnalysis')
    const rows = shotRows([
      { shotType: 'pull', bat: 4, faced: true },
      { shotType: 'pull', bat: 1, faced: true },
      { shotType: 'pull', bat: 0, faced: true, out: 'caught' },
      { shotType: 'drive', bat: 3, faced: true },
      { shotType: 'drive', bat: 6, faced: true },
      { bat: 4, faced: true }, // shot not recorded
      { shotType: 'cut', bat: 0, faced: false }, // a wide: no ball faced
    ])
    expect(rows.map((r) => r.type)).toEqual(['drive', 'pull', 'cut'])
    expect(rows[0]).toMatchObject({ runs: 9, balls: 2, twosThrees: 3, sixes: 1 })
    expect(rows[1]).toMatchObject({ runs: 5, balls: 3, ones: 1, fours: 1, dots: 1, outs: 1 })
    expect(rows[2]).toMatchObject({ runs: 0, balls: 0 })
  })
})
