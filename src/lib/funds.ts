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

// ---------- charts ----------
const inOrder = (entries: FundEntry[]) => [...entries].sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt))

/** The team fund after each ledger entry, oldest first. */
export function fundTimeline(entries: FundEntry[]): { date: string; balance: number }[] {
  let balance = 0
  return inOrder(entries).map((e) => {
    balance += signed(e)
    return { date: e.date, balance }
  })
}

export interface MonthFlow {
  /** "2026-11" */
  month: string
  moneyIn: number
  moneyOut: number
}

/** Money paid in and money spent or paid back, month by month (only months with something in them). */
export function monthlyFlow(entries: FundEntry[]): MonthFlow[] {
  const m = new Map<string, MonthFlow>()
  for (const e of entries) {
    const month = e.date.slice(0, 7)
    let x = m.get(month)
    if (!x) m.set(month, (x = { month, moneyIn: 0, moneyOut: 0 }))
    const v = signed(e)
    if (v >= 0) x.moneyIn += v
    else x.moneyOut += -v
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export const shortMonth = (month: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(2, 4)}`

const submitted = (m: Match) => !m.cancelled && m.expense?.status === 'submitted'

/** What each match cost in total, oldest first. */
export function matchCosts(matches: Match[]): { match: Match; total: number }[] {
  return matches
    .filter(submitted)
    .map((match) => ({ match, total: match.expense!.lines.reduce((s, l) => s + l.total, 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => (a.match.date + (a.match.time ?? '')).localeCompare(b.match.date + (b.match.time ?? '')))
}

/** Total spent on each expense category across all submitted matches, biggest first. */
export function spendByCategory(matches: Match[]): { name: string; total: number }[] {
  const m = new Map<string, number>()
  for (const x of matches.filter(submitted)) for (const l of x.expense!.lines) if (l.total > 0) m.set(l.categoryName, (m.get(l.categoryName) ?? 0) + l.total)
  return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total)
}

/** Who owes how much right now, biggest first. */
export function duesByPlayer(matches: Match[]): { personId: string; total: number }[] {
  const m = new Map<string, number>()
  for (const x of matches) {
    if (!isSettling(x)) continue
    for (const s of x.expense!.shares) if (!s.settled && s.pending > 0) m.set(s.personId, (m.get(s.personId) ?? 0) + s.pending)
  }
  return [...m.entries()].map(([personId, total]) => ({ personId, total })).sort((a, b) => b.total - a.total)
}
