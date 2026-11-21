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
