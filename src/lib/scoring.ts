// The scoring engine (PLAN §25). Pure functions: each takes the match's score
// file and returns the next version. Nothing here touches the store or the
// clock except through the `at` stamp, so every rule is unit-tested.
//
// The ball-by-ball log is the only thing stored. Totals, the scorecard and the
// charts are worked out from it (lib/scorecard.ts), so Undo is "drop the last
// event" and fixing an old ball is "change it and recalculate".
import type { BallEvent, Crease, DeliveryKind, Innings, ScoreEvent, ScoreFile, ScoreSide, SideKey, WicketKind } from '../types'
import { nowStamp } from './dates'
import { uuid } from './uuid'

export const BALLS = 6

export const isBall = (e: ScoreEvent): e is BallEvent => e.t === 'ball'
export const other = (side: SideKey): SideKey => (side === 'home' ? 'away' : 'home')
export const ballsOf = (inn: Innings): BallEvent[] => inn.events.filter(isBall)

/** Every run the batting side gets from one delivery. */
export const ballRuns = (b: BallEvent): number => b.bat + b.byes + (b.kind === 'legal' ? 0 : 1)

/** Runs charged to the bowler: byes and leg-byes are not the bowler's fault. */
export const bowlerRuns = (b: BallEvent): number => (b.kind === 'wd' ? 1 + b.byes : b.bat + (b.kind === 'nb' ? 1 : 0))

export const legalBalls = (inn: Innings): number => ballsOf(inn).filter((b) => b.kind === 'legal').length

/** "14.3" — completed overs and balls. */
export const oversText = (balls: number): string => `${Math.floor(balls / BALLS)}.${balls % BALLS}`

/** Dismissals that go in the bowler's wickets column. */
export const BOWLER_WICKETS: WicketKind[] = ['bowled', 'caught', 'caught_behind', 'caught_bowled', 'lbw', 'stumped', 'hit_wicket']
/** The only ways to be out off a no-ball or a free hit. */
export const NO_BALL_WICKETS: WicketKind[] = ['run_out', 'obstructing']
export const WIDE_WICKETS: WicketKind[] = ['stumped', 'run_out', 'hit_wicket', 'obstructing']
const CAUGHT: WicketKind[] = ['caught', 'caught_behind', 'caught_bowled']

export function outIds(inn: Innings): Set<string> {
  const out = new Set<string>()
  for (const e of inn.events) {
    if (e.t === 'ball' && e.wicket) out.add(e.wicket.who)
    if (e.t === 'retire' && e.out) out.add(e.who)
  }
  return out
}

/** Runs of innings `idx`, including penalty runs awarded to that side in either innings. */
export function inningsTotal(file: ScoreFile, idx: number): number {
  const inn = file.innings[idx]
  if (!inn) return 0
  let total = 0
  for (const e of inn.events) {
    if (e.t === 'ball') total += ballRuns(e)
    else if (e.t === 'penalty' && e.to === 'batting') total += e.runs
  }
  const opp = file.innings[1 - idx]
  if (opp) for (const e of opp.events) if (e.t === 'penalty' && e.to === 'fielding') total += e.runs
  return total
}

export const currentIndex = (file: ScoreFile): number => file.innings.length - 1
export const currentInnings = (file: ScoreFile): Innings | undefined => file.innings[file.innings.length - 1]
export const battingSide = (file: ScoreFile, inn: Innings): ScoreSide => file[inn.batting]
export const bowlingSide = (file: ScoreFile, inn: Innings): ScoreSide => file[other(inn.batting)]

/** The delivery about to be bowled is a free hit (the last one was a no-ball, or a wide/no-ball during a free hit). */
export function isFreeHit(inn: Innings): boolean {
  const balls = ballsOf(inn)
  for (let i = balls.length - 1; i >= 0; i--) {
    if (balls[i].kind === 'nb') return true
    if (balls[i].kind === 'legal') return false
  }
  return false
}

/** Batters who can still come in: in the XI, not out, not in the middle. Retired-hurt batters may return. */
export function availableBatters(file: ScoreFile, inn: Innings): string[] {
  const out = outIds(inn)
  return battingSide(file, inn).xi.filter((id) => !out.has(id) && id !== inn.crease.striker && id !== inn.crease.nonStriker)
}

/** Who bowled the over before the one in progress — they may not bowl the next. */
export function previousOverBowler(inn: Innings): string | undefined {
  const balls = ballsOf(inn)
  const legal = legalBalls(inn)
  if (legal === 0) return undefined
  const overNow = Math.floor(legal / BALLS)
  let count = 0
  let last: string | undefined
  for (const b of balls) {
    const over = Math.floor(count / BALLS)
    if (over === overNow - 1) last = b.bowler
    if (b.kind === 'legal') count++
  }
  return last
}

