// Dropped catches (PLAN: scoring extras): every drop a scorer marked, what it cost, and
// the totals by team, fielder, phase and place. Worked out from the score files; nothing
// extra is stored.
import type { ScoreFile, SideKey, WicketKind } from '../types'
import { ballsWithOver, phasesOf } from './analysis'
import { inningsTotal, other } from './scoring'

export type DropImpact = 'none' | 'costly' | 'decisive'

export interface DropEvent {
  matchId: string
  inningsIdx: number
  ballId: string
  /** The fielder who dropped it. */
  by: string
  batter: string
  bowler: string
  /** The dropper's side. */
  fieldingSide: SideKey
  at?: [number, number]
  tough: boolean
  over: number
  phase: 'pp' | 'mid' | 'death' | 'all'
  /** Runs the batter scored off the bat from this ball on, until they were out or the innings ended. */
  runsAfter: number
  ballsAfter: number
  out: boolean
  /**
   * `decisive`: the dropper's side lost by no more runs than the batter scored after the life.
   * `costly`: the dropper's side lost and the batter went on to a large share of the innings.
   */
  impact: DropImpact
  /** The losing margin in runs, when the dropper's side chased and fell short. */
  margin?: number
}

/** A batter who scores at least this many (and this share of the innings) after a life made it count in a lost match. */
export const COSTLY_RUNS = 20
export const COSTLY_SHARE = 0.25

const CATCH_KINDS: WicketKind[] = ['caught', 'caught_behind', 'caught_bowled']

/** Every dropped catch in these matches, in match order. */
export function dropsIn(files: ScoreFile[]): DropEvent[] {
  const out: DropEvent[] = []
  for (const f of files) {
    f.innings.forEach((inn, idx) => {
      const balls = ballsWithOver(f, idx)
      const phases = phasesOf(inn.overs, f.powerplay)
      balls.forEach(({ b, over }, i) => {
        if (!b.drop) return
        // The batter's innings from this ball on.
        let runs = 0
        let faced = 0
        let wasOut = false
        for (let j = i; j < balls.length; j++) {
          const x = balls[j].b
          if (x.striker === b.striker) {
            runs += x.bat
            if (x.kind !== 'wd') faced++
          }
          if (x.wicket?.who === b.striker) {
            wasOut = true
            break
          }
        }
        const fieldingSide = other(inn.batting)
        const winner = f.status === 'finished' ? f.result?.winner : undefined
        let impact: DropImpact = 'none'
        let margin: number | undefined
        if (winner && winner !== fieldingSide) {
          // The dropper's side lost. If they chased and fell short by runs, did the life decide it?
          if (idx === 0 && f.innings[1]) {
            const gap = inningsTotal(f, 0) - inningsTotal(f, 1)
            if (gap > 0) {
              margin = gap
              if (runs >= gap) impact = 'decisive'
            }
          }
          if (impact === 'none' && runs >= Math.max(COSTLY_RUNS, Math.round(inningsTotal(f, idx) * COSTLY_SHARE))) impact = 'costly'
        }
        out.push({
          matchId: f.matchId,
          inningsIdx: idx,
          ballId: b.id,
          by: b.drop.by,
          batter: b.striker,
          bowler: b.bowler,
          fieldingSide,
          at: b.drop.at,
          tough: !!b.drop.tough,
          over,
          phase: phases.find((p) => over >= p.from && over <= p.to)?.key ?? 'all',
          runsAfter: runs,
          ballsAfter: faced,
          out: wasOut,
          impact,
          margin,
        })
      })
    })
  }
  return out
}

export interface CatchTaken {
  matchId: string
  /** The fielder (the bowler, for a caught-and-bowled). */
  by: string
  fieldingSide: SideKey
}

/** Every catch that was held. */
export function catchesIn(files: ScoreFile[]): CatchTaken[] {
  const out: CatchTaken[] = []
  for (const f of files)
    for (const inn of f.innings)
      for (const e of inn.events) {
        if (e.t !== 'ball' || !e.wicket || !CATCH_KINDS.includes(e.wicket.kind)) continue
        const by = e.wicket.kind === 'caught_bowled' ? e.bowler : e.wicket.fielder
        if (by) out.push({ matchId: f.matchId, by, fieldingSide: other(inn.batting) })
      }
  return out
}

const rate = (taken: number, chances: number) => (chances > 0 ? Math.round((taken * 100) / chances) : null)

