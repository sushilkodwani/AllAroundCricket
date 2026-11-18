// Who may do what (PLAN §5.5, §5.6, §5.9). View-only is enforced here, in the
// app: the shared token itself can write, so every write passes canWrite().
import type { AppConfig, AvailabilityFile, Credential, CredentialsFile, ImageFile, MatchesFile, PeopleFile, Person, SubscriptionsFile, TeamsFile } from '../types'
import { isSafeImage } from './images'
import { P } from './paths'

export type Role = 'admin' | 'viewer' | 'denied'

/** Who the store is acting for. 'setup' exists only while first-time setup creates the files. */
export interface Actor {
  role: 'admin' | 'viewer' | 'setup' | 'none'
  personId?: string
  /** Matches the admin handed to this (view-only) person to score. */
  scorerMatchIds?: string[]
}

export function roleOf(personId: string | undefined, config: AppConfig | null, people: Person[]): Role {
  if (!personId || !config) return 'denied'
  const person = people.find((p) => p.id === personId)
  if (!person) return 'denied'
  if (config.adminPersonId === personId) return 'admin'
  if (person.isGuest) return 'denied'
  return person.access === 'view' && person.teamIds.length > 0 ? 'viewer' : 'denied'
}

export const credentialOf = (creds: Credential[], personId: string) => creds.find((c) => c.personId === personId)

export type OnboardStep = 'no_access' | 'set_pin' | 'enter_pin'

/** What onboarding shows after the number was matched to a person (or not). */
export function onboardStep(person: Person | undefined, config: AppConfig, creds: Credential[]): OnboardStep {
  if (!person || roleOf(person.id, config, [person]) === 'denied') return 'no_access'
  return credentialOf(creds, person.id)?.pin ? 'enter_pin' : 'set_pin'
}

export type SessionCheck = 'ok' | 'pin_reset' | 'no_access'

/** Run on every launch and refresh against freshly loaded files. */
export function checkSession(
  session: { personId: string; sessionEpoch: number },
  config: AppConfig | null,
  people: Person[],
  creds: Credential[],
): SessionCheck {
  if (roleOf(session.personId, config, people) === 'denied') return 'no_access'
  const cred = credentialOf(creds, session.personId)
  if (!cred || !cred.pin || cred.sessionEpoch !== session.sessionEpoch) return 'pin_reset'
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

/**
 * The write guard. Admin → any file. Viewer → only their own PIN record and
 * their own devices' push subscriptions. Everything else is refused before any
 * network call is made.
 */
export function canWrite(actor: Actor, path: string, before: unknown, after: unknown): boolean {
  if (actor.role === 'admin' || actor.role === 'setup') return true
  if (actor.role !== 'viewer' || !actor.personId) return false

  if (path === P.creds) {
    const b = (before as CredentialsFile | null)?.credentials ?? []
    const a = (after as CredentialsFile | null)?.credentials ?? []
    if (a.length !== b.length) return false
    const changed = touched(b, a, (c) => c.personId)
    if (changed.some((c) => c.personId !== actor.personId)) return false
    const mineBefore = credentialOf(b, actor.personId)
    const mineAfter = credentialOf(a, actor.personId)
    // A viewer can set or change their PIN, never their session epoch.
    return !!mineBefore && !!mineAfter && mineBefore.sessionEpoch === mineAfter.sessionEpoch
  }

  if (path === P.subs) {
    const b = (before as SubscriptionsFile | null)?.subscriptions ?? []
    const a = (after as SubscriptionsFile | null)?.subscriptions ?? []
    return touched(b, a, (s) => s.deviceId).every((s) => s.personId === actor.personId)
  }

  // Availability poll: anyone may set or change their own answer, nobody else's.
  if (/^teams\/[^/]+\/availability\.json$/.test(path)) {
    const b = (before as AvailabilityFile | null)?.entries ?? []
    const a = (after as AvailabilityFile | null)?.entries ?? []
    return touched(b, a, (e) => e.id).every((e) => e.personId === actor.personId)
  }

  // Profile photo: a player may set or remove their own picture only.
  if (path === P.personPhoto(actor.personId)) {
    const url = (after as ImageFile | null)?.dataUrl
    return url === null || isSafeImage(url)
  }

  // Profile: a player may change their own role, batting hand, bowling style, jersey number and photo stamp.
  if (path === P.people && ownProfileOnly(actor.personId, before, after)) return true

  return scorerMayWrite(actor.scorerMatchIds ?? [], path, before, after)
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

/** Everything about a record except the named fields, for "nothing else changed" checks. */
function without<T extends object>(rec: T | undefined, keys: string[]): string {
  if (!rec) return ''
  const copy = { ...rec } as Record<string, unknown>
  for (const k of keys) delete copy[k]
  return JSON.stringify(copy)
}

/**
 * A player the admin made scorer of a match may write what scoring needs and
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
      return without(was, ['batsLeft', 'updatedAt']) === without(p, ['batsLeft', 'updatedAt'])
    })
  }

  return path === P.opponents
}

export const peopleOf = (file: PeopleFile | null) => file?.people ?? []
