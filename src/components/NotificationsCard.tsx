// Notifications: the per-device switch in Settings and the startup sheet
// (PLAN §22.6). Sent only when a match's expenses are submitted.
import { useEffect, useState } from 'react'
import { disablePush, enablePush, ensureSubscriptionSaved, isPushEnabled, notePromptDismissed, pushSupport, setPushOff, shouldPromptForPush } from '../lib/push'
import { useApp } from '../state/AppContext'
import { ErrorNote, Sheet } from './ui'

function useTurnOn() {
  const { store, session, toast } = useApp()
  return async (): Promise<boolean> => {
    if (!store || !session) return false
    setPushOff(false)
    const result = await enablePush(store, session.personId, session.sessionEpoch)
    if (result === 'granted') {
      toast('Notifications on')
      return true
    }
    toast(result === 'denied' ? 'Notifications blocked — you can enable them in Settings' : 'Notifications were not allowed')
    return false
  }
}

export function NotificationsCard() {
  const { store, session, toast } = useApp()
  const support = pushSupport()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const turnOn = useTurnOn()

  useEffect(() => {
    void isPushEnabled().then(setEnabled)
  }, [])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  let body: React.ReactNode
  if (support === 'needs-install') body = <p className="text-muted">Add All Around Cricket to your Home Screen to get notifications.</p>
  else if (support === 'unsupported') body = <p className="text-muted">This browser doesn’t support notifications.</p>
  else if (support === 'not-configured') body = <p className="text-muted">Notifications aren’t set up for this app yet (the admin needs to add the push key — see the README).</p>
  else if (support === 'dev') body = <p className="text-muted">Notifications work in the installed (production) app, not on the dev server.</p>
  else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    body = (
      <>
        <p className="font-medium">Blocked in your phone settings</p>
        <p className="mt-1 text-muted">iPhone: Settings → Notifications → All Around Cricket→ Allow. Android: long-press the app icon → App info → Notifications.</p>
      </>
    )
  } else if (enabled) {
    body = (
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="block font-medium">On for this device</span>
          <span className="block text-xs text-muted">You’re told when match expenses are posted — your share and anything you owe.</span>
        </span>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setPushOff(true)
              await disablePush(store!, session!.personId)
              setEnabled(false)
              toast('Notifications off for this device')
            })
          }
        >
          Turn off
        </button>
      </div>
    )
  } else {
    body = (
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="block font-medium">Off</span>
          <span className="block text-xs text-muted">Get a notification when match expenses are posted.</span>
        </span>
        <button className="btn-primary" disabled={busy || enabled === null} onClick={() => void run(async () => setEnabled(await turnOn()))}>
          Turn on
        </button>
      </div>
    )
  }

  return (
    <div className="card px-4 py-3 text-sm">
      {body}
      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </div>
  )
}

/**
 * Shown right after the app opens when notifications were never decided on.
 * The system prompt can only come from a tap, so this sheet's button asks.
 * If permission is already granted but this device isn't saved (new phone,
 * reinstall), it subscribes silently instead.
 */
export function NotifyPrompt() {
  const { store, session } = useApp()
  const [open, setOpen] = useState(false)
  const turnOn = useTurnOn()

  useEffect(() => {
    if (!store || !session) return
    void ensureSubscriptionSaved(store, session.personId, session.sessionEpoch)
    const t = setTimeout(() => setOpen(shouldPromptForPush()), 1200)
    return () => clearTimeout(t)
  }, [store, session])

  if (!open) return null
  const dismiss = () => {
    notePromptDismissed()
    setOpen(false)
  }
  return (
    <Sheet onClose={dismiss}>
      <div className="flex flex-col items-center gap-3 pt-3 text-center">
        <div className="text-4xl" aria-hidden="true">
          🔔
        </div>
        <h2 className="text-lg font-semibold">Stay in the loop</h2>
        <p className="text-sm text-muted">Get a notification when match expenses are posted — your share and anything you owe.</p>
        <button
          className="btn-primary w-full"
          onClick={() => {
            notePromptDismissed()
            setOpen(false)
            void turnOn().catch(() => {})
          }}
        >
          Allow notifications
        </button>
        <button className="btn-ghost w-full" onClick={dismiss}>
          Not now
        </button>
      </div>
    </Sheet>
  )
}
