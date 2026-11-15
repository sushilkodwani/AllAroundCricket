# AllAroundCricket

An installable phone app (PWA) for running amateur cricket teams: teams and
players, matches and squads, match expenses and team funds. One admin edits;
players see their teams read-only. No server and no hosting bill — the app is
served from GitHub Pages and the data lives as JSON files in a **private**
GitHub repo.

The full design is in [PLAN.md](PLAN.md).

## Admin setup guide

1. **Create a private repo for the data** (for example `cricket-data`). Leave it
   empty.
2. **Create a fine-grained access token** at
   <https://github.com/settings/personal-access-tokens/new>: *Repository access*
   → only the data repo; *Permissions* → **Contents: Read and write**; the
   longest expiry you can. Note the expiry date.
3. **Deploy the app**: push this code to a **public** GitHub repo (branch
   `main`), then Settings → Pages → Source: **GitHub Actions**. Optional Actions
   *variables* `DATA_OWNER` and `DATA_REPO` pre-fill the data repo on the
   onboarding screen, so players type only the token and their number.
4. **On your phone**: open the Pages URL, install the app (iPhone: Safari →
   Share → *Add to Home Screen*; Android: Chrome menu → *Install app*), open it
   from the Home Screen and choose **First time setup (admin)**. Enter the repo,
   the token, your name, your 10-digit number and a 6-digit PIN. **Write down
   the recovery code** — it is the only way to reset your own PIN.
5. Settings → Data repo → enter the **token expiry date** to get a reminder.
6. Add teams and players. Share the app link with players (the *Share* button
   after adding a player writes the message); send the **token separately and
   privately**.
7. Optional: set up expense notifications — see
   [notifier/README.md](notifier/README.md).

Each player onboards once per phone with the repo, the token and their number,
then sets their own PIN. Later onboardings with that number ask for the PIN.

## Security in plain words

- Everyone uses one shared token that can write. **View-only is enforced by the
  app**, not by GitHub. Someone holding the token could edit the repo directly;
  every change is a git commit, so anything can be seen and restored.
- Phone numbers are stored only as salted hashes plus the last four digits.
  Players never see anyone's number.
- PINs and the recovery code are stored only as slow one-way hashes
  (PBKDF2-SHA256). Nobody can read them back; the admin can only reset a PIN.
- Never put the token, a phone number or a PIN in this (public) code repo.

## Development

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

On the dev server only, entering repo owner **`demo`** (any repo name, any
token) uses a fake data repo kept in the browser, so every flow can be tried
without GitHub. Ready-made test values are in
[scripts/demo-fixtures.json](scripts/demo-fixtures.json). The demo repo does
not exist in production builds.

`npm run icons` regenerates the PNG icons from `public/icon.svg` (original
artwork).

## How it is built

| Part | Where |
|---|---|
| Data files and types | `src/types.ts`, `src/lib/paths.ts` |
| GitHub client (ETag reads, sha-checked writes) | `src/lib/github.ts` |
| Store: local cache, offline write queue, merge, write guard | `src/lib/store.ts`, `merge.ts`, `access.ts`, `cache.ts` |
| Every data change | `src/lib/domain.ts` |
| Onboarding, setup, PINs | `src/lib/connect.ts`, `pin.ts`, `phone.ts` |
| Expense split and fund maths | `src/lib/split.ts`, `funds.ts`, `stats.ts` |
| Screens | `src/screens/` |
| Service worker (network-first pages, push) | `public/sw.js` |
| Notification sender for the data repo | `notifier/` |

Reads are cached on the phone, so the app opens instantly and works offline;
the admin's edits made offline are queued and sent when the connection is back.
If two devices change the same file, records are merged by id.
