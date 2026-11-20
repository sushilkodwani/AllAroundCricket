// App usage, for the super admin's Usage screen.
//
// - The hourly allowance: every GitHub reply says how many requests the shared key has left this
//   hour. The latest figure is kept here (and asked for directly, which is free).
// - Counting: each phone counts its own requests (by day and hour) and which screens it opened.
//   The counts wait on the phone and are added once a day to usage/<month>/<person>.json — one
//   file per person, so two people never write the same file. Nothing leaves the data repo.
import type { Backend } from './github'
import { APP_VERSION } from './version'

// ---------- the data ----------
export interface DayUsage {
  /** Requests that count toward the hourly allowance. */
  req: number
  /** Of those, saves (create, change or delete a file). */
  writes: number
  /** "Nothing changed" checks, which don't count toward the allowance. */
  free: number
  /** Counted requests by hour of the day (phone's local time), 24 entries. */
  hours: number[]
  /** Times the app was opened. */
  opens: number
  /** Screens opened and a few actions, by key (see FEATURES). */
  features: Record<string, number>
}

export type Platform = 'iphone' | 'android' | 'computer'

export interface DeviceInfo {
  platform: Platform
  /** Opened from the Home Screen rather than a browser tab. */
  installed: boolean
  version: string
  lastSeen: string
}

export interface UsageFile {
  schemaVersion: 1
  personId: string
  /** By date, YYYY-MM-DD. */
  days: Record<string, DayUsage>
  /** By this app's device id. */
  devices: Record<string, DeviceInfo>
  syncedAt: string
}

export const usagePath = (month: string, personId: string) => `usage/${month}/${personId}.json`
export const isUsagePath = (path: string) => path.startsWith('usage/')

export const emptyDay = (): DayUsage => ({ req: 0, writes: 0, free: 0, hours: Array(24).fill(0), opens: 0, features: {} })

/** a + sign·b, field by field (never below zero). */
function combine(a: DayUsage | undefined, b: DayUsage | undefined, sign: 1 | -1 = 1): DayUsage {
  const x = a ?? emptyDay()
  const y = b ?? emptyDay()
  const n = (p: number, q: number) => Math.max(0, (p ?? 0) + sign * (q ?? 0))
  const features: Record<string, number> = { ...x.features }
  for (const [k, v] of Object.entries(y.features)) features[k] = n(features[k] ?? 0, v)
  for (const k of Object.keys(features)) if (!features[k]) delete features[k]
  return {
    req: n(x.req, y.req),
    writes: n(x.writes, y.writes),
    free: n(x.free, y.free),
    hours: Array.from({ length: 24 }, (_, h) => n(x.hours?.[h] ?? 0, y.hours?.[h] ?? 0)),
    opens: n(x.opens, y.opens),
    features,
  }
}

export const addDay = (a: DayUsage | undefined, b: DayUsage | undefined) => combine(a, b, 1)

/** The same counts added into a file (a new one when there is none). */
export function addToFile(file: UsageFile | null, personId: string, days: Record<string, DayUsage>, device: { id: string; info: DeviceInfo } | null, now: string): UsageFile {
  const out: UsageFile = { schemaVersion: 1, personId, days: { ...(file?.days ?? {}) }, devices: { ...(file?.devices ?? {}) }, syncedAt: now }
  for (const [date, d] of Object.entries(days)) out.days[date] = addDay(out.days[date], d)
  if (device) out.devices[device.id] = device.info
  return out
}

/**
 * Two phones of the same person saved at once: keep both phones' counts. The repo's copy plus
 * what this phone added since it last read it (local − base); for each device the newest record.
 */
export function mergeUsage(base: UsageFile | null, local: UsageFile, remote: UsageFile): UsageFile {
  const days: Record<string, DayUsage> = { ...remote.days }
  for (const date of Object.keys(local.days)) {
    const added = combine(local.days[date], base?.days[date], -1)
    days[date] = addDay(days[date], added)
  }
  const devices = { ...remote.devices }
  for (const [id, d] of Object.entries(local.devices)) if (!devices[id] || devices[id].lastSeen < d.lastSeen) devices[id] = d
  return { ...remote, days, devices, syncedAt: local.syncedAt > remote.syncedAt ? local.syncedAt : remote.syncedAt }
}

