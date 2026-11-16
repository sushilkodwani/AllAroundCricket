# Expense notifications — setup

The app only *receives* notifications. They are *sent* by a GitHub Action that
lives in the **private data repo**. It sends three things, only to players who
turned notifications on:

- **Expenses posted / updated** for a match, to its squad, with each player's share
  (runs when a team's `matches.json` changes).
- **Match reminder** at 6 pm India time the evening before a match: to the squad,
  or to every active player if no squad is picked yet (runs once a day).
- **Payment reminder** when the admin taps *Remind* in the app (runs when
  `push/outbox.json` changes).

## One-time setup

1. **Create a key pair** (on any computer with Node):

   ```bash
   npx web-push generate-vapid-keys
   ```

2. **Code repo** (this one) → Settings → Secrets and variables → Actions →
   **Variables** → add `VAPID_PUBLIC_KEY` with the public key. Re-run the deploy
   so the app is built with it.

3. **Data repo**:
   - Copy `notifier/notify.yml` → `.github/workflows/notify.yml`
   - Copy the folder `notifier/notify/` → `notify/` (you need `notify.mjs`,
     `diff.mjs` and `package.json`; the test file is optional)
   - Settings → Secrets and variables → Actions → **Secrets**:
     `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`
     (`mailto:` + the admin's email address)
   - Settings → Actions → General → Workflow permissions → **Read and write**

   The shared access token used by the app has only *Contents* permission and
   cannot add workflow files, so do this step in the GitHub website or with
   your own git login.

4. **Test it:** in the app, Settings → Notifications → **Turn on** (on iPhone
   the app must be opened from the Home Screen). Then in the data repo: Actions
   → *Notify on match expenses* → **Run workflow**. Every subscribed phone gets
   the test message.

## How it behaves

- Waits 30 seconds, and a newer save cancels a waiting run — so "submit, fix,
  re-submit" produces one notification, not three.
- The admin who submitted is not notified. A phone that was logged out, or
  whose PIN was reset, stops receiving.
- Expired subscriptions are removed automatically.
- Cost: about one billed minute per run, plus one a day for the match reminder
  (about 30 a month); private repos get 2,000 free minutes a month.
- To change the reminder time, edit the `cron` line in the workflow (it is in UTC).
- If you set this up before reminders existed, copy `notify.yml`, `notify.mjs`
  and `diff.mjs` into the data repo again.

## Trying it without sending anything

From a clone of the data repo:

```bash
DRY_RUN=1 BEFORE_SHA=<an older commit> node notify/notify.mjs
```

prints each message instead of sending it and changes nothing.
