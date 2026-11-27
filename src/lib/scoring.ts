// The scoring engine (PLAN §25). Pure functions: each takes the match's score
// file and returns the next version. Nothing here touches the store or the
// clock except through the `at` stamp, so every rule is unit-tested.
//
// The ball-by-ball log is the only thing stored. Totals, the scorecard and the
// charts are worked out from it (lib/scorecard.ts), so Undo is "drop the last
// event" and fixing an old ball is "change it and recalculate".
import type { BallEvent, Crease, DeliveryKind, Drop, Innings, ScoreEvent, ScoreFile, ScoreSide, ShotType, SideKey, WicketKind } from '../types'
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
/** Dismissals that must name the fielder (or keeper) involved. */
export const FIELDER_REQUIRED: WicketKind[] = ['caught', 'caught_behind', 'stumped', 'run_out']

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

/** Everyone who played for a side: the XI and any substitutes. */
export const squadOf = (side: { xi: string[]; subs?: string[] }): string[] => (side.subs?.length ? [...side.xi, ...side.subs] : side.xi)

/** Batters who can still come in: in the XI, not out, not in the middle. Retired-hurt batters may return. */
export function availableBatters(file: ScoreFile, inn: Innings): string[] {
  const out = outIds(inn)
  return squadOf(battingSide(file, inn)).filter((id) => !out.has(id) && id !== inn.crease.striker && id !== inn.crease.nonStriker)
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

// ---------- how many overs a bowler may bowl ----------
/** At least this many bowlers share the overs of every innings. */
export const MIN_BOWLERS = 5

export interface BowlingRule {
  /** Overs every bowler may bowl. */
  base: number
  /** How many bowlers may bowl one over more than that. */
  extra: number
  /** The most any single bowler may bowl. */
  max: number
}

/**
 * Five bowlers at least, sharing the overs as evenly as possible: 15 overs → 3 each; 16 → one bowler
 * may bowl 4 and the rest 3; 17 → two may bowl 4; 18 → three; 19 → four; 20 → 4 each.
 * (A side with fewer than five players shares among all of them.)
 */
export function bowlingRule(overs: number, sideSize: number = MIN_BOWLERS): BowlingRule {
  const bowlers = Math.max(1, Math.min(MIN_BOWLERS, sideSize))
  const base = Math.floor(overs / bowlers)
  const extra = overs % bowlers
  return { base, extra, max: extra > 0 ? base + 1 : base }
}

/** The rule in words, for the picker: "At most 4 overs each — only 2 bowlers may bowl 4, the rest 3." */
export function bowlingRuleText(rule: BowlingRule): string {
  const ov = (n: number) => `${n} over${n === 1 ? '' : 's'}`
  if (rule.extra === 0) return `At most ${ov(rule.max)} each.`
  return `At most ${ov(rule.max)} each — only ${rule.extra} bowler${rule.extra === 1 ? '' : 's'} may bowl ${rule.max}, the rest ${rule.base}.`
}

/** Overs each bowler has been part of in this innings (an over they started or finished counts). */
export function oversBowledBy(inn: Innings): Map<string, number> {
  const seen = new Map<string, Set<number>>()
  let legal = 0
  for (const b of ballsOf(inn)) {
    const over = Math.floor(legal / BALLS)
    if (!seen.has(b.bowler)) seen.set(b.bowler, new Set())
    seen.get(b.bowler)!.add(over)
    if (b.kind === 'legal') legal++
  }
  return new Map([...seen].map(([id, s]) => [id, s.size]))
}

function rawBowlerBlock(inn: Innings, id: string, rule: BowlingRule, bowled: Map<string, number>): string | null {
  const count = bowled.get(id) ?? 0
  if (count >= rule.max) return `already bowled the most overs allowed (${rule.max})`
  if (rule.extra > 0 && count === rule.base) {
    const atMax = [...bowled.values()].filter((n) => n >= rule.max).length
    if (atMax >= rule.extra) return `only ${rule.extra} bowler${rule.extra === 1 ? '' : 's'} may bowl ${rule.max} overs`
  }
  return null
}

/**
 * Why this player may not bowl next, or null when they may. Never leaves the scorer stuck: if the rule
 * would block everyone who is allowed to bowl, nobody is blocked by it.
 */
export function bowlerBlock(file: ScoreFile, inn: Innings, id: string): string | null {
  const bowl = bowlingSide(file, inn)
  const rule = bowlingRule(inn.overs, bowl.xi.length)
  const bowled = oversBowledBy(inn)
  // The bowler already bowling this over is not taking up a new over.
  if (id === inn.crease.bowler && !atOverStart(inn)) return null
  const reason = rawBowlerBlock(inn, id, rule, bowled)
  if (!reason) return null
  const last = atOverStart(inn) ? previousOverBowler(inn) : undefined
  const anyoneElse = squadOf(bowl).some((other) => other !== id && other !== last && !rawBowlerBlock(inn, other, rule, bowled))
  return anyoneElse ? reason : null
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
  allDirections?: boolean
  /** Powerplay overs (0 = none). */
  powerplay?: number
  askShotType?: boolean
  askSide?: boolean
}

export function newScore(input: NewScoreInput): ScoreFile {
  if (!input.toss?.wonBy || !input.toss.chose) throw new Error('Record the toss: who won it and what they chose.')
  if (!Number.isInteger(input.overs) || input.overs < 1 || input.overs > 100) throw new Error('Enter the number of overs (1–100).')
  for (const side of [input.home, input.away]) {
    if (side.xi.length < 2) throw new Error(`Pick at least 2 players for ${side.name}.`)
    if (side.xi.length > 11) throw new Error(`${side.name} has ${side.xi.length} players — a side plays 11 at most.`)
    if (new Set(squadOf(side)).size !== squadOf(side).length) throw new Error(`A player is listed twice for ${side.name}.`)
    if (side.captainId && !side.xi.includes(side.captainId)) throw new Error(`${side.name}: the captain must be in the playing XI.`)
  }
  if (input.powerplay !== undefined && (!Number.isInteger(input.powerplay) || input.powerplay < 0 || input.powerplay >= input.overs)) throw new Error(`Powerplay overs must be between 0 and ${input.overs - 1}.`)
  if (squadOf(input.home).some((id) => squadOf(input.away).includes(id))) throw new Error('A player can’t be in both playing XIs.')
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
    ...(input.allDirections ? { allDirections: true } : {}),
    ...(input.powerplay !== undefined ? { powerplay: input.powerplay } : {}),
    ...(input.askShotType ? { askShotType: true } : {}),
    ...(input.askSide ? { askSide: true } : {}),
    status: 'live',
    startedAt: now,
    updatedAt: now,
  }
}