// ---------- what a screen counts as ----------
export type FeatureGroup = 'player' | 'admin' | 'super'
export const FEATURES: { key: string; label: string; group: FeatureGroup }[] = [
  { key: 'home', label: 'Teams (home)', group: 'player' },
  { key: 'team.players', label: 'Team players', group: 'player' },
  { key: 'team.matches', label: 'Team matches', group: 'player' },
  { key: 'team.stats', label: 'Team stats', group: 'player' },
  { key: 'match', label: 'Match page', group: 'player' },
  { key: 'act.availability', label: 'Answered availability', group: 'player' },
  { key: 'live.live', label: 'Live score', group: 'player' },
  { key: 'live.scorecard', label: 'Scorecard', group: 'player' },
  { key: 'live.commentary', label: 'Commentary', group: 'player' },
  { key: 'live.analysis', label: 'Match analysis', group: 'player' },
  { key: 'live.detailed', label: 'Detailed analysis', group: 'player' },
  { key: 'live.teams', label: 'Playing elevens', group: 'player' },
  { key: 'player', label: 'Player stats', group: 'player' },
  { key: 'statement', label: 'Money statement', group: 'player' },
  { key: 'year', label: 'Year summary', group: 'player' },
  { key: 'opponent', label: 'Opponent page', group: 'player' },
  { key: 'scout', label: 'Opponent scouting', group: 'player' },
  { key: 'opponentPlayer', label: 'Opponent player stats', group: 'player' },
  { key: 'tournaments', label: 'Tournaments', group: 'player' },
  { key: 'tournament', label: 'Tournament page', group: 'player' },
  { key: 'matches', label: 'Matches tab', group: 'player' },
  { key: 'funds', label: 'Funds tab', group: 'player' },
  { key: 'act.share', label: 'Shared a score or result', group: 'player' },
  { key: 'settings', label: 'Settings', group: 'player' },
  { key: 'tour', label: 'App tour', group: 'player' },
  { key: 'squad', label: 'Pick squad', group: 'admin' },
  { key: 'scoreSetup', label: 'Scoring setup', group: 'admin' },
  { key: 'scoring', label: 'Ball-by-ball scoring', group: 'admin' },
  { key: 'complete', label: 'Complete match', group: 'admin' },
  { key: 'expenses', label: 'Split expenses', group: 'admin' },
  { key: 'categories', label: 'Expense categories', group: 'admin' },
  { key: 'users', label: 'Users', group: 'admin' },
  { key: 'grounds', label: 'Grounds', group: 'admin' },
  { key: 'admins', label: 'Admins', group: 'super' },
  { key: 'keys', label: 'Personal access keys', group: 'super' },
  { key: 'usage', label: 'Usage', group: 'super' },
]
export const featureLabel = (key: string) => FEATURES.find((f) => f.key === key)?.label ?? key

/** Which feature a screen address is (segments and query of the hash route), or null. */
export function featureOf(segs: string[], query: URLSearchParams): string | null {
  const [a, b, c, d, e] = segs
  const tab = query.get('tab')
  if (a === 'teams') {
    if (!b) return 'home'
    if (!c) return `team.${tab === 'matches' || tab === 'stats' ? tab : 'players'}`
    if (c === 'matches' && d) {
      if (!e) return 'match'
      if (e === 'live') return `live.${['scorecard', 'commentary', 'analysis', 'detailed', 'teams'].includes(tab ?? '') ? tab : 'live'}`
      if (e === 'setup') return 'scoreSetup'
      if (e === 'score') return 'scoring'
      return ['squad', 'complete', 'expenses'].includes(e) ? e : null
    }
    if (c === 'players' && d) return 'player'
    if (c === 'statement' && d) return 'statement'
    if (c === 'year') return 'year'
    if (c === 'categories') return 'categories'
    return null
  }
  if (a === 'opponents' && b) return c === 'scout' ? 'scout' : c === 'players' ? 'opponentPlayer' : 'opponent'
  if (a === 'tournaments') return b ? 'tournament' : 'tournaments'
  if (a === 'matches') return 'matches'
  if (a === 'funds') return 'funds'
  if (a === 'tour') return 'tour'
  if (a === 'settings') return b && ['users', 'admins', 'keys', 'grounds', 'usage'].includes(b) ? b : 'settings'
  return null
}

