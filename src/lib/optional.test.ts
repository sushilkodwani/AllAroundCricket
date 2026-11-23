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
