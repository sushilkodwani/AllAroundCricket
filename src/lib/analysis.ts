// The numbers behind the Analysis and Detailed analysis tabs: innings phases,
// bowling spells, each batter's innings ball by ball, the chase, and fielding.
// All worked out from the ball-by-ball log — nothing extra is stored.
import type { BallEvent, ScoreFile } from '../types'
import { parScore, winChance } from './insights'
import { BATTER_POS, shotRegion, summarize } from './scorecard'
import { BALLS, BOWLER_WICKETS, ballRuns, bowlerRuns, isBall } from './scoring'

const pct = (n: number, d: number) => (d > 0 ? Math.round((n * 100) / d) : 0)
const rate = (runs: number, balls: number) => (balls > 0 ? (runs * BALLS) / balls : null)

// ---------- phases ----------
export interface Phase {
  key: 'pp' | 'mid' | 'death' | 'all'
  label: string
  /** 1-based, inclusive. */
  from: number
  to: number
}

/** Powerplay / middle / death for the overs of an innings (6 / 9 / 5 in a 20-over game, scaled for shorter ones). */
export function phasesOf(overs: number): Phase[] {
  if (overs < 3) return [{ key: 'all', label: 'Innings', from: 1, to: Math.max(1, overs) }]
  const pp = Math.max(1, Math.round(overs * 0.3))
  const death = Math.max(1, Math.round(overs * 0.25))
  const midTo = overs - death
  return [
    { key: 'pp', label: 'Powerplay', from: 1, to: pp },
    { key: 'mid', label: 'Middle', from: pp + 1, to: midTo },
    { key: 'death', label: 'Death', from: midTo + 1, to: overs },
  ]
}

export const phaseRange = (p: Phase) => (p.from === p.to ? `over ${p.from}` : `overs ${p.from}–${p.to}`)

/** Every ball of an innings with the over it belongs to (1-based). */
export function ballsWithOver(file: ScoreFile, idx: number): { b: BallEvent; over: number }[] {
  let legal = 0
  const out: { b: BallEvent; over: number }[] = []
  for (const e of file.innings[idx].events) {
    if (!isBall(e)) continue
    out.push({ b: e, over: Math.floor(legal / BALLS) + 1 })
    if (e.kind === 'legal') legal++
  }
  return out
}

const phaseAt = (phases: Phase[], over: number) => phases.find((p) => over >= p.from && over <= p.to) ?? phases[phases.length - 1]

export interface PhaseLine {
  phase: Phase
  runs: number
  wickets: number
  /** Legal balls bowled in the phase. */
  balls: number
  dots: number
  boundaries: number
  runRate: number | null
  dotPct: number
  boundaryPct: number
}

export function phaseStats(file: ScoreFile, idx: number): PhaseLine[] {
  const phases = phasesOf(file.innings[idx].overs)
  const lines: PhaseLine[] = phases.map((phase) => ({ phase, runs: 0, wickets: 0, balls: 0, dots: 0, boundaries: 0, runRate: null, dotPct: 0, boundaryPct: 0 }))
  for (const { b, over } of ballsWithOver(file, idx)) {
    const l = lines[phases.indexOf(phaseAt(phases, over))]
    l.runs += ballRuns(b)
    if (b.wicket) l.wickets++
    if (b.kind === 'legal') {
      l.balls++
      if (ballRuns(b) === 0) l.dots++
    }
    if (b.kind !== 'wd' && (b.bat === 4 || b.bat === 6)) l.boundaries++
  }
  for (const l of lines) {
    l.runRate = rate(l.runs, l.balls)
    l.dotPct = pct(l.dots, l.balls)
    l.boundaryPct = pct(l.boundaries, l.balls)
  }
  return lines
}

// ---------- bowling spells ----------
export interface SpellOver {
  over: number
  runs: number
  wickets: number
}
export interface Spell {
  id: string
  balls: number
  runs: number
  wickets: number
  dots: number
  maidens: number
  /** Dot balls as a share of balls bowled, 0–100. */
  dotPct: number
  economy: number | null
  /** One entry per over the bowler bowled in, in order. */
  overs: SpellOver[]
}