// ---------- this phone ----------
export function platformOf(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): Platform {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'iphone'
  if (/Android/i.test(ua)) return 'android'
  return 'computer'
}

const installed = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

const LOCAL_KEY = 'aac.usage'
/** Counts not yet sent, by person ('' = before anyone logged in, given to whoever logs in next). */
interface Local {
  pending: Record<string, Record<string, DayUsage>>
  lastSync: Record<string, string>
}

let local: Local = load()
let person = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

function load(): Local {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_KEY) : null
    const v = raw ? (JSON.parse(raw) as Local) : null
    if (v?.pending && v.lastSync) return v
  } catch {
    // start again
  }
  return { pending: {}, lastSync: {} }
}

function persistSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(persistNow, 2000)
}

export function persistNow(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local))
  } catch {
    // storage full or blocked: the counts are simply lost
  }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', persistNow)

const pad = (n: number) => String(n).padStart(2, '0')
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function today(): DayUsage {
  const days = (local.pending[person] ??= {})
  return (days[localDate()] ??= emptyDay())
}

/** Who the counts belong to from now on: the person really logged in on this phone. */
export function setUsagePerson(personId: string | null): void {
  const next = personId ?? ''
  if (next === person) return
  // Requests made while logging in belong to the person who logged in.
  if (person === '' && next && local.pending['']) {
    const anon = local.pending['']
    delete local.pending['']
    const mine = (local.pending[next] ??= {})
    for (const [date, d] of Object.entries(anon)) mine[date] = addDay(mine[date], d)
    persistSoon()
  }
  person = next
}

/** One request to the data repo. */
export function noteRequest(kind: 'read' | 'write' | 'free'): void {
  const d = today()
  if (kind === 'free') d.free++
  else {
    d.req++
    if (kind === 'write') d.writes++
    d.hours[new Date().getHours()]++
    demoUsed(1)
  }
  persistSoon()
}

/** A screen opened or an action taken (FEATURES). Not counted before anyone is logged in. */
export function track(feature: string): void {
  if (!person) return
  const d = today()
  d.features[feature] = (d.features[feature] ?? 0) + 1
  persistSoon()
}

export function noteOpen(): void {
  if (!person) return
  today().opens++
  persistSoon()
}

export function lastSyncOf(personId: string): string | null {
  return local.lastSync[personId] ?? null
}

/** This phone's not-yet-sent counts for a person (for the dashboard's own row). */
export function pendingOf(personId: string): Record<string, DayUsage> {
  return local.pending[personId] ?? {}
}

/** Due once a new day starts, or when the app goes to the background after a few hours. */
export function syncDue(personId: string, reason: 'open' | 'hide', now = new Date()): boolean {
  const last = local.lastSync[personId]
  if (!last) return true
  if (reason === 'open') return localDate(new Date(last)) !== localDate(now)
  const days = local.pending[personId]
  const any = !!days && Object.values(days).some((d) => d.req || d.free || d.opens || Object.keys(d.features).length)
  return any && now.getTime() - new Date(last).getTime() > 3 * 3600_000
}

/** Hands the counts waiting for this person to the sync, and starts counting afresh. */
export function takePending(personId: string): Record<string, DayUsage> {
  const days = local.pending[personId] ?? {}
  delete local.pending[personId]
  persistNow()
  return days
}

/** The sync couldn't start: put the counts back. */
export function returnPending(personId: string, days: Record<string, DayUsage>): void {
  const mine = (local.pending[personId] ??= {})
  for (const [date, d] of Object.entries(days)) mine[date] = addDay(mine[date], d)
  persistNow()
}

export function markSynced(personId: string, at: string): void {
  local.lastSync[personId] = at
  persistNow()
}

export function thisDevice(deviceId: string, now: string): { id: string; info: DeviceInfo } {
  return { id: deviceId, info: { platform: platformOf(), installed: installed(), version: APP_VERSION, lastSeen: now } }
}

