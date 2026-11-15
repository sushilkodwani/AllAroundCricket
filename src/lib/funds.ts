// Team fund maths (PLAN §14.3). Everything here is derived — never stored.
import type { FundEntry, Match } from '../types'

/** Effect of one ledger entry on the player's balance. */
export function signed(e: FundEntry): number {
  switch (e.type) {
    case 'contribution':
      return e.amount
    case 'adjustment':
      return e.amount // already signed
    case 'match_deduction':
    case 'refund':
      return -e.amount
  }
}

/** A player's balance; `excludeMatchId` ignores that match's own deductions (for re-submitting a split). */
export function balanceOf(entries: FundEntry[], personId: string, excludeMatchId?: string): number {
  let sum = 0
  for (const e of entries) {
    if (e.personId !== personId) continue
    if (excludeMatchId && e.type === 'match_deduction' && e.matchId === excludeMatchId) continue
    sum += signed(e)
  }
  return sum
}

export function balances(entries: FundEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) out.set(e.personId, (out.get(e.personId) ?? 0) + signed(e))
  return out
}

export const teamFund = (entries: FundEntry[]) => entries.reduce((sum, e) => sum + signed(e), 0)

const sumOf = (entries: FundEntry[], type: FundEntry['type'], personId?: string) =>
  entries.filter((e) => e.type === type && (!personId || e.personId === personId)).reduce((sum, e) => sum + e.amount, 0)

export const collected = (entries: FundEntry[], personId?: string) => sumOf(entries, 'contribution', personId)
export const usedForMatches = (entries: FundEntry[], personId?: string) => sumOf(entries, 'match_deduction', personId)

const isSettling = (m: Match) => !m.cancelled && m.lifecycle === 'settling' && m.expense?.status === 'submitted'

/** Total still owed across matches that are being settled. */
export function pendingDues(matches: Match[]): number {
  let sum = 0
  for (const m of matches) {
    if (!isSettling(m)) continue
    for (const s of m.expense!.shares) if (!s.settled) sum += s.pending
  }
  return sum
}

export interface Due {
  match: Match
  pending: number
}

/** One person's unsettled dues, oldest match first. */
export function duesOf(matches: Match[], personId: string): Due[] {
  const out: Due[] = []
  for (const m of matches) {
    if (!isSettling(m)) continue
    const share = m.expense!.shares.find((s) => s.personId === personId)
    if (share && !share.settled && share.pending > 0) out.push({ match: m, pending: share.pending })
  }
  return out.sort((a, b) => a.match.date.localeCompare(b.match.date))
}

export const duesTotal = (matches: Match[], personId: string) => duesOf(matches, personId).reduce((s, d) => s + d.pending, 0)

/** People whose balance would be below ₹0 — any change producing one is blocked. */
export function negativeBalances(entries: FundEntry[]): string[] {
  return [...balances(entries).entries()].filter(([, v]) => v < 0).map(([id]) => id)
}
