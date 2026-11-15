# AllAroundCricket — Build Plan (v0.7)

**App name: AllAroundCricket** (cricket teams, matches, squads, expenses and team
funds). Project folder: `CricketAndExpenses_App`. Branding: §21.

> **For the model building this app:** read this whole file first, then read
> `E:\Claude Projects\PersonalExpenseTracker_App.md` (the "Mobile PWA Playbook").
> This app reuses that playbook's architecture — PWA on the phone, GitHub private
> repo as the database, onboarding with a token stored in localStorage, service
> worker + update popup, theme, saving model — **including its "do better" fixes
> (playbook §14)**. Where this plan and the playbook disagree, **this plan wins**.
>
> Markers: **[DECISION]** = a default chosen by the planner; implement it unless
> told otherwise. **[LATER]** = out of scope for Phase 1; keep the data model ready
> for it but don't build it. **[TBD]** = product owner will specify later.
>
> Reference code for every reused pattern:
> `E:\Claude Projects\PersonalExpenseTracker_App` (React + Vite + TS + Tailwind).

### Changelog
- **v0.7** — **Theme:** white + cricket-ball red (light), black + the same red
  (dark) (§21.3); icon background now red. **Notifications** added (§22): sent only
  when a match's expenses are submitted, only to that match's squad members who
  turned notifications on, personalised with their share. **Startup prompt** asking
  to allow notifications + on/off toggle in Settings.
- **v0.6** — App named **AllAroundCricket**; branding, colours and an original
  batsman-silhouette icon spec (§21). Team card contents finalised (§7.2) with added
  win %, last-5 form guide, money line and status badges. All open items closed.
- **v0.5** — Product owner answered the expense questions (§19 is now a decision
  log): partial funds ✔, Pays switch + per-category exclusions ✔, **round up but
  the extra is NOT added to the team fund** (no `rounding_surplus`), **everyone may
  see everyone's balances and shares** (phone numbers stay hidden), ask to settle
  dues when adding a contribution ✔, **guest players** added (§20), Mark complete
  from match day ✔, refunds/adjustments ✔, no team-level spending.
- **v0.4** — **Expenses & Team Funds** added (§13–§16): admin-configurable expense
  categories (auto-added mandatory/optional, or manual; delete = archive), a
  **Mark complete** flow that requires either an expense split + full settlement
  or an explicit "No expense split needed", per-player shares deducted from each
  player's **team fund balance** first, pending amounts settled by the admin, a new
  **Funds** tab for recording player contributions. Match status is now an explicit
  lifecycle (§6.6) instead of being derived from the date.
- **v0.3** — Onboarding like the expense app: **everyone (admin and players) enters
  the data repo + one shared access token + their 10-digit number once**; it's kept
  in localStorage. View-only is **enforced by the app** (the token itself can write).
  After onboarding each person **sets a 6-digit PIN**; any later onboarding with
  that number (new phone, reinstall, someone else) must enter the PIN. PINs are
  stored **only as one-way salted hashes** in the data repo; the admin can **reset**
  a PIN but never see it. Admin reset also logs the old phone out. Built-in read
  token from v0.2 removed.
- v0.2 — Players log in with a 10-digit number only; one admin; Settings → Users
  access switch; numbers hidden from players.
- v0.1 — first draft.

---

## 1. Purpose

An all-in-one app for running amateur cricket teams: who is in each team, which
matches are coming up or were played, and who played in them — and later the money
side (expenses), which the product owner will specify next.

It must run on phones like a native app (installed from the browser), cost nothing
to host, and let **one admin** manage everything while **players** see their
team's information **read-only**.

**Scope of this plan:** app shell, onboarding + PIN, access, teams, players (team
master list), matches (past and future), match squads, admin user management
(Phases 1–5); expenses, team funds and guests (Part 2, Phase 6); expense
notifications (§22, Phase 7).

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Admin** | The one and only person who can edit cricket data. |
| **Viewer** | Any player with access. Read-only. Every player added to a team becomes a viewer automatically. |
| **Person** | One human, identified by a **10-digit mobile number** (unique). Can be in several teams. |
| **Player / Member** | A Person's membership in one Team's master list. |
| **Team** | A group of members with its own matches (and later expenses). |
| **Match** | A fixture on a date — past or future — belonging to one team. |
| **Squad** | The members the admin selected for a match. |
| **Access** | Per-person switch the admin controls: `view` (default) or `none`. |
| **Access token** | One GitHub fine-grained token (read & write, only the data repo) shared with everyone, entered once at onboarding. |
| **PIN** | A 6-digit code each person sets after their first onboarding. Proves "this number is really me" on any new onboarding. |
| **Onboarding** | Entering repo + access token + number on a device (once per device). |

---

## 3. Requirements (from the product owner)

1. Runs as an app on the phone (installable PWA), like PersonalExpenseTracker_App.
2. **Exactly one admin**, the only person who can edit cricket data.
3. **Onboarding (once per device), same approach as the expense app:** enter the
   data repo details, the access token and the **10-digit mobile number** (no
   country code). Stored in localStorage; not asked again on that device.
4. **PIN:** after the first successful onboarding for a number, the person **sets a
   6-digit PIN**. Whenever that number is onboarded again (another phone, a
   reinstall, or someone else trying it), the app knows the number is already
   registered and **asks for the PIN**. Only the correct PIN lets the app work.
5. PINs are stored **unreadable** in the data repo. The admin **cannot see or set**
   a PIN, only **reset** it; after a reset the person onboards again and sets a new
   PIN.
6. **Teams:** admin creates teams; inside a team, admin adds players with **name +
   10-digit number**. That list is the team's **master list**.
7. Adding a player **automatically gives that number view-only access**.
8. Admin sees all users in **Settings → Users** and can **change or remove their
   access** and **reset their PIN**. Removing access **never removes the player
   from a team's master list** (or from past squads).
9. Players **cannot see anyone's phone number**.
10. Home shows a **card per team** (contents confirmed, §7.2).
11. Team screen: members (add / delete) and matches (add **future or past** matches,
    any date). After creating a match, admin **picks the squad from the master list,
    all at once**. Players see whether they're in the squad.
12. Not in Phase 1: player availability responses; toss / man of the match /
    scorecards (separate module later); captain or editor roles.
13. **Expenses (v0.4, §13–§16):** every match has **Mark complete**. Completing
    requires either (a) splitting the match expenses among the squad's paying
    members and **settling** every share, or (b) ticking **"No expense split needed
    for this match"**.
14. **Expense categories** (e.g. Match fee, Balls, Breakfast) are managed by the
    admin in Settings: add, delete, and choose whether each is **added
    automatically to every match** as **mandatory** or **optional** (or not
    automatically). Deleting a category never changes completed matches that used it.
15. **Team Funds tab:** the admin picks a team, sees its players and records money
    each player gives to the team fund. A player's fund balance pays their match
    shares first; only the uncovered part is pending.
16. While splitting, each member row shows that member's **remaining fund balance**
    under their name. On submit, covered shares are **deducted from the player's
    fund** and don't appear as pending; uncovered amounts are pending until the
    admin **marks them settled**. The match can be completed only when everyone is
    settled.

---

## 4. Architecture

```
 PUBLIC code repo ──GitHub Actions──► GitHub Pages (installable PWA)
                                          │
                     React app + service worker on every phone
                     localStorage: repo, access token, session (§5.6)
                                          │ GitHub REST Contents API
                                          ▼
                       PRIVATE data repo (JSON files, §6)
```

- Stack: React 18 + TypeScript (strict) + Vite + Tailwind (`darkMode: 'class'`),
  Recharts later. No backend server.
- Hosting: GitHub Pages from the public code repo, `base: './'`.
- Data: a separate **private** GitHub repo (e.g. `cricket-data`).
- [DECISION] The repo owner/name may be pre-filled from build variables
  `VITE_DATA_OWNER` / `VITE_DATA_REPO` (not secrets) so players only type the token
  and number; if unset, onboarding asks for them. **The token is never built into
  the app.**
- **Must-have improvements over the reference app** (playbook §14):
  - URL-based navigation (tiny hash router) so Android Back and reload work.
  - Local cache of all data (IndexedDB, fallback localStorage); render instantly
    from cache, refresh in the background; **never wipe onboarding on a failed
    load** — show cached data with an "Offline" badge.
  - Admin offline write queue + flush on `pagehide` + retry.
  - Sha-checked writes on every file; id-based merge on conflict (§6.10).
  - Network-first service worker, version stamp, blocking update popup (playbook §5).
  - PNG + maskable icons (180, 192, 512) in addition to SVG.
  - Local-date helpers (never `toISOString().slice(0,10)` for "today").
  - **ETag conditional reads** (`If-None-Match`): `304`s don't count toward the
    5,000 requests/hour limit, which every phone shares (one token).

---

## 5. Onboarding, PIN & access

### 5.1 Token model and its honest limits

- One fine-grained token, **Contents: Read and write**, scoped to only the data
  repo, created by the admin and shared with players (e.g. on WhatsApp).
