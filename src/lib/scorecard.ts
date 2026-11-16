// Everything the viewer screens show, worked out from the ball-by-ball log
// (PLAN §26): batting and bowling figures, fall of wickets, partnerships, the
// per-over data behind the charts, and the commentary text.
import type { BallEvent, Innings, ScoreFile, WicketKind } from '../types'
import { BALLS, BOWLER_WICKETS, ballRuns, bowlerRuns, battingSide, inningsTotal, legalBalls, oversText } from './scoring'

export interface BatLine {
  id: string
  runs: number
  balls: number
  fours: number
  sixes: number
  out?: { kind: WicketKind; bowler?: string; fielder?: string }
  retiredHurt?: boolean
  atCrease?: boolean
  onStrike?: boolean
}

export interface BowlLine {
  id: string
  balls: number
  maidens: number
  runs: number
  wickets: number
  dots: number
  fours: number
  sixes: number
  wides: number
  noBalls: number
}

export interface OverLine {
  /** 1-based over number. */
  n: number
  bowler: string
  runs: number
  wickets: number
  balls: BallEvent[]
  /** Score at the end of this over. */
  total: number
  totalWickets: number
}

export interface Partnership {
  a: string
  b: string
  runs: number
  balls: number
  aRuns: number
  aBalls: number
  bRuns: number
  bBalls: number
  unbroken: boolean
}

export interface Fow {
  n: number
  score: number
  who: string
  over: string
}

export interface Extras {
  wd: number
  nb: number
  b: number
  lb: number
  pen: number
  total: number
}

export interface InningsSummary {
  total: number
  wickets: number
  legal: number
  overs: string
  runRate: number | null
  extras: Extras
  batters: BatLine[]
  bowlers: BowlLine[]
  yetToBat: string[]
  fow: Fow[]
  partnerships: Partnership[]
  overLines: OverLine[]
  /** Runs off the bat by size, for the shots chart. */
  shots: { dots: number; ones: number; twos: number; threes: number; fours: number; sixes: number }
  wicketKinds: Partial<Record<WicketKind, number>>
  target?: number
  /** Chase only: runs still needed and balls left. */
  need?: { runs: number; balls: number; rate: number | null }
}

const rate = (runs: number, balls: number): number | null => (balls > 0 ? (runs * BALLS) / balls : null)
export const fmtRate = (r: number | null): string => (r === null ? '–' : r.toFixed(2))
export const strikeRate = (runs: number, balls: number): string => (balls > 0 ? ((runs * 100) / balls).toFixed(1) : '–')
export const economy = (l: Pick<BowlLine, 'runs' | 'balls'>): string => fmtRate(rate(l.runs, l.balls))

