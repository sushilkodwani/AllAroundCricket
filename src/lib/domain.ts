// Every change to cricket data goes through one of these functions. They read
// the current files from the store, build the next version and write it back
// (the store handles the access guard, debouncing, sync and merging).
// Validation failures throw an Error whose message is shown to the user.
import type {
  AdminRecord,
  AdminsFile,
  AppConfig,
  CategoryMode,
  Credential,
  CredentialsFile,
  ExpenseCategoriesFile,
  ExpenseCategory,
  ExpenseLine,
  FundEntry,
  FundsFile,
  Match,
  MatchesFile,
  MatchExpense,
  MatchResult,
  MatchType,
  AvailabilityEntry,
  AvailabilityFile,
  BowlStyle,
  Ground,
  GroundsFile,
  PlayerRole,
  AvailabilityStatus,
  MembersFile,
  Membership,
  Opponent,
  OutboxFile,
  OpponentsFile,
  PayMethod,
  PeopleFile,
  Person,
  Team,
  TeamsFile,
} from '../types'
import { nowStamp, todayISO } from './dates'
import { balanceOf, duesOf, negativeBalances } from './funds'
import { P } from './paths'
import { hashPhone, last4 } from './phone'
import { carrySettlements, computeSplit, validateSplit, type ReopenedShare } from './split'
import { canMarkComplete, computeTeamStats, emptyStats } from './stats'
import type { Store } from './store'
import { uuid } from './uuid'

// ---------- typed readers ----------
export const configOf = (s: Store) => s.get<AppConfig>(P.config)
export const peopleOf = (s: Store) => s.get<PeopleFile>(P.people)?.people ?? []
export const credsOf = (s: Store) => s.get<CredentialsFile>(P.creds)?.credentials ?? []
export const teamsOf = (s: Store) => s.get<TeamsFile>(P.teams)?.teams ?? []
export const adminsOf = (s: Store) => s.get<AdminsFile>(P.admins)?.admins ?? []
export const categoriesOf = (s: Store, teamId: string) => s.get<ExpenseCategoriesFile>(P.categories(teamId))?.categories ?? []
export const membersOf = (s: Store, teamId: string) => s.get<MembersFile>(P.members(teamId))?.members ?? []
export const matchesOf = (s: Store, teamId: string) => s.get<MatchesFile>(P.matches(teamId))?.matches ?? []
export const fundsOf = (s: Store, teamId: string) => s.get<FundsFile>(P.funds(teamId))?.entries ?? []

const putPeople = (s: Store, people: Person[], msg: string) => s.write(P.people, { schemaVersion: 1, people }, msg)
const putCreds = (s: Store, credentials: Credential[], msg: string) => s.write(P.creds, { schemaVersion: 1, credentials }, msg)
const putTeams = (s: Store, teams: Team[], msg: string) => s.write(P.teams, { schemaVersion: 1, teams }, msg)
const putMembers = (s: Store, teamId: string, members: Membership[], msg: string) =>
  s.write(P.members(teamId), { schemaVersion: 1, members }, msg)
const putMatches = (s: Store, teamId: string, matches: Match[], msg: string) =>
  s.write(P.matches(teamId), { schemaVersion: 1, matches }, msg)
const putFunds = (s: Store, teamId: string, entries: FundEntry[], msg: string) =>
  s.write(P.funds(teamId), { schemaVersion: 1, entries }, msg)
const putCategories = (s: Store, teamId: string, categories: ExpenseCategory[], msg: string) =>
  s.write(P.categories(teamId), { schemaVersion: 1, categories }, msg)

/** Who is making the change (the store's actor). */
const actorId = (s: Store) => s.actor.personId

/** The three files a team cannot work without; availability answers and categories are loaded alongside. */
const coreTeamPaths = (teamId: string) => [P.members(teamId), P.matches(teamId), P.funds(teamId)]
export const teamPaths = (teamId: string) => [...coreTeamPaths(teamId), P.availability(teamId), P.categories(teamId)]
export const teamLoaded = (s: Store, teamId: string) => coreTeamPaths(teamId).every((p) => s.has(p))
export const loadTeam = (s: Store, teamId: string) => Promise.all(teamPaths(teamId).map((p) => s.load(p)))

const personName = (s: Store, id: string) => peopleOf(s).find((p) => p.id === id)?.name ?? 'Player'
const teamName = (s: Store, id: string) => teamsOf(s).find((t) => t.id === id)?.name ?? 'team'
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 40)

function requireName(name: string): string {
  const n = cleanName(name)
  if (!n) throw new Error('Enter a name.')
  return n
}

// ---------- derived data kept in step ----------
/** Recomputes the team's card stats; written in the same batch as the change that caused it. */
export function recomputeTeam(s: Store, teamId: string): void {
  if (!teamLoaded(s, teamId)) return
  const teams = teamsOf(s)
  const team = teams.find((t) => t.id === teamId)
  if (!team) return
  const stats = computeTeamStats(membersOf(s, teamId), matchesOf(s, teamId), fundsOf(s, teamId))
  if (JSON.stringify(stats) === JSON.stringify(team.stats)) return
  putTeams(s, teams.map((t) => (t.id === teamId ? { ...t, stats } : t)), `Update stats for ${team.name}`)
}

/** Keeps Person.teamIds (active memberships) equal to what the team's member list says. */
function syncPersonTeams(s: Store, teamId: string, msg: string): void {
  const active = new Set(membersOf(s, teamId).filter((m) => m.status === 'active').map((m) => m.personId))
  let changed = false
  const people = peopleOf(s).map((p) => {
    const has = p.teamIds.includes(teamId)
    const should = active.has(p.id)
    if (has === should) return p
    changed = true
    return { ...p, teamIds: should ? [...p.teamIds, teamId] : p.teamIds.filter((t) => t !== teamId), updatedAt: nowStamp() }
  })
  if (changed) putPeople(s, people, msg)
}

function patchPerson(s: Store, personId: string, patch: Partial<Person>, msg: string): void {
  putPeople(s, peopleOf(s).map((p) => (p.id === personId ? { ...p, ...patch, updatedAt: nowStamp() } : p)), msg)
}

function ensureCredential(s: Store, personId: string): void {
  const creds = credsOf(s)
  if (creds.some((c) => c.personId === personId)) return
  putCreds(s, [...creds, { personId, sessionEpoch: 1, updatedAt: nowStamp() }], 'Add credential record')
}

// ---------- teams ----------
export function shortNameFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 4)
    .toUpperCase()
}

export interface TeamInput {
  name: string
  shortName?: string
  color: string
  homeGround?: string
}

function checkTeamName(s: Store, name: string, exceptId?: string): void {
  const taken = teamsOf(s).some((t) => !t.archived && t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase())
  if (taken) throw new Error('A team with this name already exists.')
}