export function spellsOf(file: ScoreFile, idx: number): Spell[] {
  const byBowler = new Map<string, Spell>()
  for (const { b, over } of ballsWithOver(file, idx)) {
    let s = byBowler.get(b.bowler)
    if (!s) byBowler.set(b.bowler, (s = { id: b.bowler, balls: 0, runs: 0, wickets: 0, dots: 0, maidens: 0, dotPct: 0, economy: null, overs: [] }))
    let o = s.overs.find((x) => x.over === over)
    if (!o) s.overs.push((o = { over, runs: 0, wickets: 0 }))
    const r = bowlerRuns(b)
    s.runs += r
    o.runs += r
    if (b.kind === 'legal') {
      s.balls++
      if (r === 0) s.dots++
    }
    if (b.wicket && BOWLER_WICKETS.includes(b.wicket.kind)) {
      s.wickets++
      o.wickets++
    }
  }
  // Maidens come from the scorecard so they count the same everywhere.
  const bowlLines = new Map(summarize(file, idx).bowlers.map((l) => [l.id, l]))
  for (const s of byBowler.values()) {
    s.maidens = bowlLines.get(s.id)?.maidens ?? 0
    s.dotPct = pct(s.dots, s.balls)
    s.economy = rate(s.runs, s.balls)
  }
  return [...byBowler.values()]
}

// ---------- batters, ball by ball ----------
export interface BatterInnings {
  id: string
  runs: number
  balls: number
  /** Every ball faced, in order (wides are not faced). */
  faced: BallEvent[]
  dotPct: number
  boundaryPct: number
  /** Runs and balls in each phase, same order as phasesOf. */
  byPhase: { phase: Phase; runs: number; balls: number }[]
  out: boolean
}

export function battersOf(file: ScoreFile, idx: number): BatterInnings[] {
  const phases = phasesOf(file.innings[idx].overs)
  const out = new Map<string, BatterInnings>()
  const order = summarize(file, idx).batters
  for (const l of order) {
    out.set(l.id, { id: l.id, runs: 0, balls: 0, faced: [], dotPct: 0, boundaryPct: 0, byPhase: phases.map((phase) => ({ phase, runs: 0, balls: 0 })), out: !!l.out })
  }
  for (const { b, over } of ballsWithOver(file, idx)) {
    if (b.kind === 'wd') continue
    const bi = out.get(b.striker)
    if (!bi) continue
    bi.faced.push(b)
    bi.balls++
    bi.runs += b.bat
    const ph = bi.byPhase[phases.indexOf(phaseAt(phases, over))]
    ph.balls++
    ph.runs += b.bat
  }
  for (const bi of out.values()) {
    bi.dotPct = pct(bi.faced.filter((b) => b.bat === 0 && b.byes === 0).length, bi.balls)
    bi.boundaryPct = pct(bi.faced.filter((b) => b.bat === 4 || b.bat === 6).length, bi.balls)
  }
  return [...out.values()].filter((b) => b.balls > 0)
}

// ---------- the chase ----------
export interface ChasePoint {
  over: number
  /** Runs per over so far. */
  current: number
  /** Runs per over still needed from here; 0 once the target is passed. */
  required: number
}

/** After each over of the second innings: the rate scored so far against the rate still needed. */
export function chaseOf(file: ScoreFile): ChasePoint[] {
  const inn = file.innings[1]
  if (!inn || inn.target === undefined) return []
  let total = 0
  let legal = 0
  let over = 0
  const points: ChasePoint[] = []
  const close = () => {
    const left = inn.overs * BALLS - legal
    const need = inn.target! - total
    points.push({ over, current: (total * BALLS) / Math.max(1, legal), required: need > 0 && left > 0 ? (need * BALLS) / left : 0 })
  }
  for (const { b, over: o } of ballsWithOver(file, 1)) {
    if (o !== over && over > 0) close()
    over = o
    total += ballRuns(b)
    if (b.kind === 'legal') legal++
  }
  if (over > 0) close()
  return points
}

// ---------- fielding ----------
export interface FieldingLine {
  id: string
  catches: number
  runOuts: number
  stumpings: number
}

/** Who took the catches, ran batters out and stumped them in an innings (the fielding side's work). */
export function fieldingOf(file: ScoreFile, idx: number): FieldingLine[] {
  const m = new Map<string, FieldingLine>()
  const get = (id: string) => {
    let l = m.get(id)
    if (!l) m.set(id, (l = { id, catches: 0, runOuts: 0, stumpings: 0 }))
    return l
  }
  for (const e of file.innings[idx].events.filter(isBall)) {
    const w = e.wicket
    if (!w) continue
    if (w.kind === 'caught_bowled') get(e.bowler).catches++
    else if (w.fielder && (w.kind === 'caught' || w.kind === 'caught_behind')) get(w.fielder).catches++
    else if (w.fielder && w.kind === 'stumped') get(w.fielder).stumpings++
    else if (w.fielder && w.kind === 'run_out') get(w.fielder).runOuts++
  }
  return [...m.values()].sort((a, b) => b.catches + b.runOuts + b.stumpings - (a.catches + a.runOuts + a.stumpings))
}

