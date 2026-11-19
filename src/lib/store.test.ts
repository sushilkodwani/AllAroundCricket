import { describe, expect, it } from 'vitest'
import { memoryKV } from './cache'
import { fakeBackend } from './fakeBackend'
import { Store } from './store'

const PEOPLE = 'people.json'
const person = (id: string, name: string, updatedAt = '2026-01-01') => ({ id, name, updatedAt })
const file = (...people: ReturnType<typeof person>[]) => ({ schemaVersion: 1, people })

function setup() {
  const backend = fakeBackend()
  const kv = memoryKV()
  const store = new Store(backend, kv, 5)
  store.actor = { role: 'super', personId: 'admin-1' }
  return { backend, kv, store }
}

describe('Store', () => {
  it('writes to the repo with an Actor trailer', async () => {
    const { backend, store } = setup()
    store.write(PEOPLE, file(person('a', 'Asha')), 'Add Asha')
    expect(await store.flush()).toBe(true)
    expect(backend.json(PEOPLE)).toEqual(file(person('a', 'Asha')))
    expect(backend.commits[0].message).toBe('Add Asha\n\nActor: admin-1')
    expect(store.status.pending).toBe(0)
  })

  it('uses ETags so an unchanged file costs a 304', async () => {
    const { backend, store } = setup()
    backend.remoteWrite(PEOPLE, file(person('a', 'Asha')))
    await store.refresh(PEOPLE)
    await store.refresh(PEOPLE)
    expect(backend.counts.notModified).toBe(1)
    expect(store.get(PEOPLE)).toEqual(file(person('a', 'Asha')))
  })

  it('merges by id when another device wrote first', async () => {
    const { backend, store } = setup()
    backend.remoteWrite(PEOPLE, file(person('a', 'Asha')))
    await store.refresh(PEOPLE)
    // Another device adds Bina; this device adds Chetan from its stale copy.
    backend.remoteWrite(PEOPLE, file(person('a', 'Asha'), person('b', 'Bina')))
    store.write(PEOPLE, file(person('a', 'Asha'), person('c', 'Chetan')), 'Add Chetan')
    expect(await store.flush()).toBe(true)
    const names = (backend.json<ReturnType<typeof file>>(PEOPLE)!.people.map((p) => p.name)).sort()
    expect(names).toEqual(['Asha', 'Bina', 'Chetan'])
    expect((store.get<ReturnType<typeof file>>(PEOPLE)!.people).length).toBe(3)
  })

  it('queues writes while offline and sends them when back online', async () => {
    const { backend, store } = setup()
    backend.offline = true
    store.write(PEOPLE, file(person('a', 'Asha')), 'Add Asha')
    expect(await store.flush()).toBe(false)
    expect(store.status.save).toBe('offline')
    expect(store.status.online).toBe(false)
    expect(store.status.pending).toBe(1)
    backend.offline = false
    expect(await store.flush()).toBe(true)
    expect(backend.json(PEOPLE)).toEqual(file(person('a', 'Asha')))
  })

  it('keeps unsent writes across a reload (cache) and sends them later', async () => {
    const { backend, kv, store } = setup()
    backend.offline = true
    store.write(PEOPLE, file(person('a', 'Asha')), 'Add Asha')
    await store.flush()

    const reopened = new Store(backend, kv, 5)
    reopened.actor = { role: 'super', personId: 'admin-1' }
    await reopened.hydrate()
    expect(reopened.get(PEOPLE)).toEqual(file(person('a', 'Asha')))
    expect(reopened.status.pending).toBe(1)
    backend.offline = false
    expect(await reopened.flush()).toBe(true)
    expect(backend.json(PEOPLE)).toEqual(file(person('a', 'Asha')))
  })

  it('serves cached data when a refresh fails offline', async () => {
    const { backend, store } = setup()
    backend.remoteWrite(PEOPLE, file(person('a', 'Asha')))
    await store.refresh(PEOPLE)
    backend.offline = true
    await expect(store.refresh(PEOPLE)).rejects.toThrow()
    expect(store.get(PEOPLE)).toEqual(file(person('a', 'Asha')))
    expect(store.status.online).toBe(false)
  })

  it('refuses writes from a viewer without touching the network', async () => {
    const { backend, store } = setup()
    store.actor = { role: 'viewer', personId: 'p1' }
    expect(store.write(PEOPLE, file(person('a', 'Asha')), 'Sneaky')).toBe(false)
    await store.flush()
    expect(backend.counts.write).toBe(0)
    expect(store.get(PEOPLE)).toBeNull()
  })

  it('writeNow rolls back and throws when it cannot save', async () => {
    const { backend, store } = setup()
    backend.offline = true
    await expect(store.writeNow(PEOPLE, file(person('a', 'Asha')), 'Add Asha')).rejects.toThrow(/No connection/)
    expect(store.get(PEOPLE)).toBeNull()
    expect(store.status.pending).toBe(0)
  })

  it('writes funds before matches before teams', async () => {
    const { backend, store } = setup()
    store.write('teams.json', { teams: [] }, 't')
    store.write('teams/x/matches.json', { matches: [] }, 'm')
    store.write('teams/x/funds.json', { entries: [] }, 'f')
    await store.flush()
    expect(backend.commits.map((c) => c.path)).toEqual(['teams/x/funds.json', 'teams/x/matches.json', 'teams.json'])
  })
})