/** Turn on or off asking the shot type / over or round the wicket. */
export function setAsk(file: ScoreFile, key: 'askShotType' | 'askSide', on: boolean): ScoreFile {
  if (!!file[key] === on) return file
  const next = { ...file, updatedAt: nowStamp() }
  if (on) next[key] = true
  else delete next[key]
  return next
}

/** Turn on or off asking where 1s, 2s and 3s went. */
export function setAllDirections(file: ScoreFile, on: boolean): ScoreFile {
  if (!!file.allDirections === on) return file
  const next = { ...file, updatedAt: nowStamp() }
  if (on) next.allDirections = true
  else delete next.allDirections
  return next
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
    if (!squadOf(bat).includes(id)) throw new Error('This player is not in the batting XI.')
    if (out.has(id)) throw new Error('This batter is already out.')
  }
  if (crease.striker && crease.striker === crease.nonStriker) throw new Error('Pick two different batters.')
  if (patch.bowler !== undefined) {
    if (!squadOf(bowl).includes(patch.bowler)) throw new Error('This player is not in the bowling XI.')
    if (atOverStart(inn) && previousOverBowler(inn) === patch.bowler) throw new Error('A bowler can’t bowl two overs in a row.')
    if (patch.bowler !== inn.crease.bowler) {
      const block = bowlerBlock(file, inn, patch.bowler)
      if (block) throw new Error(`This bowler can’t bowl another over: ${block}.`)
    }
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
  shotType?: ShotType
  /** A catch was put down off this ball. */
  drop?: Drop
}

