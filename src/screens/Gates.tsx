// Full-screen states that block the app: no access, token stopped working,
// PIN on open, and a failed first load.
import { useEffect, useState } from 'react'
import { PinPad } from '../components/PinPad'
import { ErrorNote, Field } from '../components/ui'
import { verifyOwnPin } from '../lib/connect'
import { fmtDate, fmtTime, toISODate } from '../lib/dates'
import { clearPinFails, lockRemainingMs, registerPinFail } from '../lib/session'
import { useApp } from '../state/AppContext'

function Shell({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-app max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl" aria-hidden="true">
        {icon}
      </div>
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
    </div>
  )
}

export function Splash() {
  return (
    <div className="flex min-h-app flex-col items-center justify-center gap-3">
      <img src="./icon.svg" alt="" className="h-20 w-20 rounded-[22%]" />
      <p className="text-sm text-muted">Loading…</p>
    </div>
  )
}

export function BootError() {
  const { bootError, retryBoot, logout } = useApp()
  return (
    <Shell icon="📡" title="Couldn’t load your data">
      <p className="text-sm text-muted">{bootError ?? 'Check your connection and try again.'}</p>
      <button className="btn-primary w-full" onClick={retryBoot}>
        Try again
      </button>
      <button className="text-sm font-medium text-accent" onClick={() => void logout()}>
        Log out
      </button>
    </Shell>
  )
}

export function NoAccess() {
  const { refresh, switchNumber } = useApp()
  const [busy, setBusy] = useState(false)
  return (
    <Shell icon="🚫" title="You no longer have access">
      <p className="text-sm text-muted">Contact your team admin.</p>
      <button
        className="btn-secondary w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await refresh()
          setBusy(false)
        }}
      >
        {busy ? 'Checking…' : 'Check again'}
      </button>
      <button className="btn-primary w-full" onClick={switchNumber}>
        Use a different number
      </button>
    </Shell>
  )
}

/** Hard stop by the super admin: nothing to do until the time shown (it lifts by itself). */
export function Maintenance() {
  const { pausedUntil, refresh } = useApp()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const at = pausedUntil ? new Date(pausedUntil) : null
  const time = at ? fmtTime(at.toTimeString().slice(0, 5)) : ''
  const sameDay = at ? at.toDateString() === new Date(now).toDateString() : true
  const mins = at ? Math.max(1, Math.ceil((at.getTime() - now) / 60_000)) : 0
  return (
    <Shell icon="🛠️" title="The app is under maintenance">
      <p className="text-sm text-muted">
        It will be back at <strong className="text-ink">{time}</strong>
        {!sameDay && at ? ` on ${fmtDate(toISODate(at))}` : ''} (in about {mins} min). It opens again by itself; there’s no need to do anything.
      </p>
      <button
        className="btn-secondary w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await refresh()
          setBusy(false)
        }}
      >
        {busy ? 'Checking…' : 'Check again'}
      </button>
    </Shell>
  )
}

/** The shared token expired or was replaced: ask only for the new one, keep the login. */
export function TokenGate() {
  const { replaceToken, logout } = useApp()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Shell icon="🔑" title="New Access Key needed">
      <p className="text-sm text-muted">The Access Key stopped working (expired or changed). Enter the new personal key the super admin sent you.</p>
      <form
        className="flex w-full flex-col gap-3 text-left"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await replaceToken(token)
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Access Key">
          <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={busy || !token.trim()}>
          {busy ? 'Checking…' : 'Save key'}
        </button>
      </form>
      <button className="text-sm font-medium text-accent" onClick={() => void logout()}>
        Log out
      </button>
    </Shell>
  )
}

/** Optional per-device "Ask for PIN when the app opens". */
export function PinGate() {
  const { store, realSession: session, unlock, me, logout } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [padKey, setPadKey] = useState(0)
  const [lockMs, setLockMs] = useState(0)
  const personId = session?.personId ?? ''

  useEffect(() => {
    const tick = () => setLockMs(lockRemainingMs(personId))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [personId, padKey])

  async function submit(pin: string) {
    if (!store || lockRemainingMs(personId) > 0) return
    setBusy(true)
    setError(null)
    const ok = await verifyOwnPin(store, personId, pin).catch(() => false)
    setBusy(false)
    if (ok) {
      clearPinFails(personId)
      unlock()
      return
    }
    const wait = registerPinFail(personId)
    setError(wait > 0 ? `Wrong PIN. Try again in ${Math.round(wait / 1000)} seconds.` : 'Wrong PIN')
    setShake(true)
    setPadKey((k) => k + 1)
    setTimeout(() => setShake(false), 500)
  }

  return (
    <div className="mx-auto flex min-h-app max-w-md flex-col items-center justify-center gap-2 px-6">
      <img src="./icon.svg" alt="" className="h-16 w-16 rounded-[22%]" />
      <h1 className="mt-2 text-lg font-semibold">Enter your PIN</h1>
      {me && <p className="text-sm text-muted">{me.name}</p>}
      <PinPad label="PIN" resetKey={padKey} shake={shake} disabled={busy || lockMs > 0} onComplete={submit} />
      {lockMs > 0 ? <ErrorNote>Too many wrong tries. Wait {Math.ceil(lockMs / 1000)} seconds.</ErrorNote> : <ErrorNote>{error}</ErrorNote>}
      <button className="mt-3 text-sm font-medium text-accent" onClick={() => void logout()}>
        Log out
      </button>
    </div>
  )
}
