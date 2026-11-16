// Data out / data in (PLAN §7.6, §16.9): JSON backup of every file except
// auth/ and push/, CSV exports, and restore.
import type { FundEntry, Match, Person, Team } from '../types'
import { METHOD_LABELS, RESULT_LABELS } from '../types'
import { nowStamp, todayISO } from './dates'
import { configOf, credsOf, fundsOf, isGuestIn, loadTeam, matchesOf, membersOf, peopleOf, recomputeTeam, teamPaths, teamsOf } from './domain'
import { signed } from './funds'
import { P } from './paths'
import type { Store } from './store'

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(value: string | number | boolean | undefined): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (rows: (string | number | boolean | undefined)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'

// ---------- backup ----------
export interface Backup {
  app: 'AllAroundCricket'
  version: 1
  exportedAt: string
  files: Record<string, unknown>
}

/** Every data file except PIN hashes (auth/) and push subscriptions (push/). */
export function backupPaths(s: Store): string[] {
  const scoring = teamsOf(s).flatMap((t) => matchesOf(s, t.id).filter((m) => m.scoring).map((m) => P.scoring(t.id, m.id)))
  return [P.config, P.categories, P.people, P.teams, P.opponents, P.tournaments, P.grounds, ...teamsOf(s).flatMap((t) => teamPaths(t.id)), ...scoring]
}

export async function buildBackup(s: Store): Promise<Backup> {
  // Make sure every team's files are loaded before exporting.
  await Promise.all(teamsOf(s).map((t) => loadTeam(s, t.id)))
  await Promise.all(backupPaths(s).map((p) => s.load(p).catch(() => null)))
  const files: Record<string, unknown> = {}
  for (const path of backupPaths(s)) {
    const data = s.get(path)
    if (data) files[path] = data
  }
  return { app: 'AllAroundCricket', version: 1, exportedAt: nowStamp(), files }
}

export function parseBackup(text: string): Backup {
  let data: Backup
  try {
    data = JSON.parse(text) as Backup
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (data?.app !== 'AllAroundCricket' || typeof data.files !== 'object' || !data.files) throw new Error('This is not an AllAroundCricket backup file.')
  return data
}

const RESTORABLE = (path: string) =>
  path === P.categories || path === P.people || path === P.teams || path === P.opponents || path === P.tournaments || path === P.grounds || /^teams\/[^/]+\/(members|matches|funds|availability)\.json$/.test(path) || /^teams\/[^/]+\/scoring\/[^/]+\.json$/.test(path)

/**
 * Replaces the current data with the backup's. The app config (admin, phone
 * salt, recovery hash) and all PINs are left as they are; a backup made from a
 * different data repo is refused because its phone hashes wouldn't match.
 */
export async function restoreBackup(s: Store, backup: Backup): Promise<number> {
  const current = configOf(s)
  const theirs = backup.files[P.config] as { phoneSalt?: string } | undefined
  if (!current) throw new Error('App data is not loaded yet.')
  if (theirs?.phoneSalt && theirs.phoneSalt !== current.phoneSalt) throw new Error('This backup was made from a different data repo, so it can’t be restored here.')

  let count = 0
  for (const [path, data] of Object.entries(backup.files)) {
    if (!RESTORABLE(path)) continue
    s.write(path, data, 'Restore from backup')
    count++
  }
  // Everyone in the restored list needs a credential record to be able to log in.
  const creds = credsOf(s)
  const missing = peopleOf(s).filter((p) => !p.isGuest && !creds.some((c) => c.personId === p.id))
  if (missing.length) {
    s.write(P.creds, { schemaVersion: 1, credentials: [...creds, ...missing.map((p) => ({ personId: p.id, sessionEpoch: 1, updatedAt: nowStamp() }))] }, 'Restore from backup')
  }
  for (const t of teamsOf(s)) recomputeTeam(s, t.id)
  if (!(await s.flush())) throw new Error('Restored on this device, but not all of it has reached the repo yet. It will keep retrying.')
  return count
}

// ---------- CSV ----------
function namer(people: Person[]) {
  const byId = new Map(people.map((p) => [p.id, p]))
  return (id: string, guest: boolean) => `${byId.get(id)?.name ?? 'Unknown'}${guest ? ' (guest)' : ''}`
}

/** Fund ledger for one team: one row per entry. */
export function fundsCsv(s: Store, team: Team): string {
  const members = membersOf(s, team.id)
  const matches = matchesOf(s, team.id)
  const name = namer(peopleOf(s))
  const entries = [...fundsOf(s, team.id)].sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt))
  const rows: (string | number | undefined)[][] = [['Team', 'Date', 'Player', 'Type', 'Amount', 'Effect on balance', 'Method', 'Match', 'Note']]
  for (const e of entries as FundEntry[]) {
    const m = matches.find((x) => x.id === e.matchId)
    rows.push([team.name, e.date, name(e.personId, isGuestIn(members, e.personId)), e.type, e.amount, signed(e), e.method ? METHOD_LABELS[e.method] : '', m ? `vs ${m.opponent} (${m.date})` : '', e.note])
  }
  return toCsv(rows)
}

/** Match expenses for one team: one row per player per match, with a column per category. */
export function expensesCsv(s: Store, team: Team): string {
  const members = membersOf(s, team.id)
  const name = namer(peopleOf(s))
  const matches = matchesOf(s, team.id)
    .filter((m): m is Match & { expense: NonNullable<Match['expense']> } => m.expense?.status === 'submitted')
    .sort((a, b) => a.date.localeCompare(b.date))
  // Category columns come from the snapshots stored with each match.
  const cats = new Map<string, string>()
  for (const m of matches) for (const l of m.expense.lines) cats.set(l.categoryId, l.categoryName)
  const catIds = [...cats.keys()]
  const rows: (string | number | boolean | undefined)[][] = [
    ['Team', 'Date', 'Opponent', 'Result', 'Status', 'Player', ...catIds.map((id) => cats.get(id)!), 'Share', 'From funds', 'Pending', 'Settled', 'Settled method', 'Settled date', 'Note'],
  ]
  for (const m of matches) {
    for (const sh of m.expense.shares) {
      rows.push([
        team.name,
        m.date,
        m.opponent,
        m.result ? RESULT_LABELS[m.result] : '',
        m.lifecycle,
        name(sh.personId, isGuestIn(members, sh.personId)),
        ...catIds.map((id) => sh.byCategory[id] ?? ''),
        sh.total,
        sh.fromFunds,
        sh.pending,
        sh.settled ? 'yes' : 'no',
        sh.settledMethod ? METHOD_LABELS[sh.settledMethod] : '',
        sh.settledAt?.slice(0, 10),
        sh.settledNote,
      ])
    }
  }
  return toCsv(rows)
}

export const stampedName = (base: string, ext: string) => `${base}-${todayISO()}.${ext}`
