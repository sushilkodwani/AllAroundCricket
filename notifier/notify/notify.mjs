// All Around Cricket expense notifier — runs in the PRIVATE DATA repo via
// .github/workflows/notify.yml (copied from notifier/ in the app repo).
//
// What it does
// 1. Finds what changed in teams/*/matches.json since the last run (marker in
//    push/state.json).
// 2. For each match whose expenses were submitted (or re-submitted with
//    changed shares) builds a personalised message per squad member.
// 3. Sends a Web Push to every eligible subscription — never to the admin who
//    submitted, never to a phone that was logged out.
// 4. Drops dead subscriptions and records the new marker.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… or https://…)
// Optional: TEST_MESSAGE (manual test run → everyone), DRY_RUN=1 (print instead
//           of sending/committing), BEFORE_SHA (fallback start of the range),
//           MODE=reminders (the daily scheduled run: tomorrow's matches),
//           TZ_OFFSET_MINUTES (default 330 = India) for what "tomorrow" means.
//
// It also sends the payment reminders the admin asks for in the app: new
// entries in push/outbox.json (PLAN §37).

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildMessage, duesMessage, expenseEvents, matchReminders, newOutbox, recipients, reminderMessage, tomorrowIn, topicFor } from './diff.mjs'

const DRY_RUN = process.env.DRY_RUN === '1'
const SUBS_PATH = 'push/subscriptions.json'
const STATE_PATH = 'push/state.json'
const OUTBOX_PATH = 'push/outbox.json'
const REMINDERS = process.env.MODE === 'reminders'
const TTL_SECONDS = 24 * 60 * 60

// ---------- git + file helpers ----------
function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}
function tryGit(...args) {
  try {
    return git(...args)
  } catch {
    return null
  }
}
/** JSON content of `path` at `rev`, or null if it didn't exist there. */
function jsonAt(rev, path) {
  const text = tryGit('show', `${rev}:${path}`)
  if (text == null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}
function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

/** personId from the "Actor: <personId>" trailer of the newest commit that touched `path` in the range. */
function actorOf(range, path) {
  const body = tryGit('log', '-1', '--format=%B', range, '--', path) ?? ''
  return body.match(/^Actor:\s*(\S+)\s*$/m)?.[1] ?? null
}

// ---------- sending ----------
async function sender() {
  if (DRY_RUN) {
    return async (sub, payload) => {
      console.log(`[dry run] → ${sub.personId} (${sub.device ?? sub.deviceId}):`, JSON.stringify(payload))
      return 'ok'
    }
  }
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    throw new Error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT secrets.')
  }
  const webpush = (await import('web-push')).default
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  return async (sub, payload, topic) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: TTL_SECONDS, ...(topic ? { topic } : {}) })
      return 'ok'
    } catch (e) {
      // 404 / 410: the subscription is gone for good — remove it.
      if (e.statusCode === 404 || e.statusCode === 410) return 'gone'
      console.error(`Push to ${sub.personId} failed: ${e.statusCode ?? ''} ${e.body ?? e.message}`)
      return 'failed'
    }
  }
}

// ---------- main ----------
const head = git('rev-parse', 'HEAD')
const subsFile = readJson(SUBS_PATH, { schemaVersion: 1, subscriptions: [] })
const subscriptions = subsFile.subscriptions ?? []
const send = await sender()
const gone = new Set()
let sent = 0
let remindedFor = null

