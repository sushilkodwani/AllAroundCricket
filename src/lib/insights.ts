// Match insights worked out from the ball-by-ball log (PLAN §32–§34):
// milestones, the chase estimate (par score and win chance), award points and
// records. All pure, all unit-tested.
import type { MatchAwards, ScoreFile, SideKey } from '../types'
import { summarize } from './scorecard'
import { BALLS, BOWLER_WICKETS, ballRuns, battingSide, inningsTotal, isBall, legalBalls, other, outIds } from './scoring'

// ---------- milestones ----------
export type Milestone =
  | { kind: 'fifty' | 'hundred'; who: string; runs: number }
  | { kind: 'team'; runs: number }
  | { kind: 'hattrick' | 'fivefor'; who: string }

/** Milestones reached, keyed by the id of the ball that brought them up. */
export function milestonesOf(file: ScoreFile, idx: number): Map<string, Milestone[]> {
  const out = new Map<string, Milestone[]>()
  const inn = file.innings[idx]
  if (!inn) return out
  const runs = new Map<string, number>()
  const wickets = new Map<string, number>()
  const streak = new Map<string, number>()
  let total = 0
  for (const e of inn.events) {
    if (e.t === 'penalty') {
      if (e.to === 'batting') total += e.runs
      continue
    }
    if (e.t !== 'ball') continue
    const found: Milestone[] = []
    const before = runs.get(e.striker) ?? 0
    const after = before + e.bat
    runs.set(e.striker, after)
    if (before < 100 && after >= 100) found.push({ kind: 'hundred', who: e.striker, runs: after })
    else if (before < 50 && after >= 50) found.push({ kind: 'fifty', who: e.striker, runs: after })

    const teamBefore = total
    total += ballRuns(e)
    if (Math.floor(total / 50) > Math.floor(teamBefore / 50)) found.push({ kind: 'team', runs: Math.floor(total / 50) * 50 })

    if (e.wicket && BOWLER_WICKETS.includes(e.wicket.kind)) {
      const w = (wickets.get(e.bowler) ?? 0) + 1
      wickets.set(e.bowler, w)
      const s = (streak.get(e.bowler) ?? 0) + 1
      streak.set(e.bowler, s)
      if (s === 3) found.push({ kind: 'hattrick', who: e.bowler })
      if (w === 5) found.push({ kind: 'fivefor', who: e.bowler })
    } else {
      streak.set(e.bowler, 0)
    }
    if (found.length) out.set(e.id, found)
  }
  return out
}

export function milestoneText(m: Milestone, nameOf: (id: string) => string, teamName: string): string {
  switch (m.kind) {
    case 'fifty':
      return `🎉 Fifty for ${nameOf(m.who)}!`
    case 'hundred':
      return `💯 Hundred for ${nameOf(m.who)}!`
    case 'team':
      return `👏 ${teamName} reach ${m.runs}`
    case 'hattrick':
      return `🔥 Hat-trick for ${nameOf(m.who)}!`
    case 'fivefor':
      return `🖐️ Five wickets for ${nameOf(m.who)}!`
  }
}

// ---------- the chase: par score and win chance ----------
/** Runs the chasing side needs by now to be exactly on the required pace. */
export function parScore(target: number, overs: number, ballsBowled: number): number {
  const total = overs * BALLS
  return Math.round(((target - 1) * Math.min(ballsBowled, total)) / total)
}

/**
 * A rough estimate, not a prediction: compares the runs still needed with what
 * a side scoring at the first innings' pace would make from the balls left,
 * scaled down as wickets fall. Returns the chasing side's chance, 0–1.
 */
export function winChance(a: { target: number; total: number; ballsLeft: number; wicketsLeft: number; wicketsTotal: number; firstRatePerBall: number }): number {
  const need = a.target - a.total
  if (need <= 0) return 1
  if (a.ballsLeft <= 0 || a.wicketsLeft <= 0) return 0
  const strength = 0.3 + 0.7 * Math.sqrt(a.wicketsLeft / Math.max(1, a.wicketsTotal))
  const expected = a.ballsLeft * Math.max(0.5, a.firstRatePerBall) * strength
  const spread = 3 + 1.6 * Math.sqrt(a.ballsLeft)
  const p = 1 / (1 + Math.exp((-1.7 * (expected - need + 0.5)) / spread))
  return Math.min(0.99, Math.max(0.01, p))
}

