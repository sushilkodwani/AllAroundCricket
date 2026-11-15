// Web Push subscription management (PLAN §22). The app only RECEIVES pushes;
// sending happens in the data repo's GitHub Action (see notifier/), which reads
// the subscriptions this file writes to push/subscriptions.json.
import type { PushSubscriptionRecord, SubscriptionsFile } from '../types'
import { isIOS, isStandalone } from '../components/InstallBanner'
import { nowStamp } from './dates'
import { P } from './paths'
import { getPref, setPref } from './session'
import type { Store } from './store'
import { uuid } from './uuid'

/** Public half of the VAPID key pair. Set at build time; safe to be public. */
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim()

export type PushSupport =
  | 'not-configured' // built without a VAPID public key
  | 'dev' // service workers only run in production builds
  | 'needs-install' // iPhone/iPad in Safari — push needs the Home Screen app
  | 'unsupported'
  | 'ok'

export function pushSupport(): PushSupport {
  if (!import.meta.env.PROD) return 'dev'
  if (!VAPID_PUBLIC_KEY) return 'not-configured'
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac/.test(ua)) return 'Mac'
  return 'Browser'
}

const DEVICE_KEY = 'aac.deviceId'
/** "endpoint|epoch" last written to the repo, so launches don't re-write an unchanged subscription. */
const SAVED_KEY = 'aac.pushSaved'

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = uuid()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Each device writes only its own entry (the store's write guard enforces it).
 * The store re-reads and merges by deviceId when two phones save at once.
 */
async function updateSubscriptions(store: Store, message: string, change: (subs: PushSubscriptionRecord[]) => PushSubscriptionRecord[]): Promise<void> {
  await store.refresh(P.subs).catch(() => {})
  const current = store.get<SubscriptionsFile>(P.subs)?.subscriptions ?? []
  await store.writeNow(P.subs, { schemaVersion: 1, subscriptions: change(current) }, message)
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

async function saveRecord(store: Store, sub: PushSubscription, personId: string, sessionEpoch: number): Promise<void> {
  const json = sub.toJSON()
  const record: PushSubscriptionRecord = {
    personId,
    deviceId: deviceId(),
    device: deviceLabel(),
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    sessionEpoch,
    createdAt: nowStamp(),
  }
  // One entry per device (an older entry of this device may belong to whoever used it before).
  await updateSubscriptions(store, `Enable notifications (${record.device})`, (subs) => [...subs.filter((s) => s.deviceId !== record.deviceId || s.personId !== personId), record])
  localStorage.setItem(SAVED_KEY, `${sub.endpoint}|${sessionEpoch}`)
}

/** True when this device is subscribed and allowed to show notifications. */
export async function isPushEnabled(): Promise<boolean> {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return false
  return !!(await currentSubscription())
}

async function subscribe(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }))
}

/** Must be called straight from a tap: browsers only show the permission prompt for a user gesture. */
export async function enablePush(store: Store, personId: string, sessionEpoch: number): Promise<'granted' | 'denied' | 'default'> {
  if (pushSupport() !== 'ok') throw new Error('Notifications are not available on this device.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission
  await saveRecord(store, await subscribe(), personId, sessionEpoch)
  return 'granted'
}

/** Turn off: remove this device's entry and unsubscribe. Also used by Log out. */
export async function disablePush(store: Store, personId: string): Promise<void> {
  const id = deviceId()
  const known = (store.get<SubscriptionsFile>(P.subs)?.subscriptions ?? []).some((s) => s.deviceId === id && s.personId === personId)
  if (known || localStorage.getItem(SAVED_KEY)) {
    await updateSubscriptions(store, 'Disable notifications', (subs) => subs.filter((s) => !(s.deviceId === id && s.personId === personId)))
  }
  localStorage.removeItem(SAVED_KEY)
  if (pushSupport() === 'ok') await (await currentSubscription())?.unsubscribe().catch(() => {})
}

/**
 * On launch: if permission is already granted, make sure this device is
 * subscribed and its saved entry is current (the browser may rotate the
 * endpoint; a new PIN changes the session epoch). Silent — retries next launch.
 */
export async function ensureSubscriptionSaved(store: Store, personId: string, sessionEpoch: number): Promise<void> {
  try {
    if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return
    // Respect an explicit "Turn off" on this device.
    if (getPref('pushOff', false)) return
    const sub = await subscribe()
    if (localStorage.getItem(SAVED_KEY) === `${sub.endpoint}|${sessionEpoch}`) return
    await saveRecord(store, sub, personId, sessionEpoch)
  } catch {
    // best effort
  }
}

// ---------- the startup "Stay in the loop" sheet (PLAN §22.6) ----------
interface PromptState {
  shown: number
  dismissedAt: number
}
const WEEK = 7 * 24 * 60 * 60 * 1000

export function shouldPromptForPush(now = Date.now()): boolean {
  if (pushSupport() !== 'ok' || Notification.permission !== 'default') return false
  const st = getPref<PromptState>('pushPrompt', { shown: 0, dismissedAt: 0 })
  return st.shown < 3 && now - st.dismissedAt > WEEK
}

export function notePromptDismissed(now = Date.now()): void {
  const st = getPref<PromptState>('pushPrompt', { shown: 0, dismissedAt: 0 })
  setPref('pushPrompt', { shown: st.shown + 1, dismissedAt: now })
}

export const setPushOff = (off: boolean) => setPref('pushOff', off)
