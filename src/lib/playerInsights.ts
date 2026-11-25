// The player "Insights" tab: how a player compares with their own team, the moments that
// swung matches, what the team does with and without them, and when and where they play best.
// Worked out from the score files and the match list — nothing extra is stored.
import { WICKET_LABELS, type ScoreFile, type SideKey, type WicketKind } from '../types'
import { ballsWithOver } from './analysis'
import { winChance } from './insights'
import { CAUGHT, batAgg, bowlAgg, playerData, type PlayerCtx, type PlayerData } from './playerAnalysis'
import { BALLS, BOWLER_WICKETS, ballRuns, bowlerRuns, inningsTotal, oversText, squadOf } from './scoring'

const sideOf = (f: ScoreFile, id: string): SideKey | null => (squadOf(f.home).includes(id) ? 'home' : squadOf(f.away).includes(id) ? 'away' : null)

// ---------- 1. against the team ----------
export interface RankRow {
  key: string
  label: string
  /** The player's own value; null when it cannot be worked out (no balls, no dismissals). */
  value: number | null
  /** Mean of the team-mates who qualified. */
  team: number | null
  /** Best value among them. */
  best: number | null
  /** 1 = best. Null when the player does not qualify. */
  rank: number | null
  /** How many team-mates have a value to rank. */
  of: number
  higherIsBetter: boolean
  digits: number
  suffix?: string
}

/** Everyone who played on the same side as `id` in any of these matches (including `id`). */
export function teammatesOf(files: ScoreFile[], id: string): string[] {
  const ids = new Set<string>([id])
  for (const f of files) {
    const side = sideOf(f, id)
    if (side) for (const p of squadOf(f[side])) ids.add(p)
  }
  return [...ids]
}

export const MIN_BALLS = 12

interface Metric {
  key: string
  label: string
  higherIsBetter: boolean
  digits: number
  suffix?: string
  of: (d: PlayerData) => number | null
}

const BAT: Metric[] = [
  { key: 'runs', label: 'Runs', higherIsBetter: true, digits: 0, of: (d) => batAgg(d.batBalls).runs },
  { key: 'avg', label: 'Average', higherIsBetter: true, digits: 1, of: (d) => ratio(batAgg(d.batBalls).runs, batAgg(d.batBalls).outs) },
  { key: 'sr', label: 'Strike rate', higherIsBetter: true, digits: 1, of: (d) => ratio(batAgg(d.batBalls).runs * 100, batAgg(d.batBalls).balls) },
  { key: 'bound', label: 'Boundary balls', higherIsBetter: true, digits: 0, suffix: '%', of: (d) => ratio((batAgg(d.batBalls).fours + batAgg(d.batBalls).sixes) * 100, batAgg(d.batBalls).balls) },
  { key: 'dots', label: 'Dot balls', higherIsBetter: false, digits: 0, suffix: '%', of: (d) => ratio(batAgg(d.batBalls).dots * 100, batAgg(d.batBalls).balls) },
]
const BOWL: Metric[] = [
  { key: 'wkts', label: 'Wickets', higherIsBetter: true, digits: 0, of: (d) => bowlAgg(d.bowlBalls).wickets },
  { key: 'econ', label: 'Economy', higherIsBetter: false, digits: 2, of: (d) => ratio(bowlAgg(d.bowlBalls).runs * BALLS, bowlAgg(d.bowlBalls).balls) },
  { key: 'avg', label: 'Average', higherIsBetter: false, digits: 1, of: (d) => ratio(bowlAgg(d.bowlBalls).runs, bowlAgg(d.bowlBalls).wickets) },
  { key: 'dots', label: 'Dot balls', higherIsBetter: true, digits: 0, suffix: '%', of: (d) => ratio(bowlAgg(d.bowlBalls).dots * 100, bowlAgg(d.bowlBalls).balls) },
]

const ratio = (n: number, d: number) => (d > 0 ? n / d : null)

