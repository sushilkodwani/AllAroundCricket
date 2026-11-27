// Domain types — the JSON files in the private data repo (PLAN §6, §14, §20, §22).

/** One-way salted hash of a PIN / recovery code (PLAN §5.3). */
export interface PinHash {
  algo: 'PBKDF2-SHA256'
  iterations: number
  salt: string // base64, 16 random bytes, new for every PIN
  hash: string // base64, 32 bytes
}

// ---------- config/app.json ----------
/** Data format of this app version. Older data is not read (it is reset instead). */
export const DATA_SCHEMA = 2

export interface AppConfig {
  schemaVersion: 2
  appName: string
  /** The app owner (super admin): adds, suspends and replaces admins. Set once, at first-time setup. */
  superAdminId: string
  phoneSalt: string
  /** Recovery code of the super admin, for a forgotten PIN. */
  recovery: PinHash
  tokenExpiresOn?: string // YYYY-MM-DD
  /**
   * Hard stop: until this moment (ISO) nobody but the super admin can use the app. Set to when the
   * hourly GitHub allowance starts afresh, so it ends by itself; the super admin can also end it early.
   */
  pausedUntil?: string
  pausedBy?: string
  createdAt: string
  updatedAt?: string
}

// ---------- config/admins.json ----------
/** Someone the super admin made an admin. An admin runs their own teams. */
export interface AdminRecord {
  personId: string
  status: 'active' | 'suspended'
  addedBy: string
  addedAt: string
  updatedAt: string
}
export interface AdminsFile {
  schemaVersion: 1
  admins: AdminRecord[]
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
  /** Left-handed batter — used to name shot directions (PLAN §26). */
  batsLeft?: boolean
  /** Player profile (PLAN §39). */
  role?: PlayerRole
  bowlStyle?: BowlStyle
  jersey?: number
  /** Stamp of the profile photo in images/people/<id>.json; absent = no photo. */
  photo?: string
  /** Personal goals the player set (up to 4). */
  goals?: Goal[]
  createdAt: string
  updatedAt: string
}

export type GoalMetric = 'runs' | 'wickets' | 'sixes' | 'fours' | 'fifties' | 'catches' | 'sr' | 'avg' | 'econ'
export interface Goal {
  id: string
  metric: GoalMetric
  target: number
  /** One calendar year (counted from the matches that year) or the whole career. */
  period: 'year' | 'all'
  year?: string
  createdAt: string
}
export interface PeopleFile {
  schemaVersion: 1
  people: Person[]
}

// ---------- auth/credentials.json ----------
/** A phone this person logged in on. Only a hash of the phone's secret is stored. */
export interface DeviceKey {
  id: string
  /** SHA-256 (base64) of the random secret kept on that phone. */
  hash: string
  at: string
}

export interface Credential {
  personId: string
  pin?: PinHash
  pinSetAt?: string
  sessionEpoch: number
  /** Phones logged in as this person (newest last). A session is valid only on one of these. */
  devices?: DeviceKey[]
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
  /** Players who have not yet paid or been covered, across matches being settled. */
  playersToSettle: number
}

export interface Team {
  id: string
  name: string
  shortName: string
  color: string
  homeGround?: string
  /** Stamp of the team logo in images/teams/<id>.json; absent = no logo. */
  logo?: string
  /** The admin who runs this team. Only they change it; the super admin can hand it to another admin. */
  adminId: string
  /** Funds tab "Low balance" filter threshold in rupees (default 500). */
  lowBalanceThreshold?: number
  /** Where players pay their dues by UPI (shown to the team's players on the Pay button). */
  upi?: { id: string; name: string }
  archived: boolean
  createdAt: string
  updatedAt: string
  stats: TeamStats
}
/** One picture: a small, already resized image kept as a data URL (base64). */
export interface ImageFile {
  schemaVersion: 1
  dataUrl: string | null
  updatedAt: string
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
  /** Players who pay their own amount for this line; the rest share what is left. */
  fixed?: Record<string, number>
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
  /** Opponent record in opponents.json (PLAN §23). */
  opponentId?: string
  /** Set while / after the match is scored ball by ball (PLAN §24). */
  scoring?: 'live' | 'finished'
  /** The opponent's playing XI and captain, picked before the match; used when scoring starts. */
  opponentXi?: string[]
  opponentCaptainId?: string
  /** A player the admin lets score this one match (PLAN §31). */
  scorerId?: string
  /** Super admin's switch: the live score updates itself every 20 s for everyone watching (else ⟳ only). */
  liveAuto?: boolean
  /** Tournament this match counts towards (PLAN §35). */
  tournamentId?: string
  /** The team's season this match belongs to (teams/<id>/seasons.json). */
  seasonId?: string
  createdAt: string
  updatedAt: string
}
export interface MatchesFile {
  schemaVersion: 1
  matches: Match[]
}

// ---------- teams/<id>/categories.json (each team has its own) ----------
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