/** A new team belongs to the admin who creates it. It starts with the usual expense categories. */
export function createTeam(s: Store, input: TeamInput): Team {
  const name = requireName(input.name)
  checkTeamName(s, name)
  const adminId = actorId(s)
  if (!adminId) throw new Error('Log in again to create a team.')
  const now = nowStamp()
  const team: Team = {
    id: uuid(),
    name,
    shortName: (input.shortName?.trim() || shortNameFor(name)).slice(0, 4).toUpperCase(),
    color: input.color,
    homeGround: input.homeGround?.trim() || undefined,
    adminId,
    archived: false,
    createdAt: now,
    updatedAt: now,
    stats: emptyStats(),
  }
  // teams.json first: the write guard checks who runs the team before its own files are written.
  if (!putTeams(s, [...teamsOf(s), team], `Create team ${name}`)) throw new Error('You can’t create teams.')
  putMembers(s, team.id, [], `Create team ${name}`)
  putMatches(s, team.id, [], `Create team ${name}`)
  putFunds(s, team.id, [], `Create team ${name}`)
  putCategories(s, team.id, seedCategories(), `Create team ${name}`)
  return team
}

export function updateTeam(s: Store, teamId: string, input: TeamInput & { lowBalanceThreshold?: number }): void {
  const name = requireName(input.name)
  checkTeamName(s, name, teamId)
  putTeams(
    s,
    teamsOf(s).map((t) =>
      t.id === teamId
        ? {
            ...t,
            name,
            shortName: (input.shortName?.trim() || shortNameFor(name)).slice(0, 4).toUpperCase(),
            color: input.color,
            homeGround: input.homeGround?.trim() || undefined,
            lowBalanceThreshold: input.lowBalanceThreshold === undefined ? t.lowBalanceThreshold : Math.max(0, Math.round(input.lowBalanceThreshold)),
            updatedAt: nowStamp(),
          }
        : t,
    ),
    `Edit team ${name}`,
  )
}

export function setTeamArchived(s: Store, teamId: string, archived: boolean): void {
  const team = teamsOf(s).find((t) => t.id === teamId)
  if (!team) return
  if (!archived) checkTeamName(s, team.name, teamId)
  putTeams(s, teamsOf(s).map((t) => (t.id === teamId ? { ...t, archived, updatedAt: nowStamp() } : t)), `${archived ? 'Archive' : 'Restore'} team ${team.name}`)
}

/**
 * Deletes a team and everything in it: players list, matches, scores, funds,
 * availability, categories and logo. Players stay as people (they may play
 * elsewhere); the team is taken off their lists. The team's files must be loaded.
 */
export function deleteTeam(s: Store, teamId: string): void {
  if (!teamLoaded(s, teamId)) throw new Error('The team is still loading. Try again in a moment.')
  const name = teamName(s, teamId)
  const msg = `Delete team ${name}`
  const scored = matchesOf(s, teamId).filter((m) => m.scoring).map((m) => P.scoring(teamId, m.id))
  // The team's own files first, while the guard still knows who runs it.
  for (const path of [...scored, P.members(teamId), P.matches(teamId), P.funds(teamId), P.availability(teamId), P.categories(teamId), P.teamLogo(teamId)]) {
    if (!s.remove(path, msg)) throw new Error('Only the admin who runs this team can delete it.')
  }
  const people = peopleOf(s)
  if (people.some((p) => p.teamIds.includes(teamId) || p.guestOfTeamIds?.includes(teamId))) {
    putPeople(
      s,
      people.map((p) =>
        p.teamIds.includes(teamId) || p.guestOfTeamIds?.includes(teamId)
          ? { ...p, teamIds: p.teamIds.filter((t) => t !== teamId), guestOfTeamIds: p.guestOfTeamIds?.filter((t) => t !== teamId), updatedAt: nowStamp() }
          : p,
      ),
      msg,
    )
  }
  putTeams(s, teamsOf(s).filter((t) => t.id !== teamId), msg)
}

// ---------- players ----------
export type PlayerLookup =
  | { kind: 'new'; phoneHash: string }
  | { kind: 'active'; person: Person }
  | { kind: 'removed'; person: Person }
  | { kind: 'elsewhere'; person: Person; teamNames: string[] }

/** What adding this number to the team would mean — drives the add-player sheet's messages. */
export async function lookupPlayer(s: Store, teamId: string, phone: string): Promise<PlayerLookup> {
  const config = configOf(s)
  if (!config) throw new Error('App data is not loaded yet.')
  const phoneHash = await hashPhone(phone, config.phoneSalt)
  const person = peopleOf(s).find((p) => p.phoneHash === phoneHash)
  if (!person) return { kind: 'new', phoneHash }
  const membership = membersOf(s, teamId).find((m) => m.personId === person.id)
  if (membership?.status === 'active') return { kind: 'active', person }
  if (membership) return { kind: 'removed', person }
  const teams = teamsOf(s)
  return { kind: 'elsewhere', person, teamNames: person.teamIds.map((id) => teams.find((t) => t.id === id)?.name ?? '').filter(Boolean) }
}

function activate(s: Store, teamId: string, personId: string, msg: string): void {
  const members = membersOf(s, teamId)
  const now = nowStamp()
  const existing = members.find((m) => m.personId === personId)
  putMembers(
    s,
    teamId,
    existing
      ? members.map((m) => (m.personId === personId ? { personId, teamId, status: 'active' as const, joinedAt: m.joinedAt, updatedAt: now } : m))
      : [...members, { personId, teamId, status: 'active', joinedAt: now, updatedAt: now }],
    msg,
  )
  syncPersonTeams(s, teamId, msg)
  recomputeTeam(s, teamId)
}

/** Adds a brand-new person to the team's master list. They get view access automatically. */
export function addNewPlayer(s: Store, teamId: string, name: string, phone: string, phoneHash: string): Person {
  const now = nowStamp()
  const person: Person = {
    id: uuid(),
    name: requireName(name),
    phoneHash,
    phoneLast4: last4(phone),
    access: 'view',
    isGuest: false,
    teamIds: [],
    createdAt: now,
    updatedAt: now,
  }
  const msg = `Add ${person.name} to ${teamName(s, teamId)}`
  putPeople(s, [...peopleOf(s), person], msg)
  ensureCredential(s, person.id)
  activate(s, teamId, person.id, msg)
  return person
}

/** Adds (or re-adds) someone who already exists as a person. */
export function addExistingPlayer(s: Store, teamId: string, personId: string, opts: { grantAccess?: boolean } = {}): void {
  const person = peopleOf(s).find((p) => p.id === personId)
  if (!person) return
  if (!person.phoneHash) throw new Error('Add a mobile number first — team members need one.')
  const msg = `Add ${person.name} to ${teamName(s, teamId)}`
  // Join first: once they are in this admin's team, the admin may update their record.
  activate(s, teamId, personId, msg)
  const patch: Partial<Person> = {}
  if (person.isGuest) {
    patch.isGuest = false
    patch.access = 'view'
  }
  if (opts.grantAccess) patch.access = 'view'
  if (Object.keys(patch).length) patchPerson(s, personId, patch, msg)
  ensureCredential(s, personId)
}

/**
 * Where this person still appears: a team they belong to, played or paid in,
 * an opponent they played for, or an admin role. null = nowhere, safe to delete.
 * Needs every team's files loaded; answers 'not loaded' otherwise.
 */
