// Numbers behind the team Stats charts: the form strip and the phase breakdown.
// Worked out from the score files and matches — nothing extra is stored.
import type { Match, ScoreFile, SideKey, WicketKind } from '../types'
import { phaseStats } from './analysis'
import { inningsTotal, other } from './scoring'

// ---------- form strip ----------
export interface FormPoint {
  matchId: string
  teamId: string
  date: string
  /** The other side's name. */
  opponent: string
  result: 'W' | 'L' | 'T' | 'N'
  /** "27 runs", "5 wkts" — empty when there is no margin (tie, no result). */
  margin: string
  /** Size of the win/loss for the bar: runs as is, wickets × 10 would mislead, so wickets get a fixed height. */
  runsMargin: number
  scoreFor: number
  scoreAgainst: number
}

/** Finished matches of one side, oldest first. `matches` supplies the dates. */
export function formOf(files: ScoreFile[], matches: Match[], side: SideKey): FormPoint[] {
  const date = new Map(matches.map((m) => [m.id, m.date]))
  const out: FormPoint[] = []
  for (const f of files) {
    if (f.status !== 'finished' || f.innings.length < 2) continue
    const w = f.result?.winner
    const result = !f.result ? 'N' : w === side ? 'W' : w === other(side) ? 'L' : /tie/i.test(f.result.text) ? 'T' : 'N'
    const m = /by (\d+) (run|wicket)/i.exec(f.result?.text ?? '')
    const margin = m && result !== 'T' && result !== 'N' ? `${m[1]} ${m[2].toLowerCase() === 'run' ? (+m[1] === 1 ? 'run' : 'runs') : +m[1] === 1 ? 'wkt' : 'wkts'}` : ''
    const mine = f.innings[0].batting === side ? 0 : 1
    out.push({
      matchId: f.matchId,
      teamId: f.teamId,
      date: date.get(f.matchId) ?? '',
      opponent: f[other(side)].name,
      result,
      margin,
      runsMargin: m && m[2].toLowerCase() === 'run' ? +m[1] : 0,
      scoreFor: inningsTotal(f, mine),
      scoreAgainst: inningsTotal(f, 1 - mine),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.matchId.localeCompare(b.matchId))
}

// ---------- phase breakdown ----------
export interface PhaseSplit {
  key: 'pp' | 'mid' | 'death'
  label: string
  /** Run rate of this side's batting / of the runs it conceded; null with no balls. */
  batRate: number | null
  bowlRate: number | null
  /** Wickets this side lost / took in the phase, per match. */
  lost: number
  taken: number
  /** Matches that contributed. */
  matches: number
}

const LABEL = { pp: 'Powerplay', mid: 'Middle', death: 'Death' } as const

/** Powerplay, middle and death added up over every finished-or-scored match: our rate of scoring against the rate we concede. */
export function phaseSplit(files: ScoreFile[], side: SideKey): PhaseSplit[] {
  const acc = { pp: blank(), mid: blank(), death: blank() }
  for (const f of files) {
    f.innings.forEach((inn, idx) => {
      const batting = inn.batting === side
      const lines = phaseStats(f, idx)
      for (const l of lines) {
        if (l.phase.key === 'all' || l.balls === 0) continue
        const a = acc[l.phase.key]
        if (batting) {
          a.batRuns += l.runs
          a.batBalls += l.balls
          a.lost += l.wickets
        } else {
          a.bowlRuns += l.runs
          a.bowlBalls += l.balls
          a.taken += l.wickets
        }
        a.seen.add(f.matchId)
      }
    })
  }
  return (['pp', 'mid', 'death'] as const)
    .filter((k) => acc[k].seen.size > 0)
    .map((k) => {
      const a = acc[k]
      const n = a.seen.size
      return {
        key: k,
        label: LABEL[k],
        batRate: a.batBalls > 0 ? (a.batRuns * 6) / a.batBalls : null,
        bowlRate: a.bowlBalls > 0 ? (a.bowlRuns * 6) / a.bowlBalls : null,
        lost: a.lost / n,
        taken: a.taken / n,
        matches: n,
      }
    })
}

function blank() {
  return { batRuns: 0, batBalls: 0, bowlRuns: 0, bowlBalls: 0, lost: 0, taken: 0, seen: new Set<string>() }
}

// ---------- scoring mix ----------
export interface MixCounts {
  dot: number
  one: number
  two: number
  /** Threes and fives. */
  other: number
  four: number
  six: number
  /** Wides, no-balls, byes and leg-byes: deliveries where the batter did not score. */
  extras: number
  /** Every delivery, wides and no-balls included. */
  total: number
  /** Share of legal balls that scored nothing / went for four or six, in %. */
  dotPct: number
  boundaryPct: number
}

export const MIX_KEYS = ['dot', 'one', 'two', 'other', 'four', 'six', 'extras'] as const
export const MIX_LABELS: Record<(typeof MIX_KEYS)[number], string> = { dot: 'Dots', one: '1s', two: '2s', other: '3s and 5s', four: '4s', six: '6s', extras: 'Extras' }

/** What every delivery came to, in the innings where `side` batted (`batting`) or bowled (`!batting`), over all matches. */
export function scoringMix(files: ScoreFile[], side: SideKey, batting: boolean): MixCounts {
  const c = { dot: 0, one: 0, two: 0, other: 0, four: 0, six: 0, extras: 0, total: 0, dotPct: 0, boundaryPct: 0 }
  let legal = 0
  let dots = 0
  let bounds = 0
  for (const f of files) {
    for (const inn of f.innings) {
      if ((inn.batting === side) !== batting) continue
      for (const e of inn.events) {
        if (e.t !== 'ball') continue
        c.total++
        if (e.kind !== 'wd' && (e.bat === 4 || e.bat === 6)) bounds++
        if (e.kind === 'legal') {
          legal++
          if (e.bat + e.byes === 0) dots++
        }
        if (e.kind !== 'legal' || (e.bat === 0 && e.byes > 0)) c.extras++
        else if (e.bat === 0) c.dot++
        else if (e.bat === 1) c.one++
        else if (e.bat === 2) c.two++
        else if (e.bat === 4) c.four++
        else if (e.bat === 6) c.six++
        else c.other++
      }
    }
  }
  c.dotPct = legal > 0 ? Math.round((dots * 100) / legal) : 0
  c.boundaryPct = legal > 0 ? Math.round((bounds * 100) / legal) : 0
  return c
}

// ---------- dismissals ----------
/** How `side`'s wickets fell (`lost`) and how it took the other side's (`taken`). */
export function dismissalKinds(files: ScoreFile[], side: SideKey): { lost: Partial<Record<WicketKind, number>>; taken: Partial<Record<WicketKind, number>> } {
  const out = { lost: {} as Partial<Record<WicketKind, number>>, taken: {} as Partial<Record<WicketKind, number>> }
  for (const f of files) {
    for (const inn of f.innings) {
      const into = inn.batting === side ? out.lost : out.taken
      for (const e of inn.events) if (e.t === 'ball' && e.wicket) into[e.wicket.kind] = (into[e.wicket.kind] ?? 0) + 1
    }
  }
  return out
}

// ---------- scatters ----------
export interface DotsLine {
  dots: number
  balls: number
}

/** Dot balls bowled by each bowler of `side`: legal balls where the bowler was charged nothing. */
export function bowlerDots(files: ScoreFile[], side: SideKey): Map<string, DotsLine> {
  const m = new Map<string, DotsLine>()
  for (const f of files) {
    for (const inn of f.innings) {
      if (inn.batting === side) continue
      for (const e of inn.events) {
        if (e.t !== 'ball' || e.kind !== 'legal') continue
        let l = m.get(e.bowler)
        if (!l) m.set(e.bowler, (l = { dots: 0, balls: 0 }))
        l.balls++
        if (e.bat === 0) l.dots++
      }
    }
  }
  return m
}

// ---------- extras conceded ----------
export interface ExtrasPoint {
  matchId: string
  date: string
  opponent: string
  wides: number
  noBalls: number
  total: number
}

/** Wides and no-balls `side` bowled in each match, oldest first. */
export function extrasConceded(files: ScoreFile[], matches: Match[], side: SideKey): ExtrasPoint[] {
  const date = new Map(matches.map((m) => [m.id, m.date]))
  const out: ExtrasPoint[] = []
  for (const f of files) {
    let wides = 0
    let noBalls = 0
    let balls = 0
    for (const inn of f.innings) {
      if (inn.batting === side) continue
      for (const e of inn.events) {
        if (e.t !== 'ball') continue
        balls++
        if (e.kind === 'wd') wides++
        else if (e.kind === 'nb') noBalls++
      }
    }
    if (balls > 0) out.push({ matchId: f.matchId, date: date.get(f.matchId) ?? '', opponent: f[other(side)].name, wides, noBalls, total: wides + noBalls })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.matchId.localeCompare(b.matchId))
}