- **View-only is enforced by the app**, exactly like the expense app: all cricket
  data mutations are blocked in the store unless the role is `admin`.
- **The single exception:** any onboarded person may write **their own PIN record**
  in `auth/credentials.json` (set PIN after onboarding / after a reset).
- Accepted limits (show them in Settings → About security):
  1. Someone holding the token could bypass the app and edit the repo directly.
     Mitigations: the repo is private, every write is a git commit (full history,
     restorable), and commit messages carry an `Actor:` trailer.
  2. The 6-digit PIN is a lock, not a vault: someone with the token could try all
     1,000,000 PINs against a stored hash offline (slowed down by PBKDF2, §5.3).
  3. Changing the shared token (e.g. it expired or leaked) means every device must
     enter the new one (§5.8).

### 5.2 Phone number rules (`lib/phone.ts`, unit-tested)

- Inputs accept **only digits**, `inputMode="numeric"`, `maxLength=10`, label
  "Mobile number (10 digits)".
- Paste cleanup: strip spaces/dashes/brackets; 12 digits starting `91` → drop
  `91`; 11 digits starting `0` → drop `0`. Must end as **exactly 10 digits**.
- [DECISION] First digit must be 6–9 (Indian mobiles).
- Stored as `phoneHash` = PBKDF2-HMAC-SHA256(number, `config/app.json.phoneSalt`,
  100,000 iterations, 32 bytes) + `phoneLast4`. Never stored or logged in plain
  text. Players never see numbers; the admin sees `••••••3210`.

### 5.3 PIN storage — one-way hashing, never reversible

PINs are **not encrypted with a key; they are hashed**. This is deliberate:
encryption needs a decryption key, and since every device must be able to verify
PINs, that key would have to live in the app or the repo, where anyone with the
token could use it to decrypt every PIN. A salted slow hash can only be **checked**,
never turned back into the PIN — which is exactly the requirement "the admin can
reset but not see it".

`lib/pin.ts` (unit-tested) — Web Crypto (`crypto.subtle`) only, no libraries:

```ts
// Stored per person in auth/credentials.json
interface PinHash {
  algo: 'PBKDF2-SHA256'
  iterations: number     // 310_000 (current OWASP guidance for PBKDF2-SHA256)
  salt: string           // base64, 16 random bytes, NEW salt every time a PIN is set
  hash: string           // base64, 32 bytes
}

async function hashPin(pin: string, salt = randomBytes(16), iterations = 310_000): Promise<PinHash>
async function verifyPin(pin: string, stored: PinHash): Promise<boolean>
  // re-derive with stored.salt + stored.iterations, compare with a constant-time loop
function isValidPin(pin: string): boolean   // exactly 6 digits
function isWeakPin(pin: string): boolean     // 000000, 111111…, 123456, 654321, 123123,
                                             // 121212, and the person's own last 6 phone digits
```

- `iterations` and `algo` are stored with each hash so the cost can be raised later
  (re-hash on next successful login).
- Weak PINs are rejected with "Pick a less obvious PIN".
- The plain PIN exists only in memory during entry; never in localStorage, logs,
  URLs or commit messages.

### 5.4 `auth/credentials.json`

```ts
interface Credential {
  personId: string
  pin?: PinHash          // absent = PIN not set yet (new person, or after admin reset)
  pinSetAt?: string      // ISO timestamp — shown to the admin
  sessionEpoch: number   // starts at 1; +1 on every admin reset → logs out old devices
  resetAt?: string
  resetBy?: string       // admin personId
  updatedAt: string
}
interface CredentialsFile { schemaVersion: 1; credentials: Credential[] }
```

Kept separate from `people.json` so a player's PIN write never touches master data,
and admin edits to people never collide with PIN changes. Writes are sha-checked and
merged by `personId` (§6.10).

### 5.5 Onboarding flow (per device)

1. **Onboarding screen:** repo owner + repo name (pre-filled if built in), **access
   token**, **mobile number (10 digits)**, button **Continue**. Small link "First
   time setup (admin)" (§5.7).
2. Verify the token: `GET /repos/{owner}/{repo}` must succeed and return
   `permissions.push === true`; errors: "Token or repo is wrong", "Token expired".
3. Load `config/app.json`, `people.json`, `auth/credentials.json`. Hash the number,
   find the person:
   - Not found, `access: 'none'`, or (non-admin) no active team membership →
     "This number doesn't have access. Ask your team admin to add you." (one neutral
     message for all three). Nothing is saved.
   - Found and their credential has **no `pin`** → **Set PIN** screen: enter 6
     digits, confirm 6 digits, weak-PIN check → `hashPin` → write their credential
     (`pin`, `pinSetAt`, keep `sessionEpoch`) → logged in.
   - Found and their credential **has a `pin`** → **Enter PIN** screen (PIN pad from
     the reference app's `PinGate`): `verifyPin` → success logs in. Wrong PIN: shake,
     "Wrong PIN". After 5 wrong attempts, lock entry for 30 s, then 60 s, 120 s…
     (stored in localStorage; client-side only). Link: "Forgot PIN? Ask your admin
     to reset it."
4. On success, save to localStorage: `{ owner, repo, token, personId, sessionEpoch }`.
   **Never** the number or the PIN.
5. From then on the app opens straight in — no number, token or PIN prompts on that
   device — until Log out, an admin reset, or a token change.

### 5.6 Session checks on every launch and refresh

- Re-load `people.json` + `auth/credentials.json` (ETag, so usually free).
- If the stored `sessionEpoch` ≠ the credential's `sessionEpoch` (admin reset), or
  the credential has no `pin` → clear the session (keep owner/repo/token) and show
  "Your PIN was reset by the admin. Set a new PIN to continue." → number + Set PIN.
- If `access` became `none` or (non-admin) no active membership → **No-access
  screen** ("You no longer have access. Contact your team admin." + "Use a
  different number").
- Offline → use the cached session; checks run when back online.
- [DECISION] No PIN on every app open. Optional per-device **"Ask for PIN when the
  app opens"** toggle in Settings (verifies against the stored hash; useful on a
  shared phone).

### 5.7 First-time setup (admin, once per data repo)

Screen fields: repo owner/name, access token, admin **name**, admin **mobile
number**, then Set PIN.

- Repo must be empty of app data (no `config/app.json`). Create:
  `config/app.json` (random `phoneSalt`, `adminPersonId`, recovery hash),
  `people.json` (the admin, `access: 'view'`), `auth/credentials.json` (admin PIN),
  `teams.json` (empty), `config/expense-categories.json` (seeded, §14.1).
  Creating a team also creates its empty `funds.json`.
- Show a one-time **admin recovery code** (12 characters, e.g. `K7QM-3XRP-9TWD`):
  "Write this down. It's the only way to reset your own PIN." Store only its PBKDF2
  hash in `config/app.json.adminRecovery`.
- If `config/app.json` already exists, the link says "This repo is already set up —
  use normal onboarding."

### 5.8 Access token changes
- On any `401`: "The access token stopped working (expired or changed). Enter the
  new token from your admin." → token field only; on success keep the session (no
  PIN needed again on this device).
- Admin: Settings → Data repo → **Token expiry date** (manual entry) → banner from
  14 days before expiry: "Create a new token and share it with everyone."

### 5.9 Roles & enforcement

| Role | Who | Can |
|---|---|---|
| `admin` | the onboarded person whose `personId` = `config/app.json.adminPersonId` | everything |
| `viewer` | onboarded person with `access = 'view'` and ≥1 active team membership | view their teams, members (names only), matches, squads; set their own PIN |
| `denied` | anyone else | onboarding / No-access screen only |

- All writes go through the store. The store allows: `admin` → any file;
  `viewer` → **only** their own record in `auth/credentials.json` (set PIN,
  re-hash) and **their own device's entry in `push/subscriptions.json`** (§22.3).
  Everything else returns early with no network call.
- The admin's own `access` can't be switched off and the admin can't be removed from
  Users; the admin doesn't need a team membership to log in.
- [DECISION] Viewers see only teams they're an active member of.

### 5.10 PIN management (admin)

- **Settings → Users → user → Reset PIN** (confirm: "<name> will be logged out on
  all phones and must set a new PIN."): remove `pin`, `sessionEpoch += 1`,
  `resetAt`, `resetBy`. The admin never sees or chooses PINs.
- Users list shows PIN status: `PIN set 15 Nov 2026` · `PIN not set yet` ·
  `Reset 16 Nov — waiting for new PIN`.
- **First-come gap:** if someone onboards with another person's number before that
  person does, they set the PIN. The real person then sees "Enter PIN" for a PIN
  they never set → contacts the admin → admin resets. The admin can spot it via
  "PIN set" dates.
- **Admin's own PIN:** Settings → Account → **Change PIN** (current PIN + new PIN
  twice). Forgot it → "Forgot admin PIN" on the Enter PIN screen asks for the
  **recovery code** → set new PIN, and show a new recovery code.
- Every player can **Change PIN** in Settings → Account (current + new twice).

---

