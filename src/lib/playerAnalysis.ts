// One player's detailed analysis (batting and bowling), worked out from the
// ball-by-ball score files. Nothing extra is stored: every number comes from
// the balls, the players' profiles (batting hand, bowling style) and the
// ground's pitch type.
import { BOWL_LABELS, type BowlStyle, type PitchType, type ScoreFile, type SideKey, type WicketKind } from '../types'
import { ballsWithOver, phasesOf } from './analysis'
import { inningsMinutes } from './minutes'
import { shotRegion, summarize } from './scorecard'
import { BALLS, BOWLER_WICKETS, bowlerRuns } from './scoring'

export type PhaseKey = 'pp' | 'mid' | 'death' | 'all'
export type StyleKey = BowlStyle | 'unknown'
export type PaceKey = 'pace' | 'spin' | 'unknown'

/** What the analysis needs to know about people and matches, besides the score files. */
export interface PlayerCtx {
  styleOf: (id: string) => BowlStyle | undefined
  leftOf: (id: string) => boolean
  pitchOf: (matchId: string) => PitchType | undefined
  dateOf: (matchId: string) => string
  opponentOf: (matchId: string) => string
}

export const isSpin = (s?: BowlStyle) => s === 'ro' || s === 'rl' || s === 'lo' || s === 'lw'
export const paceOf = (s?: BowlStyle): PaceKey => (!s ? 'unknown' : isSpin(s) ? 'spin' : 'pace')
export const styleLabel = (s: StyleKey) => (s === 'unknown' ? 'Not recorded' : BOWL_LABELS[s])
export const CAUGHT: WicketKind[] = ['caught', 'caught_behind', 'caught_bowled']

// ---------- the raw facts ----------
interface Where {
  matchId: string
  date: string
  opponent: string
  /** 0 = first innings of the match, 1 = second. */
  inn: number
  over: number
  phase: PhaseKey
  pitch?: PitchType
}

/** One ball the player faced (or the ball they were run out on at the other end). */
export interface BatBall extends Where {
  bowler: string
  style: StyleKey
  /** Runs off the bat. */
  bat: number
  /** Counts as a ball faced (not a wide, and they were on strike). */
  faced: boolean
  /** They were out on this ball. */
  out?: WicketKind
  shot?: [number, number]
  /** Where the catch was taken / the throw came from. */
  at?: [number, number]
}

export interface BatInn {
  matchId: string
  date: string
  opponent: string
  inn: number
  position: number
  runs: number
  balls: number
  fours: number
  sixes: number
  notOut: boolean
  out?: { kind: WicketKind; bowler?: string }
  /** Their side won (null: tie, no result or still going). */
  won: boolean | null
  pitch?: PitchType
  /** Their runs after each ball faced. */
  progress: number[]
  /** Time at the crease, ms (only when the innings was scored live). */
  minutes?: number
}

/** One ball the player bowled. */
export interface BowlBall extends Where {
  striker: string
  left: boolean
  /** Batting position of the striker. */
  position: number
  bat: number
  /** Runs against the bowler (bat + wides + no-balls). */
  runs: number
  legal: boolean
  kind: 'legal' | 'wd' | 'nb'
  /** A wicket credited to the bowler. */
  wicket?: WicketKind
  /** Batting position of the batter they got out. */
  victim?: number
  shot?: [number, number]
}

export interface BowlInn {
  matchId: string
  date: string
  opponent: string
  inn: number
  balls: number
  runs: number
  wickets: number
  caught: number
  fours: number
  sixes: number
  wides: number
  noBalls: number
  maidens: number
  won: boolean | null
  pitch?: PitchType
}

export interface Stand {
  partner: string
  runs: number
  balls: number
  mine: number
  theirs: number
  wicket: number
  unbroken: boolean
  matchId: string
  date: string
  opponent: string
}

export interface PlayerData {
  batBalls: BatBall[]
  batInns: BatInn[]
  bowlBalls: BowlBall[]
  bowlInns: BowlInn[]
  stands: Stand[]
  /** Matches played, with the per-match awards won in each. */
  matches: { matchId: string; date: string; potm: boolean; batter: boolean; bowler: boolean }[]
}

