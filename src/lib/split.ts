// Expense split + funds-first allocation (PLAN §15).
import type { ExpenseLine, PlayerShare } from '../types'

export const MAX_LINE = 1_000_000

export interface SplitInput {
  lines: ExpenseLine[]
  payerIds: string[]
  /** Each payer's fund balance, NOT counting this match's own earlier deductions. */
  available: Record<string, number>
}

export interface LineSplit {
  participants: number
  perHead: number
}

export interface SplitResult {
  shares: PlayerShare[]
  /** categoryId → how that line divides. */
  perLine: Record<string, LineSplit>
  total: number
  fromFunds: number
  toCollect: number
  /** Rupees collected above the exact totals because per-head amounts round up. Never booked to the fund. */
  roundingExtra: number
}

export const participantsOf = (line: ExpenseLine, payerIds: string[]) => payerIds.filter((id) => !line.excludedPersonIds.includes(id))

export function computeSplit({ lines, payerIds, available }: SplitInput): SplitResult {
  const byPerson = new Map<string, Record<string, number>>(payerIds.map((id) => [id, {}]))
  const perLine: Record<string, LineSplit> = {}
  let total = 0
  let roundingExtra = 0

  for (const line of lines) {
    if (!(line.total > 0)) continue
    const who = participantsOf(line, payerIds)
    if (who.length === 0) continue // reported by validateSplit
    // Round UP to the next rupee so everyone in a line pays the same.
    const perHead = Math.ceil(line.total / who.length)
    perLine[line.categoryId] = { participants: who.length, perHead }
    total += line.total
    roundingExtra += perHead * who.length - line.total
    for (const id of who) byPerson.get(id)![line.categoryId] = perHead
  }

  const shares: PlayerShare[] = payerIds.map((personId) => {
    const byCategory = byPerson.get(personId)!
    const shareTotal = Object.values(byCategory).reduce((s, n) => s + n, 0)
    const fromFunds = Math.min(Math.max(0, available[personId] ?? 0), shareTotal)
    const pending = shareTotal - fromFunds
    const share: PlayerShare = { personId, byCategory, total: shareTotal, fromFunds, pending, settled: pending === 0 }
    if (share.settled && fromFunds > 0) share.settledMethod = 'funds'
    return share
  })

  const fromFunds = shares.reduce((s, x) => s + x.fromFunds, 0)
  return { shares, perLine, total, fromFunds, toCollect: shares.reduce((s, x) => s + x.pending, 0), roundingExtra }
}

/** Reasons the split can't be submitted yet; empty when it can. */
export function validateSplit(lines: ExpenseLine[], payerIds: string[]): string[] {
  const errors: string[] = []
  if (payerIds.length === 0) errors.push('At least one player must be paying.')
  for (const line of lines) {
    if (!Number.isInteger(line.total) || line.total < 0) errors.push(`${line.categoryName}: enter whole rupees.`)
    else if (line.total > MAX_LINE) errors.push(`${line.categoryName}: the most a line can be is ₹10,00,000.`)
    else if (line.mode === 'mandatory' && line.total <= 0) errors.push(`${line.categoryName} is required.`)
    if (line.total > 0 && payerIds.length > 0 && participantsOf(line, payerIds).length === 0) {
      errors.push(`${line.categoryName}: nobody is sharing this — include at least one player.`)
    }
  }
  if (!errors.length && !lines.some((l) => l.total > 0)) errors.push('Enter at least one expense amount.')
  return errors
}

export interface ReopenedShare {
  personId: string
  was: number
  now: number
}

/**
 * Re-submitting a split: a share the admin had settled by hand (cash/UPI) stays
 * settled only if the amount due is unchanged; otherwise it needs settling again.
 */
export function carrySettlements(next: PlayerShare[], prev: PlayerShare[] = []): { shares: PlayerShare[]; reopened: ReopenedShare[] } {
  const reopened: ReopenedShare[] = []
  const shares = next.map((share) => {
    const old = prev.find((p) => p.personId === share.personId)
    const manual = old?.settled && old.settledMethod && old.settledMethod !== 'funds'
    if (!manual || share.pending === 0) return share
    if (old!.pending === share.pending) {
      return { ...share, settled: true, settledAt: old!.settledAt, settledMethod: old!.settledMethod, settledNote: old!.settledNote }
    }
    reopened.push({ personId: share.personId, was: old!.pending, now: share.pending })
    return share
  })
  return { shares, reopened }
}