## 6. Data model & files (private data repo)

All ids are UUIDs (playbook §13 `uuid()` with fallbacks). Dates are local
`YYYY-MM-DD`, times `HH:mm` (24 h), timestamps ISO-8601 UTC. Every file starts
with `"schemaVersion": 1`.

### 6.1 File layout

```
config/app.json                 app settings, admin id, phone salt, admin recovery hash
config/expense-categories.json  expense categories (§14.1)            — v0.4
people.json                     every person + their access
auth/credentials.json           PIN hashes + session epochs (§5.4)
teams.json                      teams + summary stats for cards
teams/<teamId>/members.json     the team's master list
teams/<teamId>/matches.json     the team's matches + squads + match expenses
teams/<teamId>/funds.json       the team's fund ledger (§14.3)         — v0.4
push/subscriptions.json         push subscriptions per device (§22.3)  — v0.7
push/state.json                 notifier's last processed commit (§22.4) — v0.7
.github/workflows/notify.yml    notifier Action + notify/ script (§22.4) — v0.7
```

Launch reads 4 small files; opening a team reads 2 more. With the local cache and
ETags most reads are free `304`s.

### 6.2 `config/app.json`

```ts
interface AppConfig {
  schemaVersion: 1
  appName: string                // "AllAroundCricket" (§21)
  adminPersonId: string
  phoneSalt: string              // base64, 16 random bytes, created at setup, never changes
  adminRecovery: PinHash         // hash of the admin recovery code (same format as PINs)
  tokenExpiresOn?: string        // YYYY-MM-DD, entered by admin, drives the warning banner
  createdAt: string
}
```

### 6.3 `people.json`

```ts
interface Person {
  id: string
  name: string               // trimmed, 1–40 chars
  phoneHash: string          // §5.2 — unique across people (optional for guests, §20.1)
  phoneLast4: string         // shown to the admin only
  access: 'view' | 'none'    // admin-controlled; default 'view'
  createdAt: string
  updatedAt: string
  // [LATER] photo, playing role, jersey number
}
interface PeopleFile { schemaVersion: 1; people: Person[] }
```

A `Credential` (`sessionEpoch: 1`, no `pin`) is created together with every new
Person.

### 6.4 `teams.json`

```ts
interface Team {
  id: string
  name: string               // unique (case-insensitive) among non-archived teams
  shortName: string          // ≤ 4 chars, auto from initials, editable
  color: string              // hex from a fixed palette of 10
  homeGround?: string
  archived: boolean
  createdAt: string
  updatedAt: string
  stats: TeamStats           // derived, recomputed on every team change — never hand-edited
}
interface TeamStats {
  activePlayers: number
  matchesTotal: number       // excluding cancelled
  played: number
  won: number; lost: number; tied: number; draw: number; noResult: number
  upcoming: number
  nextMatch?: { id: string; date: string; time?: string; opponent: string; venue?: string }
  lastMatch?: { id: string; date: string; opponent: string; result?: MatchResult }
  form: MatchResult[]        // v0.6 — last 5 completed results, oldest → latest
  awaitingCompletion: number // v0.6 — past matches still 'scheduled'
  // + fundBalance, pendingDues, settlingMatches (§16.8)
  // win % is derived on display: won / (won + lost + tied)
}
interface TeamsFile { schemaVersion: 1; teams: Team[] }
```

`stats` is written in the same save batch as the change that caused it. Because
upcoming/played depends on today's date, the app re-derives next/last match on
display from cached matches when available.

### 6.5 `teams/<teamId>/members.json` — the master list

```ts
interface Membership {
  personId: string
  teamId: string
  status: 'active' | 'removed'   // removing from a team is a soft delete
  joinedAt: string
  removedAt?: string
}
interface MembersFile { schemaVersion: 1; members: Membership[] }
```

### 6.6 `teams/<teamId>/matches.json`

```ts
type MatchResult = 'won' | 'lost' | 'tied' | 'draw' | 'no_result' | 'abandoned'

interface Match {
  id: string
  teamId: string
  date: string               // YYYY-MM-DD — any date, past or future
  time?: string              // HH:mm
  opponent: string           // suggestions from this team's previous opponents
  venue?: string             // suggestions; default = team home ground
  matchType: 'league' | 'friendly' | 'practice' | 'tournament' | 'other'
  overs?: number
  notes?: string
  result?: MatchResult       // optional, for past matches (feeds team stats)
  ourScore?: string          // optional free text, e.g. "154/6 (20)"
  theirScore?: string
  squad: string[]            // personIds
  cancelled: boolean
  lifecycle: MatchLifecycle  // v0.4 — explicit, see below
  expense?: MatchExpense     // v0.4 — §14.2; absent when no split was done
  noExpenseSplit?: boolean   // v0.4 — true when completed via "No expense split needed"
  completedAt?: string
  createdAt: string
  updatedAt: string
  // [LATER] match-details module: toss, man of the match, scorecard, player stats
}
type MatchLifecycle = 'scheduled' | 'settling' | 'completed'
interface MatchesFile { schemaVersion: 1; matches: Match[] }
```

**Status shown in the UI** (v0.4 — completion is explicit, not by date):

| Condition | Shown as |
|---|---|
| `cancelled` | Cancelled |
| `lifecycle = 'completed'` | **Completed** |
| `lifecycle = 'settling'` | **Settlement pending** (expenses submitted, dues outstanding) |
| `scheduled` and date/time in the future | **Upcoming** |
| `scheduled` and date/time passed | **Awaiting completion** (admin sees a Mark complete prompt) |

Only `completed` matches count as "played" in `TeamStats` (W/L/T etc.).

### 6.7 Access vs. membership — the rules in one place

| Admin action | Access | Master list / squads | PIN |
|---|---|---|---|
| Add player (new number) | Person created, `access: 'view'` | Membership `active` | Credential created, PIN not set |
| Add player (number exists) | unchanged (sheet offers to turn access on if `none`) | Membership `active` / re-activated | unchanged |
| Users → **Remove access** | `none` → can't log in; logged-in phones lose access at next refresh | **unchanged** | unchanged |
| Users → **Give access** | `view` | unchanged | unchanged |
| Users → **Reset PIN** | unchanged | unchanged | PIN removed, `sessionEpoch + 1` → logged out everywhere |
| Team → **Remove player** | unchanged, but with no active team left they can't log in | Membership `removed`; stays in past squads as "(left team)" | unchanged |

### 6.8 Commit messages
`"<summary>\n\nActor: <personId>"`, e.g. `"Add match vs Lions on 2026-11-22"`,
`"Set PIN"`, `"Reset PIN for <personId>"`. Never phone numbers or PINs.

### 6.9 Referential rules
- Never hard-delete a Person (referenced by squads, later expenses, credentials).
- Team delete = **archive** (confirm by typing the team name); hard delete only for
  a team with no matches.
- Match delete allowed with confirm only while `scheduled` (§16.1, §17.12).

### 6.10 Saving & conflicts
- Reuse the reference app's debounced auto-save (`persist(key, fn)`, 1.2 s) and
  `flushSaves()` (playbook §7), one key per file path. PIN writes are **not**
  debounced — written immediately and awaited before continuing.
- Every write is sha-checked. On `409/422`: re-read and do an **id-based 3-way
  merge** (base = last read copy): one-sided changes win; both sides changed the
  same record → newest `updatedAt` wins; delete vs. edit → keep the edit.
  `auth/credentials.json` merges by `personId` (players setting PINs at the same
  time never conflict).
- `teams.json` `stats` are recomputed after a merge, never merged.

---

## 7. Screens & behaviour (Phase 1)

### 7.1 App shell
- Sticky header: back chevron on sub-screens, title, "👁 View only" badge for
  viewers, admin save status (`Saving…`, `✓ Saved`, `Offline — will sync`,
  `Save failed`), offline badge when serving cached data.
- **Bottom tab bar:** `🏏 Teams` · `📅 Matches` · `💰 Funds` · `⚙️ Settings`
  (Funds: §16.5).
- Theme light / dark / system (playbook §4.4). Update popup (playbook §5.2).
- Routes (hash router): `#/onboard`, `#/setup`, `#/pin`, `#/teams`,
  `#/teams/:teamId` (`?tab=players|matches`), `#/teams/:teamId/matches/:matchId`,
  `#/matches`, `#/settings`, `#/settings/users`. Open sheets push a history entry so
  Back closes them.
- iPhone in Safari (not installed): dismissible banner with Add to Home Screen steps.
  Note: iOS keeps the installed app's storage separate from Safari, so **onboard
  inside the installed app**.

### 7.2 Teams (home)
- One card per team (viewer: only their teams), sorted by nearest upcoming match,
  then name. Archived hidden (admin "Show archived" toggle).
