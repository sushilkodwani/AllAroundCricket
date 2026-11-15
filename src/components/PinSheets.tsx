// Change PIN (everyone) and "new recovery code" (admin) — both need the current PIN.
import { useRef, useState } from 'react'
import { changeOwnPin, newRecoveryCode, verifyOwnPin } from '../lib/connect'
import { isWeakPin } from '../lib/pin'
import { useApp } from '../state/AppContext'
import { PinPad } from './PinPad'
import { ErrorNote, Sheet } from './ui'

export function ChangePinSheet({ onClose }: { onClose: () => void }) {
  const { store, session, toast } = useApp()
  const [step, setStep] = useState<'current' | 'new' | 'confirm'>('current')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [padKey, setPadKey] = useState(0)
  const current = useRef('')
  const next = useRef('')

  function fail(message: string, back: typeof step) {
    setError(message)
    setStep(back)
    setShake(true)
    setPadKey((k) => k + 1)
    setTimeout(() => setShake(false), 500)
  }

  async function onPin(pin: string) {
    if (!store || !session) return
    setError(null)
    if (step === 'current') {
      setBusy(true)
      const ok = await verifyOwnPin(store, session.personId, pin).catch(() => false)
      setBusy(false)
      if (!ok) return fail('Current PIN is wrong.', 'current')
      current.current = pin
      setPadKey((k) => k + 1)
      setStep('new')
    } else if (step === 'new') {
      if (isWeakPin(pin)) return fail('Pick a less obvious PIN.', 'new')
      if (pin === current.current) return fail('Choose a PIN different from the current one.', 'new')
      next.current = pin
      setPadKey((k) => k + 1)
      setStep('confirm')
    } else {
      if (pin !== next.current) return fail('The two PINs did not match. Start again.', 'new')
      setBusy(true)
      try {
        await changeOwnPin(store, session.personId, current.current, pin)
        toast('PIN changed')
        onClose()
      } catch (e) {
        fail((e as Error).message, 'new')
      } finally {
        setBusy(false)
      }
    }
  }

  const titles = { current: 'Enter your current PIN', new: 'Choose a new 6-digit PIN', confirm: 'Enter the new PIN again' }
  return (
    <Sheet title="Change PIN" onClose={onClose}>
      <p className="text-center text-sm text-muted">{titles[step]}</p>
      <PinPad label={titles[step]} resetKey={padKey} shake={shake} disabled={busy} onComplete={onPin} />
      {busy && <p className="mt-2 text-center text-sm text-muted">Working…</p>}
      <div className="mt-3">
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Sheet>
  )
}

export function RecoveryCodeSheet({ onClose }: { onClose: () => void }) {
  const { store, session } = useApp()
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [padKey, setPadKey] = useState(0)

  async function onPin(pin: string) {
    if (!store || !session) return
    setBusy(true)
    setError(null)
    try {
      setCode(await newRecoveryCode(store, session.personId, pin))
    } catch (e) {
      setError((e as Error).message)
      setShake(true)
      setPadKey((k) => k + 1)
      setTimeout(() => setShake(false), 500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="New recovery code" onClose={onClose}>
      {code ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Write this down. The old code no longer works. It is shown only once.</p>
          <div className="card select-all py-5 text-center font-mono text-2xl font-bold tracking-widest">{code}</div>
          <button className="btn-primary" onClick={onClose}>
            I have written it down
          </button>
        </div>
      ) : (
        <>
          <p className="text-center text-sm text-muted">Enter your PIN to create a new recovery code. The current code stops working.</p>
          <PinPad label="PIN" resetKey={padKey} shake={shake} disabled={busy} onComplete={onPin} />
          {busy && <p className="mt-2 text-center text-sm text-muted">Working…</p>}
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        </>
      )}
    </Sheet>
  )
}
