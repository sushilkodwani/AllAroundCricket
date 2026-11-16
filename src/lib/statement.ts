// One player's money statement for a team (PLAN §36): every fund entry and
// every match share in date order, with the totals. Derived, never stored.
import type { FundEntry, Match } from '../types'
import { METHOD_LABELS } from '../types'
import { fmtDayMonth, money } from './dates'
import { balanceOf, duesOf } from './funds'

export interface StatementLine {
  date: string
  label: string
  note?: string
  /** Effect on the fund balance (+ in, − out); 0 for money paid directly. */
  fund: number
  /** Still owed for this line. */
  pending: number
  matchId?: string
}

export interface Statement {
  lines: StatementLine[]
  contributed: number
  refunded: number
  adjustments: number
  /** Total of the player's match shares. */
  shares: number
  fromFunds: number
  /** Paid to the admin directly (cash / UPI). */
  paidDirect: number
  pending: number
  balance: number
  matches: number
}

export function buildStatement(funds: FundEntry[], matches: Match[], personId: string): Statement {
  const lines: (StatementLine & { order: string })[] = []
  const st: Statement = { lines: [], contributed: 0, refunded: 0, adjustments: 0, shares: 0, fromFunds: 0, paidDirect: 0, pending: 0, balance: balanceOf(funds, personId), matches: 0 }

  for (const e of funds) {
    if (e.personId !== personId || e.type === 'match_deduction') continue // deductions show on the match line
    const method = e.method ? ` · ${METHOD_LABELS[e.method]}` : ''
    if (e.type === 'contribution') {
      st.contributed += e.amount
      lines.push({ date: e.date, label: `Contribution${method}`, note: e.note, fund: e.amount, pending: 0, order: e.date + e.createdAt })
    } else if (e.type === 'refund') {
      st.refunded += e.amount
      lines.push({ date: e.date, label: `Refund${method}`, note: e.note, fund: -e.amount, pending: 0, order: e.date + e.createdAt })
    } else {
      st.adjustments += e.amount
      lines.push({ date: e.date, label: 'Adjustment', note: e.note, fund: e.amount, pending: 0, order: e.date + e.createdAt })
    }
  }

  for (const m of matches) {
    if (m.cancelled || m.expense?.status !== 'submitted') continue
    const share = m.expense.shares.find((s) => s.personId === personId)
    if (!share || share.total === 0) continue
    st.matches++
    st.shares += share.total
    st.fromFunds += share.fromFunds
    const owed = share.settled ? 0 : share.pending
    const direct = share.settled && share.settledMethod !== 'funds' ? share.pending : 0
    st.paidDirect += direct
    st.pending += owed
    const how = [
      share.fromFunds > 0 ? `${money(share.fromFunds)} from fund` : null,
      direct > 0 ? `${money(direct)} paid ${share.settledMethod ? METHOD_LABELS[share.settledMethod].toLowerCase() : ''}`.trim() : null,
      owed > 0 ? `${money(owed)} due` : null,
    ].filter(Boolean)
    lines.push({ date: m.date, label: `vs ${m.opponent} — share ${money(share.total)}`, note: how.join(' · '), fund: -share.fromFunds, pending: owed, matchId: m.id, order: m.date + '~' })
  }

  st.lines = lines.sort((a, b) => a.order.localeCompare(b.order)).map(({ order: _o, ...l }) => l)
  return st
}

/** Plain-text version for WhatsApp. */
export function statementText(st: Statement, name: string, teamName: string): string {
  const out = [`${teamName} — statement for ${name}`, '']
  for (const l of st.lines) out.push(`${fmtDayMonth(l.date)}  ${l.label}${l.note ? ` (${l.note})` : ''}`)
  out.push('', `Contributed: ${money(st.contributed)}`, `Match shares: ${money(st.shares)} over ${st.matches} match${st.matches === 1 ? '' : 'es'}`, `Fund balance: ${money(st.balance)}`)
  if (st.pending > 0) out.push(`To pay: ${money(st.pending)}`)
  return out.join('\n')
}

/** Short reminder the admin can paste into a chat. */
export function duesText(matches: Match[], personId: string, name: string, teamName: string): string {
  const dues = duesOf(matches, personId)
  const total = dues.reduce((s, d) => s + d.pending, 0)
  const parts = dues.map((d) => `${money(d.pending)} for vs ${d.match.opponent} (${fmtDayMonth(d.match.date)})`)
  return `Hi ${name.split(' ')[0]}, a reminder from ${teamName}: ${money(total)} is pending — ${parts.join(', ')}. Please pay when you can. Thanks!`
}

// ---------- year-end summary (PLAN §43) ----------
export interface YearRow {
  personId: string
  /** Completed matches the player was in the squad for. */
  played: number
  /** Total of their match shares. */
  shares: number
  /** Money they handed over: fund contributions (less refunds) plus direct payments. */
  paid: number
  pending: number
  /** Share per match played; null when they did not play. */
  perMatch: number | null
}

/** One row per player with any activity in the calendar year (matches by match date, money by entry date). */
export function yearSummary(funds: FundEntry[], matches: Match[], year: string): YearRow[] {
  const rows = new Map<string, YearRow>()
  const get = (personId: string) => {
    let r = rows.get(personId)
    if (!r) rows.set(personId, (r = { personId, played: 0, shares: 0, paid: 0, pending: 0, perMatch: null }))
    return r
  }
  for (const e of funds) {
    if (!e.date.startsWith(year)) continue
    if (e.type === 'contribution') get(e.personId).paid += e.amount
    else if (e.type === 'refund') get(e.personId).paid -= e.amount
  }
  for (const m of matches) {
    if (m.cancelled || !m.date.startsWith(year)) continue
    if (m.lifecycle === 'completed') for (const id of m.squad) get(id).played++
    if (m.expense?.status !== 'submitted') continue
    for (const sh of m.expense.shares) {
      if (sh.total === 0) continue
      const r = get(sh.personId)
      r.shares += sh.total
      if (sh.settled && sh.settledMethod !== 'funds') r.paid += sh.pending
      else if (!sh.settled) r.pending += sh.pending
    }
  }
  for (const r of rows.values()) r.perMatch = r.played > 0 ? Math.round(r.shares / r.played) : null
  return [...rows.values()]
}

/** Years that have any match or fund entry, newest first. */
export function activeYears(funds: FundEntry[], matches: Match[]): string[] {
  return [...new Set([...funds.map((e) => e.date.slice(0, 4)), ...matches.filter((m) => !m.cancelled).map((m) => m.date.slice(0, 4))])].sort().reverse()
}