export interface ChaseView {
  chasing: SideKey
  /** Chance of the chasing side, 0–100. */
  chance: number
  par: number
  /** Positive = ahead of par. */
  ahead: number
}

export function chaseView(file: ScoreFile): ChaseView | null {
  const second = file.innings[1]
  if (!second || second.target === undefined || file.status !== 'live') return null
  const first = file.innings[0]
  const firstBalls = legalBalls(first)
  const total = inningsTotal(file, 1)
  const bowled = legalBalls(second)
  const wicketsTotal = battingSide(file, second).xi.length - 1
  const chance = winChance({
    target: second.target,
    total,
    ballsLeft: second.overs * BALLS - bowled,
    wicketsLeft: wicketsTotal - outIds(second).size,
    wicketsTotal,
    firstRatePerBall: firstBalls > 0 ? inningsTotal(file, 0) / firstBalls : 1,
  })
  const par = parScore(second.target, second.overs, bowled)
  return { chasing: second.batting, chance: Math.round(chance * 100), par, ahead: total - par }
}

// ---------- awards ----------
export interface AwardPoints {
  id: string
  side: SideKey
  bat: number
  bowl: number
  field: number
  total: number
}

/** Points per player for one match. The formula is in PLAN §33 and shown in the app. */
export function awardPoints(file: ScoreFile): AwardPoints[] {
  const all = new Map<string, AwardPoints>()
  const get = (id: string, side: SideKey) => {
    let p = all.get(id)
    if (!p) all.set(id, (p = { id, side, bat: 0, bowl: 0, field: 0, total: 0 }))
    return p
  }
  file.innings.forEach((inn, idx) => {
    const s = summarize(file, idx)
    const fielding = other(inn.batting)
    for (const b of s.batters) {
      const sr = b.balls >= 10 ? (b.runs * 100) / b.balls : 0
      get(b.id, inn.batting).bat += b.runs + b.fours + 2 * b.sixes + (b.runs >= 100 ? 30 : b.runs >= 50 ? 15 : b.runs >= 30 ? 5 : 0) + (sr >= 150 ? 10 : sr >= 120 ? 5 : 0)
    }
    for (const b of s.bowlers) {
      const eco = b.balls >= 12 ? (b.runs * BALLS) / b.balls : null
      get(b.id, fielding).bowl += 25 * b.wickets + 10 * b.maidens + (b.wickets >= 5 ? 20 : b.wickets >= 3 ? 10 : 0) + (eco === null ? 0 : eco <= 5 ? 10 : eco <= 7 ? 5 : eco >= 12 ? -5 : 0)
    }
    for (const e of inn.events.filter(isBall)) {
      const w = e.wicket
      if (!w) continue
      if (w.kind === 'caught_bowled') get(e.bowler, fielding).field += 10
      else if (w.fielder && ['caught', 'caught_behind', 'stumped', 'run_out'].includes(w.kind)) get(w.fielder, fielding).field += 10
    }
  })
  for (const p of all.values()) p.total = p.bat + p.bowl + p.field
  return [...all.values()]
}

/** Suggested awards; the admin confirms or changes them. Ties go to the winning side. */
export function suggestAwards(file: ScoreFile): MatchAwards {
  const points = awardPoints(file)
  const winner = file.result?.winner
  const top = (pick: (p: AwardPoints) => number) =>
    [...points].filter((p) => pick(p) > 0).sort((a, b) => pick(b) - pick(a) || Number(b.side === winner) - Number(a.side === winner))[0]?.id
  return { potm: top((p) => p.total), batter: top((p) => p.bat), bowler: top((p) => p.bowl) }
}