/** True between overs: the next ball starts a new over, so a bowler must be picked. */
export const atOverStart = (inn: Innings): boolean => legalBalls(inn) % BALLS === 0

// ---------- closing an innings and the result ----------
function autoClose(file: ScoreFile, idx: number): Innings['closed'] {
  const inn = file.innings[idx]
  if (inn.target !== undefined && inningsTotal(file, idx) >= inn.target) return 'target'
  if (battingSide(file, inn).xi.length - outIds(inn).size < 2) return 'all_out'
  if (legalBalls(inn) >= inn.overs * BALLS) return 'overs'
  return undefined
}

function resultOf(file: ScoreFile): ScoreFile['result'] {
  const [first, second] = file.innings
  const target = second.target ?? inningsTotal(file, 0) + 1
  const chased = inningsTotal(file, 1)
  if (chased >= target) {
    const side = battingSide(file, second)
    const n = side.xi.length - 1 - outIds(second).size
    return { winner: second.batting, text: `${side.name} won by ${n} wicket${n === 1 ? '' : 's'}` }
  }
  if (chased === target - 1) return { text: 'Match tied' }
  const n = target - 1 - chased
  return { winner: first.batting, text: `${battingSide(file, first).name} won by ${n} run${n === 1 ? '' : 's'}` }
}

/** Brings target, innings closure, status and result in line with the log. Runs after every change. */
function settle(file: ScoreFile): ScoreFile {
  const innings = file.innings.map((inn) => ({ ...inn }))
  const next: ScoreFile = { ...file, innings, updatedAt: nowStamp() }
  if (innings[1] && !innings[1].targetRevised) innings[1].target = inningsTotal(next, 0) + 1
  const idx = innings.length - 1
  const inn = innings[idx]
  if (inn.closed !== 'ended') {
    const closed = autoClose(next, idx)
    if (closed) inn.closed = closed
    else delete inn.closed
  }
  delete next.result
  if (!inn.closed || idx === 0) delete next.awards // awards belong to a finished match
  if (!inn.closed) next.status = 'live'
  else if (idx === 0) next.status = 'break'
  else {
    next.status = 'finished'
    next.result = resultOf(next)
  }
  return next
}

function withInnings(file: ScoreFile, fn: (inn: Innings) => Innings): ScoreFile {
  const idx = currentIndex(file)
  return settle({ ...file, innings: file.innings.map((inn, i) => (i === idx ? fn(inn) : inn)) })
}

function openInnings(file: ScoreFile): Innings {
  const inn = currentInnings(file)
  if (!inn || inn.closed) throw new Error('This innings is over.')
  return inn
}

// ---------- starting ----------
export interface NewScoreInput {
  matchId: string
  teamId: string
  overs: number
  home: ScoreSide
  away: ScoreSide
  opponentId?: string
  toss: { wonBy: SideKey; chose: 'bat' | 'bowl' }
}

export function newScore(input: NewScoreInput): ScoreFile {
  if (!Number.isInteger(input.overs) || input.overs < 1 || input.overs > 100) throw new Error('Enter the number of overs (1–100).')
  for (const side of [input.home, input.away]) {
    if (side.xi.length < 2) throw new Error(`Pick at least 2 players for ${side.name}.`)
    if (new Set(side.xi).size !== side.xi.length) throw new Error(`A player is listed twice for ${side.name}.`)
  }
  if (input.home.xi.some((id) => input.away.xi.includes(id))) throw new Error('A player can’t be in both playing XIs.')
  const battingFirst = input.toss.chose === 'bat' ? input.toss.wonBy : other(input.toss.wonBy)
  const now = nowStamp()
  return {
    schemaVersion: 1,
    matchId: input.matchId,
    teamId: input.teamId,
    overs: input.overs,
    home: input.home,
    away: input.away,
    opponentId: input.opponentId,
    toss: input.toss,
    innings: [{ batting: battingFirst, overs: input.overs, events: [], crease: {} }],
    status: 'live',
    startedAt: now,
    updatedAt: now,
  }
}

export function startSecondInnings(file: ScoreFile): ScoreFile {
  if (file.innings.length !== 1 || !file.innings[0].closed) throw new Error('The first innings is not over yet.')
  const second: Innings = { batting: other(file.innings[0].batting), overs: file.overs, events: [], crease: {} }
  return settle({ ...file, innings: [file.innings[0], second] })
}

