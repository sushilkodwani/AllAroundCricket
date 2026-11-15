// Connecting to a data repo, first-time setup, and everything PIN-related
// (PLAN §5). PIN writes are immediate and awaited — never debounced.
import type { AppConfig, Credential, CredentialsFile, PeopleFile, Person } from '../types'
import { credentialOf } from './access'
import { openCache } from './cache'
import { nowStamp } from './dates'
import { configOf, credsOf, peopleOf, seedCategories } from './domain'
import { demoBackend, DEMO_OWNER } from './fakeBackend'
import { describeRepoError, githubBackend, type Backend } from './github'
import { P } from './paths'
import { hashPhone, last4 } from './phone'
import { generateRecoveryCode, hashPin, hashRecoveryCode, needsRehash, verifyPin, verifyRecoveryCode } from './pin'
import { toB64, randomBytes } from './bytes'
import type { RepoRef } from './session'
import { Store } from './store'
import { uuid } from './uuid'

/** The small files every launch needs. */
export const CORE_PATHS = [P.config, P.people, P.creds, P.teams, P.categories]

/** On the dev server, owner "demo" selects a fake repo kept in this browser. */
export const demoAvailable = import.meta.env.DEV
const demos = new Map<string, Backend>()

export function createBackend(ref: RepoRef): Backend {
  if (demoAvailable && ref.owner.trim().toLowerCase() === DEMO_OWNER) {
    const key = ref.repo.trim().toLowerCase()
    if (!demos.has(key)) demos.set(key, demoBackend(key))
    return demos.get(key)!
  }
  return githubBackend(ref)
}

export async function openStore(ref: RepoRef): Promise<Store> {
  const store = new Store(createBackend(ref), await openCache(`${ref.owner}/${ref.repo}`.toLowerCase()))
  await store.hydrate()
  return store
}

/** Checks the token can write to the repo, then loads the core files. Throws a readable Error. */
export async function connectRepo(ref: RepoRef): Promise<Store> {
  let canPush: boolean
  try {
    canPush = (await createBackend(ref).checkRepo()).canPush
  } catch (e) {
    throw new Error(describeRepoError(e))
  }
  if (!canPush) throw new Error('This token can read the repo but not write to it. Ask your admin for the right token.')
  const store = await openStore(ref)
  try {
    await store.refreshAll(CORE_PATHS)
  } catch (e) {
    throw new Error(describeRepoError(e))
  }
  return store
}

export async function findPersonByPhone(store: Store, phone: string): Promise<Person | undefined> {
  const config = configOf(store)
  if (!config) return undefined
  const phoneHash = await hashPhone(phone, config.phoneSalt)
  return peopleOf(store).find((p) => p.phoneHash === phoneHash)
}

async function writeOwnCredential(store: Store, personId: string, fn: (c: Credential) => Credential, message: string): Promise<Credential> {
  // Start from the newest copy so a PIN is never written over someone else's change.
  await store.refresh(P.creds).catch(() => {})
  const creds = credsOf(store)
  const mine = credentialOf(creds, personId)
  if (!mine) throw new Error('Your account is not ready yet. Ask your admin to add you again.')
  const next = fn(mine)
  if (store.actor.role === 'none') store.actor = { role: 'viewer', personId }
  const file: CredentialsFile = { schemaVersion: 1, credentials: creds.map((c) => (c.personId === personId ? next : c)) }
  await store.writeNow(P.creds, file, message)
  return next
}

/** Sets a new PIN for the person. Returns their session epoch for the device to remember. */
export async function setOwnPin(store: Store, personId: string, pin: string): Promise<number> {
  const hash = await hashPin(pin)
  const now = nowStamp()
  const cred = await writeOwnCredential(
    store,
    personId,
    (c) => {
      const { resetAt: _x, resetBy: _y, ...keep } = c
      return { ...keep, pin: hash, pinSetAt: now, updatedAt: now }
    },
    'Set PIN',
  )
  return cred.sessionEpoch
}