const sideOf = (file: ScoreFile, id: string): SideKey | null => (file.home.xi.includes(id) ? 'home' : file.away.xi.includes(id) ? 'away' : null)
const wonFor = (file: ScoreFile, side: SideKey | null): boolean | null => (file.status !== 'finished' || !side || !file.result?.winner ? null : file.result.winner === side)
const byDate = <T extends { date: string }>(a: T, b: T) => b.date.localeCompare(a.date)

/** Everything this player did in these matches, ball by ball and innings by innings (latest first). */
export function playerData(files: ScoreFile[], id: string, ctx: PlayerCtx): PlayerData {
  const d: PlayerData = { batBalls: [], batInns: [], bowlBalls: [], bowlInns: [], stands: [], matches: [] }
  for (const file of files) {
    const side = sideOf(file, id)
    const date = ctx.dateOf(file.matchId)
    if (side) d.matches.push({ matchId: file.matchId, date, potm: file.awards?.potm === id, batter: file.awards?.batter === id, bowler: file.awards?.bowler === id })
    const opponent = ctx.opponentOf(file.matchId)
    const pitch = ctx.pitchOf(file.matchId)
    const won = wonFor(file, side)
    file.innings.forEach((innings, inn) => {
      const s = summarize(file, inn)
      const time = inningsMinutes(innings)
      const order = s.batters.map((b) => b.id)
      const pos = (who: string) => order.indexOf(who) + 1
      const phases = phasesOf(innings.overs, file.powerplay)
      const phaseAt = (over: number): PhaseKey => phases.find((p) => over >= p.from && over <= p.to)?.key ?? phases[phases.length - 1].key
      const progress: number[] = []
      let mine = 0
      let bowled = false

      for (const { b, over } of ballsWithOver(file, inn)) {
        const where: Where = { matchId: file.matchId, date, opponent, inn, over, phase: phaseAt(over), pitch }
        const outHere = b.wicket?.who === id ? b.wicket.kind : undefined
        if (b.striker === id || outHere) {
          const onStrike = b.striker === id
          const faced = onStrike && b.kind !== 'wd'
          d.batBalls.push({ ...where, bowler: b.bowler, style: ctx.styleOf(b.bowler) ?? 'unknown', bat: onStrike ? b.bat : 0, faced, out: outHere, shot: onStrike ? b.shot : undefined, at: outHere ? b.wicket?.at : undefined })
          if (faced) progress.push((mine += b.bat))
        }
        if (b.bowler === id) {
          bowled = true
          const w = b.wicket && BOWLER_WICKETS.includes(b.wicket.kind) ? b.wicket : undefined
          const runs = bowlerRuns(b)
          d.bowlBalls.push({ ...where, striker: b.striker, left: ctx.leftOf(b.striker), position: pos(b.striker), bat: b.bat, runs, legal: b.kind === 'legal', kind: b.kind, wicket: w?.kind, victim: w ? pos(w.who) : undefined, shot: b.shot })
        }
      }

      const line = s.batters.find((b) => b.id === id)
      if (line) {
        d.batInns.push({ matchId: file.matchId, date, opponent, inn, position: pos(id), runs: line.runs, balls: line.balls, fours: line.fours, sixes: line.sixes, notOut: !line.out, out: line.out ? { kind: line.out.kind, bowler: line.out.bowler } : undefined, won, pitch, progress, minutes: time.timed ? time.batters.get(id) : undefined })
        for (const p of s.partnerships) {
          if (p.a !== id && p.b !== id) continue
          const a = p.a === id
          d.stands.push({ partner: a ? p.b : p.a, runs: p.runs, balls: p.balls, mine: a ? p.aRuns : p.bRuns, theirs: a ? p.bRuns : p.aRuns, wicket: p.wicket, unbroken: p.unbroken, matchId: file.matchId, date, opponent })
        }
      }
      const bl = s.bowlers.find((b) => b.id === id)
      if (bl && bowled) {
        const mine = d.bowlBalls.filter((x) => x.matchId === file.matchId && x.inn === inn)
        d.bowlInns.push({
          matchId: file.matchId,
          date,
          opponent,
          inn,
          balls: bl.balls,
          runs: bl.runs,
          wickets: bl.wickets,
          caught: mine.filter((x) => x.wicket && CAUGHT.includes(x.wicket)).length,
          fours: bl.fours,
          sixes: bl.sixes,
          wides: bl.wides,
          noBalls: bl.noBalls,
          maidens: bl.maidens,
          won,
          pitch,
        })
      }
    })
  }
  d.batBalls.sort(byDate)
  d.batInns.sort(byDate)
  d.bowlBalls.sort(byDate)
  d.bowlInns.sort(byDate)
  d.stands.sort((a, b) => b.runs - a.runs || a.balls - b.balls)
  return d
}

