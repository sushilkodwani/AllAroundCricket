// Pure logic of the expense notifier (PLAN §22) — no git, no network, so it can
// be unit-tested. notify.mjs feeds it files read from the data repo.

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
export const money = (n) => `₹${inr.format(Number(n) || 0)}`

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dateLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  return `${DOW[date.getUTCDay()]} ${date.getUTCDate()} ${MON[date.getUTCMonth()]}`
}

const submitted = (match) => match?.expense?.status === 'submitted'
const shareOf = (match, personId) => match?.expense?.shares?.find((s) => s.personId === personId)
const shareKey = (s) => (s ? `${s.total}|${s.fromFunds}|${s.pending}` : '')

/**
 * Compares a team's matches.json before and after.
 *  - not submitted → submitted  ⇒ "posted" for everyone in the squad or the split
 *  - submitted → submitted with a new submittedAt ⇒ "updated" only for people
 *    whose share total / from-funds / pending changed
 */
export function expenseEvents(beforeMatches, afterMatches) {
  const before = new Map((beforeMatches ?? []).map((m) => [m.id, m]))
  const events = []
  for (const match of afterMatches ?? []) {
    if (!submitted(match) || match.cancelled) continue
    const old = before.get(match.id)
    const everyone = [...new Set([...(match.squad ?? []), ...match.expense.shares.map((s) => s.personId)])]
    if (!submitted(old)) {
      events.push({ kind: 'posted', match, personIds: everyone })
    } else if (old.expense.submittedAt !== match.expense.submittedAt) {
      const changed = everyone.filter((id) => shareKey(shareOf(old, id)) !== shareKey(shareOf(match, id)))
      if (changed.length) events.push({ kind: 'updated', match, previous: old, personIds: changed })
    }
  }
  return events
}

/**
 * Subscriptions that should get an event: the person is concerned, still has
 * view access, the phone's session is current (a PIN reset or log out stops
 * it), and they are not the admin who submitted.
 */
export function recipients(event, { people, credentials, subscriptions, actorId }) {
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const epoch = new Map((credentials ?? []).map((c) => [c.personId, c.sessionEpoch]))
  return (subscriptions ?? []).filter((sub) => {
    if (!event.personIds.includes(sub.personId)) return false
    if (sub.personId === actorId) return false
    const person = byId.get(sub.personId)
    if (!person || person.access !== 'view') return false
    return epoch.get(sub.personId) === sub.sessionEpoch
  })
}

/** A player's fund balance from the team's ledger. */
export function balanceOf(entries, personId) {
  let sum = 0
  for (const e of entries ?? []) {
    if (e.personId !== personId) continue
    sum += e.type === 'contribution' || e.type === 'adjustment' ? e.amount : -e.amount
  }
  return sum
}

/** The personalised notification for one person (PLAN §22.5). */
export function buildMessage(event, personId, { team, person, fundEntries }) {
  const { match } = event
  const share = shareOf(match, personId)
  const total = match.expense.lines.reduce((s, l) => s + l.total, 0)
  // The team name is only needed by someone who is in several teams.
  const prefix = (person?.teamIds?.length ?? 0) > 1 && team?.shortName ? `${team.shortName} ` : ''
  const title = `💰 ${prefix}vs ${match.opponent} · ${dateLabel(match.date)} — expenses ${event.kind === 'posted' ? 'posted' : 'updated'}`

  let body
  if (event.kind === 'updated') {
    const was = shareOf(event.previous, personId)
    if (!share) body = `Expenses updated — you’re no longer paying for this one.`
    else {
      const now = `Expenses updated — your share is now ${money(share.total)}${was ? ` (was ${money(was.total)})` : ''}.`
      body = share.pending > 0 && !share.settled ? `${now} ${money(share.pending)} to pay.` : `${now} Nothing more to pay.`
    }
  } else if (!share) {
    body = `Match total ${money(total)}. You’re not paying for this one.`
  } else if (share.pending === 0) {
    body = share.total === 0 ? `Match total ${money(total)}. Nothing for you to pay.` : `Your share ${money(share.total)} was paid from your fund ✓. Fund left: ${money(balanceOf(fundEntries, personId))}.`
  } else if (share.fromFunds > 0) {
    body = `Your share ${money(share.total)}: ${money(share.fromFunds)} from your fund, ${money(share.pending)} to pay the admin.`
  } else {
    body = `Your share is ${money(share.total)} — please pay the admin.`
  }

  return { title, body, tag: `match-${match.id}`, url: `#/teams/${match.teamId}/matches/${match.id}` }
}

/** Push "topic" header: collapses undelivered updates for the same match. Max 32 URL-safe chars. */
export const topicFor = (matchId) => `m${String(matchId).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 32)