/** Checks a PIN against the stored hash; quietly re-hashes if the cost setting was raised since. */
export async function verifyOwnPin(store: Store, personId: string, pin: string): Promise<boolean> {
  const cred = credentialOf(credsOf(store), personId)
  if (!cred?.pin) return false
  if (!(await verifyPin(pin, cred.pin))) return false
  if (needsRehash(cred.pin)) {
    const hash = await hashPin(pin)
    await writeOwnCredential(store, personId, (c) => ({ ...c, pin: hash, updatedAt: nowStamp() }), 'Re-hash PIN').catch(() => {})
  }
  return true
}

export async function changeOwnPin(store: Store, personId: string, currentPin: string, newPin: string): Promise<void> {
  if (!(await verifyOwnPin(store, personId, currentPin))) throw new Error('Current PIN is wrong.')
  await setOwnPin(store, personId, newPin)
}

// ---------- first-time setup (admin, once per data repo) ----------
export const isSetUp = (store: Store) => !!configOf(store)

export async function setupRepo(store: Store, input: { name: string; phone: string; pin: string }): Promise<{ personId: string; recoveryCode: string }> {
  if (isSetUp(store)) throw new Error('This repo is already set up — use normal onboarding.')
  const now = nowStamp()
  const personId = uuid()
  const phoneSalt = toB64(randomBytes(16))
  const recoveryCode = generateRecoveryCode()

  const config: AppConfig = {
    schemaVersion: 1,
    appName: 'AllAroundCricket',
    adminPersonId: personId,
    phoneSalt,
    adminRecovery: await hashRecoveryCode(recoveryCode),
    createdAt: now,
  }
  const admin: Person = {
    id: personId,
    name: input.name.trim().replace(/\s+/g, ' ').slice(0, 40),
    phoneHash: await hashPhone(input.phone, phoneSalt),
    phoneLast4: last4(input.phone),
    access: 'view',
    isGuest: false,
    teamIds: [],
    createdAt: now,
    updatedAt: now,
  }
  const people: PeopleFile = { schemaVersion: 1, people: [admin] }
  const creds: CredentialsFile = {
    schemaVersion: 1,
    credentials: [{ personId, pin: await hashPin(input.pin), pinSetAt: now, sessionEpoch: 1, updatedAt: now }],
  }

  store.actor = { role: 'setup', personId }
  store.write(P.config, config, 'Set up AllAroundCricket')
  store.write(P.people, people, 'Set up AllAroundCricket')
  store.write(P.creds, creds, 'Set up AllAroundCricket')
  store.write(P.teams, { schemaVersion: 1, teams: [] }, 'Set up AllAroundCricket')
  store.write(P.categories, { schemaVersion: 1, categories: seedCategories() }, 'Set up AllAroundCricket')
  if (!(await store.flush())) throw new Error(store.status.error ?? 'Could not create the app files. Check your connection and try again.')
  store.actor = { role: 'admin', personId }
  return { personId, recoveryCode }
}

/** Writes a fresh recovery code (the old one stops working). Returns the code to show once. */
async function rotateRecoveryCode(store: Store): Promise<string> {
  const config = configOf(store)
  if (!config) throw new Error('App data is not loaded yet.')
  const code = generateRecoveryCode()
  await store.writeNow(P.config, { ...config, adminRecovery: await hashRecoveryCode(code), updatedAt: nowStamp() }, 'New admin recovery code')
  return code
}

/** "Forgot admin PIN": the recovery code proves it's the admin, who then sets a new PIN. */
export async function recoverAdminPin(store: Store, code: string, newPin: string): Promise<{ sessionEpoch: number; recoveryCode: string }> {
  const config = configOf(store)
  if (!config) throw new Error('App data is not loaded yet.')
  if (!(await verifyRecoveryCode(code, config.adminRecovery))) throw new Error('That recovery code is not right.')
  store.actor = { role: 'admin', personId: config.adminPersonId }
  const sessionEpoch = await setOwnPin(store, config.adminPersonId, newPin)
  return { sessionEpoch, recoveryCode: await rotateRecoveryCode(store) }
}

export async function newRecoveryCode(store: Store, adminPersonId: string, currentPin: string): Promise<string> {
  if (!(await verifyOwnPin(store, adminPersonId, currentPin))) throw new Error('Current PIN is wrong.')
  return rotateRecoveryCode(store)
}