export function personInUse(s: Store, personId: string): string | null {
  if (isStaff(s, personId)) return 'is an admin'
  const p = peopleOf(s).find((x) => x.id === personId)
  if (p && (p.teamIds.length || p.guestOfTeamIds?.length)) return 'is still in a team'
  for (const t of teamsOf(s)) {
    if (!teamLoaded(s, t.id)) return 'not loaded'
    if (membersOf(s, t.id).some((m) => m.personId === personId)) return `is on the ${t.name} list`
    if (matchesOf(s, t.id).some((m) => m.squad.includes(personId) || m.expense?.shares.some((sh) => sh.personId === personId))) return `played for ${t.name}`
    if (fundsOf(s, t.id).some((e) => e.personId === personId)) return `has money records in ${t.name}`
  }
  const opp = opponentsOf(s).find((o) => o.playerIds.includes(personId))
  if (opp) return `played for ${opp.name}`
  return null
}

/** Removes a person completely: record, PIN and photo. Only for someone who appears nowhere (see personInUse). */
function erasePerson(s: Store, personId: string, msg: string): void {
  const creds = credsOf(s)
  if (creds.some((c) => c.personId === personId)) putCreds(s, creds.filter((c) => c.personId !== personId), msg)
  if (peopleOf(s).find((p) => p.id === personId)?.photo) s.remove(P.personPhoto(personId), msg)
  putPeople(s, peopleOf(s).filter((p) => p.id !== personId), msg)
}

/**
 * Takes a player off the team completely (no "removed" entry left behind).
 * Not while they have a fund balance or unpaid dues in this team — settle or
 * refund first. Past scorecards and money records keep their name. Someone who
 * then appears nowhere at all is deleted as a person too. Returns whether that happened.
 */
export async function deletePlayer(s: Store, teamId: string, personId: string): Promise<{ personDeleted: boolean }> {
  const name = personName(s, personId)
  const funds = fundsOf(s, teamId)
  const matches = matchesOf(s, teamId)
  const balance = balanceOf(funds, personId)
  if (balance !== 0) throw new Error(`${name} has ₹${balance} in the team fund. Refund or adjust it to ₹0 first.`)
  if (duesOf(matches, personId).length) throw new Error(`${name} still has unpaid match dues. Settle them first.`)
  const msg = `Delete ${name} from ${teamName(s, teamId)}`
  putMembers(s, teamId, membersOf(s, teamId).filter((m) => m.personId !== personId), msg)
  // Out of squads of matches still to be played, and out of their availability answers.
  const upcoming = matches.filter((m) => m.lifecycle === 'scheduled' && !m.scoring && m.squad.includes(personId))
  if (upcoming.length) {
    putMatches(s, teamId, matches.map((m) => (upcoming.includes(m) ? { ...m, squad: m.squad.filter((id) => id !== personId), updatedAt: nowStamp() } : m)), msg)
  }
  const answers = availabilityOf(s, teamId)
  if (answers.some((a) => a.personId === personId)) s.write(P.availability(teamId), { schemaVersion: 1, entries: answers.filter((a) => a.personId !== personId) }, msg)
  syncPersonTeams(s, teamId, msg)
  const person = peopleOf(s).find((p) => p.id === personId)
  if (person?.guestOfTeamIds?.includes(teamId)) patchPerson(s, personId, { guestOfTeamIds: person.guestOfTeamIds.filter((t) => t !== teamId) }, msg)
  recomputeTeam(s, teamId)
  // Every team's files are needed to know whether they appear anywhere else.
  await Promise.all(teamsOf(s).map((t) => loadTeam(s, t.id).catch(() => null)))
  if (personInUse(s, personId) !== null) return { personDeleted: false }
  erasePerson(s, personId, msg)
  return { personDeleted: true }
}

/** Deletes a person from Users (no team, no history anywhere). Throws with the reason when they are still in use. */
export async function deletePerson(s: Store, personId: string): Promise<void> {
  const name = personName(s, personId)
  await Promise.all(teamsOf(s).map((t) => loadTeam(s, t.id).catch(() => null)))
  const use = personInUse(s, personId)
  if (use === 'not loaded') throw new Error('Some teams could not be loaded. Check your connection and try again.')
  if (use) throw new Error(`${name} ${use}, so they can’t be deleted. Remove them from the team first, or keep them for the records.`)
  erasePerson(s, personId, `Delete ${name}`)
}

/** Soft delete: the person stays in past squads as "(left team)". */
export function removePlayer(s: Store, teamId: string, personId: string): void {
  const msg = `Remove ${personName(s, personId)} from ${teamName(s, teamId)}`
  const now = nowStamp()
  putMembers(
    s,
    teamId,
    membersOf(s, teamId).map((m) => (m.personId === personId ? { ...m, status: 'removed' as const, removedAt: now, updatedAt: now } : m)),
    msg,
  )
  syncPersonTeams(s, teamId, msg)
  recomputeTeam(s, teamId)
}

export function renamePerson(s: Store, personId: string, name: string): void {
  const n = requireName(name)
  patchPerson(s, personId, { name: n }, `Rename player to ${n}`)
}

export async function changeNumber(s: Store, personId: string, phone: string): Promise<void> {
  const config = configOf(s)
  if (!config) throw new Error('App data is not loaded yet.')
  const phoneHash = await hashPhone(phone, config.phoneSalt)
  const other = peopleOf(s).find((p) => p.phoneHash === phoneHash && p.id !== personId)
  if (other) throw new Error(`This number already belongs to ${other.name}.`)
  patchPerson(s, personId, { phoneHash, phoneLast4: last4(phone) }, `Change number for ${personName(s, personId)}`)
}

/** True for the super admin and anyone with an admin record. */
export const isStaff = (s: Store, personId: string) => configOf(s)?.superAdminId === personId || adminsOf(s).some((a) => a.personId === personId)

export function setAccess(s: Store, personId: string, access: 'view' | 'none'): void {
  if (isStaff(s, personId)) return // admins are switched on and off by the super admin (suspend)
  patchPerson(s, personId, { access }, `${access === 'view' ? 'Give' : 'Remove'} access for ${personName(s, personId)}`)
}

/** Removes the PIN and the logged-in phones and bumps the session epoch: the person is logged out everywhere. */
export function resetPin(s: Store, personId: string, byPersonId: string): boolean {
  const now = nowStamp()
  const creds = credsOf(s)
  const existing = creds.find((c) => c.personId === personId)
  const next: Credential = { personId, sessionEpoch: (existing?.sessionEpoch ?? 0) + 1, resetAt: now, resetBy: byPersonId, updatedAt: now }
  return putCreds(s, existing ? creds.map((c) => (c.personId === personId ? next : c)) : [...creds, next], `Reset PIN for ${personName(s, personId)}`)
}

// ---------- admins (the super admin's job, PLAN §65) ----------
const putAdmins = (s: Store, admins: AdminRecord[], msg: string) => s.write(P.admins, { schemaVersion: 1, admins }, msg)

/**
 * Makes the owner of this number an admin. A number nobody has yet becomes a
 * new person; an existing player keeps their teams and history.
 */
