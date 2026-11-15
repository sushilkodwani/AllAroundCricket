// Who may do what (PLAN §5.5, §5.6, §5.9). View-only is enforced here, in the
// app: the shared token itself can write, so every write passes canWrite().
import type { AppConfig, Credential, CredentialsFile, PeopleFile, Person, SubscriptionsFile } from '../types'
import { P } from './paths'

export type Role = 'admin' | 'viewer' | 'denied'

/** Who the store is acting for. 'setup' exists only while first-time setup creates the files. */
export interface Actor {
  role: 'admin' | 'viewer' | 'setup' | 'none'
  personId?: string
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

  return false
}

export const peopleOf = (file: PeopleFile | null) => file?.people ?? []
