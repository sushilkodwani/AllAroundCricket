// Our record against one opponent: results, streak, batting first or chasing,
// best and worst totals, and who does best on each side. Results come from the
// match records (so unscored matches count too); everything else from the
// ball-by-ball score files, where our team is always the home side.
import type { Match, MatchResult, ScoreFile } from '../types'
import { careerStats, type Career } from './career'
import { inningsTotal, squadOf } from './scoring'

export interface H2H {
  played: number
  won: number
  lost: number
  /** Tied, drawn, no result, abandoned. */
  other: number
  winPct: number | null
  /** Latest first: W / L / T / N. */
  form: { result: MatchResult; date: string; matchId: string; teamId: string }[]
  /** "Won 3 in a row" style streak from the latest result back. */
  streak: { result: MatchResult; count: number } | null
  battingFirst: { played: number; won: number }
  chasing: { played: number; won: number }
  highest?: { runs: number; wickets: number; date: string; matchId: string; teamId: string }
  lowest?: { runs: number; wickets: number; date: string; matchId: string; teamId: string }
  theirHighest?: { runs: number; wickets: number; date: string; matchId: string; teamId: string }
  /** The scored results with their wording, e.g. "Shivaji Park Strikers won by 32 runs". */
  biggestWin?: { text: string; date: string; matchId: string; teamId: string }
  heaviestLoss?: { text: string; date: string; matchId: string; teamId: string }
  ourBat: Career[]
  ourBowl: Career[]
  theirBat: Career[]
  theirBowl: Career[]
}

const DECIDED: MatchResult[] = ['won', 'lost']

/** Margin of a result for ranking wins and losses: runs count as they are, wickets as 10 runs each. */
function margin(text: string): number {
  const runs = /by (\d+) run/.exec(text)
  if (runs) return Number(runs[1])
  const wkts = /by (\d+) wicket/.exec(text)
  return wkts ? Number(wkts[1]) * 10 : 0
}

export function headToHeadOf(matches: Match[], files: ScoreFile[]): H2H {
  const withResult = matches.filter((m) => m.result).sort((a, b) => b.date.localeCompare(a.date))
  const won = withResult.filter((m) => m.result === 'won').length
  const lost = withResult.filter((m) => m.result === 'lost').length
  const decided = won + lost
  const form = withResult.map((m) => ({ result: m.result!, date: m.date, matchId: m.id, teamId: m.teamId }))
  let streak: H2H['streak'] = null
  const decidedForm = form.filter((f) => DECIDED.includes(f.result))
  if (decidedForm.length) {
    const r = decidedForm[0].result
    let n = 0
    while (n < decidedForm.length && decidedForm[n].result === r) n++
    streak = { result: r, count: n }
  }

  const byId = new Map(matches.map((m) => [m.id, m]))
  const out: H2H = {
    played: withResult.length,
    won,
    lost,
    other: withResult.length - decided,
    winPct: decided ? Math.round((won * 100) / decided) : null,
    form,
    streak,
    battingFirst: { played: 0, won: 0 },
    chasing: { played: 0, won: 0 },
    ourBat: [],
    ourBowl: [],
    theirBat: [],
    theirBowl: [],
  }

  for (const f of files) {
    const m = byId.get(f.matchId)
    if (!m || f.innings.length === 0) continue
    const at = { date: m.date, matchId: m.id, teamId: m.teamId }
    const finished = f.status === 'finished'
    const ourIdx = f.innings.findIndex((i) => i.batting === 'home')
    if (finished && f.result?.winner !== undefined) {
      const first = f.innings[0].batting === 'home'
      const bucket = first ? out.battingFirst : out.chasing
      bucket.played++
      if (f.result.winner === 'home') bucket.won++
      const text = f.result.text
      if (f.result.winner === 'home' && (!out.biggestWin || margin(text) > margin(out.biggestWin.text))) out.biggestWin = { text, ...at }
      if (f.result.winner === 'away' && (!out.heaviestLoss || margin(text) > margin(out.heaviestLoss.text))) out.heaviestLoss = { text, ...at }
    }
    f.innings.forEach((inn, idx) => {
      // Only completed innings count as totals.
      if (!inn.closed && !(finished && idx === f.innings.length - 1)) return
      const total = { runs: inningsTotal(f, idx), wickets: inn.events.filter((e) => e.t === 'ball' && e.wicket).length + inn.events.filter((e) => e.t === 'retire' && e.out).length, ...at }
      // A chase won with balls to spare is not a low score: leave it out of "lowest".
      const wonChase = idx === 1 && finished && f.result?.winner === inn.batting
      if (idx === ourIdx) {
        if (!out.highest || total.runs > out.highest.runs) out.highest = total
        if (!wonChase && (!out.lowest || total.runs < out.lowest.runs)) out.lowest = total
      } else if (!out.theirHighest || total.runs > out.theirHighest.runs) out.theirHighest = total
    })
  }

  const careers = [...careerStats(files).values()]
  const ours = new Set(files.flatMap((f) => squadOf(f.home)))
  const theirs = new Set(files.flatMap((f) => squadOf(f.away)))
  const bat = (xs: Career[]) => xs.filter((c) => c.bat.innings > 0).sort((a, b) => b.bat.runs - a.bat.runs).slice(0, 3)
  const bowl = (xs: Career[]) => xs.filter((c) => c.bowl.wickets > 0).sort((a, b) => b.bowl.wickets - a.bowl.wickets || a.bowl.runs - b.bowl.runs).slice(0, 3)
  out.ourBat = bat(careers.filter((c) => ours.has(c.id)))
  out.ourBowl = bowl(careers.filter((c) => ours.has(c.id)))
  out.theirBat = bat(careers.filter((c) => theirs.has(c.id)))
  out.theirBowl = bowl(careers.filter((c) => theirs.has(c.id)))
  return out
}