- **Card contents (confirmed v0.6)** — one `TeamCard` component, reading only
  `TeamStats` (§6.4, §16.8), so the home screen needs only `teams.json`:

  ```
  ┌─▌ RCC  Royal Cricket Club                      ⚠ 1 to settle ┐
  │ ▌ 👥 14 players · 🏏 23 played · 52% wins                     │
  │ ▌ W 12 · L 9 · T/D/NR 2        Form  W L W W L  (latest →)    │
  │ ▌ 📅 Next: vs Lions · Sat 22 Nov, 7:00 AM · in 3 days          │
  │ ▌ Last: Won vs Tigers · 15 Nov                                │
  │ ▌ 💰 Fund ₹18,450 · Dues ₹1,258                                │
  │ ▌ ✅ You're in the next squad    · You owe ₹183 (viewer only)  │
  └───────────────────────────────────────────────────────────────┘
  ```

  1. **Header:** team-colour stripe on the left, `shortName` badge, team name.
  2. **Line 1:** active players · matches played (completed) · **win %**
     (`won / (won + lost + tied)`, hidden until 1 such result).
  3. **Line 2:** `W · L · T/D/NR` record and a **form guide** — the last 5
     completed results as small coloured dots/letters (W green, L red, others grey),
     latest on the right. Hidden when there are no results.
  4. **Next match:** opponent, date, time, relative (`today`, `tomorrow`,
     `in 3 days`), or `No upcoming match`.
  5. **Last match:** result + opponent + date (or `Result pending`).
  6. **Money:** team fund balance and total pending dues (`Dues ₹0` hidden).
  7. **Badges (top-right):** `⚠ 1 to settle` when matches are in `settling`; admin
     also sees `🕓 1 awaiting completion` (past matches still `scheduled`).
  8. **Personal line (viewer):** `✅ You're in the next squad` / `Not in next
     squad`, and `You owe ₹183` in amber when they have dues in that team.
  - Lines with no data collapse; the card never shows empty placeholders.
  - Tap → Team detail. Long cards stay ≤ 7 lines on a 360 px screen (wrap money and
    personal info onto one line if needed).
- Admin: **+ Team** → sheet: name (required, unique), short name (auto), colour,
  home ground.
- Refresh icon re-fetches from GitHub.

### 7.3 Team detail — `#/teams/:teamId`
Header: team name; admin `⋯`: Edit team, Archive team.
Segmented control: **Players** | **Matches**.

**Players tab (master list)**
- Active members: initials avatar (team colour), **name**, matches played here.
  Admin also sees `••••••3210` and a `No access` tag when `access = 'none'`.
- A–Z; search box when more than 10 members.
- Admin **+ Add player** → sheet: **Name**, **Mobile number (10 digits)** (§5.2):
  - already active here → "Already in this team";
  - removed from this team → "Re-add <name>?";
  - exists in another team → "This number belongs to <name> (Team X). Add <name>
    to this team?";
  - new → Person (`view`) + Credential + Membership. Toast "Rahul added — he can
    now onboard with his number".
  - **Share** button [DECISION]: share text with the app link and onboarding steps
    (no token in the message by default; the admin shares the token separately and
    privately) via `navigator.share`, fallback `https://wa.me/91<number>?text=…`
    (number still in memory right after typing; never stored), plus Copy.
  - **Bulk add** [DECISION, nice-to-have]: paste lines `Name 9876543210` → preview
    with per-line validation → add all valid.
- Tap a player → **Player sheet**: name, teams, matches played here, last played.
  Admin: Edit name, Change number, Remove from team (confirm: "Past matches keep his
  name."), shortcut to his entry in Settings → Users.
- Swipe left (admin) = Remove from team; undo snackbar 5 s.
- Admin: "Show removed players" → **Re-add**.

**Matches tab**
- Sections: **Upcoming** (soonest first), **Past** (latest first), **Cancelled**
  (collapsed).
- Row: date chip (`SAT 22 NOV`), `vs Lions`, time · venue, type badge,
  `11 in squad`, result chip (`Won` green / `Lost` red / others grey),
  and a lifecycle chip (§6.6): `Awaiting completion` (admin), `Settlement pending`,
  `Completed`. Viewer: `You're playing ✅` when in the squad.
- Admin **+ Add match** → form: Date (required, any date, default today), Time,
  Opponent (required, autocomplete), Venue (autocomplete, default home ground),
  Type (default friendly), Overs, Notes; if the date is past also Result + scores.
  Save → Match detail + offer the **squad picker**.

### 7.4 Match detail — `#/teams/:teamId/matches/:matchId`
- Header card: `vs Lions`, `Sat 22 Nov 2026 · 7:00 AM`, venue, type, overs, status
  pill, `in 3 days` for upcoming, result + scores for completed.
- Admin: Edit, Record result, Cancel / Restore, Delete (confirm).
- **Squad (11)**: names with avatars; removed members tagged "(left team)". Viewer
  in squad: "✅ You're in the squad"; not in it: "You're not in the squad for this
  match"; empty: admin "Pick squad", viewer "Squad not announced yet".
- **Squad picker** (admin, full screen): active members with checkboxes (plus
  already-selected removed members, checked); search, **Select all**, **Clear**,
  counter `11 selected`, chip **Same as last match**. **Done** saves in one write.
  [DECISION] Soft hint when count ≠ 11 for league/tournament.

### 7.5 Matches tab — `#/matches`
Upcoming across the user's teams (team colour stripe), then "Recent results" (last
30 days). Viewer chip **My matches**. Tap → Match detail.

### 7.6 Settings — `#/settings`
- Everyone: **Account** (name, role, teams, **Change PIN**, "Ask for PIN when the
  app opens" toggle, Log out), **Notifications** (on/off for this device, §22.6),
  **Appearance**, **Refresh app** + version, **About security** (§5.1 limits).
- Admin only: **Users** (§7.7), **Expense categories** (§16.6), **Funds** (low
  balance threshold, default ₹500), **Data repo** (token expiry date, replace token
  on this device), **Data** (JSON backup of all files except `auth/`, CSV exports,
  restore), **Teams** (show archived), **Recovery code** (view status, generate a new
  one — requires current PIN).

### 7.7 Settings → Users (admin)
- Every person except the admin (guests under their own **Guests** filter, §20.5):
  name, `••••••3210`, team chips, access status, PIN
  status. Search; filters **All · Has access · No access · No active team · PIN not
  set**.
- Row controls: **View only ⇄ No access** (saves immediately, toast with Undo).
- Tap → sheet: edit name (warn if in several teams), change number, teams, access
  switch, **Reset PIN** (confirm, §5.10).
- No "delete user" — removing access is the removal (product owner requirement).

### 7.8 Notifications
In scope as of v0.7 — **only for submitted match expenses**. Full design in §22.
Other triggers (squad announced, new match, reminders) remain [LATER].

---

## 8. Non-functional requirements

- Mobile-first: correct at 360–430 px; max content width 672 px on desktop.
- Touch targets ≥ 44 px; numeric keypads for numbers and PINs.
- Offline: view cached data; admin edits queue and sync later.
- Repeat launch renders from cache instantly; first load on 4G < 3 s.
- Accessible labels, `aria-label` on icon buttons, contrast in both themes.
- Indian formats: `Sat 22 Nov 2026`, `7:00 AM`, money later `₹1,23,456`.
- **Never in plain text anywhere** (files, commits, logs, URLs, localStorage): phone
  numbers, PINs, recovery codes. localStorage holds only repo, token, `personId`,
  `sessionEpoch`, UI prefs and the wrong-PIN lockout timer.
- No hardcoded admin identity in the code repo.

---

## 9. Edge cases

1. Same number in two teams → one Person, two Memberships; renaming warns "Also
   changes the name in Team X".
2. Admin also plays → admin is a member like anyone else; still admin.
3. Access removed / player removed / PIN reset while their app is open → applies at
   next refresh or launch.
4. Person with `access: 'none'` added to another team → access stays `none`; the add
   sheet offers to turn it on.
5. Match date moved between past and future → status/result fields re-derive (values
   kept).
6. Squad member later removed from the team → stays in squad as "(left team)".
7. Admin on two devices at once → merge (§6.10).
8. Two people setting PINs at the same moment → separate records, merged by personId.
9. Someone else onboarded first with your number → "Enter PIN" → admin reset (§5.10).
10. Token expired/changed → token-only re-entry, session kept (§5.8).
11. Wrong number/blocked/no team → the same neutral message.
12. All dates/times in device local time; "today" from local date parts.

---

## 10. Suggested structure

```
src/
  types.ts
  lib/
    github.ts      Contents API (ETag GET, sha PUT), permission check
    store.ts       DataStore: GitHub + local cache + admin offline queue + write guard
    merge.ts       id-based 3-way merge                         (unit tested)
    phone.ts       clean/validate 10 digits, phone hash         (unit tested)
    pin.ts         hashPin / verifyPin / weak-PIN check          (unit tested)
    access.ts      onboarding lookup, roles, session epoch check (unit tested)
    stats.ts       TeamStats + match status                      (unit tested)
    split.ts       expense split + funds-first allocation (§15)  (unit tested)
    funds.ts       balances, team totals, ledger guards (§14.3)  (unit tested)
    dates.ts       local date helpers + formatting
    version.ts     build version + update check
    uuid.ts
  state/  AppContext.tsx  ThemeContext.tsx  router.ts
  screens/ Onboard, Setup, PinSet, PinEnter, NoAccess, Teams, TeamDetail,
           MatchDetail, SquadPicker, Matches, Settings, Users,
           CompleteMatch, SplitExpenses, Funds, PlayerFund, ExpenseCategories
  components/ BottomSheet, ConfirmDialog, UndoSnackbar, SwipeRow, PinPad, Avatar,
              StatusPill, TeamCard, UpdatePrompt, EmptyState, Toast
public/  sw.js  manifest.webmanifest  icons (svg + png 180/192/512 + maskable)
.github/workflows/deploy.yml   (optional VITE_DATA_OWNER/REPO + version stamp)
README.md  admin setup guide
```

Vitest for every `(unit tested)` module; `pin.ts` tests include: same PIN + new salt
→ different hash; verify true/false; weak-PIN list; iterations upgrade path.

### Admin setup guide (README content)
1. Create a **private** repo for data (e.g. `cricket-data`), empty.
2. Create a fine-grained token scoped to **only** that repo, **Contents: Read and
   write**, longest expiry. Note the expiry date.
3. (Optional) Code repo Actions variables `DATA_OWNER`, `DATA_REPO`; Pages source =
   GitHub Actions; push to `main` to deploy.
4. On your phone: install the app → "First time setup (admin)" → token, name,
   number, PIN → **write down the recovery code**.
5. Settings → Data repo → token expiry date.
6. Add teams and players; share the app link + token with players privately.

---

## 11. Build phases

1. **Foundation** — scaffold, PWA shell (manifest, icons, SW, update popup), router,
   theme, GitHub client with ETags, store with cache + queue + merge + write guard.
2. **Onboarding & access** — admin first-time setup + recovery code, onboarding,
   phone hashing, PIN set/enter/change/lockout, session epoch checks, roles,
   No-access screen, Settings → Users (access + PIN reset), log out.
3. **Teams & players** — home cards, create/edit/archive team, add / remove / re-add
   player, player sheet, bulk add, share message.
4. **Matches & squads** — add/edit/cancel/delete match, past results, match detail,
   squad picker, global Matches tab, team stats recompute.
5. **Polish** — empty states, offline badge, backup/export/restore, accessibility,
   tests, README.

6. **Expenses & Funds** — see §18.
7. **Notifications** — see §22.8.

**Later [TBD]:** match-details module (toss, man of the match, scorecards),
notifications, player availability.

---

## 12. Open items

None — all closed as of v0.6 (expenses §13–§20, team card §7.2, name/branding §21).
New modules (match details, notifications, availability) will be added as new parts.

---

# Part 2 — Expenses & Team Funds (v0.4)

> These sections extend Phase 1. Where they conflict with §6–§7 (match status,
> tabs, settings), **these sections win**.

## 13. Concept and money rules

- Each team has a **fund**: players give money to the team (contributions); the
  admin holds it. Each player has a **fund balance** inside the team.
- A match's costs are entered by **category** (e.g. Match fee ₹3,000, Balls ₹600,
  Breakfast ₹550). Each category total is **split equally** among the match's
  **paying members** who take part in that category.
