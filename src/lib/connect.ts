// Connecting to a data repo, first-time setup, and everything PIN-related
// (PLAN §5). PIN writes are immediate and awaited — never debounced.
import { DATA_SCHEMA, type AppConfig, type Credential, type CredentialsFile, type DeviceKey, type PeopleFile, type Person } from '../types'
import { credentialOf, MAX_DEVICES } from './access'
import { openCache } from './cache'
import { nowStamp } from './dates'
import { configOf, credsOf, peopleOf } from './domain'
import { demoBackend, DEMO_OWNER } from './fakeBackend'
import { describeRepoError, githubBackend, type Backend } from './github'
import { P } from './paths'
import { hashPhone, last4 } from './phone'
import { generateRecoveryCode, hashPin, hashRecoveryCode, needsRehash, verifyPin, verifyRecoveryCode } from './pin'
import { randomBytes, sha256, toB64 } from './bytes'
import type { RepoRef } from './session'
import { Store } from './store'
import { uuid } from './uuid'

/** The small files every launch needs. */
export const CORE_PATHS = [P.config, P.admins, P.people, P.creds, P.teams, P.opponents, P.tournaments, P.grounds]

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

export const OLD_DATA = 'This data repo was made by an older version of the app. The app owner needs to reset it and set the app up again.'

/** True when the repo holds data in an older format, which this version does not read. */
export const isOldData = (config: AppConfig | null) => !!config && config.schemaVersion !== DATA_SCHEMA

/** Checks the token can write to the repo, then loads the core files. Throws a readable Error. */
export async function connectRepo(ref: RepoRef): Promise<Store> {
  let canPush: boolean
  try {
    canPush = (await createBackend(ref).checkRepo()).canPush
  } catch (e) {
    throw new Error(describeRepoError(e))
  }
  if (!canPush) throw new Error('This access key can look but not save changes. Ask your admin for the right one.')
  const store = await openStore(ref)
  try {
    await store.refreshAll(CORE_PATHS)
  } catch (e) {
    throw new Error(describeRepoError(e))
  }
  if (isOldData(configOf(store))) throw new Error(OLD_DATA)
  return store
}

export async function findPersonByPhone(store: Store, phone: string): Promise<Person | undefined> {
  const config = configOf(store)
  if (!config) return undefined
  const phoneHash = await hashPhone(phone, config.phoneSalt)
  return peopleOf(store).find((p) => p.phoneHash === phoneHash)
}

// ---------- this phone's login key ----------
/** What a phone keeps after logging in (besides repo and token). */
export interface DeviceLogin {
  sessionEpoch: number
  deviceId: string
  deviceSecret: string
}

/** A fresh login key: the secret stays on the phone, only its hash goes into the repo. */
async function newDeviceKey(): Promise<{ key: DeviceKey; secret: string }> {
  const secret = toB64(randomBytes(32))
  return { key: { id: uuid(), hash: await sha256(secret), at: nowStamp() }, secret }
}

export const deviceHashOf = (secret: string) => sha256(secret)

const withDevice = (c: Credential, key: DeviceKey): Credential => ({ ...c, devices: [...(c.devices ?? []), key].slice(-MAX_DEVICES) })

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

/** Sets a new PIN for the person and logs this phone in. */
export async function setOwnPin(store: Store, personId: string, pin: string): Promise<DeviceLogin> {
  const hash = await hashPin(pin)
  const device = await newDeviceKey()
  const now = nowStamp()
  const cred = await writeOwnCredential(
    store,
    personId,
    (c) => {
      const { resetAt: _x, resetBy: _y, ...keep } = c
      return withDevice({ ...keep, pin: hash, pinSetAt: now, updatedAt: now }, device.key)
    },
    'Set PIN',
  )
  return { sessionEpoch: cred.sessionEpoch, deviceId: device.key.id, deviceSecret: device.secret }
}

/** After the right PIN: adds this phone to the person's logged-in phones. */
export async function logInDevice(store: Store, personId: string): Promise<DeviceLogin> {
  const device = await newDeviceKey()
  const cred = await writeOwnCredential(store, personId, (c) => withDevice({ ...c, updatedAt: nowStamp() }, device.key), 'Log in on a phone')
  return { sessionEpoch: cred.sessionEpoch, deviceId: device.key.id, deviceSecret: device.secret }
}

