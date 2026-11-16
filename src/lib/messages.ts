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

/** The match's expense split: what was spent, each player's share and how it is covered. */
export function expenseMessage(match: Match, team: Team, people: Person[]): string {
  const e = match.expense
  if (!e || e.status !== 'submitted') return ''
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unknown'
  const total = e.lines.reduce((s, l) => s + l.total, 0)
  const shares = [...e.shares].filter((s) => s.total > 0).sort((a, b) => name(a.personId).localeCompare(name(b.personId)))
  const toCollect = shares.reduce((s, sh) => s + (sh.settled ? 0 : sh.pending), 0)
  const how = (sh: (typeof shares)[number]) => {
    if (sh.pending === 0) return 'from fund ✓'
    if (sh.settled) return `paid${sh.settledMethod && sh.settledMethod !== 'funds' ? ` by ${sh.settledMethod === 'upi' ? 'UPI' : METHOD_LABELS[sh.settledMethod].toLowerCase()}` : ''} ✓`
    return sh.fromFunds > 0 ? `${money(sh.fromFunds)} from fund, *${money(sh.pending)} to pay*` : `*${money(sh.pending)} to pay*`
  }
  return [
    `💰 *${team.name} vs ${match.opponent}* — ${fmtDate(match.date, false)}`,
    '',
    '*Expenses*',
    ...e.lines.map((l) => `${l.categoryName}: ${money(l.total)}`),
    `Total: *${money(total)}* · ${shares.length} player${shares.length === 1 ? '' : 's'}`,
    '',
    '*Each player*',
    ...shares.map((sh) => `${name(sh.personId)} — ${money(sh.total)} (${how(sh)})`),
    '',
    toCollect > 0 ? `Still to collect: *${money(toCollect)}*` : 'All settled ✅',
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