// ---------- who is in the middle ----------
/** Pick the striker, non-striker or bowler (openers, next batter, next over, a mid-over change). */
export function setCrease(file: ScoreFile, patch: Crease): ScoreFile {
  const inn = openInnings(file)
  const crease = { ...inn.crease, ...patch }
  const out = outIds(inn)
  const bat = battingSide(file, inn)
  const bowl = bowlingSide(file, inn)
  for (const id of [patch.striker, patch.nonStriker]) {
    if (id === undefined) continue
    if (!bat.xi.includes(id)) throw new Error('This player is not in the batting XI.')
    if (out.has(id)) throw new Error('This batter is already out.')
  }
  if (crease.striker && crease.striker === crease.nonStriker) throw new Error('Pick two different batters.')
  if (patch.bowler !== undefined) {
    if (!bowl.xi.includes(patch.bowler)) throw new Error('This player is not in the bowling XI.')
    if (atOverStart(inn) && previousOverBowler(inn) === patch.bowler) throw new Error('A bowler can’t bowl two overs in a row.')
  }
  return withInnings(file, (i) => ({ ...i, crease }))
}

export function swapStrike(file: ScoreFile): ScoreFile {
  openInnings(file)
  return withInnings(file, (i) => ({ ...i, crease: { ...i.crease, striker: i.crease.nonStriker, nonStriker: i.crease.striker } }))
}

// ---------- a delivery ----------
export interface BallInput {
  kind?: DeliveryKind
  bat?: number
  byes?: number
  byeType?: 'b' | 'lb'
  wicket?: { kind: WicketKind; who?: string; fielder?: string; at?: [number, number] }
  shot?: [number, number]
}

export function addBall(file: ScoreFile, input: BallInput): ScoreFile {
  const inn = openInnings(file)
  const { striker, nonStriker, bowler } = inn.crease
  if (!striker || !nonStriker) throw new Error('Pick the batters first.')
  if (!bowler) throw new Error('Pick the bowler first.')

  const kind = input.kind ?? 'legal'
  const bat = kind === 'wd' ? 0 : (input.bat ?? 0)
  const byes = input.byes ?? 0
  if (![bat, byes].every((n) => Number.isInteger(n) && n >= 0 && n <= 12)) throw new Error('Runs must be between 0 and 12.')
  if (bat > 0 && byes > 0) throw new Error('A ball is either runs off the bat or byes, not both.')

  let wicket: BallEvent['wicket']
  if (input.wicket) {
    const k = input.wicket.kind
    if (k === 'retired_out' || k === 'timed_out') throw new Error('Use Retire for this.')
    if (kind === 'wd' && !WIDE_WICKETS.includes(k)) throw new Error('That dismissal is not possible off a wide.')
    if ((kind === 'nb' || (isFreeHit(inn) && kind === 'legal')) && !NO_BALL_WICKETS.includes(k)) {
      throw new Error(kind === 'nb' ? 'Off a no-ball a batter can only be run out.' : 'On a free hit a batter can only be run out.')
    }
    const who = k === 'run_out' || k === 'obstructing' ? (input.wicket.who ?? striker) : striker
    if (who !== striker && who !== nonStriker) throw new Error('Pick which batter is out.')
    wicket = { kind: k, who, fielder: input.wicket.fielder || undefined }
    if (input.wicket.at) wicket.at = input.wicket.at
  }

  const ball: BallEvent = { t: 'ball', id: uuid(), striker, nonStriker, bowler, kind, bat, byes, at: nowStamp() }
  if (byes > 0 && kind !== 'wd') ball.byeType = input.byeType ?? 'b'
  if (wicket) ball.wicket = wicket
  if (input.shot) ball.shot = input.shot

  // Where everyone stands for the next ball.
  let next: Crease = { striker, nonStriker, bowler }
  const swap = () => (next = { ...next, striker: next.nonStriker, nonStriker: next.striker })
  if (wicket && CAUGHT.includes(wicket.kind)) {
    // The new batter always takes strike after a catch (unless the over ends).
    next.striker = undefined
  } else {
    if ((bat + byes) % 2 === 1) swap()
    if (wicket) {
      if (next.striker === wicket.who) next.striker = undefined
      else next.nonStriker = undefined
    }
  }
  if (kind === 'legal' && (legalBalls(inn) + 1) % BALLS === 0) {
    swap()
    next.bowler = undefined
  }
  return withInnings(file, (i) => ({ ...i, events: [...i.events, ball], crease: next }))
}