/** Log out: this phone's key stops working. Best effort — a phone offline at logout is simply forgotten later. */
export async function forgetDevice(store: Store, personId: string, deviceId: string): Promise<void> {
  const mine = credentialOf(credsOf(store), personId)
  if (!mine?.devices?.some((d) => d.id === deviceId)) return
  await writeOwnCredential(store, personId, (c) => ({ ...c, devices: (c.devices ?? []).filter((d) => d.id !== deviceId), updatedAt: nowStamp() }), 'Log out on a phone')
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
  const hash = await hashPin(newPin)
  const now = nowStamp()
  await writeOwnCredential(store, personId, (c) => ({ ...c, pin: hash, pinSetAt: now, updatedAt: now }), 'Change PIN')
}

// ---------- first-time setup (the super admin, once per data repo) ----------
export const isSetUp = (store: Store) => !!configOf(store)

export async function setupRepo(store: Store, input: { name: string; phone: string; pin: string }): Promise<DeviceLogin & { personId: string; recoveryCode: string }> {
  if (isSetUp(store)) throw new Error('This repo is already set up — use normal onboarding.')
  const now = nowStamp()
  const personId = uuid()
  const phoneSalt = toB64(randomBytes(16))
  const recoveryCode = generateRecoveryCode()
  const device = await newDeviceKey()

  const config: AppConfig = {
    schemaVersion: DATA_SCHEMA,
    appName: 'All Around Cricket',
    superAdminId: personId,
    phoneSalt,
    recovery: await hashRecoveryCode(recoveryCode),
    createdAt: now,
  }
  const owner: Person = {
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
  const people: PeopleFile = { schemaVersion: 1, people: [owner] }
  const creds: CredentialsFile = {
    schemaVersion: 1,
    credentials: [{ personId, pin: await hashPin(input.pin), pinSetAt: now, sessionEpoch: 1, devices: [device.key], updatedAt: now }],
  }

  const msg = 'Set up All Around Cricket'
  store.actor = { role: 'setup', personId }
  store.write(P.config, config, msg)
  store.write(P.admins, { schemaVersion: 1, admins: [] }, msg)
  store.write(P.people, people, msg)
  store.write(P.creds, creds, msg)
  store.write(P.teams, { schemaVersion: 1, teams: [] }, msg)
  store.write(P.opponents, { schemaVersion: 1, opponents: [] }, msg)
  store.write(P.grounds, { schemaVersion: 1, grounds: [] }, msg)
  store.write(P.tournaments, { schemaVersion: 1, tournaments: [] }, msg)
  if (!(await store.flush())) throw new Error(store.status.error ?? 'Could not create the app files. Check your connection and try again.')
  store.actor = { role: 'super', personId }
  return { personId, recoveryCode, sessionEpoch: 1, deviceId: device.key.id, deviceSecret: device.secret }
}

/** Writes a fresh recovery code (the old one stops working). Returns the code to show once. */
async function rotateRecoveryCode(store: Store): Promise<string> {
  const config = configOf(store)
  if (!config) throw new Error('App data is not loaded yet.')
  const code = generateRecoveryCode()
  await store.writeNow(P.config, { ...config, recovery: await hashRecoveryCode(code), updatedAt: nowStamp() }, 'New recovery code')
  return code
}

/** "Forgot PIN" for the super admin: the recovery code proves who it is, who then sets a new PIN. */
export async function recoverSuperPin(store: Store, code: string, newPin: string): Promise<DeviceLogin & { recoveryCode: string }> {
  const config = configOf(store)
  if (!config) throw new Error('App data is not loaded yet.')
  if (!(await verifyRecoveryCode(code, config.recovery))) throw new Error('That recovery code is not right.')
  store.actor = { role: 'super', personId: config.superAdminId }
  const login = await setOwnPin(store, config.superAdminId, newPin)
  return { ...login, recoveryCode: await rotateRecoveryCode(store) }
}

export async function newRecoveryCode(store: Store, personId: string, currentPin: string): Promise<string> {
  if (!(await verifyOwnPin(store, personId, currentPin))) throw new Error('Current PIN is wrong.')
  return rotateRecoveryCode(store)
}
