import { describe, expect, it } from 'vitest'
import type { AdminRecord, AppConfig, Credential, Person, Team } from '../types'
import { canWrite, checkSession, onboardStep, roleOf, type Lookup } from './access'
import { memoryKV } from './cache'
import {
  addAdmin,
  addContribution,
  addMatch,
  addNewPlayer,
  addRefund,
  adminsOf,
  categoriesOf,
  createTeam,
  deletePlayer,
  deleteTeam,
  matchesOf,
  membersOf,
  peopleOf,
  setAdminStatus,
  setSquad,
  teamsOf,
  transferTeam,
} from './domain'
import { fakeBackend } from './fakeBackend'
import { P } from './paths'
import { Store } from './store'

describe('super admin, admins and their teams (whole flow)', () => {
  function setup() {
    const store = new Store(fakeBackend(), memoryKV(), 5)
    store.actor = { role: 'setup', personId: 'boss' }
    store.write(P.config, { schemaVersion: 2, appName: 'x', superAdminId: 'boss', phoneSalt: 'AAAAAAAAAAAAAAAAAAAAAA==', recovery: PIN, createdAt: '' }, 'seed')
    store.write(P.admins, { schemaVersion: 1, admins: [] }, 'seed')
    store.write(P.people, { schemaVersion: 1, people: [mk('boss', { teamIds: [] })] }, 'seed')
    store.write(P.creds, { schemaVersion: 1, credentials: [cred('boss')] }, 'seed')
    store.write(P.teams, { schemaVersion: 1, teams: [] }, 'seed')
    store.actor = { role: 'super', personId: 'boss' }
    return store
  }

  it('the super admin adds admins; each admin runs only the teams they create', async () => {
    const store = setup()
    const ravi = await addAdmin(store, 'Ravi', '9876543210')
    const sam = await addAdmin(store, 'Sam', '9876543211')
    await expect(addAdmin(store, 'Ravi again', '9876543210')).rejects.toThrow('already an admin')
    expect(adminsOf(store).map((a) => a.status)).toEqual(['active', 'active'])

    store.actor = { role: 'admin', personId: ravi.id }
    const lions = createTeam(store, { name: 'Lions', color: '#000' })
    expect(lions.adminId).toBe(ravi.id)
    // A new team starts with the usual expense categories of its own.
    expect(categoriesOf(store, lions.id).map((c) => c.name)).toEqual(['Match fee', 'Balls', 'Breakfast'])

    // Sam cannot add a match to Ravi's team.
    store.actor = { role: 'admin', personId: sam.id }
    addMatch(store, lions.id, { date: '2026-01-10', time: '10:00', opponent: 'Tigers', matchType: 'friendly' })
    expect(matchesOf(store, lions.id)).toEqual([])

    // The super admin hands Lions to Sam; now Sam runs it.
    store.actor = { role: 'super', personId: 'boss' }
    transferTeam(store, lions.id, sam.id)
    expect(teamsOf(store)[0].adminId).toBe(sam.id)
    store.actor = { role: 'admin', personId: sam.id }
    addMatch(store, lions.id, { date: '2026-01-10', time: '10:00', opponent: 'Tigers', matchType: 'friendly' })
    expect(matchesOf(store, lions.id)).toHaveLength(1)

    // Suspending logs the admin out everywhere (new session epoch, no phones).
    store.actor = { role: 'super', personId: 'boss' }
    setAdminStatus(store, ravi.id, 'suspended')
    expect(adminsOf(store).find((a) => a.personId === ravi.id)?.status).toBe('suspended')
    const raviCred = store.get<{ credentials: Credential[] }>(P.creds)!.credentials.find((c) => c.personId === ravi.id)!
    expect(raviCred.sessionEpoch).toBe(2)
    expect(raviCred.devices).toBeUndefined()
    // Only active admins can be given a team.
    expect(() => transferTeam(store, lions.id, ravi.id)).toThrow('active admin')
  })

  it('an admin deletes players and whole teams; files really leave the repo', async () => {
    const backend = fakeBackend()
    const store = new Store(backend, memoryKV(), 5)
    store.actor = { role: 'setup', personId: 'boss' }
    store.write(P.config, { schemaVersion: 2, appName: 'x', superAdminId: 'boss', phoneSalt: 'AAAAAAAAAAAAAAAAAAAAAA==', recovery: PIN, createdAt: '' }, 'seed')
    store.write(P.admins, { schemaVersion: 1, admins: [admin('a1')] }, 'seed')
    store.write(P.people, { schemaVersion: 1, people: [mk('boss', { teamIds: [] }), mk('a1', { teamIds: [] })] }, 'seed')
    store.write(P.creds, { schemaVersion: 1, credentials: [cred('boss'), cred('a1')] }, 'seed')
    store.write(P.teams, { schemaVersion: 1, teams: [] }, 'seed')
    store.write(P.opponents, { schemaVersion: 1, opponents: [] }, 'seed')
    store.actor = { role: 'admin', personId: 'a1' }
    const team = createTeam(store, { name: 'Lions', color: '#000' })
    const fresh = addNewPlayer(store, team.id, 'New Guy', '9876500001', 'hash-1')
    const vet = addNewPlayer(store, team.id, 'Old Hand', '9876500002', 'hash-2')
    const match = addMatch(store, team.id, { date: '2026-01-10', time: '10:00', opponent: 'Tigers', matchType: 'friendly' })
    setSquad(store, team.id, match.id, [vet.id])
    addContribution(store, team.id, { personId: vet.id, amount: 100, date: '2026-01-01', method: 'cash' })
    await store.flush()

    // Never played: gone from the team and from the app.
    expect(await deletePlayer(store, team.id, fresh.id)).toEqual({ personDeleted: true })
    expect(membersOf(store, team.id).some((m) => m.personId === fresh.id)).toBe(false)
    expect(peopleOf(store).some((p) => p.id === fresh.id)).toBe(false)
    // Money in the fund blocks the delete until it is refunded.
    await expect(deletePlayer(store, team.id, vet.id)).rejects.toThrow('team fund')
    addRefund(store, team.id, { personId: vet.id, amount: 100, date: '2026-01-02', method: 'cash' })
    // Played before: off the team list, but kept as a person so the old scorecard keeps the name.
    expect(await deletePlayer(store, team.id, vet.id)).toEqual({ personDeleted: false })
    expect(membersOf(store, team.id)).toEqual([])
    expect(peopleOf(store).find((p) => p.id === vet.id)?.teamIds).toEqual([])

    deleteTeam(store, team.id)
    await store.flush()
    expect(teamsOf(store)).toEqual([])
    for (const path of [P.members(team.id), P.matches(team.id), P.funds(team.id), P.categories(team.id)]) {
      expect(backend.files.has(path)).toBe(false)
      expect(store.has(path)).toBe(false)
    }
  })
})

