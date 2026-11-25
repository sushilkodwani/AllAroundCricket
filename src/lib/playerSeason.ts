// The player "Insights" extras: how steady a player is, what kind of player the numbers say they
// are, and a one-card summary of their season. Worked out from PlayerData — nothing extra is stored.
import { awardsOf, batAgg, bowlAgg, type PlayerData } from './playerAnalysis'
import type { RankRow } from './playerInsights'
import { BALLS } from './scoring'

// ---------- consistency and conversion ----------
export const START_RUNS = 15
export const KICK_ON_RUNS = 30
export const MIN_INNINGS = 4

export type SteadyLabel = 'Steady' | 'Mixed' | 'Boom or bust'

export interface BatConsistency {
  innings: number
  mean: number
  median: number
  best: number
  worst: number
  ducks: number
  /** Innings of START_RUNS or more, and how many of those went on to KICK_ON_RUNS. */
  starts: number
  kickedOn: number
  /** Spread of scores relative to the mean (standard deviation / mean). */
  spread: number
  /** Null with fewer than MIN_INNINGS innings. */
  label: SteadyLabel | null
}

export interface BowlConsistency {
  innings: number
  /** Innings with at least one wicket, and innings that went for 10 or more an over. */
  withWicket: number
  expensive: number
}

export interface Consistency {
  bat: BatConsistency | null
  bowl: BowlConsistency | null
}

export const steadyLabel = (spread: number): SteadyLabel => (spread < 0.8 ? 'Steady' : spread < 1.3 ? 'Mixed' : 'Boom or bust')

export function consistencyOf(d: PlayerData): Consistency {
  let bat: BatConsistency | null = null
  if (d.batInns.length > 0) {
    const runs = d.batInns.map((i) => i.runs)
    const n = runs.length
    const mean = runs.reduce((s, r) => s + r, 0) / n
    const sorted = [...runs].sort((a, b) => a - b)
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    const sd = Math.sqrt(runs.reduce((s, r) => s + (r - mean) ** 2, 0) / n)
    const spread = mean > 0 ? sd / mean : 0
    const starts = runs.filter((r) => r >= START_RUNS).length
    bat = {
      innings: n,
      mean,
      median,
      best: sorted[n - 1],
      worst: sorted[0],
      ducks: d.batInns.filter((i) => i.runs === 0 && !i.notOut).length,
      starts,
      kickedOn: runs.filter((r) => r >= KICK_ON_RUNS).length,
      spread,
      label: n >= MIN_INNINGS && mean > 0 ? steadyLabel(spread) : null,
    }
  }
  const spells = d.bowlInns.filter((b) => b.balls >= BALLS)
  const bowl: BowlConsistency | null = spells.length ? { innings: spells.length, withWicket: spells.filter((b) => b.wickets > 0).length, expensive: spells.filter((b) => (b.runs * BALLS) / b.balls >= 10).length } : null
  return { bat, bowl }
}

// ---------- what kind of player ----------
export interface Archetype {
  key: string
  emoji: string
  label: string
  /** The numbers behind it, one line. */
  why: string
}

/** What the rules need, gathered from a player's data and their rank among team-mates. */
export interface Profile {
  bat: null | {
    balls: number
    innings: number
    /** Mean batting position (1 = opener). */
    position: number
    /** Share of balls faced in the death overs, and how many. */
    deathShare: number
    deathBalls: number
    sr: number
    teamSr: number | null
    boundary: number
    teamBoundary: number | null
    runsRank: number | null
    runsOf: number
  }
  bowl: null | {
    balls: number
    wickets: number
    econ: number
    teamEcon: number | null
    wicketsRank: number | null
    wicketsOf: number
    deathShare: number
    deathBalls: number
  }
}

export const MIN_BAT_BALLS = 30
export const MIN_BOWL_BALLS = 18

const r0 = (n: number) => Math.round(n)