/** Checks a dropped catch and returns it tidy: a fielder of the fielding side, not on a wide, not with a catch out. */
export function cleanDrop(file: ScoreFile, inn: Innings, drop: Drop, ball: { kind: DeliveryKind; wicket?: { kind: WicketKind } }): Drop {
  if (ball.kind === 'wd') throw new Error('A catch cannot be dropped off a wide.')
  if (ball.wicket && CAUGHT.includes(ball.wicket.kind)) throw new Error('A ball cannot be both a catch taken and a catch dropped.')
  if (!drop.by || !squadOf(bowlingSide(file, inn)).includes(drop.by)) throw new Error('Pick the fielder who dropped it from the fielding side.')
  return { by: drop.by, ...(drop.at ? { at: drop.at } : {}), ...(drop.tough ? { tough: true } : {}) }
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
    const fielder = input.wicket.fielder || undefined
    if (FIELDER_REQUIRED.includes(k) && !fielder) throw new Error(k === 'caught' ? 'Pick who took the catch.' : k === 'run_out' ? 'Pick who ran the batter out.' : 'Pick the wicket-keeper.')
    wicket = { kind: k, who, fielder }
    if (input.wicket.at) wicket.at = input.wicket.at
  }

  const ball: BallEvent = { t: 'ball', id: uuid(), striker, nonStriker, bowler, kind, bat, byes, at: nowStamp() }
  if (byes > 0 && kind !== 'wd') ball.byeType = input.byeType ?? 'b'
  if (wicket) ball.wicket = wicket
  if (input.shot) ball.shot = input.shot
  if (input.shotType && kind !== 'wd') ball.shotType = input.shotType
  if (input.drop) ball.drop = cleanDrop(file, inn, input.drop, { kind, wicket })
  if (inn.crease.side) ball.side = inn.crease.side

  // Where everyone stands for the next ball (over or round the wicket carries on until the over ends).
  let next: Crease = { striker, nonStriker, bowler, ...(inn.crease.side ? { side: inn.crease.side } : {}) }
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
    delete next.side
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

/** A player who turned up late joins a side's XI mid-match; once the side has 11, a newcomer plays as a substitute. */
export function addToXi(file: ScoreFile, side: SideKey, id: string): ScoreFile {
  if (squadOf(file.home).includes(id) || squadOf(file.away).includes(id)) throw new Error('This player is already in the match.')
  const s = file[side]
  const next = s.xi.length >= 11 ? { ...s, subs: [...(s.subs ?? []), id] } : { ...s, xi: [...s.xi, id] }
  return settle({ ...file, [side]: next })
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
  const crease: Crease = last.t === 'ball' ? { striker: last.striker, nonStriker: last.nonStriker, bowler: last.bowler, ...(last.side ? { side: last.side } : {}) } : last.crease
  return withInnings(file, (i) => ({ ...i, events: i.events.slice(0, -1), crease }))
}

/** Fix the runs or the shot direction of an earlier ball. To change a wicket or a wide/no-ball, undo back to it. */
export function editBall(file: ScoreFile, inningsIdx: number, ballId: string, patch: { bat: number; byes: number; byeType?: 'b' | 'lb'; shot?: [number, number] | null; shotType?: ShotType | null; drop?: Drop | null }): ScoreFile {
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
        if (patch.shotType === null) delete next.shotType
        else if (patch.shotType) next.shotType = patch.shotType
        if (patch.drop === null) delete next.drop
        else if (patch.drop) next.drop = cleanDrop(file, inn, patch.drop, e)
        return next
      }),
    }
  })
  return settle({ ...file, innings })
}