const config = { superAdminId: 'boss', schemaVersion: 2 } as AppConfig
const admin = (personId: string, status: AdminRecord['status'] = 'active'): AdminRecord => ({ personId, status, addedBy: 'boss', addedAt: '', updatedAt: '' })
const admins = [admin('a1'), admin('a2'), admin('gone', 'suspended')]
const mk = (id: string, patch: Partial<Person> = {}): Person => ({
  id,
  name: id,
  access: 'view',
  isGuest: false,
  teamIds: ['t1'],
  createdAt: '',
  updatedAt: '',
  ...patch,
})
const cred = (personId: string, patch: Partial<Credential> = {}): Credential => ({ personId, sessionEpoch: 1, devices: [{ id: 'd1', hash: 'H', at: '' }], updatedAt: '', ...patch })
const PIN = { algo: 'PBKDF2-SHA256', iterations: 1, salt: 's', hash: 'h' } as const

describe('roles', () => {
  it('resolves super admin, admin, viewer and denied', () => {
    const people = [mk('boss', { teamIds: [] }), mk('a1', { teamIds: [] }), mk('gone', { teamIds: [] }), mk('p1'), mk('blocked', { access: 'none' }), mk('teamless', { teamIds: [] }), mk('guest', { isGuest: true })]
    expect(roleOf('boss', config, people, admins)).toBe('super')
    expect(roleOf('a1', config, people, admins)).toBe('admin') // needs no team to log in
    expect(roleOf('gone', config, people, admins)).toBe('viewer') // suspended: looks, changes nothing
    expect(roleOf('p1', config, people, admins)).toBe('viewer')
    expect(roleOf('blocked', config, people, admins)).toBe('denied')
    expect(roleOf('teamless', config, people, admins)).toBe('denied')
    expect(roleOf('guest', config, people, admins)).toBe('denied')
    expect(roleOf('nobody', config, people, admins)).toBe('denied')
  })

  it('picks the onboarding step — admins need only their number and the key', () => {
    expect(onboardStep(undefined, config, [], admins)).toBe('no_access')
    expect(onboardStep(mk('p1', { access: 'none' }), config, [cred('p1')], admins)).toBe('no_access')
    expect(onboardStep(mk('p1'), config, [cred('p1')], admins)).toBe('set_pin')
    expect(onboardStep(mk('a1', { teamIds: [] }), config, [cred('a1')], admins)).toBe('set_pin')
    expect(onboardStep(mk('p1'), config, [cred('p1', { pin: PIN })], admins)).toBe('enter_pin')
  })

  it('detects a PIN reset, lost access, and a login copied from another phone', () => {
    const people = [mk('p1'), mk('boss', { teamIds: [] })]
    const s = { personId: 'p1', sessionEpoch: 1, deviceId: 'd1' }
    expect(checkSession(s, 'H', config, people, [cred('p1', { pin: PIN })], admins)).toBe('ok')
    expect(checkSession(s, 'H', config, people, [cred('p1', { pin: PIN, sessionEpoch: 2 })], admins)).toBe('pin_reset')
    expect(checkSession(s, 'H', config, people, [cred('p1')], admins)).toBe('pin_reset')
    expect(checkSession(s, 'H', config, [mk('p1', { access: 'none' })], [cred('p1', { pin: PIN })], admins)).toBe('no_access')
    // Logged out on this phone (or the phone was dropped after too many logins).
    expect(checkSession(s, 'H', config, people, [cred('p1', { pin: PIN, devices: [] })], admins)).toBe('signed_out')
    // A player who edits their phone's saved login to say they are the super admin gets nowhere:
    // their phone's key is not one of the super admin's phones.
    const takeover = { personId: 'boss', sessionEpoch: 1, deviceId: 'mine' }
    expect(checkSession(takeover, 'MY-HASH', config, people, [cred('boss', { pin: PIN })], admins)).toBe('signed_out')
  })
})