function rank(metrics: Metric[], id: string, data: Map<string, PlayerData>, qualifies: (d: PlayerData) => boolean): RankRow[] {
  const pool = [...data.entries()].filter(([, d]) => qualifies(d))
  const mine = data.get(id)
  return metrics.map((m) => {
    const vals = pool.map(([pid, d]) => ({ pid, v: m.of(d) })).filter((x): x is { pid: string; v: number } => x.v !== null)
    const value = mine && qualifies(mine) ? m.of(mine) : null
    const better = (a: number, b: number) => (m.higherIsBetter ? a > b : a < b)
    const nums = vals.map((x) => x.v)
    return {
      key: m.key,
      label: m.label,
      value,
      team: nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null,
      best: nums.length ? (m.higherIsBetter ? Math.max(...nums) : Math.min(...nums)) : null,
      rank: value === null ? null : 1 + nums.filter((n) => better(n, value)).length,
      of: nums.length,
      higherIsBetter: m.higherIsBetter,
      digits: m.digits,
      suffix: m.suffix,
    }
  })
}

/** Batting and bowling of `id` ranked among their team-mates (12+ balls faced or bowled to count). */
export function teamRanks(files: ScoreFile[], id: string, ctx: PlayerCtx): { bat: RankRow[]; bowl: RankRow[]; mates: number } {
  const ids = teammatesOf(files, id)
  const data = new Map(ids.map((p) => [p, playerData(files, p, ctx)]))
  return {
    bat: rank(BAT, id, data, (d) => batAgg(d.batBalls).balls >= MIN_BALLS),
    bowl: rank(BOWL, id, data, (d) => bowlAgg(d.bowlBalls).balls >= MIN_BALLS),
    mates: ids.length,
  }
}

// ---------- 2. the moments that swung a match ----------
export interface ChaseBall {
  /** Overs completed after this ball, "14.3". */
  at: string
  over: number
  striker: string
  bowler: string
  runs: number
  wicket?: { kind: WicketKind; who: string; fielder?: string }
  /** Change in the chasing side's chance, in percentage points (a rough estimate). */
  delta: number
  /** The chasing side's chance before the ball, 0–100. */
  before: number
  /** Runs off the bat, and whether it counts as a ball faced. */
  bat: number
  faced: boolean
  /** Runs charged to the bowler, and whether it was a legal ball. */
  charged: number
  legal: boolean
}

/** Every ball of the chase with how much it moved the chasing side's win chance. [] when there was no chase. */
export function chaseBalls(file: ScoreFile): ChaseBall[] {
  const first = file.innings[0]
  const second = file.innings[1]
  if (!first || !second || second.target === undefined) return []
  const firstLegal = first.events.filter((e) => e.t === 'ball' && e.kind === 'legal').length
  const firstRate = firstLegal > 0 ? inningsTotal(file, 0) / firstLegal : 1
  const wicketsTotal = file[second.batting].xi.length - 1
  const chance = (total: number, legal: number, out: number) => winChance({ target: second.target!, total, ballsLeft: second.overs * BALLS - legal, wicketsLeft: wicketsTotal - out, wicketsTotal, firstRatePerBall: firstRate })
  let total = 0
  let legal = 0
  let out = 0
  let before = chance(0, 0, 0)
  const rows: ChaseBall[] = []
  for (const { b, over } of ballsWithOver(file, 1)) {
    total += ballRuns(b)
    if (b.kind === 'legal') legal++
    if (b.wicket) out++
    const after = chance(total, legal, out)
    rows.push({ at: oversText(legal), over, striker: b.striker, bowler: b.bowler, runs: ballRuns(b), wicket: b.wicket && { kind: b.wicket.kind, who: b.wicket.who, fielder: b.wicket.fielder }, delta: (after - before) * 100, before: before * 100, bat: b.bat, faced: b.kind !== 'wd', charged: bowlerRuns(b), legal: b.kind === 'legal' })
    before = after
  }
  return rows
}

export interface Moment {
  matchId: string
  at: string
  over: number
  kind: 'bat' | 'bowl' | 'field'
  /** Percentage points of win chance this ball gave (+) or cost (–) the player's side. */
  delta: number
  runs: number
  wicket?: { kind: WicketKind; who: string; fielder?: string }
  striker: string
  bowler: string
}