export interface FielderRow {
  id: string
  drops: number
  tough: number
  taken: number
  chances: number
  /** Catches held as a share of chances, 0–100. */
  rate: number | null
  runsCost: number
  costly: number
  decisive: number
}

export interface DropSummary {
  drops: number
  tough: number
  taken: number
  chances: number
  rate: number | null
  runsCost: number
  costly: number
  decisive: number
  byFielder: FielderRow[]
  byPhase: { key: DropEvent['phase']; drops: number }[]
  /** Where they went down, for the map. */
  marks: [number, number][]
  recent: DropEvent[]
}

/** One side's catching: chances, drops, what they cost, and the people behind the numbers. */
export function dropSummary(files: ScoreFile[], side: SideKey): DropSummary {
  const drops = dropsIn(files).filter((d) => d.fieldingSide === side)
  const taken = catchesIn(files).filter((c) => c.fieldingSide === side)
  const rows = new Map<string, FielderRow>()
  const row = (id: string): FielderRow => {
    let r = rows.get(id)
    if (!r) rows.set(id, (r = { id, drops: 0, tough: 0, taken: 0, chances: 0, rate: null, runsCost: 0, costly: 0, decisive: 0 }))
    return r
  }
  for (const c of taken) row(c.by).taken++
  for (const d of drops) {
    const r = row(d.by)
    r.drops++
    if (d.tough) r.tough++
    r.runsCost += d.runsAfter
    if (d.impact === 'costly') r.costly++
    if (d.impact === 'decisive') r.decisive++
  }
  for (const r of rows.values()) {
    r.chances = r.taken + r.drops
    r.rate = rate(r.taken, r.chances)
  }
  const phases: DropSummary['byPhase'] = (['pp', 'mid', 'death', 'all'] as const).map((key) => ({ key, drops: drops.filter((d) => d.phase === key).length })).filter((p) => p.drops > 0)
  return {
    drops: drops.length,
    tough: drops.filter((d) => d.tough).length,
    taken: taken.length,
    chances: taken.length + drops.length,
    rate: rate(taken.length, taken.length + drops.length),
    runsCost: drops.reduce((n, d) => n + d.runsAfter, 0),
    costly: drops.filter((d) => d.impact === 'costly').length,
    decisive: drops.filter((d) => d.impact === 'decisive').length,
    byFielder: [...rows.values()].filter((r) => r.chances > 0).sort((a, b) => b.drops - a.drops || b.runsCost - a.runsCost || a.id.localeCompare(b.id)),
    byPhase: phases,
    marks: drops.flatMap((d) => (d.at ? [d.at] : [])),
    recent: [...drops].reverse().slice(0, 8),
  }
}

export interface PlayerDrops {
  /** As a fielder: their own catching. */
  fielding: FielderRow
  /** As a batter: lives they were given. */
  lives: { count: number; runsAfter: number; stillOut: number }
  /** As a bowler: chances off their bowling that went down. */
  luck: { count: number; runsAfter: number }
}

export function playerDrops(files: ScoreFile[], id: string): PlayerDrops {
  const drops = dropsIn(files)
  const mine = drops.filter((d) => d.by === id)
  const taken = catchesIn(files).filter((c) => c.by === id).length
  const fielding: FielderRow = {
    id,
    drops: mine.length,
    tough: mine.filter((d) => d.tough).length,
    taken,
    chances: taken + mine.length,
    rate: rate(taken, taken + mine.length),
    runsCost: mine.reduce((n, d) => n + d.runsAfter, 0),
    costly: mine.filter((d) => d.impact === 'costly').length,
    decisive: mine.filter((d) => d.impact === 'decisive').length,
  }
  const lives = drops.filter((d) => d.batter === id)
  const luck = drops.filter((d) => d.bowler === id)
  return {
    fielding,
    lives: { count: lives.length, runsAfter: lives.reduce((n, d) => n + d.runsAfter, 0), stillOut: lives.filter((d) => d.out).length },
    luck: { count: luck.length, runsAfter: luck.reduce((n, d) => n + d.runsAfter, 0) },
  }
}

/** "Dropped at deep mid-wicket by Rohit: Santosh went on to 34 (22)". */
export const impactText = (d: DropEvent): string =>
  d.impact === 'decisive' ? `Could have decided it: they lost by ${d.margin}, the batter scored ${d.runsAfter} after this` : d.impact === 'costly' ? `Cost ${d.runsAfter} runs in a lost match` : d.runsAfter > 0 ? `Cost ${d.runsAfter} run${d.runsAfter === 1 ? '' : 's'}` : 'No further runs'