const team = (id: string, adminId: string) => ({ id, adminId, name: id }) as Team
const look = (teams: Team[], people: Person[]): Lookup => ({
  teamAdmin: (id) => teams.find((t) => t.id === id)?.adminId,
  person: (id) => people.find((p) => p.id === id),
  isStaff: (id) => id === 'boss' || admins.some((a) => a.personId === id),
})

describe('write guard', () => {
  const viewer = { role: 'viewer', personId: 'p1' } as const
  const creds = (...c: Credential[]) => ({ schemaVersion: 1, credentials: c })

  it('super admin may write anything; nobody may write when logged out', () => {
    expect(canWrite({ role: 'super', personId: 'boss' }, 'config/admins.json', null, {})).toBe(true)
    expect(canWrite({ role: 'none' }, 'teams.json', null, {})).toBe(false)
  })

  it('viewer may set only their own PIN and phones', () => {
    const before = creds(cred('p1'), cred('p2'))
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1', { pin: PIN }), cred('p2')))).toBe(true)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1', { devices: [] }), cred('p2')))).toBe(true)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1'), cred('p2', { pin: PIN })))).toBe(false)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1'), cred('p2', { devices: [] })))).toBe(false)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1', { sessionEpoch: 2 }), cred('p2')))).toBe(false)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1')))).toBe(false)
    expect(canWrite(viewer, 'people.json', null, {})).toBe(false)
    expect(canWrite(viewer, 'teams/t1/matches.json', null, {})).toBe(false)
  })

  it('viewer may add or remove only their own push subscription', () => {
    const sub = (deviceId: string, personId: string) => ({ deviceId, personId })
    const subs = (...s: ReturnType<typeof sub>[]) => ({ schemaVersion: 1, subscriptions: s })
    expect(canWrite(viewer, 'push/subscriptions.json', subs(sub('d2', 'p2')), subs(sub('d2', 'p2'), sub('d1', 'p1')))).toBe(true)
    expect(canWrite(viewer, 'push/subscriptions.json', subs(sub('d1', 'p1'), sub('d2', 'p2')), subs(sub('d2', 'p2')))).toBe(true)
    expect(canWrite(viewer, 'push/subscriptions.json', subs(sub('d1', 'p1'), sub('d2', 'p2')), subs(sub('d1', 'p1')))).toBe(false)
  })

  describe('an admin runs only their own teams', () => {
    const a1 = { role: 'admin', personId: 'a1' } as const
    const teams = [team('t1', 'a1'), team('t2', 'a2')]
    const people = [mk('p1', { teamIds: ['t1'] }), mk('p2', { teamIds: ['t2'] }), mk('both', { teamIds: ['t1', 't2'] }), mk('free', { teamIds: [] }), mk('a2', { teamIds: [] }), mk('boss', { teamIds: [] })]
    const L = look(teams, people)
    const tf = (...t: Team[]) => ({ schemaVersion: 1, teams: t })
    const pf = (...p: Person[]) => ({ schemaVersion: 1, people: p })

    it('their own team files, never another admin’s; app config is the super admin’s', () => {
      expect(canWrite(a1, 'teams/t1/matches.json', null, {}, L)).toBe(true)
      expect(canWrite(a1, 'teams/t1/funds.json', null, {}, L)).toBe(true)
      expect(canWrite(a1, 'teams/t2/matches.json', null, {}, L)).toBe(false)
      expect(canWrite(a1, 'teams/t2/funds.json', null, {}, L)).toBe(false)
      expect(canWrite(a1, 'config/app.json', null, {}, L)).toBe(false)
      expect(canWrite(a1, 'config/admins.json', null, {}, L)).toBe(false)
    })

    it('creates teams as their own, edits only their own, cannot hand a team over', () => {
      expect(canWrite(a1, 'teams.json', tf(...teams), tf(...teams, team('t3', 'a1')), L)).toBe(true)
      expect(canWrite(a1, 'teams.json', tf(...teams), tf(...teams, team('t3', 'a2')), L)).toBe(false)
      expect(canWrite(a1, 'teams.json', tf(...teams), tf({ ...teams[0], name: 'New' }, teams[1]), L)).toBe(true)
      expect(canWrite(a1, 'teams.json', tf(...teams), tf(teams[0], { ...teams[1], name: 'Mine now' }), L)).toBe(false)
      expect(canWrite(a1, 'teams.json', tf(...teams), tf({ ...teams[0], adminId: 'a2' }, teams[1]), L)).toBe(false)
      expect(canWrite(a1, 'teams.json', tf(...teams), tf(teams[0]), L)).toBe(false)
    })

    it('looks after the players of their teams; joins anyone to their own team only', () => {
      const all = pf(...people)
      const edit = (id: string, patch: Partial<Person>) => pf(...people.map((p) => (p.id === id ? { ...p, ...patch } : p)))
      expect(canWrite(a1, 'people.json', all, edit('p1', { name: 'Renamed' }), L)).toBe(true)
      expect(canWrite(a1, 'people.json', all, edit('p2', { name: 'Renamed' }), L)).toBe(false)
      expect(canWrite(a1, 'people.json', all, edit('both', { name: 'Renamed' }), L)).toBe(true)
      expect(canWrite(a1, 'people.json', all, edit('a2', { name: 'Renamed' }), L)).toBe(false)
      expect(canWrite(a1, 'people.json', all, edit('boss', { access: 'none' }), L)).toBe(false)
      // Adding another club's player to my team is fine; taking them out of theirs is not.
      expect(canWrite(a1, 'people.json', all, edit('p2', { teamIds: ['t2', 't1'] }), L)).toBe(true)
      expect(canWrite(a1, 'people.json', all, edit('p2', { teamIds: [] }), L)).toBe(false)
      expect(canWrite(a1, 'people.json', all, pf(...people, mk('new', { teamIds: [] })), L)).toBe(true)
      // Deleting a person: only someone in no team; never another club's player or an admin.
      expect(canWrite(a1, 'people.json', all, pf(...people.filter((p) => p.id !== 'free')), L)).toBe(true)
      expect(canWrite(a1, 'people.json', all, pf(...people.filter((p) => p.id !== 'p1')), L)).toBe(false)
      expect(canWrite(a1, 'people.json', all, pf(...people.filter((p) => p.id !== 'a2')), L)).toBe(false)
    })

    it('resets PINs only for their own players', () => {
      const before = creds(cred('p1'), cred('p2'), cred('a2'))
      expect(canWrite(a1, 'auth/credentials.json', before, creds(cred('p1', { sessionEpoch: 2, devices: [] }), cred('p2'), cred('a2')), L)).toBe(true)
      expect(canWrite(a1, 'auth/credentials.json', before, creds(cred('p1'), cred('p2', { sessionEpoch: 2 }), cred('a2')), L)).toBe(false)
      expect(canWrite(a1, 'auth/credentials.json', before, creds(cred('p1'), cred('p2'), cred('a2', { sessionEpoch: 2 })), L)).toBe(false)
    })

    it('shared lists: adds freely, changes only what they added', () => {
      const g = (id: string, createdBy: string, name = id) => ({ id, name, createdBy })
      const gf = (...x: ReturnType<typeof g>[]) => ({ schemaVersion: 1, grounds: x })
      expect(canWrite(a1, 'grounds.json', gf(g('x', 'a2')), gf(g('x', 'a2'), g('y', 'a1')), L)).toBe(true)
      expect(canWrite(a1, 'grounds.json', gf(g('x', 'a2')), gf(g('x', 'a2', 'Renamed')), L)).toBe(false)
      expect(canWrite(a1, 'grounds.json', gf(g('x', 'a2')), gf(), L)).toBe(false)
      const o = (id: string, createdBy: string, playerIds: string[] = []) => ({ id, name: id, createdBy, playerIds })
      const of = (...x: ReturnType<typeof o>[]) => ({ schemaVersion: 1, opponents: x })
      // Scoring against another admin's opponent adds its players; renaming it is not allowed.
      expect(canWrite(a1, 'opponents.json', of(o('x', 'a2')), of(o('x', 'a2', ['q1'])), L)).toBe(true)
      expect(canWrite(a1, 'opponents.json', of(o('x', 'a2')), of({ ...o('x', 'a2'), name: 'Other' }), L)).toBe(false)
    })
  })
})

