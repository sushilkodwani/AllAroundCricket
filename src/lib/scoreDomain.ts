// Store-side of live scoring (PLAN §24): reads and writes the match's score
// file, and keeps the match record (matches.json) in step at the two moments
// that matter to everyone else — scoring started, match finished.
import type { MatchResult, ScoreFile, ScoreSide, SideKey } from '../types'
import { addOpponentPlayers, getMatch, patchMatch } from './domain'
import { P } from './paths'
import { scoreLine } from './scorecard'
import { newScore, squadOf } from './scoring'
import type { Store } from './store'

export const scoreOf = (s: Store, teamId: string, matchId: string) => s.get<ScoreFile>(P.scoring(teamId, matchId))

/** What the match record shows once the game is over. `home` is always our team. */
export function matchOutcome(file: ScoreFile): { result: MatchResult; ourScore: string; theirScore: string } | null {
  if (file.status !== 'finished' || !file.result) return null
  const idxOf = (side: SideKey) => file.innings.findIndex((i) => i.batting === side)
  return {
    result: file.result.winner === 'home' ? 'won' : file.result.winner === 'away' ? 'lost' : 'tied',
    ourScore: scoreLine(file, idxOf('home')),
    theirScore: scoreLine(file, idxOf('away')),
  }
}

function syncMatch(s: Store, file: ScoreFile): void {
  const match = getMatch(s, file.teamId, file.matchId)
  if (!match) return
  const outcome = matchOutcome(file)
  const scoring = outcome ? 'finished' : 'live'
  if (match.scoring === scoring && (!outcome || (match.result === outcome.result && match.ourScore === outcome.ourScore && match.theirScore === outcome.theirScore))) return
  // matches.json changes only here (start / finish), never per ball — the notifier Action watches that file.
  patchMatch(s, file.teamId, file.matchId, (m) => ({ ...m, scoring, ...(outcome ?? {}) }), outcome ? `Result: ${file.result!.text}` : 'Live scoring')
}

export function saveScore(s: Store, file: ScoreFile, message: string): void {
  if (!s.write(P.scoring(file.teamId, file.matchId), file, message)) throw new Error('Only the admin can score a match.')
  syncMatch(s, file)
}

export interface StartInput {
  teamId: string
  matchId: string
  overs: number
  opponentId: string
  home: ScoreSide
  away: ScoreSide
  toss: { wonBy: SideKey; chose: 'bat' | 'bowl' }
  allDirections?: boolean
  powerplay?: number
  askShotType?: boolean
  askSide?: boolean
}

export function startScoring(s: Store, input: StartInput): ScoreFile {
  const match = getMatch(s, input.teamId, input.matchId)
  if (!match) throw new Error('Match not found.')
  if (match.cancelled) throw new Error('This match is cancelled.')
  if (scoreOf(s, input.teamId, input.matchId)) throw new Error('Scoring has already started for this match.')
  const file = newScore(input)
  addOpponentPlayers(s, input.opponentId, squadOf(input.away))
  patchMatch(s, input.teamId, input.matchId, (m) => ({
    ...m,
    overs: input.overs,
    opponentId: input.opponentId,
    // The XI picked here is the squad: keep the match card and Squad section in step.
    squad: m.lifecycle === 'scheduled' ? [...new Set([...m.squad, ...input.home.xi])] : m.squad,
  }), 'Start live scoring')
  saveScore(s, file, `Start scoring vs ${input.away.name}`)
  return file
}

/** Apply one engine step to the stored score. Throws the engine's message when the step is not allowed. */
export function applyScore(s: Store, teamId: string, matchId: string, step: (file: ScoreFile) => ScoreFile, message: string): ScoreFile {
  const file = scoreOf(s, teamId, matchId)
  if (!file) throw new Error('Scoring has not started for this match.')
  const next = step(file)
  if (next !== file) saveScore(s, next, message)
  return next
}
