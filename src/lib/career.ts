// Career statistics (PLAN §28): each player's batting, bowling and fielding
// record added up over every scored match. Worked out from the score files —
// nothing extra is stored.
import type { ScoreFile } from '../types'
import { summarize } from './scorecard'
import { BALLS, isBall, oversText } from './scoring'

export interface MatchLine {
  matchId: string
  /** Batted in this match. */
  bat?: { runs: number; balls: number; notOut: boolean }
  bowl?: { balls: number; runs: number; wickets: number }
}

export interface Career {
  id: string
  matches: number
  /** Player-of-the-match awards. */
  potm: number
  bat: {
    innings: number
    notOuts: number
    runs: number
    balls: number
    fours: number
    sixes: number
    fifties: number
    hundreds: number
    ducks: number
    best: { runs: number; notOut: boolean } | null
  }
  bowl: {
    innings: number
    balls: number
    runs: number
    wickets: number
    maidens: number
    wides: number
    noBalls: number
    best: { wickets: number; runs: number } | null
  }
  field: { catches: number; stumpings: number; runOuts: number }
  /** Recorded boundary directions, for the career wagon wheel. */
  shots: { shot: [number, number]; runs: number }[]
  byMatch: MatchLine[]
}

function blank(id: string): Career {
  return {
    id,
    matches: 0,
    potm: 0,
    bat: { innings: 0, notOuts: 0, runs: 0, balls: 0, fours: 0, sixes: 0, fifties: 0, hundreds: 0, ducks: 0, best: null },
    bowl: { innings: 0, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0, best: null },
    field: { catches: 0, stumpings: 0, runOuts: 0 },
    shots: [],
    byMatch: [],
  }
}

/** Everyone who appears in any of the score files, keyed by person id. */
export function careerStats(files: ScoreFile[]): Map<string, Career> {
  const all = new Map<string, Career>()
  const get = (id: string): Career => {
    let c = all.get(id)
    if (!c) all.set(id, (c = blank(id)))
    return c
  }

  for (const file of files) {
    const lines = new Map<string, MatchLine>()
    const line = (id: string): MatchLine => {
      let l = lines.get(id)
      if (!l) lines.set(id, (l = { matchId: file.matchId }))
      return l
    }
    for (const id of [...file.home.xi, ...file.away.xi]) {
      get(id).matches++
      line(id)
    }
    if (file.awards?.potm) get(file.awards.potm).potm++

    file.innings.forEach((inn, idx) => {
      const s = summarize(file, idx)
      for (const b of s.batters) {
        const c = get(b.id).bat
        const notOut = !b.out
        c.innings++
        if (notOut) c.notOuts++
        c.runs += b.runs
        c.balls += b.balls
        c.fours += b.fours
        c.sixes += b.sixes
        if (b.runs >= 100) c.hundreds++
        else if (b.runs >= 50) c.fifties++
        if (b.runs === 0 && !notOut) c.ducks++
        if (!c.best || b.runs > c.best.runs || (b.runs === c.best.runs && notOut && !c.best.notOut)) c.best = { runs: b.runs, notOut }
        line(b.id).bat = { runs: b.runs, balls: b.balls, notOut }
      }
      for (const b of s.bowlers) {
        if (b.balls === 0 && b.runs === 0) continue // picked but never bowled
        const c = get(b.id).bowl
        c.innings++
        c.balls += b.balls
        c.runs += b.runs
        c.wickets += b.wickets
        c.maidens += b.maidens
        c.wides += b.wides
        c.noBalls += b.noBalls
        if (!c.best || b.wickets > c.best.wickets || (b.wickets === c.best.wickets && b.runs < c.best.runs)) c.best = { wickets: b.wickets, runs: b.runs }
        line(b.id).bowl = { balls: b.balls, runs: b.runs, wickets: b.wickets }
      }
      for (const e of inn.events.filter(isBall)) {
        if (e.shot) get(e.striker).shots.push({ shot: e.shot, runs: e.bat })
        const w = e.wicket
        if (!w) continue
        if (w.kind === 'caught_bowled') get(e.bowler).field.catches++
        else if (w.fielder && (w.kind === 'caught' || w.kind === 'caught_behind')) get(w.fielder).field.catches++
        else if (w.fielder && w.kind === 'stumped') get(w.fielder).field.stumpings++
        else if (w.fielder && w.kind === 'run_out') get(w.fielder).field.runOuts++
      }
    })
    for (const [id, l] of lines) get(id).byMatch.push(l)
  }
  return all
}

// ---------- derived numbers, as text ----------
const fixed = (n: number | null, d = 2) => (n === null || !Number.isFinite(n) ? '–' : n.toFixed(d))

/** Batting average: runs per dismissal. No dismissals yet → "–". */
export const batAverage = (c: Career) => fixed(c.bat.innings - c.bat.notOuts > 0 ? c.bat.runs / (c.bat.innings - c.bat.notOuts) : null)
export const batStrikeRate = (c: Career) => fixed(c.bat.balls > 0 ? (c.bat.runs * 100) / c.bat.balls : null, 1)
export const highScore = (c: Career) => (c.bat.best ? `${c.bat.best.runs}${c.bat.best.notOut ? '*' : ''}` : '–')
export const bowlOvers = (c: Career) => oversText(c.bowl.balls)
export const bowlEconomy = (c: Career) => fixed(c.bowl.balls > 0 ? (c.bowl.runs * BALLS) / c.bowl.balls : null)
export const bowlAverage = (c: Career) => fixed(c.bowl.wickets > 0 ? c.bowl.runs / c.bowl.wickets : null)
export const bestBowling = (c: Career) => (c.bowl.best ? `${c.bowl.best.wickets}/${c.bowl.best.runs}` : '–')
