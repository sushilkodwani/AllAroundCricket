import { describe, expect, it } from 'vitest'
import type { ImageFile, PeopleFile, Person, TeamsFile } from '../types'
import { canWrite } from './access'
import { memoryKV } from './cache'
import { createTeam } from './domain'
import { fakeBackend } from './fakeBackend'
import { isSafeImage, setPersonPhoto, setTeamLogo } from './images'
import { P } from './paths'
import { Store } from './store'

const PIC = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
const person = (id: string): Person => ({ id, name: id.toUpperCase(), access: 'view', isGuest: false, teamIds: ['t1'], createdAt: '2026-01-01', updatedAt: '2026-01-01' }) as Person

function setup(role: 'admin' | 'viewer' = 'admin') {
  const backend = fakeBackend()
  const store = new Store(backend, memoryKV(), 5)
  store.actor = { role: 'super', personId: 'p1' }
  store.write(P.people, { schemaVersion: 1, people: [person('p1'), person('p2')] }, 'seed')
  store.actor = { role: 'admin', personId: 'p1' }
  const team = createTeam(store, { name: 'Royal Cricket Club', color: '#000' })
  store.actor = role === 'admin' ? { role: 'admin', personId: 'p1' } : { role: 'viewer', personId: 'p1' }
  return { backend, store, teamId: team.id }
}

describe('photos and logos', () => {
  it('only accepts small raster data URLs', () => {
    expect(isSafeImage(PIC)).toBe(true)
    expect(isSafeImage('https://example.com/a.png')).toBe(false)
    expect(isSafeImage('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isSafeImage('data:image/png;base64,' + 'A'.repeat(200_000))).toBe(false)
  })

  it('stores the picture in its own file and a stamp on the person; the picture is sent first', async () => {
    const { backend, store } = setup()
    expect(setPersonPhoto(store, 'p1', PIC)).toBe(true)
    const p1 = store.get<PeopleFile>(P.people)!.people.find((p) => p.id === 'p1')!
    expect(p1.photo).toBeTruthy()
    expect(store.get<ImageFile>(P.personPhoto('p1'))).toMatchObject({ dataUrl: PIC, updatedAt: p1.photo })
    await store.flush()
    const order = backend.commits.map((c) => c.path)
    expect(order.indexOf(P.personPhoto('p1'))).toBeLessThan(order.lastIndexOf(P.people))
    // Removing clears both.
    setPersonPhoto(store, 'p1', null)
    expect(store.get<PeopleFile>(P.people)!.people.find((p) => p.id === 'p1')!.photo).toBeUndefined()
    expect(store.get<ImageFile>(P.personPhoto('p1'))!.dataUrl).toBeNull()
  })

  it('a player may change their own photo, nobody else’s, and no team logo', () => {
    const { store, teamId } = setup('viewer')
    expect(setPersonPhoto(store, 'p1', PIC)).toBe(true)
    expect(setPersonPhoto(store, 'p2', PIC)).toBe(false)
    expect(store.get(P.personPhoto('p2'))).toBeNull()
    expect(setTeamLogo(store, teamId, PIC)).toBe(false)
    expect(canWrite({ role: 'viewer', personId: 'p1' }, P.teamLogo(teamId), null, {})).toBe(false)
    // Only a real small picture (or removal) passes the guard.
    expect(canWrite({ role: 'viewer', personId: 'p1' }, P.personPhoto('p1'), null, { schemaVersion: 1, dataUrl: 'https://evil.example/x.png', updatedAt: 'x' })).toBe(false)
    expect(canWrite({ role: 'viewer', personId: 'p1' }, P.personPhoto('p1'), null, { schemaVersion: 1, dataUrl: null, updatedAt: 'x' })).toBe(true)
    // The photo stamp is a profile field; other fields stay locked.
    const before = { schemaVersion: 1, people: [person('p1')] }
    expect(canWrite({ role: 'viewer', personId: 'p1' }, P.people, before, { schemaVersion: 1, people: [{ ...person('p1'), photo: 'x' }] })).toBe(true)
    expect(canWrite({ role: 'viewer', personId: 'p1' }, P.people, before, { schemaVersion: 1, people: [{ ...person('p1'), name: 'Other' }] })).toBe(false)
  })

  it('the admin sets a team logo', () => {
    const { store, teamId } = setup()
    expect(setTeamLogo(store, teamId, PIC)).toBe(true)
    const team = store.get<TeamsFile>(P.teams)!.teams.find((t) => t.id === teamId)!
    expect(team.logo).toBeTruthy()
    expect(store.get<ImageFile>(P.teamLogo(teamId))!.dataUrl).toBe(PIC)
    expect(() => setTeamLogo(store, teamId, 'javascript:alert(1)')).toThrow()
  })
})
