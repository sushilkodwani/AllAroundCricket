import { beforeEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../types'
import { canWrite } from './access'
import { pausedUntil, pauseApp, resumeApp } from './domain'
import { memoryKV } from './cache'
import { fakeBackend } from './fakeBackend'
import { mergeFile } from './merge'
import { Store } from './store'
import {
  addToFile,
  countedDemo,
  currentRate,
  emptyDay,
  featureOf,
  isLow,
  localDate,
  noteRate,
  noteRequest,
  pendingOf,
  resetUsageForTests,
  setUsagePerson,
  syncDue,
  track,
  usagePath,
  type DayUsage,
  type UsageFile,
} from './usage'
import { buildReport, daysInMonth } from './usageReport'
import { syncUsage } from './usageSync'

const day = (patch: Partial<DayUsage>): DayUsage => ({ ...emptyDay(), ...patch })
const route = (hash: string) => {
  const [p, q = ''] = hash.split('?')
  return featureOf(p.split('/').filter(Boolean), new URLSearchParams(q))
}

beforeEach(() => {
  resetUsageForTests()
})

describe('usage counts', () => {
  it('names each screen and tab', () => {
    expect(route('/teams')).toBe('home')
    expect(route('/teams/t1')).toBe('team.players')
    expect(route('/teams/t1?tab=stats')).toBe('team.stats')
    expect(route('/teams/t1/matches/m1')).toBe('match')
    expect(route('/teams/t1/matches/m1/live')).toBe('live.live')
    expect(route('/teams/t1/matches/m1/live?tab=analysis')).toBe('live.analysis')
    expect(route('/teams/t1/matches/m1/score')).toBe('scoring')
    expect(route('/teams/t1/players/p1')).toBe('player')
    expect(route('/settings/usage')).toBe('usage')
    expect(route('/settings')).toBe('settings')
    expect(route('/funds')).toBe('funds')
    expect(route('/onboard')).toBeNull()
  })

  it('gives requests made while logging in to whoever logs in, and counts screens only once logged in', () => {
    noteRequest('read')
    noteRequest('free')
    track('home')
    setUsagePerson('p1')
    noteRequest('write')
    track('home')
    const d = pendingOf('p1')[localDate()]
    expect(d.req).toBe(2)
    expect(d.writes).toBe(1)
    expect(d.free).toBe(1)
    expect(d.features).toEqual({ home: 1 })
    expect(d.hours.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('is due on the first open of a new day', () => {
    setUsagePerson('p1')
    expect(syncDue('p1', 'open')).toBe(true)
  })
})

describe('merging two phones of one person', () => {
  it('keeps both phones’ counts', () => {
    const base = addToFile(null, 'p1', { '2026-11-01': day({ req: 10, features: { home: 2 } }) }, null, '2026-11-01T10:00:00Z')
    const local = addToFile(base, 'p1', { '2026-11-01': day({ req: 5, features: { home: 1 } }) }, null, '2026-11-02T10:00:00Z')
    const remote = addToFile(base, 'p1', { '2026-11-01': day({ req: 7 }), '2026-11-02': day({ req: 3 }) }, null, '2026-11-02T09:00:00Z')
    const merged = mergeFile('usage/2026-11/p1.json', base, local, remote) as UsageFile
    expect(merged.days['2026-11-01'].req).toBe(22)
    expect(merged.days['2026-11-01'].features.home).toBe(3)
    expect(merged.days['2026-11-02'].req).toBe(3)
    expect(merged.syncedAt).toBe('2026-11-02T10:00:00Z')
  })
})

describe('who may write usage files', () => {
  const file = (personId: string) => addToFile(null, personId, {}, null, 'x')
  it('lets a player write only their own', () => {
    const me = { role: 'viewer' as const, personId: 'p1' }
    expect(canWrite(me, 'usage/2026-11/p1.json', null, file('p1'))).toBe(true)
    expect(canWrite(me, 'usage/2026-11/p2.json', null, file('p2'))).toBe(false)
    expect(canWrite(me, 'usage/2026-11/p1.json', null, file('p2'))).toBe(false)
  })
  it('lets the super admin acting as an admin write their own', () => {
    const acting = { role: 'admin' as const, personId: 'a1', viaId: 's1' }
    expect(canWrite(acting, 'usage/2026-11/s1.json', null, file('s1'))).toBe(true)
  })
})

describe('sync', () => {
  it('adds the waiting counts to the month file, twice without losing any', async () => {
    const backend = fakeBackend()
    const store = new Store(backend, memoryKV(), 5)
    store.actor = { role: 'viewer', personId: 'p1' }
    setUsagePerson('p1')
    track('home')
    track('funds')
    expect(await syncUsage(store, 'p1', 'dev1')).toBe(true)
    await store.flush()
    track('home')
    expect(await syncUsage(store, 'p1', 'dev1')).toBe(true)
    await store.flush()
    const saved = backend.json<UsageFile>(usagePath(localDate().slice(0, 7), 'p1'))!
    expect(saved.days[localDate()].features).toEqual({ home: 2, funds: 1 })
    expect(saved.devices.dev1.platform).toBeDefined()
    expect(Object.keys(pendingOf('p1'))).toHaveLength(0)
  })

  it('keeps the counts on the phone when it can’t reach the repo', async () => {
    const backend = fakeBackend()
    backend.offline = true
    const store = new Store(backend, memoryKV(), 5)
    store.actor = { role: 'viewer', personId: 'p1' }
    setUsagePerson('p1')
    track('home')
    expect(await syncUsage(store, 'p1', 'dev1')).toBe(false)
    expect(pendingOf('p1')[localDate()].features.home).toBe(1)
  })
})

describe('the hourly allowance', () => {
  it('counts as full again once its hour is over, and is low under 10%', () => {
    noteRate({ limit: 5000, remaining: 400, resetAt: 1_000_000, at: 0 })
    expect(isLow(currentRate(500_000))).toBe(true)
    expect(currentRate(2_000_000)?.remaining).toBe(5000)
  })

  it('gives the demo repo a pretend allowance that goes down with each request', async () => {
    const b = countedDemo(fakeBackend())
    await b.write('a.json', { x: 1 }, 'm')
    await b.read('a.json')
    const r = await b.rateLimit!()
    expect(r!.limit - r!.remaining).toBe(2)
  })
})

describe('hard stop', () => {
  const config = { schemaVersion: 2, appName: 'x', superAdminId: 's1', phoneSalt: 'x', recovery: { salt: '', hash: '', iterations: 1 }, createdAt: 'x' } as unknown as AppConfig

  it('is on until its time and then off by itself', () => {
    const until = new Date(1_000_000).toISOString()
    expect(pausedUntil({ ...config, pausedUntil: until }, 500_000)).toBe(until)
    expect(pausedUntil({ ...config, pausedUntil: until }, 1_000_001)).toBeNull()
    expect(pausedUntil(config, 0)).toBeNull()
  })

  it('is set and ended by the super admin, and only by them', async () => {
    const backend = fakeBackend()
    backend.remoteWrite('config/app.json', config)
    const store = new Store(backend, memoryKV(), 5)
    await store.refresh('config/app.json')
    store.actor = { role: 'admin', personId: 'a1' }
    await expect(pauseApp(store, new Date(Date.now() + 60_000), 'a1')).rejects.toThrow()
    store.actor = { role: 'super', personId: 's1' }
    await pauseApp(store, new Date(Date.now() + 60_000), 's1')
    expect(pausedUntil(backend.json<AppConfig>('config/app.json'))).not.toBeNull()
    await resumeApp(store)
    expect(backend.json<AppConfig>('config/app.json')!.pausedUntil).toBeUndefined()
  })
})

describe('the month report', () => {
  it('adds everyone up and lists who hasn’t opened the app', () => {
    const f1 = addToFile(null, 'p1', { '2026-11-03': day({ req: 10, opens: 2, hours: Array.from({ length: 24 }, (_, h) => (h === 19 ? 10 : 0)), features: { home: 3, 'act.share': 1 } }) }, { id: 'd1', info: { platform: 'android', installed: true, version: '1.0', lastSeen: '2026-11-03T19:00:00Z' } }, 'x')
    const f2 = addToFile(null, 'p2', { '2026-11-05': day({ req: 4, opens: 1, features: { home: 1, funds: 2 } }) }, null, 'x')
    const r = buildReport('2026-11', [
      { personId: 'p1', file: f1 },
      { personId: 'p2', file: f2 },
      { personId: 'p3', file: null },
    ], ['p1', 'p2', 'p3'])
    expect(r.req).toBe(14)
    expect(r.byDay).toHaveLength(30)
    expect(r.byDay[2]).toBe(10)
    expect(r.byHour[19]).toBe(10)
    expect(r.people.map((p) => p.personId)).toEqual(['p1', 'p2'])
    expect(r.idle).toEqual(['p3'])
    expect(r.features[0]).toEqual({ key: 'home', count: 4, people: 2 })
    expect(r.screens).toBe(6)
    expect(r.platforms.android).toBe(1)
    expect(daysInMonth('2026-02')).toBe(28)
  })
})
