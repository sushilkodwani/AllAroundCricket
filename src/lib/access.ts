// Who may do what (PLAN §5.5, §5.6, §5.9, §65). The app enforces it: the shared
// token itself can write, so every write passes canWrite().
//
// Roles:
//  - super admin  the app owner. Adds, suspends and replaces admins; may change anything.
//  - admin        added by the super admin. Runs the teams they created (team.adminId).
//  - viewer       a player with access. Sees every team; changes only their own things.
import type {
  AdminRecord,
  AppConfig,
  AvailabilityFile,
  Credential,
  CredentialsFile,
  GroundsFile,
  ImageFile,
  MatchesFile,
  OpponentsFile,
  OutboxFile,
  PeopleFile,
  Person,
  SubscriptionsFile,
  TeamsFile,
  TournamentsFile,
} from '../types'
import { isSafeImage } from './images'
import { P } from './paths'

export type Role = 'super' | 'admin' | 'viewer' | 'denied'

/** Who the store is acting for. 'setup' exists only while first-time setup creates the files. */
export interface Actor {
  role: 'super' | 'admin' | 'viewer' | 'setup' | 'none'
  personId?: string
  /** Set while the super admin acts as an admin: who really made the change. */
  viaId?: string
  /** Matches an admin handed to this person to score. */
  scorerMatchIds?: string[]
}

/** Current data the write guard needs (read from the store at the moment of the write). */
export interface Lookup {
  /** Admin who runs the team. */
  teamAdmin(teamId: string): string | undefined
  person(personId: string): Person | undefined
  /** The super admin or anyone with an admin record (active or suspended). */
  isStaff(personId: string): boolean
}

export const NO_LOOKUP: Lookup = { teamAdmin: () => undefined, person: () => undefined, isStaff: () => false }

export const adminRecordOf = (admins: AdminRecord[], personId: string) => admins.find((a) => a.personId === personId)

export function roleOf(personId: string | undefined, config: AppConfig | null, people: Person[], admins: AdminRecord[]): Role {
  if (!personId || !config) return 'denied'
  const person = people.find((p) => p.id === personId)
  if (!person) return 'denied'
  if (config.superAdminId === personId) return 'super'
  const rec = adminRecordOf(admins, personId)
  if (rec?.status === 'active') return 'admin'
  // A suspended admin keeps looking (view only) while their teams are handed over.
  if (rec) return person.access === 'view' ? 'viewer' : 'denied'
  if (person.isGuest) return 'denied'
  return person.access === 'view' && person.teamIds.length > 0 ? 'viewer' : 'denied'
}

export const isAdminRole = (role: Role) => role === 'super' || role === 'admin'

export const credentialOf = (creds: Credential[], personId: string) => creds.find((c) => c.personId === personId)

export type OnboardStep = 'no_access' | 'set_pin' | 'enter_pin'

/** What onboarding shows after the number was matched to a person (or not). */
export function onboardStep(person: Person | undefined, config: AppConfig, creds: Credential[], admins: AdminRecord[]): OnboardStep {
  if (!person || roleOf(person.id, config, [person], admins) === 'denied') return 'no_access'
  return credentialOf(creds, person.id)?.pin ? 'enter_pin' : 'set_pin'
}

/** How many phones one person may stay logged in on; the oldest is logged out beyond that. */
export const MAX_DEVICES = 8

export type SessionCheck = 'ok' | 'pin_reset' | 'signed_out' | 'no_access'

/**
 * Run on every launch and refresh against freshly loaded files. `deviceHash`
 * is the hash of this phone's secret: a login only counts on a phone that is
 * listed for that person, so copying someone's id into this phone does nothing.
 */
