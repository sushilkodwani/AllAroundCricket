// Adds up everyone's usage files for one month, for the Usage screen.
import { addDay, emptyDay, type DayUsage, type DeviceInfo, type Platform, type UsageFile } from './usage'

export interface PersonUsage {
  personId: string
  req: number
  writes: number
  opens: number
  /** Screens opened (actions not included). */
  screens: number
  /** Days with any use. */
  activeDays: number
  features: Record<string, number>
  devices: (DeviceInfo & { id: string })[]
  syncedAt: string | null
}

export interface FeatureUsage {
  key: string
  count: number
  /** How many people used it. */
  people: number
}

export interface UsageReport {
  req: number
  writes: number
  free: number
  opens: number
  screens: number
  /** Requests on each day of the month (index 0 = the 1st). */
  byDay: number[]
  /** Requests in each hour of the day. */
  byHour: number[]
  /** Most requests first; only people with any use. */
  people: PersonUsage[]
  /** People with access and no use this month. */
  idle: string[]
  /** Most used first. */
  features: FeatureUsage[]
  platforms: Record<Platform, number>
  installed: number
  browser: number
  versions: { version: string; devices: number }[]
}

export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

const isScreen = (key: string) => !key.startsWith('act.')

export function buildReport(month: string, files: { personId: string; file: UsageFile | null; extra?: Record<string, DayUsage> }[], withAccess: string[]): UsageReport {
  const n = daysInMonth(month)
  const r: UsageReport = {
    req: 0,
    writes: 0,
    free: 0,
    opens: 0,
    screens: 0,
    byDay: Array(n).fill(0),
    byHour: Array(24).fill(0),
    people: [],
    idle: [],
    features: [],
    platforms: { iphone: 0, android: 0, computer: 0 },
    installed: 0,
    browser: 0,
    versions: [],
  }
  const feats = new Map<string, FeatureUsage>()
  const versions = new Map<string, number>()
  const used = new Set<string>()

  for (const { personId, file, extra } of files) {
    // This month's days only, with any counts this phone hasn't sent yet.
    const days: Record<string, DayUsage> = {}
    for (const [date, d] of Object.entries(file?.days ?? {})) if (date.startsWith(month)) days[date] = d
    for (const [date, d] of Object.entries(extra ?? {})) if (date.startsWith(month)) days[date] = addDay(days[date], d)

    let total = emptyDay()
    let activeDays = 0
    for (const [date, d] of Object.entries(days)) {
      total = addDay(total, d)
      const day = Number(date.slice(8, 10)) - 1
      if (day >= 0 && day < n) r.byDay[day] += d.req
      d.hours?.forEach((v, h) => (r.byHour[h] += v ?? 0))
      if (d.req || d.opens || Object.keys(d.features).length) activeDays++
    }
    const screens = Object.entries(total.features).reduce((s, [k, v]) => s + (isScreen(k) ? v : 0), 0)
    const devices = Object.entries(file?.devices ?? {}).map(([id, d]) => ({ id, ...d }))
    if (!activeDays && devices.length === 0) continue
    used.add(personId)

    r.req += total.req
    r.writes += total.writes
    r.free += total.free
    r.opens += total.opens
    r.screens += screens
    for (const [key, count] of Object.entries(total.features)) {
      const f = feats.get(key) ?? { key, count: 0, people: 0 }
      f.count += count
      f.people++
      feats.set(key, f)
    }
    for (const d of devices) {
      r.platforms[d.platform] = (r.platforms[d.platform] ?? 0) + 1
      if (d.installed) r.installed++
      else r.browser++
      versions.set(d.version, (versions.get(d.version) ?? 0) + 1)
    }
    r.people.push({ personId, req: total.req, writes: total.writes, opens: total.opens, screens, activeDays, features: total.features, devices, syncedAt: file?.syncedAt ?? null })
  }

  r.people.sort((a, b) => b.req - a.req || b.opens - a.opens)
  r.idle = withAccess.filter((id) => !used.has(id))
  r.features = [...feats.values()].sort((a, b) => b.count - a.count)
  r.versions = [...versions.entries()].map(([version, devices]) => ({ version, devices })).sort((a, b) => b.devices - a.devices)
  return r
}

/** The last `count` months, newest first, as YYYY-MM. */
export function recentMonths(now: Date, count = 6): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}