/** One line describing a moment: "6 off Sahil Kapoor", "Got Rahul Bhalla (bowled)". */
export function momentText(m: Moment, name: (id: string) => string): string {
  const w = m.wicket
  if (m.kind === 'bat') return w ? (w.kind === 'run_out' ? 'Run out' : `${WICKET_LABELS[w.kind]} (${name(m.bowler)})`) : m.runs === 0 ? `Dot ball from ${name(m.bowler)}` : `${m.runs} off ${name(m.bowler)}`
  if (m.kind === 'bowl') return w ? `Got ${name(w.who)} (${WICKET_LABELS[w.kind].toLowerCase()})` : m.runs === 0 ? `Dot ball to ${name(m.striker)}` : `${m.runs} to ${name(m.striker)}`
  return w ? `${w.kind === 'run_out' ? 'Ran out' : w.kind === 'stumped' ? 'Stumped' : 'Caught'} ${name(w.who)}` : ''
}

export interface MatchSwing {
  matchId: string
  bat: number
  bowl: number
  /** Batting plus bowling. Fielding moments are listed but not added in. */
  total: number
}

/** The player's balls in each chase: every one that moved the win chance, and the total per match. */
export function playerMoments(files: ScoreFile[], id: string): { moments: Moment[]; matches: MatchSwing[] } {
  const moments: Moment[] = []
  const matches: MatchSwing[] = []
  for (const f of files) {
    const side = sideOf(f, id)
    const second = f.innings[1]
    if (!side || !second || second.target === undefined) continue
    const chasing = second.batting === side
    const balls = chaseBalls(f)
    let bat = 0
    let bowl = 0
    let any = false
    for (const c of balls) {
      const mk = (kind: Moment['kind'], delta: number) => moments.push({ matchId: f.matchId, at: c.at, over: c.over, kind, delta, runs: c.runs, wicket: c.wicket, striker: c.striker, bowler: c.bowler })
      if (chasing && c.striker === id) {
        bat += c.delta
        any = true
        mk('bat', c.delta)
      } else if (!chasing && c.bowler === id && c.wicket?.kind !== 'run_out') {
        bowl -= c.delta
        any = true
        mk('bowl', -c.delta)
      }
      if (!chasing && c.wicket?.fielder === id) mk('field', -c.delta)
    }
    if (any) matches.push({ matchId: f.matchId, bat, bowl, total: bat + bowl })
  }
  return { moments, matches }
}

// ---------- 3. what the team does with and without them ----------
export interface WinCount {
  played: number
  won: number
}

export interface WinContribution {
  /** Matches the team played with the player in the XI, and without. Ties and no-results are left out. */
  withIn: WinCount
  without: WinCount
  /** Score at or above the line against below it (matches where they batted). */
  batHigh: WinCount
  batLow: WinCount
  /** Took a wicket against did not (matches where they bowled). */
  wicket: WinCount
  noWicket: WinCount
  line: number
}

export const BAT_LINE = 25

const decided = (f: ScoreFile, side: SideKey): boolean | null => (f.status !== 'finished' || !f.result?.winner ? null : f.result.winner === side)
const tally = (c: WinCount, won: boolean | null) => {
  if (won === null) return
  c.played++
  if (won) c.won++
}

export function winContribution(files: ScoreFile[], d: PlayerData, id: string): WinContribution {
  const out: WinContribution = { withIn: { played: 0, won: 0 }, without: { played: 0, won: 0 }, batHigh: { played: 0, won: 0 }, batLow: { played: 0, won: 0 }, wicket: { played: 0, won: 0 }, noWicket: { played: 0, won: 0 }, line: BAT_LINE }
  // The side they mostly play for; matches they missed are judged from that side.
  const sides = files.map((f) => sideOf(f, id)).filter((s): s is SideKey => !!s)
  const main: SideKey = sides.filter((s) => s === 'away').length > sides.length / 2 ? 'away' : 'home'
  for (const f of files) {
    const side = sideOf(f, id)
    if (side) tally(out.withIn, decided(f, side))
    else tally(out.without, decided(f, main))
  }
  for (const i of d.batInns) tally(i.runs >= BAT_LINE ? out.batHigh : out.batLow, i.won)
  const byMatch = new Map<string, { w: number; won: boolean | null }>()
  for (const b of d.bowlInns) {
    const m = byMatch.get(b.matchId) ?? { w: 0, won: b.won }
    m.w += b.wickets
    byMatch.set(b.matchId, m)
  }
  for (const m of byMatch.values()) tally(m.w > 0 ? out.wicket : out.noWicket, m.won)
  return out
}