export async function addAdmin(s: Store, name: string, phone: string): Promise<Person> {
  const config = configOf(s)
  const by = actorId(s)
  if (!config || !by) throw new Error('App data is not loaded yet.')
  const phoneHash = await hashPhone(phone, config.phoneSalt)
  let person = peopleOf(s).find((p) => p.phoneHash === phoneHash)
  if (person?.id === config.superAdminId) throw new Error('That is your own number.')
  if (person && adminsOf(s).some((a) => a.personId === person!.id && a.status === 'active')) throw new Error(`${person.name} is already an admin.`)
  const now = nowStamp()
  if (!person) {
    person = { id: uuid(), name: requireName(name), phoneHash, phoneLast4: last4(phone), access: 'view', isGuest: false, teamIds: [], createdAt: now, updatedAt: now }
    putPeople(s, [...peopleOf(s), person], `Add admin ${person.name}`)
  } else if (person.isGuest || person.access !== 'view') {
    patchPerson(s, person.id, { isGuest: false, access: 'view' }, `Add admin ${person.name}`)
  }
  ensureCredential(s, person.id)
  const others = adminsOf(s).filter((a) => a.personId !== person!.id)
  putAdmins(s, [...others, { personId: person.id, status: 'active', addedBy: by, addedAt: now, updatedAt: now }], `Add admin ${person.name}`)
  return person
}

/** Suspend = view only; their teams stay as they are until handed to someone else. Restore undoes it. */
export function setAdminStatus(s: Store, personId: string, status: AdminRecord['status']): void {
  const now = nowStamp()
  putAdmins(s, adminsOf(s).map((a) => (a.personId === personId ? { ...a, status, updatedAt: now } : a)), `${status === 'active' ? 'Restore' : 'Suspend'} admin ${personName(s, personId)}`)
  // A suspended admin is logged out everywhere, so their phones pick up the change at once.
  if (status === 'suspended') resetPin(s, personId, actorId(s) ?? '')
}

/** No longer an admin at all. Only for someone who runs no team (hand the teams over first). */
export function removeAdmin(s: Store, personId: string): void {
  if (teamsOf(s).some((t) => t.adminId === personId)) throw new Error('Hand their teams to another admin first.')
  putAdmins(s, adminsOf(s).filter((a) => a.personId !== personId), `Remove admin ${personName(s, personId)}`)
  resetPin(s, personId, actorId(s) ?? '')
}

/** Hands one team to another admin (or to the super admin). */
export function transferTeam(s: Store, teamId: string, toPersonId: string): void {
  const config = configOf(s)
  const ok = toPersonId === config?.superAdminId || adminsOf(s).some((a) => a.personId === toPersonId && a.status === 'active')
  if (!ok) throw new Error('Pick an active admin.')
  const team = teamsOf(s).find((t) => t.id === teamId)
  if (!team) throw new Error('Team not found.')
  putTeams(s, teamsOf(s).map((t) => (t.id === teamId ? { ...t, adminId: toPersonId, updatedAt: nowStamp() } : t)), `Hand ${team.name} to ${personName(s, toPersonId)}`)
}

// ---------- guests (PLAN §20) ----------
/** A guest plays without being in the master list. With a number we reuse the matching person. */
export async function addGuest(s: Store, teamId: string, name: string, phone?: string): Promise<Person> {
  const config = configOf(s)
  if (!config) throw new Error('App data is not loaded yet.')
  const now = nowStamp()
  if (phone) {
    const phoneHash = await hashPhone(phone, config.phoneSalt)
    const existing = peopleOf(s).find((p) => p.phoneHash === phoneHash)
    if (existing) {
      markGuestOf(s, existing.id, teamId)
      return existing
    }
    const person: Person = {
      id: uuid(),
      name: requireName(name),
      phoneHash,
      phoneLast4: last4(phone),
      access: 'none',
      isGuest: true,
      guestOfTeamIds: [teamId],
      teamIds: [],
      createdAt: now,
      updatedAt: now,
    }
    putPeople(s, [...peopleOf(s), person], `Add guest ${person.name}`)
    return person
  }
  const person: Person = {
    id: uuid(),
    name: requireName(name),
    access: 'none',
    isGuest: true,
    guestOfTeamIds: [teamId],
    teamIds: [],
    createdAt: now,
    updatedAt: now,
  }
  putPeople(s, [...peopleOf(s), person], `Add guest ${person.name}`)
  return person
}

/** Remembers that someone played for a team as a guest, so they show up as a suggestion next time. */
export function markGuestOf(s: Store, personId: string, teamId: string): void {
  const person = peopleOf(s).find((p) => p.id === personId)
  if (!person || person.guestOfTeamIds?.includes(teamId)) return
  patchPerson(s, personId, { guestOfTeamIds: [...(person.guestOfTeamIds ?? []), teamId] }, `Add guest ${person.name}`)
}

/** Guest → team member. Needs a number; history stays attached to the same person. */
export async function convertGuest(s: Store, teamId: string, personId: string, phone?: string): Promise<void> {
  const person = peopleOf(s).find((p) => p.id === personId)
  if (!person) return
  if (phone) await changeNumber(s, personId, phone)
  else if (!person.phoneHash) throw new Error('Enter a mobile number — team members need one.')
  addExistingPlayer(s, teamId, personId)
}

/** A guest in this team's context = someone who was never in its master list. */
export const isGuestIn = (members: Membership[], personId: string) => !members.some((m) => m.personId === personId)

// ---------- matches ----------
export interface MatchInput {
  date: string
  time?: string
  opponent: string
  venue?: string
  matchType: MatchType
  overs?: number
  notes?: string
  result?: MatchResult
  ourScore?: string
  theirScore?: string
  tournamentId?: string
}

function cleanMatchInput(input: MatchInput): MatchInput {
  const opponent = input.opponent.trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!opponent) throw new Error('Enter the opponent.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Pick a date.')
  if (!/^\d{2}:\d{2}$/.test(input.time ?? '')) throw new Error('Pick the match time.')
  return {
    date: input.date,
    time: input.time,
    opponent,
    venue: input.venue?.trim() || undefined,
    matchType: input.matchType,
    overs: input.overs && input.overs > 0 ? Math.round(input.overs) : undefined,
    notes: input.notes?.trim() || undefined,
    result: input.result || undefined,
    ourScore: input.ourScore?.trim() || undefined,
    theirScore: input.theirScore?.trim() || undefined,
    tournamentId: input.tournamentId || undefined,
  }
}

export function patchMatch(s: Store, teamId: string, matchId: string, fn: (m: Match) => Match, msg: string): Match {
  let out: Match | undefined
  const matches = matchesOf(s, teamId).map((m) => {
    if (m.id !== matchId) return m
    out = { ...fn(m), updatedAt: nowStamp() }
    return out
  })
  if (!out) throw new Error('Match not found.')
  putMatches(s, teamId, matches, msg)
  recomputeTeam(s, teamId)
  return out
}

export const getMatch = (s: Store, teamId: string, matchId: string) => matchesOf(s, teamId).find((m) => m.id === matchId)

// ---------- opponents (PLAN §23) ----------
export const opponentsOf = (s: Store) => s.get<OpponentsFile>(P.opponents)?.opponents ?? []
const putOpponents = (s: Store, opponents: Opponent[], msg: string) => s.write(P.opponents, { schemaVersion: 1, opponents }, msg)