/** Splits counts by month (each month has its own file). */
export function byMonth(days: Record<string, DayUsage>): Record<string, Record<string, DayUsage>> {
  const out: Record<string, Record<string, DayUsage>> = {}
  for (const [date, d] of Object.entries(days)) (out[date.slice(0, 7)] ??= {})[date] = d
  return out
}

/** Test hook: forget everything this module holds. */
export function resetUsageForTests(): void {
  local = { pending: {}, lastSync: {} }
  person = ''
  rate = null
  demo = { hour: '', used: 0 }
}

// ---------- the hourly allowance ----------
export interface Rate {
  limit: number
  remaining: number
  /** When the allowance starts afresh (ms since 1970). */
  resetAt: number
  /** When this figure was learned. */
  at: number
}

const RATE_KEY = 'aac.rate'
let rate: Rate | null = (() => {
  try {
    return typeof localStorage !== 'undefined' ? (JSON.parse(localStorage.getItem(RATE_KEY) ?? 'null') as Rate | null) : null
  } catch {
    return null
  }
})()
const rateListeners = new Set<() => void>()

export function noteRate(next: Rate): void {
  // Replies can arrive out of order: within the same hour the smaller number is the newer one.
  if (rate && rate.resetAt === next.resetAt && next.remaining > rate.remaining && next.at - rate.at < 5000) return
  rate = next
  try {
    localStorage.setItem(RATE_KEY, JSON.stringify(rate))
  } catch {
    // fine
  }
  rateListeners.forEach((f) => f())
}

/** From GitHub's reply headers; ignored when they aren't there. */
export function noteRateHeaders(h: Headers): void {
  const limit = Number(h.get('x-ratelimit-limit'))
  const remaining = h.get('x-ratelimit-remaining')
  const reset = Number(h.get('x-ratelimit-reset'))
  if (!limit || remaining === null || !reset || (h.get('x-ratelimit-resource') ?? 'core') !== 'core') return
  noteRate({ limit, remaining: Number(remaining), resetAt: reset * 1000, at: Date.now() })
}

/** The latest known allowance; an old one whose hour has passed counts as full again. */
export function currentRate(now = Date.now()): Rate | null {
  if (!rate) return null
  if (now >= rate.resetAt) return { ...rate, remaining: rate.limit }
  return rate
}

/** The stored figure as is (a stable value for React's useSyncExternalStore). */
export const latestRate = () => rate

export function subscribeRate(fn: () => void): () => void {
  rateListeners.add(fn)
  return () => rateListeners.delete(fn)
}

/** Below this share of the hour's allowance the super admin is warned. */
export const LOW_SHARE = 0.1
export const isLow = (r: Rate | null) => !!r && r.remaining < r.limit * LOW_SHARE

// ---------- the demo repo (dev server) has no real allowance: pretend 5,000 an hour ----------
let demo = { hour: '', used: 0 }
const hourKey = (d = new Date()) => `${localDate(d)}T${d.getHours()}`

function demoUsed(n: number): void {
  const h = hourKey()
  if (demo.hour !== h) demo = { hour: h, used: 0 }
  demo.used += n
}

export function demoRate(now = new Date()): Rate {
  const h = hourKey(now)
  const used = demo.hour === h ? demo.used : 0
  const next = new Date(now)
  next.setMinutes(60, 0, 0)
  return { limit: 5000, remaining: Math.max(0, 5000 - used), resetAt: next.getTime(), at: now.getTime() }
}

/** Counts every request of a demo backend, and gives it a pretend allowance. */
export function countedDemo<B extends Backend>(b: B): B {
  return {
    // Keeps the fake's own helpers (files, json…) for the dev tools that use them.
    ...b,
    async checkRepo() {
      noteRequest('read')
      const r = await b.checkRepo()
      noteRate(demoRate())
      return r
    },
    async read(path, etag) {
      const r = await b.read(path, etag)
      noteRequest(r.kind === 'not_modified' ? 'free' : 'read')
      noteRate(demoRate())
      return r
    },
    async write(path, data, message, sha) {
      noteRequest('write')
      const r = await b.write(path, data, message, sha)
      noteRate(demoRate())
      return r
    },
    async remove(path, message, sha) {
      noteRequest('write')
      await b.remove(path, message, sha)
      noteRate(demoRate())
    },
    async rateLimit() {
      return demoRate()
    },
  }
}