// ---------- records ----------
export interface TeamRecord {
  key: string
  label: string
  value: string
  /** Player the record belongs to, when it is a personal one. */
  personIds?: string[]
  matchId: string
  teamId: string
}

/** Best marks of one side over a set of scored matches. */
export function teamRecords(files: ScoreFile[], side: SideKey): TeamRecord[] {
  const best = new Map<string, TeamRecord & { score: number }>()
  const offer = (key: string, label: string, score: number, value: string, file: ScoreFile, personIds?: string[]) => {
    const cur = best.get(key)
    if (!cur || score > cur.score) best.set(key, { key, label, value, personIds, matchId: file.matchId, teamId: file.teamId, score })
  }
  for (const file of files) {
    file.innings.forEach((inn, idx) => {
      const s = summarize(file, idx)
      if (inn.batting === side) {
        offer('total', 'Highest total', s.total, `${s.total}/${s.wickets} (${s.overs})`, file)
        if (inn.closed === 'all_out') offer('low', 'Lowest all-out total', -s.total, `${s.total} (${s.overs})`, file)
        for (const b of s.batters) offer('score', 'Highest score', b.runs * 1000 - b.balls, `${b.runs}${b.out ? '' : '*'} (${b.balls})`, file, [b.id])
        for (const b of s.batters) if (b.sixes > 0) offer('sixes', 'Most sixes in an innings', b.sixes, `${b.sixes}`, file, [b.id])
        for (const p of s.partnerships) offer('stand', 'Best partnership', p.runs * 1000 - p.balls, `${p.runs} (${p.balls})`, file, [p.a, p.b])
      } else {
        for (const b of s.bowlers) if (b.wickets > 0) offer('bowl', 'Best bowling', b.wickets * 1000 - b.runs, `${b.wickets}/${b.runs}`, file, [b.id])
      }
    })
    if (file.status === 'finished' && file.result?.winner === side && file.innings.length === 2) {
      const battedFirst = file.innings[0].batting === side
      if (battedFirst) {
        const margin = inningsTotal(file, 0) - inningsTotal(file, 1)
        offer('winRuns', 'Biggest win (runs)', margin, `by ${margin} run${margin === 1 ? '' : 's'}`, file)
      } else {
        const left = file[side].xi.length - 1 - outIds(file.innings[1]).size
        offer('winWkts', 'Biggest win (wickets)', left, `by ${left} wicket${left === 1 ? '' : 's'}`, file)
      }
    }
  }
  const order = ['total', 'low', 'winRuns', 'winWkts', 'score', 'stand', 'bowl', 'sixes']
  return order.map((k) => best.get(k)).filter((r): r is TeamRecord & { score: number } => !!r)
}

// ---------- pressure meter (PLAN §41) ----------
export interface Pressure {
  /** Share of legal balls with no run of any kind, 0–100. */
  dotPct: number
  /** Legal balls since the last four or six (the whole innings if there has been none). */
  sinceBoundary: number
  /** Runs off the last 12 legal balls (fewer early on). */
  lastRuns: number
  lastBalls: number
}

export function pressureOf(file: ScoreFile, idx: number): Pressure | null {
  const balls = file.innings[idx]?.events.filter(isBall) ?? []
  const legal = balls.filter((b) => b.kind === 'legal')
  if (legal.length === 0) return null
  let sinceBoundary = 0
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i]
    if (b.kind !== 'wd' && (b.bat === 4 || b.bat === 6)) break
    if (b.kind === 'legal') sinceBoundary++
  }
  // The last 12 legal balls, together with any wides and no-balls bowled among them.
  let count = 0
  let lastRuns = 0
  for (let i = balls.length - 1; i >= 0 && count < 12; i--) {
    lastRuns += ballRuns(balls[i])
    if (balls[i].kind === 'legal') count++
  }
  const dots = legal.filter((b) => ballRuns(b) === 0).length
  return { dotPct: Math.round((dots * 100) / legal.length), sinceBoundary, lastRuns, lastBalls: count }
}