/** The opponent record with this name (any letter case), created the first time the name is used. */
export function ensureOpponent(s: Store, rawName: string): Opponent {
  const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 60)
  const all = opponentsOf(s)
  const found = all.find((o) => o.name.toLowerCase() === name.toLowerCase())
  if (found) return found
  const now = nowStamp()
  const opp: Opponent = { id: uuid(), name, shortName: shortNameFor(name), playerIds: [], createdBy: actorId(s), createdAt: now, updatedAt: now }
  putOpponents(s, [...all, opp], `Add opponent ${name}`)
  return opp
}

export function addOpponentPlayers(s: Store, opponentId: string, personIds: string[]): void {
  const all = opponentsOf(s)
  const opp = all.find((o) => o.id === opponentId)
  if (!opp) return
  const fresh = personIds.filter((id) => !opp.playerIds.includes(id))
  if (fresh.length === 0) return
  putOpponents(s, all.map((o) => (o.id === opponentId ? { ...o, playerIds: [...o.playerIds, ...fresh], updatedAt: nowStamp() } : o)), `Add players to ${opp.name}`)
}

/**
 * Deletes an opponent team record. Matches against it keep the opponent's
 * name; its saved players stay as people. Only whoever added it (or the super admin).
 */
export function deleteOpponent(s: Store, opponentId: string): void {
  const opp = opponentsOf(s).find((o) => o.id === opponentId)
  if (!opp) return
  if (!putOpponents(s, opponentsOf(s).filter((o) => o.id !== opponentId), `Delete opponent ${opp.name}`)) throw new Error('Only the admin who added this team can delete it.')
}

export function removeOpponentPlayer(s: Store, opponentId: string, personId: string): void {
  const all = opponentsOf(s)
  putOpponents(s, all.map((o) => (o.id === opponentId ? { ...o, playerIds: o.playerIds.filter((id) => id !== personId), updatedAt: nowStamp() } : o)), 'Remove opponent player')
}

/**
 * A player for scoring: name and number are both required. If the number is
 * already known, that person is reused (`existed`); otherwise a record without
 * app access is created.
 */
export async function findOrCreatePlayer(s: Store, name: string, phone: string): Promise<{ person: Person; existed: boolean }> {
  const config = configOf(s)
  if (!config) throw new Error('App data is not loaded yet.')
  const phoneHash = await hashPhone(phone, config.phoneSalt)
  const existing = peopleOf(s).find((p) => p.phoneHash === phoneHash)
  if (existing) return { person: existing, existed: true }
  const now = nowStamp()
  const person: Person = { id: uuid(), name: requireName(name), phoneHash, phoneLast4: last4(phone), access: 'none', isGuest: true, teamIds: [], createdAt: now, updatedAt: now }
  putPeople(s, [...peopleOf(s), person], `Add player ${person.name}`)
  return { person, existed: false }
}

export function setBatsLeft(s: Store, personId: string, batsLeft: boolean): void {
  patchPerson(s, personId, { batsLeft: batsLeft || undefined }, `Set batting hand for ${personName(s, personId)}`)
}

export function addMatch(s: Store, teamId: string, input: MatchInput): Match {
  const clean = cleanMatchInput(input)
  const now = nowStamp()
  const opponentId = s.has(P.opponents) ? ensureOpponent(s, clean.opponent).id : undefined
  const match: Match = { id: uuid(), teamId, ...clean, opponentId, squad: [], cancelled: false, lifecycle: 'scheduled', createdAt: now, updatedAt: now }
  putMatches(s, teamId, [...matchesOf(s, teamId), match], `Add match vs ${match.opponent} on ${match.date}`)
  recomputeTeam(s, teamId)
  return match
}

export function editMatch(s: Store, teamId: string, matchId: string, input: MatchInput): Match {
  const clean = cleanMatchInput(input)
  const opponentId = s.has(P.opponents) ? ensureOpponent(s, clean.opponent).id : undefined
  return patchMatch(s, teamId, matchId, (m) => ({ ...m, ...clean, opponentId: opponentId ?? m.opponentId }), `Edit match vs ${clean.opponent} on ${clean.date}`)
}

export function recordResult(s: Store, teamId: string, matchId: string, r: { result?: MatchResult; ourScore?: string; theirScore?: string }): Match {
  return patchMatch(
    s,
    teamId,
    matchId,
    (m) => ({ ...m, result: r.result || undefined, ourScore: r.ourScore?.trim() || undefined, theirScore: r.theirScore?.trim() || undefined }),
    'Record match result',
  )
}

/** Saves the whole squad in one write. Locked once expenses are submitted. */
export function setSquad(s: Store, teamId: string, matchId: string, squad: string[]): Match {
  const members = membersOf(s, teamId)
  for (const id of squad) if (isGuestIn(members, id)) markGuestOf(s, id, teamId)
  return patchMatch(
    s,
    teamId,
    matchId,
    (m) => {
      if (m.lifecycle !== 'scheduled') throw new Error('The squad is locked once expenses are submitted. Use Edit expenses to change who pays.')
      const next: Match = { ...m, squad: [...new Set(squad)] }
      if (m.expense?.status === 'draft') {
        // Keep a draft split in step: drop people who left the squad, add newcomers as payers.
        const added = next.squad.filter((id) => !m.squad.includes(id))
        next.expense = {
          ...m.expense,
          payerIds: [...m.expense.payerIds.filter((id) => next.squad.includes(id)), ...added],
          lines: m.expense.lines.map((l) => {
            const kept = { ...l, excludedPersonIds: l.excludedPersonIds.filter((id) => next.squad.includes(id)) }
            if (l.fixed) kept.fixed = Object.fromEntries(Object.entries(l.fixed).filter(([id]) => next.squad.includes(id)))
            return kept
          }),
          updatedAt: nowStamp(),
        }
      }
      return next
    },
    'Update squad',
  )
}

export function setCancelled(s: Store, teamId: string, matchId: string, cancelled: boolean): Match {
  return patchMatch(
    s,
    teamId,
    matchId,
    (m) => {
      if (m.lifecycle !== 'scheduled') throw new Error('Expenses were already submitted for this match, so it can’t be cancelled.')
      const next = { ...m, cancelled }
      if (cancelled) delete next.expense // a draft split is discarded
      return next
    },
    cancelled ? 'Cancel match' : 'Restore match',
  )
}

/**
 * Deletes a match with everything that hangs off it: its ball-by-ball score,
 * availability answers and the fund deductions its expenses made (that money
 * goes back to the players' balances). Git history keeps the old copy.
 */
export function deleteMatch(s: Store, teamId: string, matchId: string): void {
  const match = getMatch(s, teamId, matchId)
  if (!match) return
  const msg = `Delete match vs ${match.opponent} on ${match.date}`
  const funds = fundsOf(s, teamId)
  if (funds.some((e) => e.matchId === matchId)) putFunds(s, teamId, funds.filter((e) => e.matchId !== matchId), msg)
  const answers = availabilityOf(s, teamId)
  if (answers.some((a) => a.matchId === matchId)) s.write(P.availability(teamId), { schemaVersion: 1, entries: answers.filter((a) => a.matchId !== matchId) }, msg)
  if (match.scoring) s.remove(P.scoring(teamId, matchId), msg)
  putMatches(s, teamId, matchesOf(s, teamId).filter((m) => m.id !== matchId), msg)
  recomputeTeam(s, teamId)
}