- Each player's share is paid **from their fund balance first**. Only the part
  their balance can't cover is **pending**; the admin marks it **settled** when the
  player pays (cash/UPI). When nobody has anything pending, the match can be
  **completed**.
- Funds are **per team**. A person in two teams has two separate balances.
- **Money is whole rupees** (integers) everywhere — inputs accept digits only, no
  paise. Display with `₹` and Indian grouping (`₹1,23,456`).
- Expense categories (§14.1) are global admin settings, used by all teams.

## 14. Data model additions

### 14.1 `config/expense-categories.json`

```ts
interface ExpenseCategory {
  id: string
  name: string               // unique (case-insensitive) among non-archived
  mode: 'mandatory' | 'optional' | 'manual'
  //  mandatory → added to every split automatically; amount required (> 0)
  //  optional  → added to every split automatically; may be left empty / removed
  //  manual    → not added automatically; available under "+ Add category"
  defaultAmount?: number     // [DECISION] optional prefill (e.g. Balls ₹600)
  order: number              // display order
  archived: boolean          // "delete" = archive — see below
  createdAt: string
  updatedAt: string
}
interface ExpenseCategoriesFile { schemaVersion: 1; categories: ExpenseCategory[] }
```

- Seeded at first-time setup: **Match fee** (mandatory), **Balls** (mandatory),
  **Breakfast** (optional). All editable.
- **Deleting a category = archiving it**: hidden from new splits and from Settings
  (unless "Show deleted"), restorable. Completed and in-progress matches keep it,
  because every match expense stores a **snapshot of the category name and mode**
  (§14.2) and never looks the name up again.

### 14.2 Match expense (`Match.expense` in `teams/<teamId>/matches.json`)

```ts
interface MatchExpense {
  status: 'draft' | 'submitted'   // draft = being entered (auto-saved); submitted = funds deducted
  lines: ExpenseLine[]
  payerIds: string[]              // squad members who pay; default = whole squad
  shares: PlayerShare[]           // computed at submit (live-previewed in draft)
  roundingExtra: number           // ₹ collected above the exact totals (§15.2) — display only, never booked to the fund
  submittedAt?: string
  updatedAt: string
}
interface ExpenseLine {
  categoryId: string
  categoryName: string            // SNAPSHOT at the time of the split
  mode: 'mandatory' | 'optional' | 'manual'   // snapshot
  total: number                   // whole rupees
  excludedPersonIds: string[]     // payers who don't share this line (e.g. skipped breakfast)
}
interface PlayerShare {
  personId: string
  byCategory: Record<string, number>   // categoryId → ₹ share
  total: number                         // Σ byCategory
  fromFunds: number                     // deducted from the player's fund at submit
  pending: number                       // total − fromFunds
  settled: boolean                      // true when pending = 0, or admin marked settled
  settledAt?: string
  settledMethod?: 'funds' | 'cash' | 'upi' | 'other'
  settledNote?: string
}
```

### 14.3 `teams/<teamId>/funds.json` — the fund ledger

```ts
type FundEntryType =
  | 'contribution'      // player gave money to the team fund           (+ player balance)
  | 'match_deduction'   // share paid from the player's fund            (− player balance)
  | 'refund'            // admin returned money to the player           (− player balance)
  | 'adjustment'        // admin correction, signed amount              (± player balance)

interface FundEntry {
  id: string
  teamId: string
  type: FundEntryType
  personId: string      // member or guest (§20)
  amount: number        // whole rupees, > 0; for 'adjustment' may be negative
  date: string          // YYYY-MM-DD
  matchId?: string      // for match_deduction
  method?: 'cash' | 'upi' | 'other'   // for contribution / refund
  note?: string
  createdAt: string
  updatedAt: string
}
interface FundsFile { schemaVersion: 1; entries: FundEntry[] }
```

**Derived values (`lib/funds.ts`, unit-tested — never stored):**
- `balance(personId)` = Σ contribution − Σ match_deduction − Σ refund + Σ adjustment.
  **A balance can never go below ₹0**; any operation that would make it negative is
  blocked with a clear message.
- `teamFund` = Σ all player balances (members and guests).
- `collected` = Σ contributions; `usedForMatches` = Σ match_deduction;
  `pendingDues` = Σ `pending` of unsettled shares in matches with
  `lifecycle = 'settling'`.
- Deductions are keyed by `(matchId, personId)`: re-submitting a match's expenses
  **replaces** that match's deduction entries (git history keeps the old ones).

### 14.4 Files written together
Submitting / editing / settling a match writes the team's `matches.json` **and**
`funds.json` (and `teams.json` stats). Write `funds.json` first, then
`matches.json`. If the second write fails, it stays in the offline queue and the
app shows "Sync incomplete — retrying" instead of silently diverging. Only the
admin writes these files.

## 15. Split calculation (`lib/split.ts`, unit-tested)

### 15.1 Algorithm
Input: `lines`, `payerIds`, and each payer's **available balance** = fund balance
**excluding this match's own existing deductions** (so re-submitting doesn't
double-count).

1. For each line with `total > 0`: participants = `payerIds − excludedPersonIds`
   (none → validation error on that line). `perHead = ceil(total / participants)`;
   each participant gets `byCategory[line] = perHead`.
2. `roundingExtra` = Σ over lines of (`perHead × participants − total`)
   (display only).
3. Per payer: `total = Σ byCategory`; `fromFunds = min(available, total)`;
   `pending = total − fromFunds`; `settled = pending === 0`
   (`settledMethod: 'funds'` when `fromFunds > 0`).
4. Squad members switched to "Not paying" get no share.

### 15.2 Rounding — confirmed by product owner
Per-head amounts are rounded **up** to the next rupee so everyone in a line pays
the same. The few extra rupees (typically ₹20–30 per match) are **not** recorded
anywhere in the fund — the admin simply keeps them. The split footer shows them for
transparency: "Includes ₹8 rounding".