// ---------- between balls ----------
/** A batter leaves between balls: hurt (may come back later) or retired out. */
export function retire(file: ScoreFile, who: string, out: boolean): ScoreFile {
  const inn = openInnings(file)
  if (who !== inn.crease.striker && who !== inn.crease.nonStriker) throw new Error('Only a batter in the middle can retire.')
  const crease = { ...inn.crease }
  if (crease.striker === who) crease.striker = undefined
  else crease.nonStriker = undefined
  return withInnings(file, (i) => ({ ...i, events: [...i.events, { t: 'retire', id: uuid(), who, out, crease: { ...inn.crease }, at: nowStamp() }], crease }))
}

/** Penalty runs (normally 5) to the batting or the fielding side. */
export function penalty(file: ScoreFile, runs: number, to: 'batting' | 'fielding'): ScoreFile {
  const inn = openInnings(file)
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('Enter the penalty runs.')
  return withInnings(file, (i) => ({ ...i, events: [...i.events, { t: 'penalty', id: uuid(), runs, to, crease: { ...inn.crease }, at: nowStamp() }] }))
}

/** Close the innings by hand (declared, bad light, opponents left…). */
export function endInnings(file: ScoreFile): ScoreFile {
  openInnings(file)
  return withInnings(file, (i) => ({ ...i, closed: 'ended' }))
}

/** Reduce or extend the overs of the innings in progress (rain etc.). */
export function setOvers(file: ScoreFile, overs: number): ScoreFile {
  const inn = openInnings(file)
  if (!Number.isInteger(overs) || overs < 1 || overs > 100) throw new Error('Enter the number of overs (1–100).')
  if (overs * BALLS < legalBalls(inn)) throw new Error('More overs than that have already been bowled.')
  const next = withInnings(file, (i) => ({ ...i, overs }))
  return file.innings.length === 1 ? { ...next, overs } : next
}

/** Revised target for the chase. */
export function setTarget(file: ScoreFile, target: number): ScoreFile {
  if (file.innings.length !== 2) throw new Error('A target applies to the second innings.')
  if (!Number.isInteger(target) || target < 1) throw new Error('Enter the target.')
  return withInnings(file, (i) => ({ ...i, target, targetRevised: true }))
}

/** A player who turned up late (or a substitute) joins a side's XI mid-match. */
export function addToXi(file: ScoreFile, side: SideKey, id: string): ScoreFile {
  if (file.home.xi.includes(id) || file.away.xi.includes(id)) throw new Error('This player is already in the match.')
  return settle({ ...file, [side]: { ...file[side], xi: [...file[side].xi, id] } })
}

// ---------- corrections ----------
export const canUndo = (file: ScoreFile): boolean => file.innings.length > 1 || file.innings[0].events.length > 0 || !!file.innings[0].closed

/** Takes back the last thing that happened and puts the batters and bowler back as they were. */
export function undo(file: ScoreFile): ScoreFile {
  const idx = currentIndex(file)
  const inn = file.innings[idx]
  if (inn.closed === 'ended') return withInnings(file, ({ closed: _c, ...rest }) => rest)
  if (inn.events.length === 0) {
    if (idx === 0) return file
    return settle({ ...file, innings: [file.innings[0]] })
  }
  const last = inn.events[inn.events.length - 1]
  const crease: Crease = last.t === 'ball' ? { striker: last.striker, nonStriker: last.nonStriker, bowler: last.bowler } : last.crease
  return withInnings(file, (i) => ({ ...i, events: i.events.slice(0, -1), crease }))
}

/** Fix the runs or the shot direction of an earlier ball. To change a wicket or a wide/no-ball, undo back to it. */
export function editBall(file: ScoreFile, inningsIdx: number, ballId: string, patch: { bat: number; byes: number; byeType?: 'b' | 'lb'; shot?: [number, number] | null }): ScoreFile {
  const innings = file.innings.map((inn, i) => {
    if (i !== inningsIdx) return inn
    return {
      ...inn,
      events: inn.events.map((e) => {
        if (e.t !== 'ball' || e.id !== ballId) return e
        const bat = e.kind === 'wd' ? 0 : patch.bat
        if (bat > 0 && patch.byes > 0) throw new Error('A ball is either runs off the bat or byes, not both.')
        const next: BallEvent = { ...e, bat, byes: patch.byes }
        if (patch.byes > 0 && e.kind !== 'wd') next.byeType = patch.byeType ?? e.byeType ?? 'b'
        else delete next.byeType
        if (patch.shot === null) delete next.shot
        else if (patch.shot) next.shot = patch.shot
        return next
      }),
    }
  })
  return settle({ ...file, innings })
}
