// Domain types — the JSON files in the private data repo (PLAN §6, §14, §20, §22).

/** One-way salted hash of a PIN / recovery code (PLAN §5.3). */
export interface PinHash {
  algo: 'PBKDF2-SHA256'
  iterations: number
  salt: string // base64, 16 random bytes, new for every PIN
  hash: string // base64, 32 bytes
}

// ---------- config/app.json ----------
export interface AppConfig {
  schemaVersion: 1
  appName: string
  adminPersonId: string
  phoneSalt: string
  adminRecovery: PinHash
  tokenExpiresOn?: string // YYYY-MM-DD
  /** Funds tab "Low balance" filter threshold in rupees (default 500). */
  lowBalanceThreshold?: number
  createdAt: string
  updatedAt?: string
}

// ---------- people.json ----------
export interface Person {
  id: string
  name: string
  phoneHash?: string // optional only for guests
  phoneLast4?: string
  access: 'view' | 'none'
  isGuest: boolean
  guestOfTeamIds?: string[]
  /**
   * Derived index: ids of teams where this person is an ACTIVE member. Kept in
   * step with every membership change so a launch can decide "may this person
   * log in / which teams do they see" from people.json alone.
   */
  teamIds: string[]
  createdAt: string
  updatedAt: string
}
export interface PeopleFile {
  schemaVersion: 1
  people: Person[]
}

// ---------- auth/credentials.json ----------
export interface Credential {
  personId: string
  pin?: PinHash
  pinSetAt?: string
  sessionEpoch: number
  resetAt?: string
  resetBy?: string
  updatedAt: string
}
export interface CredentialsFile {
  schemaVersion: 1
  credentials: Credential[]
}

// ---------- teams.json ----------
export type MatchResult = 'won' | 'lost' | 'tied' | 'draw' | 'no_result' | 'abandoned'

export interface TeamStats {
  activePlayers: number
  matchesTotal: number
  played: number
  won: number
  lost: number
  tied: number
  draw: number
  noResult: number
  upcoming: number
  nextMatch?: { id: string; date: string; time?: string; opponent: string; venue?: string }
  lastMatch?: { id: string; date: string; opponent: string; result?: MatchResult }
  form: MatchResult[]
  awaitingCompletion: number
  fundBalance: number
  pendingDues: number
  settlingMatches: number
}

export interface Team {
  id: string
  name: string
  shortName: string
  color: string
  homeGround?: string
  archived: boolean
  createdAt: string
  updatedAt: string
  stats: TeamStats
}
export interface TeamsFile {
  schemaVersion: 1
  teams: Team[]
}

// ---------- teams/<id>/members.json ----------
export interface Membership {
  personId: string
  teamId: string
  status: 'active' | 'removed'
  joinedAt: string
  removedAt?: string
  updatedAt?: string
}
export interface MembersFile {
  schemaVersion: 1
  members: Membership[]
}

// ---------- teams/<id>/matches.json ----------
export type MatchType = 'league' | 'friendly' | 'practice' | 'tournament' | 'other'
export type MatchLifecycle = 'scheduled' | 'settling' | 'completed'
export type CategoryMode = 'mandatory' | 'optional' | 'manual'
export type PayMethod = 'cash' | 'upi' | 'other'

export interface ExpenseLine {
  categoryId: string
  categoryName: string // snapshot
  mode: CategoryMode // snapshot
  total: number
  excludedPersonIds: string[]
}

export interface PlayerShare {
  personId: string
  byCategory: Record<string, number>
  total: number
  fromFunds: number
  pending: number
  settled: boolean
  settledAt?: string
  settledMethod?: 'funds' | PayMethod
  settledNote?: string
}

export interface MatchExpense {
  status: 'draft' | 'submitted'
  lines: ExpenseLine[]
  payerIds: string[]
  shares: PlayerShare[]
  roundingExtra: number
  submittedAt?: string
  updatedAt: string
}

export interface Match {
  id: string
  teamId: string
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
  squad: string[]
  cancelled: boolean
  lifecycle: MatchLifecycle
  expense?: MatchExpense
  noExpenseSplit?: boolean
  completedAt?: string
  createdAt: string
  updatedAt: string
}
export interface MatchesFile {
  schemaVersion: 1
  matches: Match[]
}

// ---------- config/expense-categories.json ----------
export interface ExpenseCategory {
  id: string
  name: string
  mode: CategoryMode
  defaultAmount?: number
  order: number
  archived: boolean
  createdAt: string
  updatedAt: string
}
export interface ExpenseCategoriesFile {
  schemaVersion: 1
  categories: ExpenseCategory[]
}

// ---------- teams/<id>/funds.json ----------
export type FundEntryType = 'contribution' | 'match_deduction' | 'refund' | 'adjustment'

export interface FundEntry {
  id: string
  teamId: string
  type: FundEntryType
  personId: string
  amount: number // whole rupees, > 0; 'adjustment' may be negative
  date: string
  matchId?: string
  method?: PayMethod
  note?: string
  createdAt: string
  updatedAt: string
}
export interface FundsFile {
  schemaVersion: 1
  entries: FundEntry[]
}

// ---------- push/subscriptions.json ----------
export interface PushSubscriptionRecord {
  personId: string
  deviceId: string
  device: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  sessionEpoch: number
  createdAt: string
}
export interface SubscriptionsFile {
  schemaVersion: 1
  subscriptions: PushSubscriptionRecord[]
}

// ---------- labels ----------
export const RESULT_LABELS: Record<MatchResult, string> = {
  won: 'Won',
  lost: 'Lost',
  tied: 'Tied',
  draw: 'Draw',
  no_result: 'No result',
  abandoned: 'Abandoned',
}
export const RESULT_LETTER: Record<MatchResult, string> = {
  won: 'W',
  lost: 'L',
  tied: 'T',
  draw: 'D',
  no_result: 'NR',
  abandoned: 'A',
}
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  league: 'League',
  friendly: 'Friendly',
  practice: 'Practice',
  tournament: 'Tournament',
  other: 'Other',
}
export const METHOD_LABELS: Record<'funds' | PayMethod, string> = {
  funds: 'Funds',
  cash: 'Cash',
  upi: 'UPI',
  other: 'Other',
}
export const MODE_LABELS: Record<CategoryMode, string> = {
  mandatory: 'Mandatory',
  optional: 'Optional',
  manual: 'Manual',
}

/** Team colours (PLAN §21.3): 10 hues, no reds/maroons. */
export const TEAM_COLORS: { name: string; hex: string }[] = [
  { name: 'Navy', hex: '#1E3A8A' },
  { name: 'Royal blue', hex: '#2563EB' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Green', hex: '#15803D' },
  { name: 'Olive', hex: '#6B7A1E' },
  { name: 'Purple', hex: '#7C3AED' },
  { name: 'Magenta', hex: '#C026D3' },
  { name: 'Orange', hex: '#EA580C' },
  { name: 'Gold', hex: '#CA8A04' },
  { name: 'Slate', hex: '#475569' },
]