// ---------- player profile (PLAN §39) ----------
export type PlayerRole = 'batter' | 'bowler' | 'allrounder' | 'keeper'
export type BowlStyle = 'rf' | 'rm' | 'ro' | 'rl' | 'lf' | 'lm' | 'lo' | 'lw'
export const ROLE_LABELS: Record<PlayerRole, string> = { batter: 'Batter', bowler: 'Bowler', allrounder: 'All-rounder', keeper: 'Wicket-keeper' }
export const ROLE_SHORT: Record<PlayerRole, string> = { batter: 'Bat', bowler: 'Bowl', allrounder: 'AR', keeper: 'WK' }
export const BOWL_LABELS: Record<BowlStyle, string> = {
  rf: 'Right-arm fast',
  rm: 'Right-arm medium',
  ro: 'Right-arm off spin',
  rl: 'Right-arm leg spin',
  lf: 'Left-arm fast',
  lm: 'Left-arm medium',
  lo: 'Left-arm orthodox spin',
  lw: 'Left-arm wrist spin',
}

// ---------- grounds.json (PLAN §42) ----------
export type PitchType = 'turf' | 'matting' | 'cement' | 'other'
export const PITCH_LABELS: Record<PitchType, string> = { turf: 'Turf', matting: 'Matting', cement: 'Cement', other: 'Other' }
export interface Ground {
  id: string
  name: string
  /** A maps link (https only). */
  mapUrl?: string
  pitch?: PitchType
  /** Usual ground fee in rupees. */
  fee?: number
  /** Who to call — a name, never a phone number (numbers stay out of the repo). */
  contact?: string
  notes?: string
  /** The admin who added it; only they edit or delete it. */
  createdBy?: string
  createdAt: string
  updatedAt: string
}
export interface GroundsFile {
  schemaVersion: 1
  grounds: Ground[]
}

// ---------- opponents.json (PLAN §23) ----------
/** A team we play against. Kept for reuse; never shown in the Teams tab. */
export interface Opponent {
  id: string
  name: string
  shortName: string
  /** People who have played for this opponent (records in people.json, no login). */
  playerIds: string[]
  /** The admin who added it; only they rename or delete it (anyone scoring may add players). */
  createdBy?: string
  createdAt: string
  updatedAt: string
}
export interface OpponentsFile {
  schemaVersion: 1
  opponents: Opponent[]
}

// ---------- teams/<id>/scoring/<matchId>.json (PLAN §24) ----------
export type SideKey = 'home' | 'away'
export interface ScoreSide {
  name: string
  shortName: string
  xi: string[]
  /** Substitutes: played in the match (batted, bowled or fielded) beyond the 11 — they don't count towards "all out". */
  subs?: string[]
  captainId?: string
  keeperId?: string
}
export type DeliveryKind = 'legal' | 'wd' | 'nb'
export type WicketKind =
  | 'bowled'
  | 'caught'
  | 'caught_behind'
  | 'caught_bowled'
  | 'lbw'
  | 'stumped'
  | 'run_out'
  | 'hit_wicket'
  | 'obstructing'
  | 'retired_out'
  | 'timed_out'

/** Who is in the middle right now. A missing value means "to be picked". */
export interface Crease {
  striker?: string
  nonStriker?: string
  bowler?: string
  /** Over or round the wicket (only when the match asks for it); cleared at the end of each over. */
  side?: BowlingSide
}

export type BowlingSide = 'over' | 'round'
export const SIDE_LABELS: Record<BowlingSide, string> = { over: 'Over the wicket', round: 'Round the wicket' }

export type ShotType = 'drive' | 'cut' | 'pull' | 'hook' | 'sweep' | 'flick' | 'glance' | 'lofted' | 'defence' | 'edge' | 'scoop' | 'other'
export const SHOT_LABELS: Record<ShotType, string> = { drive: 'Drive', cut: 'Cut', pull: 'Pull', hook: 'Hook', sweep: 'Sweep', flick: 'Flick', glance: 'Glance', lofted: 'Lofted', defence: 'Defence', edge: 'Edge', scoop: 'Scoop / ramp', other: 'Other' }

export interface BallEvent {
  t: 'ball'
  id: string
  striker: string
  nonStriker: string
  bowler: string
  kind: DeliveryKind
  /** Runs off the bat (always 0 on a wide). */
  bat: number
  /** Runs run / boundary as byes or leg-byes; on a wide, the extra wides run. */
  byes: number
  byeType?: 'b' | 'lb'
  /** t = where the catch was taken / the throw came from (same coordinates as shot). */
  wicket?: { kind: WicketKind; who: string; fielder?: string; at?: [number, number] }
  /** Where a boundary went: point on the ground, unit circle, centre = 0,0, y down. */
  shot?: [number, number]
  /** The kind of shot played (only when the match asks for it). */
  shotType?: ShotType
  /** Bowled over or round the wicket (only when the match asks for it). */
  side?: BowlingSide
  at: string
}
/** A batter walks off between balls (hurt = may return; out = dismissed). */
export interface RetireEvent {
  t: 'retire'
  id: string
  who: string
  out: boolean
  crease: Crease
  at: string
}
export interface PenaltyEvent {
  t: 'penalty'
  id: string
  runs: number
  to: 'batting' | 'fielding'
  crease: Crease
  at: string
}
export type ScoreEvent = BallEvent | RetireEvent | PenaltyEvent

