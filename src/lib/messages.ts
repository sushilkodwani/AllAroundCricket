// Ready-to-send WhatsApp messages (PLAN §45). Plain text with WhatsApp's
// *bold* marks; built here so the wording is unit-tested.
import type { Match, Person, Team } from '../types'
import { METHOD_LABELS, ROLE_SHORT } from '../types'
import { fmtDate, fmtTime, money } from './dates'

const SQUAD_SIZE = 11

/** "Squad for …" with a numbered list, padded with TBD up to eleven. */
export function squadMessage(match: Match, team: Team, people: Person[]): string {
  const byId = new Map(people.map((p) => [p.id, p]))
  const names = match.squad
    .map((id) => byId.get(id))
    .filter((p): p is Person => !!p)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}${p.role ? ` (${ROLE_SHORT[p.role]})` : ''}`)
  while (names.length < SQUAD_SIZE) names.push('TBD')
  const lines = [
    `🏏 *${team.name} vs ${match.opponent}*`,
    `📅 ${fmtDate(match.date)}${match.time ? ` · ${fmtTime(match.time)}` : ''}`,
    match.venue ? `📍 ${match.venue}` : null,
    match.overs ? `${match.overs} overs a side` : null,
    '',
    `*Squad* (${match.squad.length}${match.squad.length < SQUAD_SIZE ? ` of ${SQUAD_SIZE}` : ''})`,
    ...names.map((n, i) => `${i + 1}. ${n}`),
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/**
 * The match's expense split, grouped so it reads at a glance: the costs, how
 * they were divided (once, when everyone pays alike), who still pays, who is done.
 */
export function expenseMessage(match: Match, team: Team, people: Person[]): string {
  const e = match.expense
  if (!e || e.status !== 'submitted') return ''
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unknown'
  const total = e.lines.reduce((s, l) => s + l.total, 0)
  const shares = [...e.shares].filter((s) => s.total > 0).sort((a, b) => name(a.personId).localeCompare(name(b.personId)))
  type Share = (typeof shares)[number]

  // What a player's total is made of, e.g. "Match fee ₹500 + Balls ₹150".
  const division = (sh: Share) =>
    e.lines.filter((l) => (sh.byCategory?.[l.categoryId] ?? 0) > 0).map((l) => `${l.categoryName} ${money(sh.byCategory[l.categoryId])}`)
  const bullets = (items: string[]) => items.map((x) => `   ◦ ${x}`)
  const parts = shares.map((sh) => division(sh).join('|'))
  const sameForAll = shares.length > 0 && parts[0] !== '' && parts.every((p) => p === parts[0]) && shares.every((sh) => sh.total === shares[0].total)

  const open = shares.filter((sh) => !sh.settled && sh.pending > 0)
  const done = shares.filter((sh) => !open.includes(sh))
  const toCollect = open.reduce((n, sh) => n + sh.pending, 0)
  const method = (sh: Share) =>
    sh.pending === 0 ? 'from fund' : sh.settledMethod && sh.settledMethod !== 'funds' ? (sh.settledMethod === 'upi' ? 'UPI' : METHOD_LABELS[sh.settledMethod].toLowerCase()) : 'paid'
  // When shares differ each player is a small block (name line, sub-bullets, blank line between players).
  const block = (sh: Share, head: string): string[] => (sameForAll ? [head] : [head, ...bullets(division(sh)), ''])
  const list = (items: string[][]) => (sameForAll ? items.flat() : items.flat().slice(0, -1))

  return [
    `💰 *${team.name} vs ${match.opponent}* · ${fmtDate(match.date, false)}`,
    '',
    `*Costs* · ${money(total)}`,
    ...e.lines.map((l) => `• ${l.categoryName} ${money(l.total)}`),
    '',
    `*Split* · ${shares.length} player${shares.length === 1 ? '' : 's'}`,
    ...(sameForAll ? [`${money(shares[0].total)} each:`, ...bullets(division(shares[0]))] : ['Shares differ, so each is shown below.']),
    ...(open.length ? ['', `⏳ *To pay · ${money(toCollect)}*`, ...list(open.map((sh) => block(sh, `• ${name(sh.personId)} — ${money(sh.pending)}${sh.fromFunds > 0 ? ` (+${money(sh.fromFunds)} from fund)` : ''}`)))] : []),
    ...(done.length ? ['', '✅ *Settled*', ...list(done.map((sh) => block(sh, `• ${name(sh.personId)} — ${money(sh.total)} (${method(sh)})`)))] : []),
    '',
    open.length ? 'Please pay the admin and let them know. Thanks!' : 'All settled ✅',
  ].join('\n')
}

/** Shares text through the phone's share sheet, or copies it where that is missing. */
export async function shareMessage(text: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
    await navigator.share({ text }).catch(() => {})
    return 'shared'
  }
  await navigator.clipboard?.writeText(text)
  return 'copied'
}