/** Only the matches of one year ('all' = everything). */
export function inYear(d: PlayerData, year: string): PlayerData {
  if (year === 'all') return d
  const y = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date.startsWith(year))
  return { ...d, batBalls: y(d.batBalls), batInns: y(d.batInns), bowlBalls: y(d.bowlBalls), bowlInns: y(d.bowlInns), stands: y(d.stands), matches: y(d.matches) }
}

export const awardsOf = (d: PlayerData) => ({ potm: d.matches.filter((m) => m.potm).length, batter: d.matches.filter((m) => m.batter).length, bowler: d.matches.filter((m) => m.bowler).length })

export const yearsOf = (d: PlayerData) => [...new Set([...d.batInns, ...d.bowlInns].map((x) => x.date.slice(0, 4)))].filter(Boolean).sort().reverse()

// ---------- adding up ----------
export interface BatAgg {
  runs: number
  balls: number
  outs: number
  dots: number
  ones: number
  twos: number
  threes: number
  fours: number
  sixes: number
}

export function batAgg(balls: BatBall[]): BatAgg {
  const a: BatAgg = { runs: 0, balls: 0, outs: 0, dots: 0, ones: 0, twos: 0, threes: 0, fours: 0, sixes: 0 }
  for (const b of balls) {
    if (b.out) a.outs++
    if (!b.faced) continue
    a.balls++
    a.runs += b.bat
    if (b.bat === 0) a.dots++
    else if (b.bat === 1) a.ones++
    else if (b.bat === 2) a.twos++
    else if (b.bat === 3) a.threes++
    else if (b.bat === 4) a.fours++
    else if (b.bat === 6) a.sixes++
  }
  return a
}

export const sr = (runs: number, balls: number) => (balls > 0 ? (runs * 100) / balls : null)
export const avg = (runs: number, outs: number) => (outs > 0 ? runs / outs : null)
export const econ = (runs: number, balls: number) => (balls > 0 ? (runs * BALLS) / balls : null)
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0)
export const fmt = (n: number | null, d = 2) => (n === null || !Number.isFinite(n) ? '–' : n.toFixed(d))

export function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const x of xs) {
    const k = key(x)
    const list = m.get(k)
    if (list) list.push(x)
    else m.set(k, [x])
  }
  return m
}

// ---------- batting ----------
export interface InnsRow {
  inns: number
  runs: number
  balls: number
  notOuts: number
  outs: number
  best: number
  bestNotOut: boolean
}

export function innsRow(inns: BatInn[]): InnsRow {
  const r: InnsRow = { inns: inns.length, runs: 0, balls: 0, notOuts: 0, outs: 0, best: 0, bestNotOut: false }
  for (const i of inns) {
    r.runs += i.runs
    r.balls += i.balls
    if (i.notOut) r.notOuts++
    else r.outs++
    if (i.runs > r.best || (i.runs === r.best && i.notOut)) {
      r.best = i.runs
      r.bestNotOut = i.notOut
    }
  }
  return r
}

/** Their average score after each ball faced (1, 2, 3 …), over the innings that lasted that long. */
export function progression(inns: BatInn[], minInns = 2): number[] {
  const out: number[] = []
  const need = Math.min(minInns, inns.length)
  for (let n = 0; ; n++) {
    const reached = inns.filter((i) => i.progress.length > n)
    if (reached.length === 0 || reached.length < need) break
    out.push(reached.reduce((s, i) => s + i.progress[n], 0) / reached.length)
  }
  return out
}

