// Numbers across many scored matches: batting first against chasing, the toss,
// opponents, grounds, best stands for each wicket, and a player's phase profile.
// Worked out from the score files — nothing extra is stored.
import type { Match, ScoreFile, SideKey } from '../types'
import type { Career } from './career'
import { ballsWithOver, phasesOf } from './analysis'
import { summarize } from './scorecard'
import { BALLS, BOWLER_WICKETS, bowlerRuns, inningsTotal, other } from './scoring'

const done = (f: ScoreFile) => f.status === 'finished' && f.innings.length === 2
const wonBy = (f: ScoreFile, side: SideKey) => f.result?.winner === side
const avg = (n: number, d: number) => (d > 0 ? n / d : null)

// ---------- batting first, chasing and the toss ----------
export interface Split {
  played: number
  won: number
  /** Average runs this side scored in these games. */
  avgRuns: number | null
}
export interface FirstVsChase {
  battingFirst: Split
  chasing: Split
  tossWon: { played: number; won: number }
  tossLost: { played: number; won: number }
}

export function firstVsChase(files: ScoreFile[], side: SideKey): FirstVsChase {
  const out: FirstVsChase = {
    battingFirst: { played: 0, won: 0, avgRuns: null },
    chasing: { played: 0, won: 0, avgRuns: null },
    tossWon: { played: 0, won: 0 },
    tossLost: { played: 0, won: 0 },
  }
  const runs = { first: 0, chase: 0 }
  for (const f of files.filter(done)) {
    const first = f.innings[0].batting === side
    const mine = first ? out.battingFirst : out.chasing
    mine.played++
    if (wonBy(f, side)) mine.won++
    runs[first ? 'first' : 'chase'] += inningsTotal(f, first ? 0 : 1)
    const toss = f.toss.wonBy === side ? out.tossWon : out.tossLost
    toss.played++
    if (wonBy(f, side)) toss.won++
  }
  out.battingFirst.avgRuns = avg(runs.first, out.battingFirst.played)
  out.chasing.avgRuns = avg(runs.chase, out.chasing.played)
  return out
}

// ---------- by opponent ----------
export interface OpponentRecord {
  name: string
  played: number
  won: number
  lost: number
  tied: number
  avgFor: number | null
  avgAgainst: number | null
}

/** Our record against each team we have played (finished, scored matches only). */
export function byOpponent(files: ScoreFile[], side: SideKey): OpponentRecord[] {
  const m = new Map<string, OpponentRecord & { f: number; a: number }>()
  for (const f of files.filter(done)) {
    const name = f[other(side)].name
    let r = m.get(name)
    if (!r) m.set(name, (r = { name, played: 0, won: 0, lost: 0, tied: 0, avgFor: null, avgAgainst: null, f: 0, a: 0 }))
    r.played++
    if (wonBy(f, side)) r.won++
    else if (wonBy(f, other(side))) r.lost++
    else r.tied++
    f.innings.forEach((inn, i) => {
      if (inn.batting === side) r.f += inningsTotal(f, i)
      else r.a += inningsTotal(f, i)
    })
  }
  return [...m.values()]
    .map(({ f, a, ...r }) => ({ ...r, avgFor: avg(f, r.played), avgAgainst: avg(a, r.played) }))
    .sort((x, y) => y.played - x.played || x.name.localeCompare(y.name))
}

// ---------- by ground ----------
export interface GroundRecord {
  venue: string
  played: number
  /** Average score of the side that batted first. */
  avgFirst: number | null
  /** How often the side batting first won, 0–100. */
  batFirstWinPct: number | null
}

export function byGround(files: ScoreFile[], matches: Match[]): GroundRecord[] {
  const venue = new Map(matches.map((m) => [m.id, m.venue?.trim()]))
  const g = new Map<string, { played: number; first: number; firstWins: number; decided: number }>()
  for (const f of files.filter(done)) {
    const v = venue.get(f.matchId)
    if (!v) continue
    let x = g.get(v)
    if (!x) g.set(v, (x = { played: 0, first: 0, firstWins: 0, decided: 0 }))
    x.played++
    x.first += inningsTotal(f, 0)
    if (f.result?.winner) {
      x.decided++
      if (f.result.winner === f.innings[0].batting) x.firstWins++
    }
  }
  return [...g.entries()]
    .map(([venue, x]) => ({ venue, played: x.played, avgFirst: avg(x.first, x.played), batFirstWinPct: x.decided > 0 ? Math.round((x.firstWins * 100) / x.decided) : null }))
    .sort((a, b) => b.played - a.played || a.venue.localeCompare(b.venue))
}