export function summarize(file: ScoreFile, idx: number): InningsSummary {
  const inn = file.innings[idx]
  const bat = new Map<string, BatLine>()
  const bowl = new Map<string, BowlLine>()
  const batLine = (id: string): BatLine => {
    let l = bat.get(id)
    if (!l) bat.set(id, (l = { id, runs: 0, balls: 0, fours: 0, sixes: 0 }))
    return l
  }
  const bowlLine = (id: string): BowlLine => {
    let l = bowl.get(id)
    if (!l) bowl.set(id, (l = { id, balls: 0, maidens: 0, runs: 0, wickets: 0, dots: 0, fours: 0, sixes: 0, wides: 0, noBalls: 0 }))
    return l
  }

  const extras: Extras = { wd: 0, nb: 0, b: 0, lb: 0, pen: 0, total: 0 }
  const shots = { dots: 0, ones: 0, twos: 0, threes: 0, fours: 0, sixes: 0 }
  const wicketKinds: Partial<Record<WicketKind, number>> = {}
  const fow: Fow[] = []
  const partnerships: Partnership[] = []
  const overLines: OverLine[] = []
  let total = 0
  let wickets = 0
  let legal = 0
  let pair: Partnership | undefined

  const fall = (who: string) => {
    wickets++
    fow.push({ n: wickets, score: total, who, over: oversText(legal) })
    if (pair) pair.unbroken = false
    pair = undefined
  }

  for (const e of inn.events) {
    if (e.t === 'penalty') {
      if (e.to === 'batting') {
        extras.pen += e.runs
        total += e.runs
      }
      continue
    }
    if (e.t === 'retire') {
      const l = batLine(e.who)
      if (e.out) {
        l.out = { kind: 'retired_out' }
        wicketKinds.retired_out = (wicketKinds.retired_out ?? 0) + 1
        fall(e.who)
      } else {
        l.retiredHurt = true
        if (pair) pair.unbroken = false
        pair = undefined
      }
      continue
    }

    const s = batLine(e.striker)
    batLine(e.nonStriker)
    s.retiredHurt = false
    bat.get(e.nonStriker)!.retiredHurt = false
    const bw = bowlLine(e.bowler)
    const runs = ballRuns(e)

    // The over this ball belongs to.
    const overNo = Math.floor(legal / BALLS) + 1
    let over = overLines[overLines.length - 1]
    if (!over || over.n !== overNo) overLines.push((over = { n: overNo, bowler: e.bowler, runs: 0, wickets: 0, balls: [], total: 0, totalWickets: 0 }))
    over.balls.push(e)
    over.runs += runs
    over.bowler = e.bowler

    // Partnership: starts whenever the pair in the middle changes.
    if (!pair || !((pair.a === e.striker && pair.b === e.nonStriker) || (pair.a === e.nonStriker && pair.b === e.striker))) {
      if (pair) pair.unbroken = false
      partnerships.push((pair = { a: e.striker, b: e.nonStriker, runs: 0, balls: 0, aRuns: 0, aBalls: 0, bRuns: 0, bBalls: 0, unbroken: true }))
    }
    pair.runs += runs
    const strikerIsA = pair.a === e.striker
    if (strikerIsA) pair.aRuns += e.bat
    else pair.bRuns += e.bat

    total += runs
    bw.runs += bowlerRuns(e)
    if (e.kind === 'wd') {
      extras.wd += 1 + e.byes
      bw.wides += 1 + e.byes
    } else {
      s.runs += e.bat
      s.balls++
      pair.balls++
      if (strikerIsA) pair.aBalls++
      else pair.bBalls++
      if (e.bat === 4) (s.fours++, bw.fours++, shots.fours++)
      else if (e.bat === 6) (s.sixes++, bw.sixes++, shots.sixes++)
      else if (e.bat === 1) shots.ones++
      else if (e.bat === 2) shots.twos++
      else if (e.bat === 3) shots.threes++
      else if (e.bat === 0 && e.byes === 0 && e.kind === 'legal') shots.dots++
      if (e.kind === 'nb') {
        extras.nb++
        bw.noBalls++
      }
      if (e.byes > 0) extras[e.byeType ?? 'b'] += e.byes
    }
    if (e.kind === 'legal') {
      legal++
      bw.balls++
      if (bowlerRuns(e) === 0) bw.dots++
    }
    if (e.wicket) {
      const out = batLine(e.wicket.who)
      out.out = { kind: e.wicket.kind, bowler: e.bowler, fielder: e.wicket.fielder }
      wicketKinds[e.wicket.kind] = (wicketKinds[e.wicket.kind] ?? 0) + 1
      if (BOWLER_WICKETS.includes(e.wicket.kind)) bw.wickets++
      over.wickets++
      fall(e.wicket.who)
    }
    over.total = total
    over.totalWickets = wickets
  }

  // Penalty runs the other innings awarded to this side.
  const fielding = inningsTotal(file, idx) - total
  if (fielding > 0) {
    extras.pen += fielding
    total += fielding
  }

  // A maiden: a full over by one bowler with nothing charged to them.
  for (const o of overLines) {
    const legalInOver = o.balls.filter((b) => b.kind === 'legal')
    if (legalInOver.length === BALLS && o.balls.every((b) => b.bowler === o.bowler && bowlerRuns(b) === 0)) bowlLine(o.bowler).maidens++
  }

  for (const id of [inn.crease.striker, inn.crease.nonStriker]) {
    if (!id) continue
    const l = batLine(id)
    l.atCrease = true
    l.retiredHurt = false
    l.onStrike = id === inn.crease.striker
  }
  if (inn.crease.bowler) bowlLine(inn.crease.bowler)

  extras.total = extras.wd + extras.nb + extras.b + extras.lb + extras.pen
  const summary: InningsSummary = {
    total,
    wickets,
    legal,
    overs: oversText(legal),
    runRate: rate(total, legal),
    extras,
    batters: [...bat.values()],
    bowlers: [...bowl.values()],
    yetToBat: battingSide(file, inn).xi.filter((id) => !bat.has(id)),
    fow,
    partnerships,
    overLines,
    shots,
    wicketKinds,
  }
  if (inn.target !== undefined) {
    summary.target = inn.target
    const balls = Math.max(0, inn.overs * BALLS - legal)
    const runs = Math.max(0, inn.target - total)
    summary.need = { runs, balls, rate: rate(runs, balls) }
  }
  return summary
}

// ---------- text ----------
type NameOf = (id: string) => string

export function howOut(l: BatLine, nameOf: NameOf): string {
  if (!l.out) return l.retiredHurt ? 'retired hurt' : l.atCrease ? 'batting' : 'not out'
  const b = l.out.bowler ? nameOf(l.out.bowler) : ''
  const f = l.out.fielder ? nameOf(l.out.fielder) : ''
  switch (l.out.kind) {
    case 'bowled':
      return `b ${b}`
    case 'caught':
      return `c ${f || 'sub'} b ${b}`
    case 'caught_behind':
      return `c †${f || 'wk'} b ${b}`
    case 'caught_bowled':
      return `c & b ${b}`
    case 'lbw':
      return `lbw b ${b}`
    case 'stumped':
      return `st †${f || 'wk'} b ${b}`
    case 'hit_wicket':
      return `hit wicket b ${b}`
    case 'run_out':
      return f ? `run out (${f})` : 'run out'
    case 'obstructing':
      return 'obstructing the field'
    case 'retired_out':
      return 'retired out'
    case 'timed_out':
      return 'timed out'
  }
}