// ---------- 4. when and where ----------
export type TimeBucket = 'morning' | 'afternoon' | 'evening'
export const BUCKET_LABEL: Record<TimeBucket, string> = { morning: 'Morning (before noon)', afternoon: 'Afternoon (noon to 5 pm)', evening: 'Evening and night (after 5 pm)' }

/** "07:05" → morning; "13:30" → afternoon; "21:30" → evening. Null when the start time is missing or odd. */
export function bucketOf(time?: string): TimeBucket | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '')
  if (!m) return null
  const h = +m[1]
  if (h > 23) return null
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

export interface SplitRow {
  key: string
  label: string
  matches: number
  inns: number
  runs: number
  balls: number
  outs: number
  bowlBalls: number
  bowlRuns: number
  wickets: number
}

export const splitSr = (r: SplitRow) => ratio(r.runs * 100, r.balls)
export const splitEcon = (r: SplitRow) => ratio(r.bowlRuns * BALLS, r.bowlBalls)

function group(d: PlayerData, keyOf: (matchId: string) => { key: string; label: string } | null): SplitRow[] {
  const rows = new Map<string, SplitRow & { ids: Set<string> }>()
  const row = (matchId: string) => {
    const k = keyOf(matchId)
    if (!k) return null
    let r = rows.get(k.key)
    if (!r) rows.set(k.key, (r = { key: k.key, label: k.label, matches: 0, inns: 0, runs: 0, balls: 0, outs: 0, bowlBalls: 0, bowlRuns: 0, wickets: 0, ids: new Set() }))
    r.ids.add(matchId)
    return r
  }
  for (const i of d.batInns) {
    const r = row(i.matchId)
    if (!r) continue
    r.inns++
    r.runs += i.runs
    r.balls += i.balls
    if (!i.notOut) r.outs++
  }
  for (const b of d.bowlInns) {
    const r = row(b.matchId)
    if (!r) continue
    r.bowlBalls += b.balls
    r.bowlRuns += b.runs
    r.wickets += b.wickets
  }
  return [...rows.values()].map(({ ids, ...r }) => ({ ...r, matches: ids.size }))
}

export interface MatchInfo {
  time?: string
  venue?: string
}

/** The player's batting and bowling by start time (morning, afternoon, evening). */
export function byTimeOfDay(d: PlayerData, info: (matchId: string) => MatchInfo): SplitRow[] {
  const order: TimeBucket[] = ['morning', 'afternoon', 'evening']
  return group(d, (id) => {
    const b = bucketOf(info(id).time)
    return b ? { key: b, label: BUCKET_LABEL[b] } : null
  }).sort((a, b) => order.indexOf(a.key as TimeBucket) - order.indexOf(b.key as TimeBucket))
}

/** By ground, most matches first. */
export function byVenue(d: PlayerData, info: (matchId: string) => MatchInfo): SplitRow[] {
  return group(d, (id) => {
    const v = info(id).venue?.trim()
    return v ? { key: v, label: v } : null
  }).sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label))
}

/** The best and worst row for strike rate (batting) when each has at least 2 innings and 15 balls; null otherwise. */
export function bestWorstSr(rows: SplitRow[]): { best: SplitRow; worst: SplitRow } | null {
  const ok = rows.filter((r) => r.inns >= 2 && r.balls >= 15)
  if (ok.length < 2) return null
  const sorted = [...ok].sort((a, b) => splitSr(b)! - splitSr(a)!)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  return splitSr(best)! - splitSr(worst)! >= 10 ? { best, worst } : null
}

// ---------- 5. nemesis and favourite victims ----------
export interface VsPlayer {
  id: string
  balls: number
  runs: number
  /** Times the batter was got out by the bowler (bowler-credited wickets only). */
  outs: number
}