### 15.3 Worked example (also a unit test)

Squad of 11, all paying. Match fee ₹3,000 (all 11), Balls ₹600 (all 11),
Breakfast ₹550 (10 — Amit excluded).

- Match fee: ceil(3000 / 11) = ₹273 → rounding extra 273 × 11 − 3000 = ₹3
- Balls: ceil(600 / 11) = ₹55 → rounding extra 55 × 11 − 600 = ₹5
- Breakfast: 550 / 10 = ₹55 → rounding extra ₹0
- Per player ₹383 (273 + 55 + 55); Amit ₹328. Collected ₹4,158 = ₹4,150 + ₹8
  rounding (`roundingExtra = 8`, not booked to the fund).

| Player | Balance before | Share | From funds | Pending | Balance after |
|---|---|---|---|---|---|
| Rahul | ₹1,000 | ₹383 | ₹383 | ₹0 → auto-settled | ₹617 |
| Vikram | ₹200 | ₹383 | ₹200 | **₹183** | ₹0 |
| Amit | ₹0 | ₹328 | ₹0 | **₹328** | ₹0 |

Rahul never appears in the pending list; Vikram and Amit do until the admin marks
them settled.

## 16. Flows & screens

### 16.1 Match lifecycle

```
scheduled ─Mark complete─┬─ "No expense split needed" ticked ─────────────► completed
                         └─ Split expenses (draft, auto-saved)
                                   │ Submit (deduct from funds)
                                   ▼
                               settling ─ all shares settled ─ Complete ───► completed
                                   ▲                                          │
                                   └──────────────── Reopen (admin) ──────────┘
```

- A match **cannot** reach `completed` any other way.
- [DECISION] **Mark complete** is available from the **match day** onwards
  (disabled before, hint "Available from 22 Nov"), on Match detail and as a prompt
  on "Awaiting completion" rows.
- [DECISION] A `settling` match can't be cancelled or deleted; a `scheduled` match
  with only a **draft** can be (draft discarded, confirm).
- [DECISION] The **squad is locked** once expenses are submitted (payers change via
  **Edit expenses**). While in draft, squad changes update the split's member list.

### 16.2 Mark complete sheet — `#/teams/:teamId/matches/:matchId/complete`
- Title "Complete match vs Lions · Sat 22 Nov".
- [DECISION] **Result** chips (Won / Lost / Tied / Draw / No result / Abandoned) and
  optional scores — optional here, can be added later.