import { describeRepoError, ApiError, withKeyPrefix, withoutKeyPrefix } from './github'

describe('access key entry', () => {
  it('adds the common first part, accepts a full key, drops stray spaces', () => {
    expect(withKeyPrefix('11ABC_xyz')).toBe('github_pat_11ABC_xyz')
    expect(withKeyPrefix('  11ABC_ xyz\n')).toBe('github_pat_11ABC_xyz')
    expect(withKeyPrefix('github_pat_11ABC_xyz')).toBe('github_pat_11ABC_xyz')
    expect(withKeyPrefix('ghp_classic123')).toBe('ghp_classic123')
    expect(withKeyPrefix('   ')).toBe('')
    expect(withoutKeyPrefix('github_pat_11ABC_xyz')).toBe('11ABC_xyz')
    expect(withoutKeyPrefix(withKeyPrefix('11ABC_xyz'))).toBe('11ABC_xyz')
  })
  it('errors never repeat the service’s own wording', () => {
    for (const status of [401, 403, 404, 422, 500]) {
      const text = describeRepoError(new ApiError(status, 'Bad credentials / personal access token / GitHub'))
      expect(text.toLowerCase()).not.toMatch(/github|personal access|bad credentials|token|repo\b/)
    }
  })
})

import { addExistingPlayer, lookupPlayer } from './domain'

