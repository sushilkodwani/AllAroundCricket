// Minutes on the field, from the time each ball was entered (PLAN §26).
//
// Every event in the score file carries the moment the scorer tapped it. Read
// one after the other those give a clock for the innings: how long each batter
// was at the crease, how long each stand lasted, how long each over took.
// Two things would make that clock lie, so they are handled here:
//  - breaks (drinks, a lost ball, a long stoppage): any single gap counts for
//    at most GAP_CAP, so a break never lands on one batter;
//  - balls entered in a burst (caught up later, or the whole match typed in
//    afterwards): when too many gaps are only a few seconds, the innings is
//    marked as not timed and no minutes are shown at all.
import type { Innings } from '../types'
import { BALLS, isBall } from './scoring'

export const GAP_CAP = 5 * 60_000
/** Gaps shorter than this can only mean the balls were typed in one after another. */
export const BURST = 5_000
/** An innings is not timed when more than this share of its gaps are bursts. */
export const BURST_SHARE = 0.3
const MIN_BALLS = 6

export interface InningsMinutes {
  timed: boolean
  /** Total time of the innings, ms. */
  total: number
  /** Time each batter spent at the crease, ms. */
  batters: Map<string, number>
  /** Time each pair batted together, ms; key = the two ids sorted, joined by "|". */
  stands: Map<string, number>
  /** Time each over took, ms (index 0 = over 1; the last one may be unfinished). */
  overs: number[]
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
/** Whole minutes, at least 1 for anything that took any time at all. */
export const mins = (ms: number) => (ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60_000)))

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const EMPTY: InningsMinutes = { timed: false, total: 0, batters: new Map(), stands: new Map(), overs: [] }

export function inningsMinutes(inn: Innings): InningsMinutes {
  const events = inn.events
  const times = events.map((e) => Date.parse(e.at))
  if (events.filter(isBall).length < MIN_BALLS || times.some((t) => !Number.isFinite(t))) return EMPTY

  const raw = times.slice(1).map((t, i) => t - times[i])
  if (raw.some((g) => g < 0)) return EMPTY
  if (raw.filter((g) => g < BURST).length > raw.length * BURST_SHARE) return EMPTY

  // The first ball also took a ball's time to bowl: give it a typical gap.
  const typical = Math.min(GAP_CAP, median(raw))
  const gaps = [typical, ...raw.map((g) => Math.min(g, GAP_CAP))]

  const batters = new Map<string, number>()
  const stands = new Map<string, number>()
  const overs: number[] = []
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

  let crease: [string, string] | null = null
  let legal = 0
  let total = 0
  events.forEach((e, i) => {
    const gap = gaps[i]
    total += gap
    // Who was out in the middle during this gap: the batters of this ball, or (for a
    // retirement or penalty between balls) the pair from the ball before.
    if (isBall(e)) crease = [e.striker, e.nonStriker]
    if (crease) {
      add(batters, crease[0], gap)
      add(batters, crease[1], gap)
      add(stands, pairKey(crease[0], crease[1]), gap)
    }
    const over = Math.floor(Math.max(0, legal - (isBall(e) ? 0 : 1)) / BALLS)
    overs[over] = (overs[over] ?? 0) + gap
    if (isBall(e) && e.kind === 'legal') legal++
  })
  return { timed: true, total, batters, stands, overs: Array.from(overs, (v) => v ?? 0) }
}