/** Strike rate over the first `n` balls of each innings, and over the balls after that. */
export function startAndAfter(inns: BatInn[], n = 15): { start: number | null; after: number | null } {
  let r1 = 0
  let b1 = 0
  let r2 = 0
  let b2 = 0
  for (const i of inns) {
    i.progress.forEach((runs, k) => {
      const ball = runs - (k > 0 ? i.progress[k - 1] : 0)
      if (k < n) (r1 += ball, b1++)
      else (r2 += ball, b2++)
    })
  }
  return { start: sr(r1, b1), after: sr(r2, b2) }
}

/** How often their side won when a condition held (null: no decided match like that). */
export function winPct<T extends { won: boolean | null }>(xs: T[], when: (x: T) => boolean): { pct: number; of: number } | null {
  const decided = xs.filter((x) => when(x) && x.won !== null)
  return decided.length ? { pct: pct(decided.filter((x) => x.won).length, decided.length), of: decided.length } : null
}

/** The fielding position that sees most of their runs — where to put the best fielder. */
export function busiestRegion(balls: { shot?: [number, number]; bat: number }[], left: boolean): { region: string; runs: number; share: number } | null {
  const m = new Map<string, number>()
  let total = 0
  for (const b of balls) {
    if (!b.shot || b.bat <= 0) continue
    const r = shotRegion(b.shot, left)
    m.set(r, (m.get(r) ?? 0) + b.bat)
    total += b.bat
  }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? { region: top[0], runs: top[1], share: pct(top[1], total) } : null
}

/** The key with the biggest value of `score` among groups with at least `min` items. */
export function topBy<K, T>(groups: Map<K, T[]>, score: (xs: T[]) => number | null, min = 1, lowest = false): { key: K; value: number } | null {
  let best: { key: K; value: number } | null = null
  for (const [k, xs] of groups) {
    if (xs.length < min) continue
    const v = score(xs)
    if (v === null) continue
    if (!best || (lowest ? v < best.value : v > best.value)) best = { key: k, value: v }
  }
  return best
}

// ---------- bowling ----------
export interface BowlAgg {
  balls: number
  runs: number
  wickets: number
  dots: number
  ones: number
  twos: number
  threes: number
  fours: number
  sixes: number
  wides: number
  noBalls: number
}

export function bowlAgg(balls: BowlBall[]): BowlAgg {
  const a: BowlAgg = { balls: 0, runs: 0, wickets: 0, dots: 0, ones: 0, twos: 0, threes: 0, fours: 0, sixes: 0, wides: 0, noBalls: 0 }
  for (const b of balls) {
    a.runs += b.runs
    if (b.wicket) a.wickets++
    if (b.kind === 'wd') a.wides++
    if (b.kind === 'nb') a.noBalls++
    if (b.legal) a.balls++
    if (b.kind === 'wd') continue
    if (b.bat === 0 && b.legal && b.runs === 0) a.dots++
    else if (b.bat === 1) a.ones++
    else if (b.bat === 2) a.twos++
    else if (b.bat === 3) a.threes++
    else if (b.bat === 4) a.fours++
    else if (b.bat === 6) a.sixes++
  }
  return a
}

/** For each over of the innings (1, 2, 3 …): how many times they bowled it, the runs and the wickets. */
export function byOverOfInnings(balls: BowlBall[]): { over: number; overs: number; runs: number; wickets: number; balls: number }[] {
  const max = Math.max(0, ...balls.map((b) => b.over))
  const rows = Array.from({ length: max }, (_, i) => ({ over: i + 1, overs: 0, runs: 0, wickets: 0, balls: 0, seen: new Set<string>() }))
  for (const b of balls) {
    const r = rows[b.over - 1]
    r.seen.add(`${b.matchId}:${b.inn}`)
    r.runs += b.runs
    if (b.legal) r.balls++
    if (b.wicket) r.wickets++
  }
  return rows.map(({ seen, ...r }) => ({ ...r, overs: seen.size }))
}

/** 0, 1, 2, 3, 4 and 5+ wickets: in how many innings. */
export function wicketsSpread(inns: BowlInn[]): number[] {
  const out = [0, 0, 0, 0, 0, 0]
  for (const i of inns) out[Math.min(5, i.wickets)]++
  return out
}