- Checkbox **"No expense split needed for this match"**:
  - ticked → **Complete match** → confirm → `completed`, `noExpenseSplit: true`;
  - unticked → **Split expenses →** (needs a non-empty squad; if empty: "Pick the
    squad first" → squad picker → back here).

### 16.3 Split expenses screen — `#/teams/:teamId/matches/:matchId/expenses`
Admin, full screen. Auto-saves as `expense.status = 'draft'`, so leaving and
returning keeps everything.

**Top — Expenses card**
- A row per auto-added category (mandatory first, then optional, by `order`): name,
  amount input (prefilled with `defaultAmount`); mandatory marked `*`; optional rows
  have a remove `×`.
- **+ Add category** → manual categories and removed optional ones.
- Each line shows live `÷ 10 players · ₹55 each`.
- **Total ₹4,150**.

**Middle — Members (the squad)**
- Row per squad member: avatar, **name**, and directly **under the name `Funds:
  ₹1,000`** (green if > 0, grey `Funds: ₹0`).
- Right side: per-category chips (`Match ₹273 · Balls ₹55 · Bfast ₹55`) and the
  **total ₹383** in bold.
- Below: live preview `₹383 from funds` (green, nothing due) · `₹200 from funds ·
  ₹183 due` (amber) · `₹328 due` (red).
- **Pays** switch per member [DECISION], default on. Off → greyed "Not paying"; the
  others' shares grow.
- **Tap a category chip** to exclude/include that member for that category
  [DECISION] (struck-through when excluded).
- Filter chip "Has dues".

**Footer (sticky):** `Total ₹4,150 · From funds ₹2,900 · To collect ₹1,258 ·
Includes ₹8 rounding` and **Submit expenses**.

**Validation:** every mandatory line > 0; ≥ 1 payer; every line ≥ 1 participant;
whole rupees ≤ ₹10,00,000 per line.

**Submit** → confirm: "₹2,900 will be deducted from 8 players' funds. 3 players owe
₹1,258 in total." → deductions written to `funds.json`, shares to the match,
`lifecycle = 'settling'`. If **nobody has anything pending**, the confirm
offers **Submit & complete match**.

### 16.4 Settlement (Match detail while `settling`)
- Progress `8 of 11 settled` with a bar.
- **Pending**: name, `₹183 due`, **Mark settled** → sheet: method (Cash / UPI /
  Other), date (default today), note.
- **Settled**: `Paid from funds ✓ ₹383` or `₹200 from funds + ₹183 UPI · 22 Nov`;
  admin can **Undo** a manual settlement.
- **Complete match** — disabled until everyone is settled ("3 players still to
  settle"). Settling the last one prompts "Everyone has settled. Complete the match
  now?".
- **Edit expenses** → split screen with current values. On re-submit, this match's
  deductions are replaced; any **manually settled** share whose amount
  changed returns to unsettled (warn first: "Vikram's due changes from ₹183 to
  ₹200 — he'll need settling again").
- Completed matches show a read-only **Expense summary**; admin **Reopen match**
  (confirm) → back to `settling`.

### 16.5 Funds tab — `#/funds`
Bottom tab bar becomes: `🏏 Teams` · `📅 Matches` · `💰 Funds` · `⚙️ Settings`.

- **Team selector** at the top (chips; dropdown when > 4 teams); remembers the last
  team per device. Viewers see only their teams.
- **Summary card:** `Team fund ₹18,450` (big) · `Collected ₹25,000` · `Used for
  matches ₹6,550` · `Pending dues ₹1,258`.
- **Players list** (active members, then **Guests** (§20) and "Left team" sections —
  each only for people who have a balance, dues or fund history): name, **balance** (green > 0, grey ₹0), amber `₹183 due`
  chip for pending dues. Filters: **Low balance (< ₹500)** [DECISION, threshold in
  settings] · **Has dues**.
- Admin **+ Add contribution** (pick player), or tap a player → **Player fund
  sheet**:
  - Balance, total contributed, total used.
  - **Add contribution**: amount, date (default today), method (Cash / UPI /
    Other), note.
  - **Confirmed:** when the admin saves a contribution and that player has unsettled
    dues in any `settling` match, ask: "Vikram owes ₹183 for vs Lions (22 Nov). Use
    this contribution to settle it?" — one row per match with a checkbox (all ticked
    by default), oldest first, only as far as the new balance allows. Yes = a
    `match_deduction` per ticked match + those shares settled with method `funds`.
    No = the money stays in his balance.
  - **Refund / withdraw** (confirmed): amount ≤ balance, method, note.
  - **Adjustment** (confirmed): signed correction, note required.
  - **History**, newest first: `+₹1,000 contribution · UPI · 1 Nov`,
    `−₹383 vs Lions · 22 Nov` (tap → match), refunds, adjustments.
  - Edit/delete contributions and adjustments (confirm); blocked if the balance would
    go negative ("₹383 of this was already used for vs Lions"). Deductions change
    only through their match.

### 16.6 Settings → Expense categories (admin) — `#/settings/categories`
- List by `order` (up/down to reorder): name, mode badge, default amount.
- **+ Add category**: name, mode (**Mandatory · Optional · Manual**, each with a
  one-line explanation), default amount (optional).
- Edits apply to **new** splits only (drafts keep their lines).
- **Delete** → confirm "Removed from new matches. Matches that already used it keep
  it." → `archived: true`. "Show deleted" → **Restore**.

### 16.7 What viewers see — confirmed: everything money-related, read-only
- **Funds tab:** the same screen as the admin for their teams — team summary, every
  player's balance and dues, and each player's fund history — without any add /
  edit / settle buttons. Their own row is pinned to the top and highlighted.
- **Match detail:** the full expense summary — category totals, every player's
  share, how it was paid, who is settled. Their own row highlighted, with "You owe
  ₹183 — pay the admin" in amber when applicable.
- Phone numbers stay hidden everywhere (§5.2) — money visibility doesn't change that.

### 16.8 Team stats additions
`TeamStats` gains `fundBalance`, `pendingDues`, `settlingMatches` so home cards can
show money info without loading `funds.json` (recomputed on every funds change).

### 16.9 Exports
- CSV: fund ledger per team; match expenses (one row per player per match: category
  amounts, from funds, pending, settled method/date).
- JSON backup includes `funds.json` files and `expense-categories.json`.
- CSV and summaries label guests as "(guest)".

## 17. Expenses edge cases

1. Squad player removed from the team before settling → stays in the split; dues
   remain; shown under "Left team" in Funds.
2. Player with `access: 'none'` → still pays; access doesn't affect money.
3. Two settling matches drawing on one balance → each submit uses the balance at
   that moment (§15.1); submission order decides.
4. Contribution edited/deleted after part was used → blocked if the balance would go
   negative.
5. Category archived while used in a draft → the draft keeps the line (snapshot).
6. Category mode changed → affects new splits only.
7. Optional line left empty/0 → removed on submit; no ₹0 shares.
8. One payer → pays everything; zero payers → can't submit.
9. Reopened match edited → same rules as Edit expenses; stats recomputed.
10. Admin in the squad → pays like any member.
11. Admin offline → split, settlement and contributions queue offline; funds show "as
    of last sync" with the offline badge.
12. Deleting a match: only while `scheduled` (draft discarded); [DECISION] never
    after funds were deducted, to keep the ledger honest.

## 18. Expenses — build phase & tests

**Phase 6 — Expenses & Funds** (after matches & squads): categories settings + seed
→ `lib/split.ts` and `lib/funds.ts` with unit tests (the §15.3 example, rounding,
exclusions, non-payers, partial funds, re-submit replacement, negative-balance
guards) → Mark complete sheet → split screen → settlement → Funds tab → viewer views
→ exports → stats additions.

## 19. Expense decisions (answered by the product owner, v0.5)

| # | Question | Decision |
|---|---|---|
| 1 | Partial funds | **Deduct what the balance covers; the rest is pending.** |
| 2 | Pays switch + per-category exclusions | **Yes, both.** |
| 3 | Rounding | **Round up per head; the extra (≈ ₹20–30/match) is NOT added to the fund.** |
| 4 | What viewers see | **Everyone's balances, shares and settlement status** (read-only; no phone numbers). |
| 5 | Contribution vs dues | **Ask when the admin adds a contribution** if the player has unsettled dues (§16.5). |
| 6 | Guests | **Yes** — people who play without being in the master list or onboarding (§20). |
| 7 | Completion timing | **Mark complete from match day onwards.** |
| 8 | Refunds / adjustments | **Yes.** |
| 9 | Team spending not tied to a match | **Not needed now.** |

## 20. Guest players (v0.5)

Not everyone will use the app. Two different cases, both supported:

1. **Master-list members who never onboard** — already work: adding a player never
   requires them to open the app. They can be picked in squads, pay shares, hold a
   fund balance and be settled by the admin. They just never log in.
2. **Guests** — people who play for the team occasionally and are **not in the
   master list**. The admin adds them directly to a match squad, **name only**
   (mobile number optional).

### 20.1 Data
`Person` (§6.3) changes:

```ts
interface Person {
  // …existing fields…
  phoneHash?: string         // now OPTIONAL — guests may have no number
  phoneLast4?: string
  isGuest: boolean           // true when created via "Add guest"; false for master-list players
  guestOfTeamIds?: string[]  // teams whose squads this guest has played in (for suggestions)
}
```

- A guest has **no membership**, so they **can never log in** (§5.9 requires an
  active membership), even if a number was entered.
- `squad` (§6.6) may contain guest `personId`s; the UI tags them **Guest**.
- Uniqueness: if a number is entered for a guest and it already belongs to a
  person, reuse that person (e.g. a member of another team playing as a guest here).

### 20.2 Squad picker — "+ Add guest"
- At the bottom of the squad picker: **+ Add guest** → sheet with **Name**
  (required) and **Mobile number (optional, 10 digits)**.
- Above the form, **suggestions**: guests who played for this team before
  (`guestOfTeamIds`) and members of the admin's other teams, searchable by name — tap
  to add without creating a duplicate.
- Selected guests appear in the squad list with a **Guest** chip; the 11-player hint
  counts them.

### 20.3 Money
- Guests take part in splits exactly like members: Pays switch, category
  exclusions, shares.
- A guest's fund balance in the team is usually ₹0, so their share is pending and
  the admin settles it (cash/UPI). Guests **may** also receive contributions (e.g. a
  regular guest paying in advance) — they then appear in the **Guests** section of
  the Funds tab with a balance, and funds-first deduction applies to them too.
- Funds tab shows guests only when they have a balance, dues or history.

### 20.4 Converting a guest to a team member
- Guest's sheet (from a squad or the Funds tab) → **Add to team <name>** → asks for
  the **mobile number** if missing (required for members) → creates an active
  membership; `isGuest` becomes false. Their past squads, shares and fund history
  stay attached (same `personId`), and they gain view access like any member.

### 20.5 Settings → Users
Guests are listed in a separate **Guests** filter (name, teams played for, matches
played, dues) with actions: edit name, add/change number, **Add to team**. There is
no access control for guests — they can't log in.

### 20.6 Edge cases
1. Guest added with a number that later gets added to the master list → the existing
   person is reused (no duplicate); history merges automatically.
2. Two guests with the same name and no numbers → allowed (different ids); the
   suggestion list shows the last match each played to tell them apart.
3. A guest's only match is deleted while `scheduled` → the guest person remains (no
   harm) and keeps appearing in suggestions.

---

## 21. Branding — AllAroundCricket (v0.6)

### 21.1 Name usage
- App name everywhere: **AllAroundCricket** (one word, capital A-A-C).
- Manifest: `"name": "AllAroundCricket"`, `"short_name": "AllAround"` (fits under
  the Home Screen icon); `apple-mobile-web-app-title` = `AllAround`;
  `<title>AllAroundCricket</title>`.
- Header on Login/Setup: icon + "AllAroundCricket"; inside the app the header shows
  screen titles, not the app name.

### 21.2 Icon — original artwork, **do not copy any existing logo**
The product owner wants the feel of the IPL logo: a **batsman silhouette playing a
big shot**. The IPL logo is a registered trademark and most web graphics are
copyrighted, so **draw an original SVG** (don't download or trace an existing logo
or stock image):

- **Subject:** a single batsman silhouette mid **lofted drive / pull shot** — front
  leg planted, back leg bent, bat swung high over the shoulder in a strong
  diagonal, helmet-shaped head; plus a small **ball** with a short motion arc
  leaving the bat toward the top-right.
- **Style:** flat, solid silhouette (no outlines, no text, no gradients on the
  figure), readable at 48 px. Simple geometric shapes are fine — clarity beats
  realism.
- **Background (v0.7):** a rounded square (radius ~22 % of size) in cricket-ball
  red `#9B1C1F`, optionally a subtle diagonal to `#7A1518`; silhouette in white;
  the **ball in white with one thin curved red seam** (it reads as a ball against
  the red background).
- **Safe zone:** keep the figure inside the central 80 % so Android's maskable
  crop (circle/squircle) never cuts the bat or ball.
- **Files** (generated from one master SVG, e.g. with a small Node script using
  `sharp`, committed as static files):
  - `public/icon.svg` — master
  - `public/icon-192.png`, `public/icon-512.png` (`"purpose": "any"`)
  - `public/icon-maskable-512.png` (full-bleed background, `"purpose": "maskable"`)
  - `public/apple-touch-icon.png` 180×180 (no transparency) + `<link rel="apple-touch-icon">`
  - `public/favicon-32.png`
- If a model can't draw a convincing silhouette, use a **CC0 / public-domain**
  cricket batsman icon (licence must explicitly allow commercial use without
  attribution, e.g. CC0) and record its source and licence in `public/ICON_LICENSE.md`.

### 21.3 Colours & theme tokens — "cricket ball" theme (v0.7, product owner)

**Light mode = white + cricket-ball dark red. Dark mode = black + the same red.**

| Token | Light | Dark | Use |
|---|---|---|---|
| `brand` | `#9B1C1F` | `#9B1C1F` | **cricket-ball red** — filled buttons, light-mode header bar, active tab indicator, badges, icon background, FAB |
| `brand-pressed` | `#7A1518` | `#7A1518` | pressed state of brand fills |
| `brand-text` | `#9B1C1F` | `#F05252` | red **text**/links/icons on the page background (the tint keeps ≥ 4.5:1 contrast on black — `#9B1C1F` on black is too dark to read as text) |
| `on-brand` | `#FFFFFF` | `#FFFFFF` | text/icons on brand fills |
| `bg` | `#FFFFFF` | `#000000` | page background |
| `surface` | `#FFFFFF` | `#121212` | cards, sheets, tab bar |
| `surface-alt` | `#F7F7F7` | `#1C1C1C` | grouped rows, inputs, chips |
| `border` | `#E5E5E5` | `#2A2A2A` | card and divider hairlines |
| `text` | `#111111` | `#F5F5F5` | primary text |
| `text-muted` | `#6B6B6B` | `#A3A3A3` | secondary text |
| `success` | `#15803D` | `#22C55E` | Won, settled, positive balance |
| `danger` | `#DC2626` | `#F87171` | Lost, dues, destructive actions |
| `warning` | `#B45309` | `#FBBF24` | partial dues, settlement pending |

Rules:
- **Light:** white everywhere; the **header bar is solid brand red with white
  text**; cards are white with a `border` hairline (no heavy shadows); primary
  buttons brand-filled. `meta theme-color` = `#9B1C1F` (red status bar).
- **Dark:** black page, `#121212` cards; header bar black with a 2 px brand-red
  bottom border and white title; primary buttons the same brand-red fill.
  `meta theme-color` = `#000000`.
- Because the brand is red, **danger must never look like a brand control**:
  destructive buttons are **outlined** (danger border + text), never filled; "Lost"
  and dues always carry a text label or icon, not colour alone.
- Team colours (§6.4): a palette of 10 hues that excludes reds/maroons (so team
  stripes never look like the brand or like "Lost"): navy, royal blue, teal, green,
  olive, purple, magenta, orange, gold, slate.
- Define tokens as CSS variables (switched by the `dark` class) and map them in
  `tailwind.config.js` (`theme.extend.colors`).

### 21.4 Typography & tone
- System font stack (no web-font download): `-apple-system, "Segoe UI", Roboto,
  sans-serif`; numbers use `font-variant-numeric: tabular-nums` so amounts line up.
- Tone: short, friendly cricket language — "You're in the squad", "Awaiting
  completion", "All settled 🎉".

---

## 22. Notifications (v0.7)

> Reuse the proven design from the reference app: playbook §9 and the working code
> in `E:\Claude Projects\PersonalExpenseTracker_App` (`src/lib/push.ts`,
> `src/components/NotificationsCard.tsx`, `public/sw.js` push handlers,
> `notifier/notify.yml`, `notifier/notify/notify.mjs`). Differences are listed here.

### 22.1 When a notification is sent — one trigger only
- **Trigger:** a match's expenses are **submitted** (§16.3 "Submit expenses" or
  "Submit & complete match"), i.e. `expense.status` becomes `'submitted'`.