function addTo(m: Map<string, VsPlayer>, id: string, balls: number, runs: number, outs: number) {
  const r = m.get(id) ?? { id, balls: 0, runs: 0, outs: 0 }
  r.balls += balls
  r.runs += runs
  r.outs += outs
  m.set(id, r)
}

/** Every bowler this player faced: balls, runs off the bat and times out to them. */
export function facedBowlers(d: PlayerData): VsPlayer[] {
  const m = new Map<string, VsPlayer>()
  for (const b of d.batBalls) addTo(m, b.bowler, b.faced ? 1 : 0, b.faced ? b.bat : 0, b.out && BOWLER_WICKETS.includes(b.out) ? 1 : 0)
  return [...m.values()].filter((r) => r.balls > 0 || r.outs > 0)
}

/** Every batter this player bowled to: legal balls, runs charged and wickets. */
export function bowledAt(d: PlayerData): VsPlayer[] {
  const m = new Map<string, VsPlayer>()
  for (const b of d.bowlBalls) addTo(m, b.striker, b.legal ? 1 : 0, b.runs, b.wicket ? 1 : 0)
  return [...m.values()]
}

const rate = (r: VsPlayer) => (r.balls > 0 ? r.runs / r.balls : 0)
export const MIN_VS = 10

/** The ones who got them out most (fewest balls first on a tie). */
export const mostOuts = (rows: VsPlayer[], n = 3) => rows.filter((r) => r.outs > 0).sort((a, b) => b.outs - a.outs || a.balls - b.balls).slice(0, n)
/** The ones scored off fastest, among those with at least MIN_VS balls. */
export const fastestOff = (rows: VsPlayer[], n = 3) => rows.filter((r) => r.balls >= MIN_VS && r.runs > 0).sort((a, b) => rate(b) - rate(a) || b.runs - a.runs).slice(0, n)
/** For a bowler: the batters who scored fastest off them (lowest first is not wanted here). */
export const hardestHit = fastestOff

// ---------- 6. under pressure ----------
export interface Line {
  balls: number
  runs: number
  /** Dismissals (batting) or wickets (bowling). */
  wickets: number
}

export interface Clutch {
  /** Last quarter of the innings (the death overs), against all their balls. */
  death: { bat: Line; bowl: Line }
  overall: { bat: Line; bowl: Line }
  /** Chase balls where the match was in the balance: the chasing side's chance was 30–70% before the ball. */
  balance: { bat: Line; bowl: Line }
}

export const BALANCE_LOW = 30
export const BALANCE_HIGH = 70

const batLine = (balls: Parameters<typeof batAgg>[0]): Line => {
  const a = batAgg(balls)
  return { balls: a.balls, runs: a.runs, wickets: a.outs }
}
const bowlLine = (balls: Parameters<typeof bowlAgg>[0]): Line => {
  const a = bowlAgg(balls)
  return { balls: a.balls, runs: a.runs, wickets: a.wickets }
}

export function clutchOf(files: ScoreFile[], d: PlayerData, id: string): Clutch {
  const out: Clutch = {
    death: { bat: batLine(d.batBalls.filter((b) => b.phase === 'death')), bowl: bowlLine(d.bowlBalls.filter((b) => b.phase === 'death')) },
    overall: { bat: batLine(d.batBalls), bowl: bowlLine(d.bowlBalls) },
    balance: { bat: { balls: 0, runs: 0, wickets: 0 }, bowl: { balls: 0, runs: 0, wickets: 0 } },
  }
  for (const f of files) {
    const side = sideOf(f, id)
    const second = f.innings[1]
    if (!side || !second || second.target === undefined) continue
    const chasing = second.batting === side
    for (const c of chaseBalls(f)) {
      if (c.before < BALANCE_LOW || c.before > BALANCE_HIGH) continue
      if (chasing && c.striker === id) {
        if (c.faced) {
          out.balance.bat.balls++
          out.balance.bat.runs += c.bat
        }
        if (c.wicket?.who === id && BOWLER_WICKETS.includes(c.wicket.kind)) out.balance.bat.wickets++
      } else if (!chasing && c.bowler === id) {
        if (c.legal) out.balance.bowl.balls++
        out.balance.bowl.runs += c.charged
        if (c.wicket && BOWLER_WICKETS.includes(c.wicket.kind)) out.balance.bowl.wickets++
      }
    }
  }
  return out
}