// ---------- the innings in one line ----------
export interface InningsKpis {
  dotPct: number
  boundaryPct: number
  /** Runs from fours and sixes as a share of the total. */
  boundaryRunsPct: number
  /** Most runs in one over, and which over. */
  bestOver: { over: number; runs: number } | null
}

export function kpisOf(file: ScoreFile, idx: number): InningsKpis {
  const balls = ballsWithOver(file, idx)
  const legal = balls.filter((x) => x.b.kind === 'legal')
  const dots = legal.filter((x) => ballRuns(x.b) === 0).length
  const fours = balls.filter((x) => x.b.kind !== 'wd' && x.b.bat === 4).length
  const sixes = balls.filter((x) => x.b.kind !== 'wd' && x.b.bat === 6).length
  const total = balls.reduce((s, x) => s + ballRuns(x.b), 0)
  const perOver = new Map<number, number>()
  for (const x of balls) perOver.set(x.over, (perOver.get(x.over) ?? 0) + ballRuns(x.b))
  let best: InningsKpis['bestOver'] = null
  for (const [over, runs] of perOver) if (!best || runs > best.runs) best = { over, runs }
  return { dotPct: pct(dots, legal.length), boundaryPct: pct(fours + sixes, legal.length), boundaryRunsPct: pct(fours * 4 + sixes * 6, total), bestOver: best }
}

// ---------- batter against bowler ----------
export interface Matchup {
  batter: string
  bowler: string
  runs: number
  balls: number
  /** Times this bowler got this batter out. */
  outs: number
}

/** Every batter/bowler pairing in an innings. Runs and balls count only what the batter faced (wides are not faced). */
export function matchupsOf(file: ScoreFile, idx: number): Matchup[] {
  const m = new Map<string, Matchup>()
  for (const { b } of ballsWithOver(file, idx)) {
    const key = `${b.striker}|${b.bowler}`
    let x = m.get(key)
    if (!x) m.set(key, (x = { batter: b.striker, bowler: b.bowler, runs: 0, balls: 0, outs: 0 }))
    if (b.kind !== 'wd') {
      x.balls++
      x.runs += b.bat
    }
    if (b.wicket && b.wicket.who === b.striker && BOWLER_WICKETS.includes(b.wicket.kind)) x.outs++
  }
  return [...m.values()]
}

// ---------- momentum ----------
export interface MomentumPoint {
  over: number
  /** Average runs per over across this and the last two overs. */
  rolling: number
  /** Legal balls since the last four or six, at the end of the over. */
  sinceBoundary: number
}

export function momentumOf(file: ScoreFile, idx: number): MomentumPoint[] {
  const perOver: number[] = []
  const since: number[] = []
  let legal = 0
  let sinceB = 0
  let current = 0
  for (const { b, over } of ballsWithOver(file, idx)) {
    if (over !== current) {
      if (current > 0) since.push(sinceB)
      current = over
    }
    perOver[over - 1] = (perOver[over - 1] ?? 0) + ballRuns(b)
    if (b.kind === 'legal') {
      legal++
      sinceB++
    }
    if (b.kind !== 'wd' && (b.bat === 4 || b.bat === 6)) sinceB = 0
  }
  if (current > 0) since.push(sinceB)
  void legal
  return perOver.map((_, i) => {
    const win = perOver.slice(Math.max(0, i - 2), i + 1)
    return { over: i + 1, rolling: win.reduce((s, n) => s + (n ?? 0), 0) / win.length, sinceBoundary: since[i] ?? 0 }
  })
}

// ---------- left-handers and right-handers ----------
export interface HandLine {
  balls: number
  runs: number
  wickets: number
}
export interface HandSplit {
  id: string
  left: HandLine
  right: HandLine
}