// ---------- expense categories (PLAN §14.1) ----------
export function seedCategories(): ExpenseCategory[] {
  const now = nowStamp()
  const mk = (name: string, mode: CategoryMode, order: number): ExpenseCategory => ({
    id: uuid(),
    name,
    mode,
    order,
    archived: false,
    createdAt: now,
    updatedAt: now,
  })
  return [mk('Match fee', 'mandatory', 1), mk('Balls', 'mandatory', 2), mk('Breakfast', 'optional', 3)]
}

export function saveCategory(s: Store, teamId: string, input: { id?: string; name: string; mode: CategoryMode; defaultAmount?: number }): void {
  const name = requireName(input.name)
  const cats = categoriesOf(s, teamId)
  if (cats.some((c) => !c.archived && c.id !== input.id && c.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('A category with this name already exists.')
  }
  const now = nowStamp()
  const defaultAmount = input.defaultAmount && input.defaultAmount > 0 ? Math.round(input.defaultAmount) : undefined
  if (input.id) {
    putCategories(s, teamId, cats.map((c) => (c.id === input.id ? { ...c, name, mode: input.mode, defaultAmount, updatedAt: now } : c)), `Edit category ${name}`)
  } else {
    const order = Math.max(0, ...cats.map((c) => c.order)) + 1
    putCategories(s, teamId, [...cats, { id: uuid(), name, mode: input.mode, defaultAmount, order, archived: false, createdAt: now, updatedAt: now }], `Add category ${name}`)
  }
}

/** Deletes a category for good. Matches that already used it keep their own copy of its name and amount. */
export function deleteCategory(s: Store, teamId: string, id: string): void {
  const cats = categoriesOf(s, teamId)
  const cat = cats.find((c) => c.id === id)
  if (!cat) return
  putCategories(s, teamId, cats.filter((c) => c.id !== id), `Delete category ${cat.name}`)
}

/** Hide / show a category without deleting it. Matches that already used the category keep their snapshot of it. */
export function setCategoryArchived(s: Store, teamId: string, id: string, archived: boolean): void {
  const cats = categoriesOf(s, teamId)
  const cat = cats.find((c) => c.id === id)
  if (!cat) return
  if (!archived && cats.some((c) => !c.archived && c.id !== id && c.name.toLowerCase() === cat.name.toLowerCase())) {
    throw new Error('Another category already uses this name.')
  }
  putCategories(s, teamId, cats.map((c) => (c.id === id ? { ...c, archived, updatedAt: nowStamp() } : c)), `${archived ? 'Delete' : 'Restore'} category ${cat.name}`)
}

export function moveCategory(s: Store, teamId: string, id: string, dir: -1 | 1): void {
  const cats = categoriesOf(s, teamId)
  const live = cats.filter((c) => !c.archived).sort((a, b) => a.order - b.order)
  const i = live.findIndex((c) => c.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= live.length) return
  const a = live[i]
  const b = live[j]
  const now = nowStamp()
  putCategories(
    s,
    teamId,
    cats.map((c) => (c.id === a.id ? { ...c, order: b.order, updatedAt: now } : c.id === b.id ? { ...c, order: a.order, updatedAt: now } : c)),
    'Reorder categories',
  )
}

// ---------- match expenses (PLAN §15, §16) ----------
/** A fresh draft: every mandatory and optional category, prefilled, with the whole squad paying. */
export function newDraft(match: Match, categories: ExpenseCategory[]): MatchExpense {
  const lines: ExpenseLine[] = categories
    .filter((c) => !c.archived && c.mode !== 'manual')
    .sort((a, b) => (a.mode === b.mode ? a.order - b.order : a.mode === 'mandatory' ? -1 : 1))
    .map((c) => ({ categoryId: c.id, categoryName: c.name, mode: c.mode, total: c.defaultAmount ?? 0, excludedPersonIds: [] }))
  return { status: 'draft', lines, payerIds: [...match.squad], shares: [], roundingExtra: 0, updatedAt: nowStamp() }
}

export function saveDraft(s: Store, teamId: string, matchId: string, draft: Pick<MatchExpense, 'lines' | 'payerIds'>): void {
  patchMatch(
    s,
    teamId,
    matchId,
    (m) => {
      if (m.expense?.status === 'submitted') return m // submitted splits change only through submit
      return { ...m, expense: { status: 'draft', lines: draft.lines, payerIds: draft.payerIds, shares: [], roundingExtra: 0, updatedAt: nowStamp() } }
    },
    'Save expense draft',
  )
}

/** Each payer's balance without this match's own deductions, so re-submitting never double-counts. */
export function availableFor(s: Store, teamId: string, matchId: string, payerIds: string[]): Record<string, number> {
  const entries = fundsOf(s, teamId)
  return Object.fromEntries(payerIds.map((id) => [id, Math.max(0, balanceOf(entries, id, matchId))]))
}

/**
 * Submit (or re-submit) a split: deduct what each player's fund covers, leave
 * the rest pending, move the match to "settling" — or straight to completed
 * when asked and nobody owes anything.
 */
export function submitExpenses(
  s: Store,
  teamId: string,
  matchId: string,
  draft: Pick<MatchExpense, 'lines' | 'payerIds'>,
  complete = false,
): { reopened: ReopenedShare[]; completed: boolean } {
  const match = getMatch(s, teamId, matchId)
  if (!match) throw new Error('Match not found.')
  if (match.cancelled) throw new Error('This match is cancelled.')
  const errors = validateSplit(draft.lines, draft.payerIds)
  if (errors.length) throw new Error(errors[0])

  const lines = draft.lines.filter((l) => l.total > 0)
  const now = nowStamp()
  const result = computeSplit({ lines, payerIds: draft.payerIds, available: availableFor(s, teamId, matchId, draft.payerIds) })
  const previous = match.expense?.status === 'submitted' ? match.expense.shares : []
  const { shares: carried, reopened } = carrySettlements(result.shares, previous)
  const shares = carried.map((sh) => (sh.settled && !sh.settledAt ? { ...sh, settledAt: todayISO() } : sh))

  // Replace this match's deductions (git history keeps the old ones).
  const entries = fundsOf(s, teamId)
  const old = entries.filter((e) => e.type === 'match_deduction' && e.matchId === matchId)
  const deductions: FundEntry[] = shares
    .filter((sh) => sh.fromFunds > 0)
    .map((sh) => {
      const prev = old.find((e) => e.personId === sh.personId)
      return {
        id: prev?.id ?? uuid(),
        teamId,
        type: 'match_deduction' as const,
        personId: sh.personId,
        amount: sh.fromFunds,
        date: match.date,
        matchId,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      }
    })
  putFunds(s, teamId, [...entries.filter((e) => !old.includes(e)), ...deductions], `Expenses for vs ${match.opponent} on ${match.date}`)

  const done = complete && shares.every((sh) => sh.settled)
  patchMatch(
    s,
    teamId,
    matchId,
    (m) => ({
      ...m,
      expense: { status: 'submitted', lines, payerIds: draft.payerIds, shares, roundingExtra: result.roundingExtra, submittedAt: now, updatedAt: now },
      noExpenseSplit: false,
      lifecycle: done ? 'completed' : 'settling',
      completedAt: done ? now : undefined,
    }),
    `Submit expenses for vs ${match.opponent} on ${match.date}`,
  )
  return { reopened, completed: done }
}

function patchShare(s: Store, teamId: string, matchId: string, personId: string, fn: (sh: MatchExpense['shares'][number]) => MatchExpense['shares'][number], msg: string): void {
  patchMatch(
    s,
    teamId,
    matchId,
    (m) => {
      if (m.expense?.status !== 'submitted') throw new Error('Expenses are not submitted yet.')
      return { ...m, expense: { ...m.expense, shares: m.expense.shares.map((sh) => (sh.personId === personId ? fn(sh) : sh)), updatedAt: nowStamp() } }
    },
    msg,
  )
}

/** Admin marks a pending share as paid outside the fund (cash / UPI). */
export function settleShare(s: Store, teamId: string, matchId: string, personId: string, how: { method: PayMethod; date: string; note?: string }): void {
  patchShare(
    s,
    teamId,
    matchId,
    personId,
    (sh) => ({ ...sh, settled: true, settledAt: how.date, settledMethod: how.method, settledNote: how.note?.trim() || undefined }),
    `Settle ${personName(s, personId)}'s share`,
  )
}

export function unsettleShare(s: Store, teamId: string, matchId: string, personId: string): void {
  patchShare(
    s,
    teamId,
    matchId,
    personId,
    (sh) => {
      if (sh.pending === 0 || sh.settledMethod === 'funds') return sh // nothing manual to undo
      const { settledAt: _a, settledMethod: _m, settledNote: _n, ...rest } = sh
      return { ...rest, settled: false }
    },
    `Undo settlement for ${personName(s, personId)}`,
  )
}

/** The only two ways to reach "completed" (PLAN §16.1). */
export function completeMatch(
  s: Store,
  teamId: string,
  matchId: string,
  opts: { noExpenseSplit?: boolean; result?: MatchResult; ourScore?: string; theirScore?: string } = {},
): Match {
  return patchMatch(
    s,
    teamId,
    matchId,
    (m) => {
      const base: Match = {
        ...m,
        result: opts.result ?? m.result,
        ourScore: opts.ourScore?.trim() || m.ourScore,
        theirScore: opts.theirScore?.trim() || m.theirScore,
      }
      if (opts.noExpenseSplit) {
        if (!canMarkComplete(m)) throw new Error('A match can be completed from its match day onwards.')
        const next = { ...base, lifecycle: 'completed' as const, noExpenseSplit: true, completedAt: nowStamp() }
        delete next.expense
        return next
      }
      if (m.lifecycle !== 'settling' || m.expense?.status !== 'submitted') throw new Error('Split the expenses first.')
      const open = m.expense.shares.filter((sh) => !sh.settled).length
      if (open > 0) throw new Error(`${open} player${open === 1 ? '' : 's'} still to settle.`)
      return { ...base, lifecycle: 'completed', completedAt: nowStamp() }
    },
    'Complete match',
  )
}

export function reopenMatch(s: Store, teamId: string, matchId: string): Match {
  return patchMatch(
    s,
    teamId,
    matchId,
    (m) => {
      if (m.lifecycle !== 'completed') return m
      const next: Match = { ...m, lifecycle: m.noExpenseSplit ? 'scheduled' : 'settling', noExpenseSplit: false }
      delete next.completedAt
      return next
    },
    'Reopen match',
  )
}

// ---------- team funds (PLAN §14.3, §16.5) ----------
function requireAmount(amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter an amount in whole rupees.')
  if (amount > 10_000_000) throw new Error('That amount is too large.')
  return amount
}

function guardBalances(s: Store, entries: FundEntry[]): void {
  const bad = negativeBalances(entries)
  if (bad.length) {
    throw new Error(`${personName(s, bad[0])}'s balance would go below ₹0 — part of this money was already used for matches.`)
  }
}

export interface ContributionInput {
  personId: string
  amount: number
  date: string
  method: PayMethod
  note?: string
}

/**
 * Records money a player gave to the team fund. `settleMatchIds` = the dues the
 * admin chose to pay off with it (oldest first, only as far as the balance allows).
 */
export function addContribution(s: Store, teamId: string, input: ContributionInput, settleMatchIds: string[] = []): { settled: number } {
  const now = nowStamp()
  let entries: FundEntry[] = [
    ...fundsOf(s, teamId),
    {
      id: uuid(),
      teamId,
      type: 'contribution',
      personId: input.personId,
      amount: requireAmount(input.amount),
      date: input.date,
      method: input.method,
      note: input.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    },
  ]
  const name = personName(s, input.personId)
  let settled = 0
  let matches = matchesOf(s, teamId)
  for (const due of duesOf(matches, input.personId)) {
    if (!settleMatchIds.includes(due.match.id)) continue
    if (balanceOf(entries, input.personId) < due.pending) break
    const existing = entries.find((e) => e.type === 'match_deduction' && e.matchId === due.match.id && e.personId === input.personId)
    entries = existing
      ? entries.map((e) => (e === existing ? { ...e, amount: e.amount + due.pending, updatedAt: now } : e))
      : [
          ...entries,
          { id: uuid(), teamId, type: 'match_deduction', personId: input.personId, amount: due.pending, date: due.match.date, matchId: due.match.id, createdAt: now, updatedAt: now },
        ]
    matches = matches.map((m) =>
      m.id !== due.match.id
        ? m
        : {
            ...m,
            updatedAt: now,
            expense: {
              ...m.expense!,
              updatedAt: now,
              shares: m.expense!.shares.map((sh) =>
                sh.personId === input.personId
                  ? { ...sh, fromFunds: sh.fromFunds + sh.pending, pending: 0, settled: true, settledAt: input.date, settledMethod: 'funds' as const }
                  : sh,
              ),
            },
          },
    )
    settled++
  }
  putFunds(s, teamId, entries, `Contribution from ${name}`)
  if (settled) putMatches(s, teamId, matches, `Settle dues for ${name} from funds`)
  recomputeTeam(s, teamId)
  return { settled }
}

export function addRefund(s: Store, teamId: string, input: ContributionInput): void {
  const entries = fundsOf(s, teamId)
  const amount = requireAmount(input.amount)
  if (amount > balanceOf(entries, input.personId)) throw new Error('A refund can’t be more than the player’s balance.')
  const now = nowStamp()
  putFunds(
    s,
    teamId,
    [...entries, { id: uuid(), teamId, type: 'refund', personId: input.personId, amount, date: input.date, method: input.method, note: input.note?.trim() || undefined, createdAt: now, updatedAt: now }],
    `Refund to ${personName(s, input.personId)}`,
  )
  recomputeTeam(s, teamId)
}

/** Signed correction; a note is required. */
export function addAdjustment(s: Store, teamId: string, input: { personId: string; amount: number; date: string; note: string }): void {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error('Enter a whole-rupee amount (not zero).')
  if (!input.note.trim()) throw new Error('Add a note explaining the adjustment.')
  const now = nowStamp()
  const entries: FundEntry[] = [
    ...fundsOf(s, teamId),
    { id: uuid(), teamId, type: 'adjustment', personId: input.personId, amount: input.amount, date: input.date, note: input.note.trim(), createdAt: now, updatedAt: now },
  ]
  guardBalances(s, entries)
  putFunds(s, teamId, entries, `Adjustment for ${personName(s, input.personId)}`)
  recomputeTeam(s, teamId)
}

/** Edit a contribution, refund or adjustment. Deductions change only through their match. */
export function updateFundEntry(s: Store, teamId: string, entryId: string, patch: { amount: number; date: string; method?: PayMethod; note?: string }): void {
  const entries = fundsOf(s, teamId).map((e) => {
    if (e.id !== entryId) return e
    if (e.type === 'match_deduction') throw new Error('Match deductions change only through their match.')
    const amount = e.type === 'adjustment' ? patch.amount : requireAmount(patch.amount)
    return { ...e, amount, date: patch.date, method: e.type === 'adjustment' ? undefined : patch.method, note: patch.note?.trim() || undefined, updatedAt: nowStamp() }
  })
  guardBalances(s, entries)
  putFunds(s, teamId, entries, 'Edit fund entry')
  recomputeTeam(s, teamId)
}

export function deleteFundEntry(s: Store, teamId: string, entryId: string): void {
  const all = fundsOf(s, teamId)
  const target = all.find((e) => e.id === entryId)
  if (!target) return
  if (target.type === 'match_deduction') throw new Error('Match deductions change only through their match.')
  const entries = all.filter((e) => e.id !== entryId)
  guardBalances(s, entries)
  putFunds(s, teamId, entries, 'Delete fund entry')
  recomputeTeam(s, teamId)
}

// ---------- app config ----------
/** App-wide settings (super admin). */
export function updateConfig(s: Store, patch: Partial<Pick<AppConfig, 'tokenExpiresOn'>>): void {
  const config = configOf(s)
  if (!config) return
  s.write(P.config, { ...config, ...patch, updatedAt: nowStamp() }, 'Update app settings')
}

/** The team's "Low balance" line in Funds (each admin sets their own). */
export const lowBalanceThreshold = (s: Store, teamId: string) => teamsOf(s).find((t) => t.id === teamId)?.lowBalanceThreshold ?? 500
export const today = todayISO

// ---------- availability poll (PLAN §30) ----------
export const availabilityOf = (s: Store, teamId: string) => s.get<AvailabilityFile>(P.availability(teamId))?.entries ?? []

/** A player's own answer for a match; `null` clears it. Returns false if the write was refused. */
export function setAvailability(s: Store, teamId: string, matchId: string, personId: string, status: AvailabilityStatus | null): boolean {
  const id = `${matchId}:${personId}`
  const rest = availabilityOf(s, teamId).filter((e) => e.id !== id)
  const entries: AvailabilityEntry[] = status ? [...rest, { id, matchId, personId, status, updatedAt: nowStamp() }] : rest
  return s.write(P.availability(teamId), { schemaVersion: 1, entries }, `Availability: ${personName(s, personId)} is ${status ?? 'undecided'}`)
}

// ---------- one-match scorer (PLAN §31) ----------
/** Lets one player score this match from their own phone (or takes it back with `undefined`). */
export function setScorer(s: Store, teamId: string, matchId: string, personId: string | undefined): Match {
  return patchMatch(
    s,
    teamId,
    matchId,
    (m) => {
      const next = { ...m, scorerId: personId }
      if (!personId) delete next.scorerId
      return next
    },
    personId ? `Scorer: ${personName(s, personId)}` : 'Remove scorer',
  )
}

// ---------- payment reminders (PLAN §37) ----------
/** Asks the notifier Action to nudge these players about their pending dues. */
export function queueDuesReminder(s: Store, teamId: string, personIds: string[]): void {
  if (personIds.length === 0) return
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
  // Old requests are dropped so the file stays small; the notifier only acts on new ones.
  const messages = (s.get<OutboxFile>(P.outbox)?.messages ?? []).filter((m) => m.createdAt > cutoff)
  s.write(P.outbox, { schemaVersion: 1, messages: [...messages, { id: uuid(), kind: 'dues', teamId, personIds, createdAt: nowStamp() }] }, `Payment reminder to ${personIds.length} player${personIds.length === 1 ? '' : 's'}`)
}
// ---------- player profile (PLAN §39) ----------
export interface ProfileInput {
  role?: PlayerRole
  batsLeft?: boolean
  bowlStyle?: BowlStyle
  jersey?: number
}

/** Role, batting hand, bowling style and jersey number. The admin edits anyone; a player edits their own. */
export function updateProfile(s: Store, personId: string, input: ProfileInput): boolean {
  if (input.jersey !== undefined && (!Number.isInteger(input.jersey) || input.jersey < 0 || input.jersey > 999)) throw new Error('Jersey number must be between 0 and 999.')
  const now = nowStamp()
  const people = peopleOf(s).map((p) => {
    if (p.id !== personId) return p
    const next: Person = { ...p, updatedAt: now }
    for (const key of ['role', 'bowlStyle', 'jersey'] as const) {
      if (input[key] === undefined) delete next[key]
      else (next[key] as unknown) = input[key]
    }
    if (input.batsLeft) next.batsLeft = true
    else delete next.batsLeft
    return next
  })
  return putPeople(s, people, `Update profile of ${personName(s, personId)}`)
}

// ---------- grounds (PLAN §42) ----------
export const groundsOf = (s: Store) => s.get<GroundsFile>(P.grounds)?.grounds ?? []
export const groundByName = (s: Store, venue?: string) => (venue ? groundsOf(s).find((g) => g.name.toLowerCase() === venue.trim().toLowerCase()) : undefined)

export function saveGround(s: Store, input: Omit<Ground, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): void {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!name) throw new Error('Enter the ground’s name.')
  const all = groundsOf(s)
  if (all.some((g) => g.id !== input.id && g.name.toLowerCase() === name.toLowerCase())) throw new Error('A ground with this name already exists.')
  const mapUrl = input.mapUrl?.trim() || undefined
  if (mapUrl && !/^https:\/\/\S+$/.test(mapUrl)) throw new Error('The map link must start with https://')
  if (/\d{10}/.test(`${input.contact ?? ''}${input.notes ?? ''}`.replace(/[\s-]/g, ''))) throw new Error('Don’t put a phone number here — everyone using the app can read it.')
  const now = nowStamp()
  const clean = { name, mapUrl, pitch: input.pitch, fee: input.fee && input.fee > 0 ? Math.round(input.fee) : undefined, contact: input.contact?.trim() || undefined, notes: input.notes?.trim() || undefined }
  const grounds = input.id ? all.map((g) => (g.id === input.id ? { ...g, ...clean, updatedAt: now } : g)) : [...all, { id: uuid(), ...clean, createdBy: actorId(s), createdAt: now, updatedAt: now }]
  if (!s.write(P.grounds, { schemaVersion: 1, grounds }, `${input.id ? 'Edit' : 'Add'} ground ${name}`)) throw new Error('Only the admin who added this ground can change it.')
}

export function deleteGround(s: Store, id: string): void {
  if (!s.write(P.grounds, { schemaVersion: 1, grounds: groundsOf(s).filter((g) => g.id !== id) }, 'Delete ground')) throw new Error('Only the admin who added this ground can delete it.')
}