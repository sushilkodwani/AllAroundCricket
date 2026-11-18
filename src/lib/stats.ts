// Derived match status and team summary stats (PLAN §6.4, §6.6, §16.8).
import type { FundEntry, Match, MatchResult, Membership, TeamStats } from '../types'
import { nowHM, todayISO } from './dates'
import { pendingDues, teamFund } from './funds'

export type MatchStatus = 'cancelled' | 'completed' | 'settling' | 'upcoming' | 'awaiting'

export const STATUS_LABELS: Record<MatchStatus, string> = {
  cancelled: 'Cancelled',
  completed: 'Completed',
  settling: 'Settlement pending',
  upcoming: 'Upcoming',
  awaiting: 'Awaiting completion',
}

/** Completion is explicit (lifecycle), never guessed from the date. */
export function matchStatus(m: Match, today = todayISO(), hm = nowHM()): MatchStatus {
  if (m.cancelled) return 'cancelled'
  if (m.lifecycle === 'completed') return 'completed'
  if (m.lifecycle === 'settling') return 'settling'
  const future = m.date > today || (m.date === today && (!m.time || m.time > hm))
  return future ? 'upcoming' : 'awaiting'
}

/** "Mark complete" opens on the match day (PLAN §16.1). */
export function canMarkComplete(m: Match, today = todayISO()): boolean {
  return !m.cancelled && m.lifecycle === 'scheduled' && m.date <= today
}

const byDateAsc = (a: Match, b: Match) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''))

export function emptyStats(): TeamStats {
  return {
    activePlayers: 0,
    matchesTotal: 0,
    played: 0,
    won: 0,
    lost: 0,
    tied: 0,
    draw: 0,
    noResult: 0,
    upcoming: 0,
    form: [],
    awaitingCompletion: 0,
    fundBalance: 0,
    pendingDues: 0,
    settlingMatches: 0,
    playersToSettle: 0,
  }
}

export function computeTeamStats(
  members: Membership[],
  matches: Match[],
  funds: FundEntry[],
  today = todayISO(),
  hm = nowHM(),
): TeamStats {
  const live = matches.filter((m) => !m.cancelled).sort(byDateAsc)
  const completed = live.filter((m) => m.lifecycle === 'completed')
  const count = (r: MatchResult) => completed.filter((m) => m.result === r).length
  const upcoming = live.filter((m) => matchStatus(m, today, hm) === 'upcoming')
  const past = live.filter((m) => matchStatus(m, today, hm) !== 'upcoming')
  const next = upcoming[0]
  const last = past[past.length - 1]

  const stats: TeamStats = {
    activePlayers: members.filter((m) => m.status === 'active').length,
    matchesTotal: live.length,
    played: completed.length,
    won: count('won'),
    lost: count('lost'),
    tied: count('tied'),
    draw: count('draw'),
    noResult: count('no_result') + count('abandoned'),
    upcoming: upcoming.length,
    form: completed
      .filter((m) => m.result)
      .slice(-5)
      .map((m) => m.result!),
    awaitingCompletion: live.filter((m) => matchStatus(m, today, hm) === 'awaiting').length,
    fundBalance: teamFund(funds),
    pendingDues: pendingDues(matches),
    settlingMatches: live.filter((m) => m.lifecycle === 'settling').length,
    playersToSettle: live.filter((m) => m.lifecycle === 'settling').reduce((n, m) => n + (m.expense?.shares ?? []).filter((sh) => !sh.settled).length, 0),
  }
  if (next) stats.nextMatch = { id: next.id, date: next.date, time: next.time, opponent: next.opponent, venue: next.venue }
  if (last) stats.lastMatch = { id: last.id, date: last.date, opponent: last.opponent, result: last.result }
  return stats
}

/** Win % = won / (won + lost + tied); null until there is one such result. */
export function winPercent(s: Pick<TeamStats, 'won' | 'lost' | 'tied'>): number | null {
  const n = s.won + s.lost + s.tied
  return n === 0 ? null : Math.round((s.won / n) * 100)
}

/** Completed matches a person was in the squad for. */
export function playedCount(matches: Match[], personId: string): number {
  return matches.filter((m) => !m.cancelled && m.lifecycle === 'completed' && m.squad.includes(personId)).length
}

export function lastPlayed(matches: Match[], personId: string): Match | undefined {
  return matches
    .filter((m) => !m.cancelled && m.lifecycle === 'completed' && m.squad.includes(personId))
    .sort(byDateAsc)
    .pop()
}

export const sortMatchesAsc = (matches: Match[]) => [...matches].sort(byDateAsc)
