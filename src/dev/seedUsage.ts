// Dev only: believable usage counts for the showcase club (October and November up to today), so the
// super admin's Usage screen has something to show. Match mornings are busy, weekday evenings steady,
// a couple of players never open the app.
import type { Store } from '../lib/store'
import { addToFile, emptyDay, localDate, usagePath, type DayUsage, type DeviceInfo, type UsageFile } from '../lib/usage'
import { APP_VERSION } from '../lib/version'

function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PLAYER_SCREENS: [string, number][] = [
  ['home', 10],
  ['team.matches', 5],
  ['team.players', 3],
  ['team.stats', 4],
  ['match', 6],
  ['live.live', 9],
  ['live.scorecard', 7],
  ['live.analysis', 3],
  ['live.detailed', 1.5],
  ['live.commentary', 2],
  ['player', 5],
  ['funds', 4],
  ['statement', 1],
  ['matches', 3],
  ['settings', 1],
  ['opponent', 0.6],
]
const SUPER_SCREENS: [string, number][] = [
  ['home', 6],
  ['team.players', 3],
  ['match', 4],
  ['squad', 1],
  ['scoreSetup', 0.6],
  ['scoring', 5],
  ['expenses', 1],
  ['complete', 0.6],
  ['users', 1],
  ['keys', 0.5],
  ['funds', 2],
  ['settings', 2],
  ['usage', 1.5],
  ['live.scorecard', 2],
]

function pick(list: [string, number][], rnd: () => number): string {
  const total = list.reduce((s, [, w]) => s + w, 0)
  let r = rnd() * total
  for (const [k, w] of list) if ((r -= w) <= 0) return k
  return list[0][0]
}

/** The busy days: match mornings. */
const MATCH_DAYS = new Set(['2026-10-04', '2026-10-18', '2026-11-01', '2026-11-15', '2026-11-20'])

export async function seedUsage(store: Store, people: { id: string; name: string; super?: boolean }[]): Promise<void> {
  const rnd = mulberry(77)
  const end = localDate()
  const quiet = new Set(['Omkar Sawant', 'Tejas Gokhale'])
  const files = new Map<string, UsageFile>()

  for (const [i, p] of people.entries()) {
    if (quiet.has(p.name)) continue
    // How keen: the captain, Aarav and the super admin open it most.
    const keen = p.super ? 1.6 : ['Rohan Deshpande', 'Aarav Mehta', 'Kunal Joshi'].includes(p.name) ? 1.4 : 0.35 + rnd() * 0.8
    const screens = p.super ? SUPER_SCREENS : PLAYER_SCREENS
    const devices: Record<string, DeviceInfo> = {}
    const platform = p.super ? 'computer' : i % 3 === 1 ? 'iphone' : 'android'
    const old = i === 5 || i === 9
    devices[`dev-${i}`] = { platform, installed: platform !== 'computer', version: old ? 'a41c9e2' : APP_VERSION, lastSeen: '' }
    if (p.super) devices[`dev-${i}b`] = { platform: 'android', installed: true, version: APP_VERSION, lastSeen: '' }

    const byMonth: Record<string, Record<string, DayUsage>> = {}
    for (let d = new Date(2026, 9, 1); localDate(d) <= end; d.setDate(d.getDate() + 1)) {
      const date = localDate(d)
      const matchDay = MATCH_DAYS.has(date)
      const weekend = d.getDay() === 0 || d.getDay() === 6
      const chance = matchDay ? 0.9 : weekend ? 0.6 * keen : 0.45 * keen
      if (rnd() > Math.min(0.97, chance)) continue
      const day = emptyDay()
      const opens = 1 + Math.floor(rnd() * (matchDay ? 3 : 2) * keen)
      day.opens = opens
      const views = Math.round(opens * (3 + rnd() * 5) * (matchDay ? 1.3 : 1))
      for (let v = 0; v < views; v++) {
        // Match mornings lean on the live score and scorecard.
        const k = matchDay && rnd() < 0.45 ? (p.super ? 'scoring' : rnd() < 0.6 ? 'live.live' : 'live.scorecard') : pick(screens, rnd)
        day.features[k] = (day.features[k] ?? 0) + 1
        const hour = matchDay ? 7 + Math.floor(rnd() * 5) : rnd() < 0.25 ? 8 + Math.floor(rnd() * 2) : rnd() < 0.15 ? 13 : 19 + Math.floor(rnd() * 4)
        const cost = k === 'scoring' ? 3 : 1
        day.req += cost
        day.hours[hour] += cost
        day.free += 2
      }
      // Each open loads the app's main files.
      const OPEN_HOURS = [8, 9, 13, 18, 19, 20, 21, 22]
      let hour = 7
      for (let o = 0; o < opens; o++) {
        hour = matchDay ? 6 + Math.floor(rnd() * 5) : OPEN_HOURS[Math.floor(rnd() * OPEN_HOURS.length)]
        day.req += 3
        day.hours[hour] += 3
      }
      if (!p.super && d.getDay() >= 1 && d.getDay() <= 4 && rnd() < 0.25) {
        day.features['act.availability'] = 1
        day.req += 1
        day.writes += 1
      }
      if (matchDay && rnd() < 0.2) day.features['act.share'] = 1
      if (p.super) day.writes += Math.round(day.req * 0.3)
      for (const dev of Object.values(devices)) dev.lastSeen = `${date}T${String(hour).padStart(2, '0')}:30:00.000Z`
      ;(byMonth[date.slice(0, 7)] ??= {})[date] = day
    }
    for (const [month, days] of Object.entries(byMonth)) {
      let file = addToFile(null, p.id, days, null, `${Object.keys(days).sort().pop()}T21:00:00.000Z`)
      file = { ...file, devices }
      files.set(usagePath(month, p.id), file)
    }
  }
  for (const [path, file] of files) store.write(path, file, 'Usage counts')
  await store.flush()
}