export function archetypesFor(p: Profile): Archetype[] {
  const out: Archetype[] = []
  const b = p.bat && p.bat.balls >= MIN_BAT_BALLS && p.bat.innings >= 3 ? p.bat : null
  const w = p.bowl && p.bowl.balls >= MIN_BOWL_BALLS ? p.bowl : null
  if (b) {
    const faster = b.teamSr !== null && b.sr >= b.teamSr * 1.15 && b.teamBoundary !== null && b.boundary >= b.teamBoundary
    const perInns = b.balls / b.innings
    if (b.deathBalls >= 12 && b.deathShare >= 0.3) out.push({ key: 'finisher', emoji: '🏁', label: 'Finisher', why: `${r0(b.deathShare * 100)}% of your balls are faced in the death overs.` })
    else if (b.position <= 2.5) out.push({ key: 'opener', emoji: '🚦', label: 'Opener', why: `You bat at ${b.position.toFixed(1)} on average, facing ${r0(perInns)} balls an innings.` })
    else if (faster) out.push({ key: 'hitter', emoji: '🚀', label: 'Power hitter', why: `Strike rate ${r0(b.sr)} against a team average of ${r0(b.teamSr!)}, and more boundary balls than most.` })
    else if (perInns >= 15 && (b.teamSr === null || b.sr <= b.teamSr * 1.05)) out.push({ key: 'anchor', emoji: '⚓', label: 'Anchor', why: `You face ${r0(perInns)} balls an innings at a steady strike rate of ${r0(b.sr)}.` })
    else out.push({ key: 'steady', emoji: '🏏', label: 'Steady bat', why: `Strike rate ${r0(b.sr)}, ${r0(perInns)} balls an innings.` })
  }
  if (w) {
    const top = w.wicketsRank !== null && w.wicketsOf >= 3 && w.wicketsRank <= Math.ceil(w.wicketsOf / 3)
    if (w.wickets >= 3 && top) out.push({ key: 'strike', emoji: '🎯', label: 'Strike bowler', why: `${w.wickets} wickets, ${w.wicketsRank === 1 ? 'the most' : `${w.wicketsRank}${w.wicketsRank === 2 ? 'nd' : 'rd'} most`} in the team.` })
    else if (w.teamEcon !== null && w.econ <= w.teamEcon * 0.85) out.push({ key: 'miser', emoji: '🔒', label: 'Miser', why: `Economy ${w.econ.toFixed(1)} against a team average of ${w.teamEcon.toFixed(1)}.` })
    else if (w.deathBalls >= 12 && w.deathShare >= 0.4) out.push({ key: 'death', emoji: '🔥', label: 'Death bowler', why: `${r0(w.deathShare * 100)}% of your balls come in the death overs.` })
  }
  if (b && w && b.runsRank !== null && w.wicketsRank !== null && b.runsRank <= Math.ceil(b.runsOf / 2) && w.wicketsRank <= Math.ceil(w.wicketsOf / 2)) {
    out.unshift({ key: 'allround', emoji: '⭐', label: 'All-rounder', why: 'In the top half of the team for both runs and wickets.' })
  }
  return out
}

const row = (rows: RankRow[], key: string) => rows.find((r) => r.key === key)

/** Gathers the rule inputs from a player's data and their team ranks (see teamRanks). */
export function profileOf(d: PlayerData, ranks: { bat: RankRow[]; bowl: RankRow[] }): Profile {
  const a = batAgg(d.batBalls)
  const w = bowlAgg(d.bowlBalls)
  const deathBat = d.batBalls.filter((x) => x.faced && x.phase === 'death').length
  const deathBowl = d.bowlBalls.filter((x) => x.legal && x.phase === 'death').length
  const sr = row(ranks.bat, 'sr')
  const bound = row(ranks.bat, 'bound')
  const runs = row(ranks.bat, 'runs')
  const wk = row(ranks.bowl, 'wkts')
  const eco = row(ranks.bowl, 'econ')
  return {
    bat: a.balls > 0 ? { balls: a.balls, innings: d.batInns.length, position: d.batInns.reduce((s, i) => s + i.position, 0) / Math.max(1, d.batInns.length), deathShare: deathBat / a.balls, deathBalls: deathBat, sr: (a.runs * 100) / a.balls, teamSr: sr?.team ?? null, boundary: ((a.fours + a.sixes) * 100) / a.balls, teamBoundary: bound?.team ?? null, runsRank: runs?.rank ?? null, runsOf: runs?.of ?? 0 } : null,
    bowl: w.balls > 0 ? { balls: w.balls, wickets: w.wickets, econ: (w.runs * BALLS) / w.balls, teamEcon: eco?.team ?? null, wicketsRank: wk?.rank ?? null, wicketsOf: wk?.of ?? 0, deathShare: deathBowl / w.balls, deathBalls: deathBowl } : null,
  }
}

// ---------- the season card ----------
export interface Wrapped {
  /** "2026 season", or "All matches" when the data spans years. */
  label: string
  matches: number
  wins: number
  bat: null | { innings: number; runs: number; balls: number; fours: number; sixes: number; best: { runs: number; notOut: boolean; opponent: string } }
  bowl: null | { wickets: number; balls: number; runs: number; best: { wickets: number; runs: number; opponent: string } }
  catches: number
  potm: number
  badges: number
  archetype: string | null
}

export function wrappedOf(d: PlayerData, badges: number, archetypes: Archetype[]): Wrapped {
  const years = [...new Set([...d.batInns, ...d.bowlInns, ...d.matches].map((x) => x.date.slice(0, 4)).filter(Boolean))]
  const a = batAgg(d.batBalls)
  const w = bowlAgg(d.bowlBalls)
  const bestBat = [...d.batInns].sort((x, y) => y.runs - x.runs || x.balls - y.balls)[0]
  const bestBowl = [...d.bowlInns].sort((x, y) => y.wickets - x.wickets || x.runs - y.runs)[0]
  const won = new Set<string>()
  for (const i of [...d.batInns, ...d.bowlInns]) if (i.won) won.add(i.matchId)
  return {
    label: years.length === 1 ? `${years[0]} season` : 'All matches',
    matches: d.matches.length,
    wins: won.size,
    bat: bestBat ? { innings: d.batInns.length, runs: a.runs, balls: a.balls, fours: a.fours, sixes: a.sixes, best: { runs: bestBat.runs, notOut: bestBat.notOut, opponent: bestBat.opponent } } : null,
    bowl: bestBowl ? { wickets: w.wickets, balls: w.balls, runs: w.runs, best: { wickets: bestBowl.wickets, runs: bestBowl.runs, opponent: bestBowl.opponent } } : null,
    catches: d.catches.length,
    potm: awardsOf(d).potm,
    badges,
    archetype: archetypes[0]?.label ?? null,
  }
}