describe('an admin who is also a player', () => {
  async function twoAdmins() {
    const store = new Store(fakeBackend(), memoryKV(), 5)
    store.actor = { role: 'setup', personId: 'boss' }
    store.write(P.config, { schemaVersion: 2, appName: 'x', superAdminId: 'boss', phoneSalt: 'AAAAAAAAAAAAAAAAAAAAAA==', recovery: PIN, createdAt: '' }, 'seed')
    store.write(P.admins, { schemaVersion: 1, admins: [] }, 'seed')
    store.write(P.people, { schemaVersion: 1, people: [mk('boss', { teamIds: [], phoneHash: 'bosshash', phoneLast4: '0000' })] }, 'seed')
    store.write(P.creds, { schemaVersion: 1, credentials: [cred('boss')] }, 'seed')
    store.write(P.teams, { schemaVersion: 1, teams: [] }, 'seed')
    store.actor = { role: 'super', personId: 'boss' }
    const ravi = await addAdmin(store, 'Ravi', '9876543210')
    const sam = await addAdmin(store, 'Sam', '9876543211')
    store.actor = { role: 'admin', personId: sam.id }
    const lions = createTeam(store, { name: 'Lions', color: '#000' })
    store.actor = { role: 'admin', personId: ravi.id }
    const tigers = createTeam(store, { name: 'Tigers', color: '#111' })
    return { store, ravi, sam, lions, tigers }
  }

  it('another admin can be added to a team as a player, and keeps their own admin powers', async () => {
    const { store, ravi, sam, lions, tigers } = await twoAdmins()
    store.actor = { role: 'admin', personId: sam.id }
    const found = await lookupPlayer(store, lions.id, '9876543210')
    expect(found.kind).toBe('elsewhere') // already in the app (as an admin) — not a new person
    addExistingPlayer(store, lions.id, ravi.id)
    expect(membersOf(store, lions.id).find((m) => m.personId === ravi.id)?.status).toBe('active')
    expect(peopleOf(store).find((p) => p.id === ravi.id)?.teamIds).toContain(lions.id)

    // Ravi is still an admin: he runs Tigers, but only plays for Lions.
    expect(roleOf(ravi.id, store.get<AppConfig>(P.config)!, peopleOf(store), adminsOf(store))).toBe('admin')
    store.actor = { role: 'admin', personId: ravi.id }
    addMatch(store, tigers.id, { date: '2026-01-10', time: '10:00', opponent: 'X', matchType: 'friendly' })
    expect(matchesOf(store, tigers.id)).toHaveLength(1)
    addMatch(store, lions.id, { date: '2026-01-11', time: '10:00', opponent: 'Y', matchType: 'friendly' })
    expect(matchesOf(store, lions.id)).toHaveLength(0)
  })

  it('the team’s admin cannot change another admin’s details or PIN just because they play for the team', async () => {
    const { store, ravi, sam, lions } = await twoAdmins()
    store.actor = { role: 'admin', personId: sam.id }
    addExistingPlayer(store, lions.id, ravi.id)
    const before = store.get<{ people: Person[] }>(P.people)!
    const renamed = { people: before.people.map((p) => (p.id === ravi.id ? { ...p, name: 'Renamed' } : p)) }
    expect(canWrite({ role: 'admin', personId: sam.id }, P.people, before, renamed, store.lookup)).toBe(false)
    const creds = store.get<{ credentials: Credential[] }>(P.creds)!
    const reset = { credentials: creds.credentials.map((c) => (c.personId === ravi.id ? { ...c, pin: undefined, sessionEpoch: c.sessionEpoch + 1 } : c)) }
    expect(canWrite({ role: 'admin', personId: sam.id }, P.creds, creds, reset, store.lookup)).toBe(false)
  })

  it('an admin can play in their own team, and the super admin can play in any team', async () => {
    const { store, ravi, sam, lions, tigers } = await twoAdmins()
    store.actor = { role: 'admin', personId: ravi.id }
    addExistingPlayer(store, tigers.id, ravi.id) // Ravi in his own team
    store.actor = { role: 'admin', personId: sam.id }
    addExistingPlayer(store, lions.id, 'boss') // the super admin in Sam's team
    expect(membersOf(store, tigers.id).some((m) => m.personId === ravi.id)).toBe(true)
    expect(membersOf(store, lions.id).some((m) => m.personId === 'boss')).toBe(true)
  })

  it('taking them off the team does not delete the admin', async () => {
    const { store, ravi, sam, lions } = await twoAdmins()
    store.actor = { role: 'admin', personId: sam.id }
    addExistingPlayer(store, lions.id, ravi.id)
    const out = await deletePlayer(store, lions.id, ravi.id)
    expect(out.personDeleted).toBe(false)
    expect(peopleOf(store).some((p) => p.id === ravi.id)).toBe(true)
    expect(adminsOf(store).some((a) => a.personId === ravi.id)).toBe(true)
  })
})