export interface Innings {
  batting: SideKey
  /** Overs limit of this innings (can be reduced, e.g. for rain). */
  overs: number
  /** Second innings only. */
  target?: number
  targetRevised?: boolean
  events: ScoreEvent[]
  crease: Crease
  closed?: 'all_out' | 'overs' | 'target' | 'ended'
}

export interface ScoreFile {
  schemaVersion: 1
  matchId: string
  teamId: string
  overs: number
  home: ScoreSide
  away: ScoreSide
  opponentId?: string
  toss: { wonBy: SideKey; chose: 'bat' | 'bowl' }
  innings: Innings[]
  /** Powerplay overs, set before the first ball (0 = no powerplay). Older matches: 30% of the overs. */
  powerplay?: number
  /** Also ask where 1s, 2s and 3s went (optional for the scorer), so the wagon wheel shows every scoring shot. */
  allDirections?: boolean
  /** Also ask the kind of shot (drive, pull …) — optional on every ball. */
  askShotType?: boolean
  /** Also ask over or round the wicket when each over starts. */
  askSide?: boolean
  status: 'live' | 'break' | 'finished'
  result?: { winner?: SideKey; text: string }
  /** Confirmed by the admin after the match (PLAN §33). */
  awards?: MatchAwards
  startedAt: string
  updatedAt: string
}

export interface MatchAwards {
  potm?: string
  batter?: string
  bowler?: string
}

// ---------- teams/<id>/availability.json (PLAN §30) ----------
export type AvailabilityStatus = 'in' | 'out' | 'maybe'
export interface AvailabilityEntry {
  /** `${matchId}:${personId}` */
  id: string
  matchId: string
  personId: string
  status: AvailabilityStatus
  updatedAt: string
}
export interface AvailabilityFile {
  schemaVersion: 1
  entries: AvailabilityEntry[]
}

// ---------- teams/<id>/seasons.json ----------
/** A period a team plays in, such as "LL-26-27"; matches are put in a season, and the season has its own analysis. */
export interface Season {
  id: string
  teamId: string
  name: string
  startDate?: string
  endDate?: string
  archived: boolean
  createdAt: string
  updatedAt: string
}
// ---------- AI reports (config/ai.json, teams/<id>/ai.json) ----------
export interface AiConfig {
  schemaVersion: 1
  geminiKey: string
  /** Gemini model name, e.g. gemini-3.1-flash-lite. */
  model: string
  /** The super admin's master switch. Off hides every generate button; saved reports keep showing. Missing = on. */
  enabled?: boolean
  updatedAt: string
}

export type AiKind = 'plan' | 'review' | 'player'

export interface AiReport {
  id: string
  teamId: string
  kind: AiKind
  /** plan and review: the match. */
  matchId?: string
  /** player: the player. */
  personId?: string
  /** The answer, in light markdown (headings, bullets, bold). */
  text: string
  model: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface AiFile {
  schemaVersion: 1
  reports: AiReport[]
}

export interface SeasonsFile {
  schemaVersion: 1
  seasons: Season[]
}

// ---------- tournaments.json (PLAN §35) ----------
export interface TournamentTeam {
  id: string
  name: string
  /** One of our teams… */
  teamId?: string
  /** …or an opponent from opponents.json. Neither = a team we never play. */
  opponentId?: string
}
/** A result between two other teams, typed in by hand so the table is complete. */
export interface OtherResult {
  id: string
  a: string
  b: string
  aRuns: number
  /** Balls faced; the full quota when the side was all out. */
  aBalls: number
  bRuns: number
  bBalls: number
  outcome: 'a' | 'b' | 'tie' | 'nr'
  date?: string
  createdAt: string
  updatedAt: string
}
export interface Tournament {
  id: string
  name: string
  points: { win: number; tie: number; nr: number }
  teams: TournamentTeam[]
  otherResults: OtherResult[]
  archived: boolean
  /** The admin who created it; only they change it. */
  createdBy?: string
  createdAt: string
  updatedAt: string
}
export interface TournamentsFile {
  schemaVersion: 1
  tournaments: Tournament[]
}

// ---------- push/outbox.json (PLAN §37) ----------
/** A notification the admin asked for; the notifier Action sends it. */
export interface OutboxMessage {
  id: string
  kind: 'dues'
  teamId: string
  personIds: string[]
  createdAt: string
}
export interface OutboxFile {
  schemaVersion: 1
  messages: OutboxMessage[]
}

export const WICKET_LABELS: Record<WicketKind, string> = {
  bowled: 'Bowled',
  caught: 'Caught',
  caught_behind: 'Caught behind',
  caught_bowled: 'Caught & bowled',
  lbw: 'LBW',
  stumped: 'Stumped',
  run_out: 'Run out',
  hit_wicket: 'Hit wicket',
  obstructing: 'Obstructing the field',
  retired_out: 'Retired out',
  timed_out: 'Timed out',
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