// ---------- best stand for each wicket ----------
export interface BestStand {
  wicket: number
  runs: number
  balls: number
  a: string
  b: string
  matchId: string
  teamId: string
}

export function bestStands(files: ScoreFile[], side: SideKey): BestStand[] {
  const best = new Map<number, BestStand>()
  for (const f of files) {
    f.innings.forEach((inn, idx) => {
      if (inn.batting !== side) return
      for (const p of summarize(f, idx).partnerships) {
        const cur = best.get(p.wicket)
        if (p.runs > 0 && (!cur || p.runs > cur.runs || (p.runs === cur.runs && p.balls < cur.balls))) {
          best.set(p.wicket, { wicket: p.wicket, runs: p.runs, balls: p.balls, a: p.a, b: p.b, matchId: f.matchId, teamId: f.teamId })
        }
      }
    })
  }
  return [...best.values()].sort((a, b) => a.wicket - b.wicket)
}

// ---------- best strike rates and economies ----------
export interface RateRow {
  id: string
  value: number
  /** Balls behind the number. */
  balls: number
}

/** Best strike rates among batters who faced at least `minBalls`. */
export function bestStrikeRates(careers: Career[], minBalls = 30, count = 5): RateRow[] {
  return careers
    .filter((c) => c.bat.balls >= minBalls)
    .map((c) => ({ id: c.id, value: (c.bat.runs * 100) / c.bat.balls, balls: c.bat.balls }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count)
}

/** Best economies among bowlers who bowled at least `minBalls` (12 = two overs). */
export function bestEconomies(careers: Career[], minBalls = 12, count = 5): RateRow[] {
  return careers
    .filter((c) => c.bowl.balls >= minBalls)
    .map((c) => ({ id: c.id, value: (c.bowl.runs * BALLS) / c.bowl.balls, balls: c.bowl.balls }))
    .sort((a, b) => a.value - b.value)
    .slice(0, count)
}

// ---------- one player's phases across matches ----------
export interface PhaseProfile {
  key: 'pp' | 'mid' | 'death' | 'all'
  label: string
  bat: { runs: number; balls: number; outs: number }
  bowl: { runs: number; balls: number; wickets: number }
}

const PROFILE = [
  { key: 'pp', label: 'Powerplay' },
  { key: 'mid', label: 'Middle' },
  { key: 'death', label: 'Death' },
] as const

/** Batting strike rate and bowling economy in the powerplay, middle and death overs, over the given matches. */
export function phaseProfile(files: ScoreFile[], personId: string): PhaseProfile[] {
  const rows: PhaseProfile[] = PROFILE.map((p) => ({ ...p, bat: { runs: 0, balls: 0, outs: 0 }, bowl: { runs: 0, balls: 0, wickets: 0 } }))
  for (const f of files) {
    f.innings.forEach((inn, idx) => {
      const phases = phasesOf(inn.overs, f.powerplay)
      if (phases[0].key === 'all') return // too short to split
      for (const { b, over } of ballsWithOver(f, idx)) {
        const k = phases.find((p) => over >= p.from && over <= p.to)?.key ?? 'death'
        const row = rows.find((r) => r.key === k)!
        if (b.striker === personId && b.kind !== 'wd') {
          row.bat.balls++
          row.bat.runs += b.bat
          if (b.wicket?.who === personId) row.bat.outs++
        }
        if (b.bowler === personId) {
          row.bowl.runs += bowlerRuns(b)
          if (b.kind === 'legal') row.bowl.balls++
          if (b.wicket && BOWLER_WICKETS.includes(b.wicket.kind)) row.bowl.wickets++
        }
      }
    })
  }
  return rows
}

/** Each value averaged with the ones just before it (up to `window` in all), so a trend shows through ups and downs. */
export function rollingAverage(values: number[], window = 3): number[] {
  return values.map((_, i) => {
    const part = values.slice(Math.max(0, i - window + 1), i + 1)
    return part.reduce((s, n) => s + n, 0) / part.length
  })
}
