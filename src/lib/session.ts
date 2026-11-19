// What this device remembers (PLAN §5.5, §8): repo, token, personId, session
// epoch, UI prefs and the wrong-PIN lockout timer. Never a phone number or PIN.

export interface RepoRef {
  owner: string
  repo: string
  token: string
}

export interface Session extends RepoRef {
  personId: string
  sessionEpoch: number
  /**
   * This phone's login key. The credentials file holds only a hash of the
   * secret, so editing personId on this phone cannot borrow someone else's login.
   */
  deviceId: string
  deviceSecret: string
}

const SESSION_KEY = 'aac.session'
const REPO_KEY = 'aac.repo'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** A saved login; one from before device keys existed counts as none (the person logs in again). */
export function loadSession(): Session | null {
  const s = read<Session>(SESSION_KEY)
  return s && typeof s.deviceId === 'string' && typeof s.deviceSecret === 'string' ? s : null
}

export function saveSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  saveRepoRef(s)
}

/** Ends the login but keeps repo + token, so onboarding again asks only for the number. */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export const loadRepoRef = () => read<RepoRef>(REPO_KEY)

export function saveRepoRef(r: RepoRef): void {
  localStorage.setItem(REPO_KEY, JSON.stringify({ owner: r.owner, repo: r.repo, token: r.token }))
}

export function forgetEverything(): void {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(REPO_KEY)
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('aac.lock.') || k.startsWith('aac.pref.')) localStorage.removeItem(k)
  }
}

// ---------- per-device preferences ----------
export function getPref<T>(name: string, fallback: T): T {
  const v = read<T>(`aac.pref.${name}`)
  return v === null ? fallback : v
}

export function setPref(name: string, value: unknown): void {
  localStorage.setItem(`aac.pref.${name}`, JSON.stringify(value))
}

// ---------- wrong-PIN lockout (client-side only) ----------
interface Lock {
  fails: number
  until: number
}
const FREE_ATTEMPTS = 5

export function lockRemainingMs(personId: string, now = Date.now()): number {
  const lock = read<Lock>(`aac.lock.${personId}`)
  return lock ? Math.max(0, lock.until - now) : 0
}

/** Records a wrong PIN. After 5 the entry locks for 30 s, then 60 s, 120 s… Returns the lock in ms. */
export function registerPinFail(personId: string, now = Date.now()): number {
  const lock = read<Lock>(`aac.lock.${personId}`) ?? { fails: 0, until: 0 }
  const fails = lock.fails + 1
  const wait = fails >= FREE_ATTEMPTS ? 30_000 * 2 ** Math.min(fails - FREE_ATTEMPTS, 10) : 0
  localStorage.setItem(`aac.lock.${personId}`, JSON.stringify({ fails, until: now + wait }))
  return wait
}

export function clearPinFails(personId: string): void {
  localStorage.removeItem(`aac.lock.${personId}`)
}