if (process.env.TEST_MESSAGE) {
  // Manual run (workflow_dispatch): one test message to every subscription.
  for (const sub of subscriptions) {
    const result = await send(sub, { title: 'All Around Cricket', body: process.env.TEST_MESSAGE, tag: 'test', url: '#/teams' })
    if (result === 'gone') gone.add(sub.endpoint)
    if (result === 'ok') sent++
  }
} else if (REMINDERS) {
  // Daily run: one reminder per match played tomorrow. `remindedFor` stops a re-run from sending twice.
  const state = readJson(STATE_PATH, {})
  const date = tomorrowIn(new Date(), Number(process.env.TZ_OFFSET_MINUTES ?? 330))
  if (state.remindedFor !== date) {
    const people = readJson('people.json', { people: [] }).people ?? []
    const credentials = readJson('auth/credentials.json', { credentials: [] }).credentials ?? []
    for (const team of readJson('teams.json', { teams: [] }).teams ?? []) {
      if (team.archived) continue
      const matches = readJson(`teams/${team.id}/matches.json`, { matches: [] }).matches
      const members = readJson(`teams/${team.id}/members.json`, { members: [] }).members
      for (const event of matchReminders(matches, members, date)) {
        for (const sub of recipients(event, { people, credentials, subscriptions, actorId: null })) {
          const result = await send(sub, reminderMessage(event, { team, person: people.find((p) => p.id === sub.personId) }), topicFor(event.match.id))
          if (result === 'gone') gone.add(sub.endpoint)
          if (result === 'ok') sent++
        }
      }
    }
    remindedFor = date
  }
} else {
  const state = readJson(STATE_PATH, {})
  let from = state.lastCommit
  if (!from || tryGit('cat-file', '-e', `${from}^{commit}`) === null) from = process.env.BEFORE_SHA
  if (!from || /^0+$/.test(from) || tryGit('cat-file', '-e', `${from}^{commit}`) === null) from = tryGit('rev-parse', 'HEAD~1')

  if (from && from !== head) {
    const range = `${from}..${head}`
    const changed = (tryGit('diff', '--name-only', from, head, '--', 'teams') ?? '').split('\n').filter((p) => /^teams\/[^/]+\/matches\.json$/.test(p))
    const people = readJson('people.json', { people: [] }).people ?? []
    const credentials = readJson('auth/credentials.json', { credentials: [] }).credentials ?? []
    const teams = readJson('teams.json', { teams: [] }).teams ?? []

    for (const path of changed) {
      const teamId = path.split('/')[1]
      const events = expenseEvents(jsonAt(from, path)?.matches, readJson(path, { matches: [] }).matches)
      if (events.length === 0) continue
      const actorId = actorOf(range, path)
      const team = teams.find((t) => t.id === teamId)
      const fundEntries = readJson(`teams/${teamId}/funds.json`, { entries: [] }).entries ?? []
      for (const event of events) {
        for (const sub of recipients(event, { people, credentials, subscriptions, actorId })) {
          const person = people.find((p) => p.id === sub.personId)
          const payload = buildMessage(event, sub.personId, { team, person, fundEntries })
          const result = await send(sub, payload, topicFor(event.match.id))
          if (result === 'gone') gone.add(sub.endpoint)
          if (result === 'ok') sent++
        }
      }
    }

    // Payment reminders the admin asked for since the last run.
    for (const request of newOutbox(jsonAt(from, OUTBOX_PATH)?.messages, readJson(OUTBOX_PATH, { messages: [] }).messages)) {
      const team = teams.find((t) => t.id === request.teamId)
      const matches = readJson(`teams/${request.teamId}/matches.json`, { matches: [] }).matches
      for (const sub of recipients({ personIds: request.personIds ?? [] }, { people, credentials, subscriptions, actorId: null })) {
        const payload = duesMessage(matches, sub.personId, { team })
        if (!payload) continue // paid in the meantime
        const result = await send(sub, payload, topicFor(`dues${request.teamId}`))
        if (result === 'gone') gone.add(sub.endpoint)
        if (result === 'ok') sent++
      }
    }
  }
}

console.log(`Sent ${sent} notification(s); ${gone.size} expired subscription(s).`)

if (!DRY_RUN) {
  if (gone.size) writeJson(SUBS_PATH, { ...subsFile, subscriptions: subscriptions.filter((s) => !gone.has(s.endpoint)) })
  if (!process.env.TEST_MESSAGE) {
    const state = readJson(STATE_PATH, {})
    // The daily run only records the day it reminded for; the commit marker belongs to push runs.
    writeJson(STATE_PATH, REMINDERS ? { ...state, remindedFor: remindedFor ?? state.remindedFor } : { ...state, lastCommit: head, updatedAt: new Date().toISOString() })
  }
  git('add', 'push')
  if (tryGit('diff', '--cached', '--quiet') === null) {
    git('-c', 'user.name=AllAroundCricket notifier', '-c', 'user.email=notifier@users.noreply.github.com', 'commit', '-m', 'Notifier: update marker [skip ci]')
    // Someone may have saved meanwhile: rebase onto the tip and retry once.
    if (tryGit('push') === null) {
      git('pull', '--rebase')
      git('push')
    }
  }
}