- **Re-submit** via Edit expenses (§16.4): notify **only** recipients whose share,
  from-funds or pending amount changed ("Expenses updated…").
- **Nothing else** sends notifications in this version — not settling, completing,
  contributions, squads or new matches ([LATER]).

### 22.2 Who receives it
All of these must be true for a person:
1. They are in **that match's squad** and are a **payer** or listed in the split.
2. They have **turned notifications on** — at least one entry in
   `push/subscriptions.json` with their `personId`.
3. Their `access` is `view` and the subscription's `sessionEpoch` equals their
   current `sessionEpoch` (§5.4) — so a phone that was logged out by a PIN reset or
   Log out stops receiving.
4. They are **not the admin who submitted** (from the commit's `Actor:` trailer) —
   [DECISION] the admin doesn't get notified about their own action even when in the
   squad.

Guests and members who never onboarded have no subscriptions, so they're skipped
automatically. A person with two phones gets it on both.

### 22.3 Subscriptions file — `push/subscriptions.json`

```ts
interface PushSubscriptionRecord {
  personId: string
  deviceId: string        // random id per device (localStorage)
  device: string          // "iPhone" / "Android" — readable label
  endpoint: string
  keys: { p256dh: string; auth: string }
  sessionEpoch: number    // copied from the person's credential when saved
  createdAt: string
}
interface SubscriptionsFile { schemaVersion: 1; subscriptions: PushSubscriptionRecord[] }
```
- Each device writes **only its own entry** (write exemption, §5.9), with the
  read-modify-write retry loop from the reference `push.ts`.
- **Log out** removes this device's entry. On launch, re-save if the browser rotated
  the endpoint or the `sessionEpoch` changed after a new PIN was set.
- No phone numbers in this file.

### 22.4 Sender — GitHub Action in the data repo
Same structure as the reference notifier (`notify.yml` + `notify/notify.mjs` +
`web-push`, VAPID keys), with these changes:
- `on: push` with `paths: ['teams/*/matches.json']` + `workflow_dispatch` (test
  message to all subscriptions).
- `concurrency: { group: notify, cancel-in-progress: true }` and a **30 s** wait
  (the admin often edits right after submitting).
- From the marker in `push/state.json` to HEAD, for every changed `matches.json`
  compare each match's `expense` before vs after:
  - not submitted → submitted ⇒ **"posted"** message to every eligible squad member;
  - submitted → submitted with changed `submittedAt` ⇒ **"updated"** message only to
    people whose `PlayerShare` total / fromFunds / pending changed.
- Reads `people.json` (names, access), `auth/credentials.json` (session epochs),
  `teams.json` (team name) and the team's `funds.json` (balance left) at HEAD.
- One notification per recipient per match (`tag: match-<matchId>`, `topic` header
  so undelivered updates collapse). Expired subscriptions (404/410) are removed;
  the new marker is committed with `[skip ci]`.
- Cost: one short run per `matches.json` change (~1 billed minute); fine within the
  2,000 free minutes/month of a private repo.
- `DRY_RUN=1` mode prints payloads — test with fixture repos.

### 22.5 Message content (personalised from that person's `PlayerShare`)
Title: `💰 vs Lions · Sat 22 Nov — expenses posted` (team name added when the person
is in several teams: `RCC vs Lions…`).

| Situation | Body |
|---|---|
| Fully covered by fund | `Your share ₹383 was paid from your fund ✓. Fund left: ₹617.` |
| Partly covered | `Your share ₹383: ₹200 from your fund, ₹183 to pay the admin.` |
| No fund | `Your share is ₹328 — please pay the admin.` |
| In squad, not paying | `Match total ₹4,150. You're not paying for this one.` |
| Updated (re-submit) | `Expenses updated — your share is now ₹400 (was ₹383). ₹17 to pay.` |

Tap → opens `#/teams/<teamId>/matches/<matchId>` (Match detail with the expense
summary, own row highlighted). If the app is already open, the service worker posts
a message and the app navigates there.

### 22.6 Asking permission at startup + Settings toggle

**Platform rule:** browsers only show the system "Allow notifications?" prompt in
response to a **tap**, and Chrome may block sites that ask on page load. So "ask at
startup" = the app **automatically shows its own sheet**, whose button triggers the
system prompt.

**Startup sheet** — shown right after the app opens (and after onboarding finishes)
when all are true: logged in; push supported; on iPhone running as the installed
app; `Notification.permission === 'default'`; not dismissed in the last 7 days; shown
fewer than 3 times in total (counters in localStorage).

```
🔔  Stay in the loop
Get a notification when match expenses are posted —
your share and anything you owe.
[ Allow notifications ]        Not now
```
- **Allow** → `Notification.requestPermission()` → if granted: subscribe and save
  (§22.3) → toast "Notifications on". If denied: toast "Notifications blocked — you
  can enable them in Settings".
- **Not now** → ask again after 7 days; after the 3rd "Not now", only via Settings.
- Permission already **granted** but no subscription on this device (reinstall, new
  phone) → subscribe and save **silently** at startup, no sheet.
- iPhone in Safari (not installed) → no permission sheet; the install banner (§7.1)
  mentions that notifications need the Home Screen app.

**Settings → Notifications** (everyone; per device):
| State | Shows |
|---|---|
| On | "On for this device" + **Turn off** |
| Off (permission default/granted, not subscribed) | **Turn on** (same flow as Allow) |
| Blocked by the phone (permission denied) | "Blocked in your phone settings" + steps: iPhone → Settings → Notifications → AllAround → Allow; Android → long-press the app icon → App info → Notifications |
| iPhone not installed | "Add AllAroundCricket to your Home Screen to get notifications" |
| Not supported | "This browser doesn't support notifications" |

**Turn off** → `subscription.unsubscribe()` and remove this device's entry.

### 22.7 Service worker
- `push` → `showNotification(title, { body, icon: 'icon-192.png', badge:
  'badge-72.png' (monochrome white-on-transparent ball), tag, data: { url } })`.
- `notificationclick` → focus an open app window and `postMessage({ type: 'open',
  url })`, else `clients.openWindow(url)`.
- The rest of the SW is as in §4 (network-first navigations, never cache `sw.js` /
  `version.json`).

### 22.8 Setup & build (Phase 7)
1. `npx web-push generate-vapid-keys`.
2. Code repo: Actions **variable** `VAPID_PUBLIC_KEY` → build env
   `VITE_VAPID_PUBLIC_KEY`.
3. Data repo: copy `notifier/notify.yml` → `.github/workflows/notify.yml` and
   `notifier/notify/` → `notify/`; secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` (`mailto:` address of the admin). Workflow permissions: read and
   write.
4. Build order: subscription module + startup sheet + Settings toggle → SW handlers
   + deep link → notifier script with unit-tested diff (fixtures: first submit, re-
   submit with one changed share, non-payer, excluded admin, stale epoch, expired
   subscription) → README steps → test via `workflow_dispatch`.

### 22.9 Edge cases
1. Admin submits, then immediately edits and re-submits within 30 s → one run sees
   the final state → recipients get a single "posted" message.
2. Expenses submitted while a player's phone is off → delivered when it reconnects
   (TTL 24 h; collapsed by topic if updated meanwhile).
3. Player removed from the team after the match but still in the squad with access
   `view` → still notified (it's their money).
4. Match reopened and re-submitted → treated as an update (§22.1).
5. A device's subscription expired → removed by the notifier; the app re-subscribes
   silently on next launch if permission is still granted.