export function checkSession(
  session: { personId: string; sessionEpoch: number; deviceId: string },
  deviceHash: string,
  config: AppConfig | null,
  people: Person[],
  creds: Credential[],
  admins: AdminRecord[],
): SessionCheck {
  if (roleOf(session.personId, config, people, admins) === 'denied') return 'no_access'
  const cred = credentialOf(creds, session.personId)
  if (!cred || !cred.pin || cred.sessionEpoch !== session.sessionEpoch) return 'pin_reset'
  if (!cred.devices?.some((d) => d.id === session.deviceId && d.hash === deviceHash)) return 'signed_out'
  return 'ok'
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Every record that was added, removed or changed between two lists. */
function touched<T>(before: T[], after: T[], idOf: (t: T) => string): T[] {
  const b = new Map(before.map((x) => [idOf(x), x]))
  const a = new Map(after.map((x) => [idOf(x), x]))
  const out: T[] = []
  for (const [id, x] of a) if (!same(x, b.get(id))) out.push(x)
  for (const [id, x] of b) if (!a.has(id)) out.push(x)
  return out
}

/** Like touched(), but as [before, after] pairs (undefined = added / removed). */
function changes<T>(before: T[], after: T[], idOf: (t: T) => string): [T | undefined, T | undefined][] {
  const b = new Map(before.map((x) => [idOf(x), x]))
  const a = new Map(after.map((x) => [idOf(x), x]))
  const out: [T | undefined, T | undefined][] = []
  for (const [id, x] of a) if (!same(x, b.get(id))) out.push([b.get(id), x])
  for (const [id, x] of b) if (!a.has(id)) out.push([x, undefined])
  return out
}

/** Everything about a record except the named fields, for "nothing else changed" checks. */
function without<T extends object>(rec: T | undefined, keys: string[]): string {
  if (!rec) return ''
  const copy = { ...rec } as Record<string, unknown>
  for (const k of keys) delete copy[k]
  return JSON.stringify(copy)
}

const list = <T>(file: unknown, key: string): T[] => ((file as Record<string, T[]> | null)?.[key] ?? []) as T[]

/**
 * The write guard. Super admin → any file. Admin → their own teams and the
 * people in them, plus shared lists (opponents, grounds, tournaments) for
 * what they added. Everyone → their own PIN, devices, push subscription,
 * availability answers, photo and profile. A match scorer → that match.
 */
export function canWrite(actor: Actor, path: string, before: unknown, after: unknown, look: Lookup = NO_LOOKUP): boolean {
  if (actor.role === 'super' || actor.role === 'setup') return true
  if ((actor.role !== 'viewer' && actor.role !== 'admin') || !actor.personId) return false
  // Usage counts: everyone adds to their own file (the super admin's too while acting as an admin).
  const usage = path.match(/^usage\/\d{4}-\d{2}\/([^/]+)\.json$/)
  if (usage) return (usage[1] === actor.personId || usage[1] === actor.viaId) && (after as { personId?: string } | null)?.personId === usage[1]
  const me = actor.personId
  if (ownMayWrite(me, path, before, after)) return true
  if (actor.role === 'admin' && adminMayWrite(me, path, before, after, look)) return true
  return scorerMayWrite(actor.scorerMatchIds ?? [], path, before, after)
}

// ---------- everyone: their own things ----------
function ownMayWrite(me: string, path: string, before: unknown, after: unknown): boolean {
  if (path === P.creds) {
    const b = list<Credential>(before, 'credentials')
    const a = list<Credential>(after, 'credentials')
    if (a.length !== b.length) return false
    const changed = touched(b, a, (c) => c.personId)
    if (changed.some((c) => c.personId !== me)) return false
    const mineBefore = credentialOf(b, me)
    const mineAfter = credentialOf(a, me)
    // Anyone can set or change their PIN and their phones, never their session epoch.
    return !!mineBefore && !!mineAfter && mineBefore.sessionEpoch === mineAfter.sessionEpoch
  }

  if (path === P.subs) {
    return touched(list<{ deviceId: string; personId: string }>(before, 'subscriptions'), list(after, 'subscriptions'), (s) => s.deviceId).every((s) => s.personId === me)
  }

  // Availability poll: anyone may set or change their own answer, nobody else's.
  if (/^teams\/[^/]+\/availability\.json$/.test(path)) {
    const b = (before as AvailabilityFile | null)?.entries ?? []
    const a = (after as AvailabilityFile | null)?.entries ?? []
    return touched(b, a, (e) => e.id).every((e) => e.personId === me)
  }

  // Profile photo: a player may set or remove their own picture only.
  if (path === P.personPhoto(me)) return safeImageFile(after)

  // Profile: their own role, batting hand, bowling style, jersey number and photo stamp.
  if (path === P.people) return ownProfileOnly(me, before, after)
  return false
}

const safeImageFile = (after: unknown) => {
  if (after === null) return true // the picture file is deleted
  const url = (after as ImageFile | null)?.dataUrl
  return url === null || isSafeImage(url)
}

const PROFILE_FIELDS = ['role', 'batsLeft', 'bowlStyle', 'jersey', 'photo', 'updatedAt']

function ownProfileOnly(personId: string, before: unknown, after: unknown): boolean {
  const b = (before as PeopleFile | null)?.people ?? []
  const a = (after as PeopleFile | null)?.people ?? []
  if (a.length !== b.length) return false
  const old = new Map(b.map((p) => [p.id, p]))
  const changed = touched(b, a, (p) => p.id)
  return changed.length > 0 && changed.every((p) => p.id === personId && without(old.get(p.id), PROFILE_FIELDS) === without(p, PROFILE_FIELDS))
}

// ---------- admin: their own teams ----------
/**
 * May this admin look after this person's record? Their own; anyone in (or a
 * guest of) one of their teams; anyone in no team at all (new players,
 * opponents' players). Never another admin or the super admin.
 */
export function managesPerson(me: string, p: Person | undefined, look: Lookup): boolean {
  if (!p) return false
  if (p.id === me) return true
  if (look.isStaff(p.id)) return false
  const teams = [...p.teamIds, ...(p.guestOfTeamIds ?? [])]
  return teams.length === 0 || teams.some((t) => look.teamAdmin(t) === me)
}

const diff = (a: string[] = [], b: string[] = []) => [...a.filter((x) => !b.includes(x)), ...b.filter((x) => !a.includes(x))]

function adminMayWrite(me: string, path: string, before: unknown, after: unknown, look: Lookup): boolean {
  const owns = (teamId: string) => look.teamAdmin(teamId) === me

  const teamFile = path.match(/^teams\/([^/]+)\//)
  if (teamFile) return owns(teamFile[1])

  const logo = path.match(/^images\/teams\/([^/]+)\.json$/)
  if (logo) return owns(logo[1]) && safeImageFile(after)

  const photo = path.match(/^images\/people\/([^/]+)\.json$/)
  if (photo) return managesPerson(me, look.person(photo[1]), look) && safeImageFile(after)

  if (path === P.teams) {
    // New teams are theirs; they change or delete only their own; handing a team over is the super admin's job.
    return changes(list<TeamsFile['teams'][number]>(before, 'teams'), list(after, 'teams'), (t) => t.id).every(([was, now]) => {
      if (!was) return now!.adminId === me
      if (!now) return was.adminId === me
      return was.adminId === me && now.adminId === me
    })
  }

  if (path === P.people) {
    return changes(list<Person>(before, 'people'), list(after, 'people'), (p) => p.id).every(([was, now]) => {
      // Deleting someone: only a person they look after who is in no team any more.
      if (!now) return was!.teamIds.length === 0 && managesPerson(me, was, look) && was!.id !== me
      if (!was) return now.teamIds.every(owns) && (now.guestOfTeamIds ?? []).every(owns)
      // Team lists change only for their own teams.
      if (!diff(was.teamIds, now.teamIds).every(owns) || !diff(was.guestOfTeamIds, now.guestOfTeamIds).every(owns)) return false
      const rest = ['teamIds', 'guestOfTeamIds', 'updatedAt', 'batsLeft', 'bowlStyle']
      return without(was, rest) === without(now, rest) || managesPerson(me, was, look)
    })
  }

  if (path === P.creds) {
    // New credential records and PIN resets, only for people they look after.
    return changes(list<Credential>(before, 'credentials'), list(after, 'credentials'), (c) => c.personId).every(([was, now]) => {
      if (!now) return was!.personId !== me && managesPerson(me, look.person(was!.personId), look)
      return managesPerson(me, look.person(now.personId), look) && (!was || was.personId !== me || was.sessionEpoch === now.sessionEpoch)
    })
  }

  if (path === P.opponents) {
    // Anyone scoring may add players to an opponent; only whoever added it renames or deletes it.
    return changes(list<OpponentsFile['opponents'][number]>(before, 'opponents'), list(after, 'opponents'), (o) => o.id).every(([was, now]) => {
      if (!was) return now!.createdBy === me
      if (!now) return was.createdBy === me
      return was.createdBy === me || without(was, ['playerIds', 'updatedAt']) === without(now, ['playerIds', 'updatedAt'])
    })
  }
  if (path === P.grounds) return createdByMe(list<GroundsFile['grounds'][number]>(before, 'grounds'), list(after, 'grounds'), me)
  if (path === P.tournaments) {
    // Any admin may enter their match (and its two teams) into a tournament; only its creator changes the rest.
    return changes(list<TournamentsFile['tournaments'][number]>(before, 'tournaments'), list(after, 'tournaments'), (t) => t.id).every(([was, now]) => {
      if (!was) return now!.createdBy === me
      if (!now || was.createdBy === me) return was.createdBy === me
      const kept = was.teams.every((t) => now.teams.some((n) => n.id === t.id))
      return kept && without(was, ['teams', 'updatedAt']) === without(now, ['teams', 'updatedAt'])
    })
  }

  if (path === P.outbox) {
    // Payment reminders for their own teams; old requests may be pruned by anyone.
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
    return changes(list<OutboxFile['messages'][number]>(before, 'messages'), list(after, 'messages'), (m) => m.id).every(([was, now]) => (now ? !was && owns(now.teamId) : was!.createdAt < dayAgo))
  }

  // config/app.json and config/admins.json belong to the super admin.
  return false
}

/** Shared list (grounds, tournaments): add yours, change or delete only yours. */
function createdByMe<T extends { id: string; createdBy?: string }>(before: T[], after: T[], me: string): boolean {
  return changes(before, after, (x) => x.id).every(([was, now]) => (was ? was.createdBy === me : now!.createdBy === me))
}

// ---------- one-match scorer ----------
/**
 * A player an admin made scorer of a match may write what scoring needs and
 * nothing more: that match's ball log; on the match record only the score
 * fields; the team's derived stats; new players without app access; opponents.
 */
function scorerMayWrite(matchIds: string[], path: string, before: unknown, after: unknown): boolean {
  if (matchIds.length === 0) return false
  const scoring = path.match(/^teams\/[^/]+\/scoring\/([^/]+)\.json$/)
  if (scoring) return matchIds.includes(scoring[1])

  if (/^teams\/[^/]+\/matches\.json$/.test(path)) {
    const b = (before as MatchesFile | null)?.matches ?? []
    const a = (after as MatchesFile | null)?.matches ?? []
    const old = new Map(b.map((m) => [m.id, m]))
    const keep = ['scoring', 'result', 'ourScore', 'theirScore', 'overs', 'opponentId', 'updatedAt']
    return a.length === b.length && touched(b, a, (m) => m.id).every((m) => matchIds.includes(m.id) && without(old.get(m.id), keep) === without(m, keep))
  }

  if (path === P.teams) {
    const b = (before as TeamsFile | null)?.teams ?? []
    const a = (after as TeamsFile | null)?.teams ?? []
    const old = new Map(b.map((t) => [t.id, t]))
    return a.length === b.length && touched(b, a, (t) => t.id).every((t) => without(old.get(t.id), ['stats']) === without(t, ['stats']))
  }

  if (path === P.people) {
    const b = (before as PeopleFile | null)?.people ?? []
    const a = (after as PeopleFile | null)?.people ?? []
    const old = new Map(b.map((p) => [p.id, p]))
    const now = new Set(a.map((p) => p.id))
    return touched(b, a, (p) => p.id).every((p) => {
      if (!now.has(p.id)) return false // no deleting
      const was = old.get(p.id)
      if (!was) return p.access === 'none' && p.isGuest && p.teamIds.length === 0
      return without(was, ['batsLeft', 'bowlStyle', 'updatedAt']) === without(p, ['batsLeft', 'bowlStyle', 'updatedAt'])
    })
  }

  if (path === P.opponents) {
    // A missing opponent may be added and players added to one; nothing renamed or deleted.
    const b = (before as OpponentsFile | null)?.opponents ?? []
    const a = (after as OpponentsFile | null)?.opponents ?? []
    return changes(b, a, (o) => o.id).every(([was, now]) => !!now && (!was || without(was, ['playerIds', 'updatedAt']) === without(now, ['playerIds', 'updatedAt'])))
  }
  return false
}

export const peopleOf = (file: PeopleFile | null) => file?.people ?? []