/** Short token for the "this over" strip: • 1 4 6 W wd nb+2 lb1 … */
export function ballToken(b: BallEvent): string {
  let t: string
  if (b.kind === 'wd') t = b.byes ? `wd+${b.byes}` : 'wd'
  else if (b.kind === 'nb') t = b.bat ? `nb+${b.bat}` : b.byes ? `nb+${b.byes}${b.byeType ?? 'b'}` : 'nb'
  else if (b.byes) t = `${b.byes}${b.byeType ?? 'b'}`
  else t = b.bat === 0 ? '•' : String(b.bat)
  if (b.wicket) return t === '•' ? 'W' : `${t}W`
  return t
}

export type BallTone = 'wicket' | 'six' | 'four' | 'extra' | 'plain'
export function ballTone(b: BallEvent): BallTone {
  if (b.wicket) return 'wicket'
  if (b.kind !== 'wd' && b.bat === 6) return 'six'
  if (b.kind !== 'wd' && b.bat === 4) return 'four'
  if (b.kind !== 'legal' || b.byes > 0) return 'extra'
  return 'plain'
}

/** Where the batter stands on the ground map (unit circle, y down, bowler below). */
export const BATTER_POS: [number, number] = [0, -0.14]

/** Fielding region a shot went to. `left` = left-handed batter (mirror image). */
export function shotRegion(shot: [number, number], left = false): string {
  const dx = (shot[0] - BATTER_POS[0]) * (left ? -1 : 1)
  const dy = shot[1] - BATTER_POS[1]
  // 0° = straight back past the bowler; positive = leg side for a right-hander.
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI
  const a = Math.abs(deg)
  if (a <= 12) return 'straight down the ground'
  if (a > 168) return 'behind the wicket'
  if (deg > 0) return a <= 50 ? 'long on' : a <= 80 ? 'mid wicket' : a <= 115 ? 'square leg' : 'fine leg'
  return a <= 50 ? 'long off' : a <= 80 ? 'cover' : a <= 115 ? 'point' : 'third man'
}

const runsWord = (n: number) => (n === 1 ? '1 run' : `${n} runs`)

/** "Rishit to Asit, FOUR, to cover" */
export function ballText(b: BallEvent, nameOf: NameOf, isLeft: (id: string) => boolean = () => false): string {
  const head = `${nameOf(b.bowler)} to ${nameOf(b.striker)}`
  const parts: string[] = []
  if (b.kind === 'wd') parts.push(b.byes ? `wide, plus ${runsWord(b.byes)}` : 'wide')
  else {
    if (b.kind === 'nb') parts.push('no ball')
    if (b.byes) parts.push(`${b.byeType === 'lb' ? 'leg bye' : 'bye'}${b.byes === 4 ? ', FOUR' : `, ${runsWord(b.byes)}`}`)
    else if (b.bat === 4) parts.push('FOUR')
    else if (b.bat === 6) parts.push('SIX')
    else if (b.bat > 0) parts.push(runsWord(b.bat))
    else if (b.kind === 'legal' && !b.wicket) parts.push('no run')
  }
  if (b.shot) parts.push(`to ${shotRegion(b.shot, isLeft(b.striker))}`)
  if (b.wicket) {
    const line: BatLine = { id: b.wicket.who, runs: 0, balls: 0, fours: 0, sixes: 0, out: { kind: b.wicket.kind, bowler: b.bowler, fielder: b.wicket.fielder } }
    parts.push(`OUT! ${nameOf(b.wicket.who)} ${howOut(line, nameOf)}${b.wicket.at ? ` at ${shotRegion(b.wicket.at, isLeft(b.striker))}` : ''}`)
  }
  return `${head}, ${parts.join(', ')}`
}

/** "14.3" label of each ball in an over (a wide or no-ball shares the number of the ball that replaces it). */
export function ballNumbers(over: OverLine): string[] {
  let legal = 0
  return over.balls.map((b) => {
    const label = `${over.n - 1}.${Math.min(legal + 1, BALLS)}`
    if (b.kind === 'legal') legal++
    return label
  })
}

/** "154/6 (20.0)" for the match record. */
export function scoreLine(file: ScoreFile, idx: number): string {
  const inn: Innings | undefined = file.innings[idx]
  if (!inn) return ''
  const s = summarize(file, idx)
  return `${s.total}/${s.wickets} (${oversText(legalBalls(inn))})`
}