export const lineSr = (l: Line) => ratio(l.runs * 100, l.balls)
export const lineEcon = (l: Line) => ratio(l.runs * BALLS, l.balls)

// ---------- 7. partners ----------
export interface PartnerRow {
  id: string
  stands: number
  runs: number
  balls: number
  best: number
  /** The player's own runs in these stands. */
  mine: number
}

/** Batting partners, most runs together first. */
export function partnersOf(d: PlayerData): PartnerRow[] {
  const m = new Map<string, PartnerRow>()
  for (const s of d.stands) {
    const r = m.get(s.partner) ?? { id: s.partner, stands: 0, runs: 0, balls: 0, best: 0, mine: 0 }
    r.stands++
    r.runs += s.runs
    r.balls += s.balls
    r.best = Math.max(r.best, s.runs)
    r.mine += s.mine
    m.set(s.partner, r)
  }
  return [...m.values()].sort((a, b) => b.runs - a.runs || a.balls - b.balls)
}

export interface DuoRow {
  id: string
  n: number
}

const DUO_KINDS = [...CAUGHT.filter((k) => k !== 'caught_bowled'), 'stumped'] as const

/** Who took catches (and stumpings) off the player's bowling, and whose bowling the player took them off. */
export function catchDuos(files: ScoreFile[], id: string): { offMe: DuoRow[]; iTookFor: DuoRow[] } {
  const off = new Map<string, number>()
  const took = new Map<string, number>()
  for (const f of files) {
    for (const inn of f.innings) {
      for (const e of inn.events) {
        if (e.t !== 'ball' || !e.wicket?.fielder || !(DUO_KINDS as readonly string[]).includes(e.wicket.kind)) continue
        if (e.bowler === id) off.set(e.wicket.fielder, (off.get(e.wicket.fielder) ?? 0) + 1)
        if (e.wicket.fielder === id) took.set(e.bowler, (took.get(e.bowler) ?? 0) + 1)
      }
    }
  }
  const list = (m: Map<string, number>) => [...m.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n)
  return { offMe: list(off), iTookFor: list(took) }
}

export interface TightFollow {
  id: string
  /** Times this team-mate bowled the over right after one of the player's tight overs. */
  overs: number
  wickets: number
}

export const TIGHT_RUNS = 4

/** The player's overs that cost TIGHT_RUNS or fewer, and the wickets that fell in the over after each. */
export function tightOvers(files: ScoreFile[], id: string): { tight: number; followed: number; wickets: number; by: TightFollow[] } {
  const by = new Map<string, TightFollow>()
  let tight = 0
  let followed = 0
  let wickets = 0
  for (const f of files) {
    f.innings.forEach((inn, idx) => {
      const overs = new Map<number, { bowler: string; runs: number; wickets: number; balls: number }>()
      for (const { b, over } of ballsWithOver(f, idx)) {
        const o = overs.get(over) ?? { bowler: b.bowler, runs: 0, wickets: 0, balls: 0 }
        o.runs += bowlerRuns(b)
        if (b.kind === 'legal') o.balls++
        if (b.wicket) o.wickets++
        overs.set(over, o)
      }
      for (const [n, o] of overs) {
        if (o.bowler !== id || o.balls < BALLS || o.runs > TIGHT_RUNS) continue
        const next = overs.get(n + 1)
        if (!next || next.bowler === id) continue
        tight++
        const r = by.get(next.bowler) ?? { id: next.bowler, overs: 0, wickets: 0 }
        r.overs++
        r.wickets += next.wickets
        by.set(next.bowler, r)
        wickets += next.wickets
        if (next.wickets > 0) followed++
      }
    })
  }
  return { tight, followed, wickets, by: [...by.values()].sort((a, b) => b.wickets - a.wickets || b.overs - a.overs) }
}