/** How each bowler fared against left-handed and right-handed batters. */
export function handSplitOf(file: ScoreFile, idx: number, lefties: Set<string>): HandSplit[] {
  const m = new Map<string, HandSplit>()
  const blank = (): HandLine => ({ balls: 0, runs: 0, wickets: 0 })
  for (const { b } of ballsWithOver(file, idx)) {
    let x = m.get(b.bowler)
    if (!x) m.set(b.bowler, (x = { id: b.bowler, left: blank(), right: blank() }))
    const l = lefties.has(b.striker) ? x.left : x.right
    l.runs += bowlerRuns(b)
    if (b.kind === 'legal') l.balls++
    if (b.wicket && BOWLER_WICKETS.includes(b.wicket.kind)) l.wickets++
  }
  return [...m.values()]
}

// ---------- scoring zones ----------
export interface ZoneRow {
  region: string
  fours: number
  sixes: number
}

/** Where recorded boundaries went, by fielding region (mirrored for left-handers). */
export function zonesOf(file: ScoreFile, idx: number, lefties: Set<string>): ZoneRow[] {
  const m = new Map<string, ZoneRow>()
  for (const { b } of ballsWithOver(file, idx)) {
    if (!b.shot || b.kind === 'wd' || (b.bat !== 4 && b.bat !== 6)) continue
    const region = shotRegion(b.shot, lefties.has(b.striker))
    let z = m.get(region)
    if (!z) m.set(region, (z = { region, fours: 0, sixes: 0 }))
    if (b.bat === 4) z.fours++
    else z.sixes++
  }
  return [...m.values()].sort((a, b) => b.fours + b.sixes - (a.fours + a.sixes))
}

// ---------- wagon wheel: eight 45° slices ----------
/** Angle of a shot from the batter: 0° = straight past the bowler, positive = leg side (mirrored for left-handers). */
export function shotAngle(shot: [number, number], left = false): number {
  const dx = (shot[0] - BATTER_POS[0]) * (left ? -1 : 1)
  const dy = shot[1] - BATTER_POS[1]
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

/** Slice 0–7 of a shot; slice i spans -180 + 45·i to -135 + 45·i degrees (0–3 off side, 4–7 leg side). */
export const sliceOf = (shot: [number, number], left = false) => Math.min(7, Math.max(0, Math.floor((shotAngle(shot, left) + 180) / 45)))

/** Runs in each of the eight slices and each slice's share of them (whole per cent). */
export function wagonSlices(shots: { shot: [number, number]; runs: number }[], left = false): { runs: number[]; pct: number[] } {
  const runs = Array(8).fill(0) as number[]
  for (const s of shots) runs[sliceOf(s.shot, left)] += s.runs
  const total = runs.reduce((a, b) => a + b, 0)
  return { runs, pct: runs.map((r) => (total ? Math.round((r / total) * 100) : 0)) }
}

// ---------- the chase against par ----------
export interface SwingPoint {
  over: number
  /** Runs ahead of (+) or behind (–) the required pace. */
  ahead: number
  /** The chasing side's chance, 0–100 (a rough estimate). */
  chance: number
}

/** After each over of the second innings: ahead of or behind the required pace, and the chasing side's chance. */
export function swingOf(file: ScoreFile): SwingPoint[] {
  const first = file.innings[0]
  const second = file.innings[1]
  if (!first || !second || second.target === undefined) return []
  const firstBalls = first.events.filter(isBall).filter((b) => b.kind === 'legal').length
  const firstRate = firstBalls > 0 ? inningsTotalOf(first) / firstBalls : 1
  const wicketsTotal = file[second.batting].xi.length - 1
  let total = 0
  let legal = 0
  let out = 0
  let current = 0
  const points: SwingPoint[] = []
  const close = () => {
    const left = second.overs * BALLS - legal
    points.push({
      over: current,
      ahead: total - parScore(second.target!, second.overs, legal),
      chance: Math.round(winChance({ target: second.target!, total, ballsLeft: left, wicketsLeft: wicketsTotal - out, wicketsTotal, firstRatePerBall: firstRate }) * 100),
    })
  }
  for (const { b, over } of ballsWithOver(file, 1)) {
    if (over !== current && current > 0) close()
    current = over
    total += ballRuns(b)
    if (b.kind === 'legal') legal++
    if (b.wicket) out++
  }
  if (current > 0) close()
  return points
}

/** Runs the batting side made from the ball-by-ball log alone (penalties are ignored here). */
const inningsTotalOf = (inn: ScoreFile['innings'][number]) => inn.events.filter(isBall).reduce((s, b) => s + ballRuns(b), 0)
