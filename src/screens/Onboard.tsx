// Onboarding (once per device), first-time setup by the app owner (super admin), and the PIN steps that
// follow both (PLAN §5.5, §5.7, §5.10). The number and the PIN live only in
// this component's memory while it is on screen.
import { useEffect, useRef, useState } from 'react'
import { PinPad } from '../components/PinPad'
import { ErrorNote, Field, PhoneInput } from '../components/ui'
import { adminRecordOf, onboardStep } from '../lib/access'
import { connectRepo, demoAvailable, findPersonByPhone, isSetUp, logInDevice, recoverSuperPin, setOwnPin, setupRepo, verifyOwnPin } from '../lib/connect'
import { adminsOf, configOf, credsOf } from '../lib/domain'
import { withKeyPrefix, withoutKeyPrefix } from '../lib/github'
import { normalizePhone } from '../lib/phone'
import { isWeakPin, verifyRecoveryCode } from '../lib/pin'
import { clearPinFails, loadRepoRef, lockRemainingMs, registerPinFail, type RepoRef, type Session } from '../lib/session'
import type { Store } from '../lib/store'
import { DevelopedBy } from '../components/DevelopedBy'
import { useApp } from '../state/AppContext'
import { navigate } from '../state/router'
import type { Person } from '../types'

type Step = 'form' | 'set_pin' | 'confirm_pin' | 'enter_pin' | 'forgot' | 'recovery'

const NO_ACCESS = "This number doesn't have access. Ask your team admin to add you."

function Brand() {
  return (
    <div className="flex flex-col items-center pb-6 pt-10">
      <img src="./icon.svg" alt="" className="h-20 w-20 rounded-[22%]" />
      <h1 className="mt-3 text-center text-2xl font-bold">All Around Cricket</h1>
    </div>
  )
}

export function Onboard({ mode }: { mode: 'join' | 'setup' }) {
  const { login, notice } = useApp()
  const saved = useRef(loadRepoRef()).current
  // A deployed app already knows its data repo (build settings), so players only need the access key.
  const envOwner = (import.meta.env.VITE_DATA_OWNER ?? '').trim()
  const envRepo = (import.meta.env.VITE_DATA_REPO ?? '').trim()
  const repoFixed = !!envOwner && !!envRepo
  const [owner, setOwner] = useState(repoFixed ? envOwner : (saved?.owner ?? ''))
  const [repo, setRepo] = useState(repoFixed ? envRepo : (saved?.repo ?? ''))
  // The key is shown and typed without its common first part; the app adds it back (withKeyPrefix).
  const [token, setToken] = useState(withoutKeyPrefix(saved?.token ?? ''))
  const [editRepo, setEditRepo] = useState(!saved)
  // The admin-setup link only appears once this repo has been seen to be empty.
  const [emptyRepo, setEmptyRepo] = useState(false)
  const [name, setName] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [step, setStep] = useState<Step>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [padKey, setPadKey] = useState(0)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [wroteDown, setWroteDown] = useState(false)
  const [lockMs, setLockMs] = useState(0)

  // In memory only, for the duration of onboarding.
  const store = useRef<Store | null>(null)
  const person = useRef<Person | null>(null)
  const phone = useRef('')
  const firstPin = useRef('')
  const usedRecovery = useRef('')
  const pending = useRef<Session | null>(null)

  const ref = (): RepoRef => ({ owner: owner.trim(), repo: repo.trim(), token: withKeyPrefix(token) })

  useEffect(() => {
    setError(null)
    setStep('form')
  }, [mode])

  // Count down a wrong-PIN lock.
  useEffect(() => {
    if (step !== 'enter_pin' || !person.current) return
    const tick = () => setLockMs(lockRemainingMs(person.current!.id))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [step, padKey])

  function fail(message: string) {
    setError(message)
    setShake(true)
    setPadKey((k) => k + 1)
    setTimeout(() => setShake(false), 500)
  }

  async function submitForm() {
    setError(null)
    const r = ref()
    if (!r.token) return setError('Enter your access key.')
    if (!r.owner || !r.repo) return setError('Enter the repo owner and repo name.')
    if (mode === 'setup' && !name.trim()) return setError('Enter your name.')
    const p = normalizePhone(phoneInput)
    if (!p.ok) return setError(p.error)
    setBusy(true)
    try {
      const s = await connectRepo(r)
      store.current = s
      phone.current = p.phone
      if (mode === 'setup') {
        if (isSetUp(s)) throw new Error('This repo is already set up — use normal onboarding.')
        setStep('set_pin')
        return
      }
      if (!isSetUp(s)) {
        setEmptyRepo(true)
        throw new Error('This app has not been set up yet. If you are the app owner, use “First time setup” below.')
      }
      const found = await findPersonByPhone(s, p.phone)
      const next = onboardStep(found, configOf(s)!, credsOf(s), adminsOf(s))
      if (next === 'no_access' || !found) {
        await s.clear() // nothing is kept for a number without access
        throw new Error(NO_ACCESS)
      }
      person.current = found
      setStep(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function chooseFirstPin(pin: string) {
    if (isWeakPin(pin, phone.current)) return fail('Pick a less obvious PIN.')
    firstPin.current = pin
    setError(null)
    setPadKey((k) => k + 1)
    setStep('confirm_pin')
  }

  async function confirmPin(pin: string) {
    if (pin !== firstPin.current) {
      firstPin.current = ''
      setStep('set_pin')
      return fail('The two PINs did not match. Start again.')
    }
    const s = store.current!
    setBusy(true)
    setError(null)
    try {
      if (mode === 'setup') {
        const out = await setupRepo(s, { name, phone: phone.current, pin })
        pending.current = { ...ref(), personId: out.personId, sessionEpoch: out.sessionEpoch, deviceId: out.deviceId, deviceSecret: out.deviceSecret }
        setRecoveryCode(out.recoveryCode)
        setStep('recovery')
      } else if (usedRecovery.current) {
        const out = await recoverSuperPin(s, usedRecovery.current, pin)
        usedRecovery.current = ''
        clearPinFails(person.current!.id)
        pending.current = { ...ref(), personId: person.current!.id, sessionEpoch: out.sessionEpoch, deviceId: out.deviceId, deviceSecret: out.deviceSecret }
        setRecoveryCode(out.recoveryCode)
        setStep('recovery')
      } else {
        const device = await setOwnPin(s, person.current!.id, pin)
        login(s, { ...ref(), personId: person.current!.id, ...device })
        navigate('/teams', { replace: true })
      }
    } catch (e) {
      firstPin.current = ''
      setStep('set_pin')
      fail((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function enterPin(pin: string) {
    const s = store.current!
    const who = person.current!
    if (lockRemainingMs(who.id) > 0) return
    setBusy(true)
    setError(null)
    try {
      if (await verifyOwnPin(s, who.id, pin)) {
        clearPinFails(who.id)
        const device = await logInDevice(s, who.id)
        login(s, { ...ref(), personId: who.id, ...device })
        navigate('/teams', { replace: true })
      } else {
        const wait = registerPinFail(who.id)
        fail(wait > 0 ? `Wrong PIN. Try again in ${Math.round(wait / 1000)} seconds.` : 'Wrong PIN')
      }
    } catch (e) {
      fail((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitRecovery() {
    setError(null)
    setBusy(true)
    try {
      const config = configOf(store.current!)!
      if (!(await verifyRecoveryCode(recoveryInput, config.recovery))) throw new Error('That recovery code is not right.')
      usedRecovery.current = recoveryInput
      setRecoveryInput('')
      setStep('set_pin')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const isSuperPerson = !!person.current && configOf(store.current!)?.superAdminId === person.current.id
  const isAdminPerson = !!person.current && !!store.current && !!adminRecordOf(adminsOf(store.current), person.current.id)
  const locked = lockMs > 0

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-10">
      <Brand />

      {step === 'form' && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submitForm()
          }}
        >
          <h2 className="text-lg font-semibold">{mode === 'setup' ? 'First time setup (app owner)' : 'Get started'}</h2>
          {notice && mode === 'join' && <p className="rounded-xl bg-warn/15 px-3 py-2 text-sm text-warn">{notice}</p>}
          {mode === 'setup' && (
            <p className="text-sm text-muted">Do this once for a new, empty private data repo. You become the super admin: you add the admins (by mobile number), and each admin runs their own teams. Admins and players never do this — they only need the access key and their number.</p>
          )}

          <Field label="Mobile number (10 digits)" hint="No country code. It is never stored or shown as-is.">
            <PhoneInput value={phoneInput} onChange={setPhoneInput} autoFocus />
          </Field>
          {mode === 'setup' && (
            <Field label="Your name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" />
            </Field>
          )}
          {!repoFixed &&
            (editRepo ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Repo owner">
                  <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                </Field>
                <Field label="Repo name">
                  <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                </Field>
              </div>
            ) : (
              <div className="card flex items-center justify-between px-4 py-3 text-sm">
                <span className="min-w-0 truncate">
                  Data repo: <strong>{owner}/{repo}</strong>
                </span>
                <button type="button" className="font-semibold text-accent" onClick={() => setEditRepo(true)}>
                  Change
                </button>
              </div>
            ))}
          <Field label="Access Key" hint={mode === 'join' ? 'Your team admin shares this with you.' : 'The access key for this app’s data store. You can leave out its common first part.'}>
            <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </Field>
          {demoAvailable && !repoFixed && <p className="text-xs text-muted">Dev server only: owner “demo” with any repo name and any key uses a fake repo stored in this browser.</p>}

          <ErrorNote>{error}</ErrorNote>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          {mode === 'join' ? (
            emptyRepo && (
              <button type="button" className="text-sm font-medium text-accent" onClick={() => navigate('/setup')}>
                First time setup (app owner)
              </button>
            )
          ) : (
            <button type="button" className="text-sm font-medium text-accent" onClick={() => navigate('/onboard')}>
              Already set up? Use normal onboarding
            </button>
          )}
        </form>
      )}

      {(step === 'set_pin' || step === 'confirm_pin') && (
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-lg font-semibold">{step === 'set_pin' ? 'Set a 6-digit PIN' : 'Enter the PIN again'}</h2>
          <p className="text-center text-sm text-muted">
            {step === 'set_pin' ? 'You will need it if you set up the app on another phone.' : 'Just to make sure it was typed correctly.'}
          </p>
          <PinPad label={step === 'set_pin' ? 'New PIN' : 'Confirm PIN'} resetKey={padKey} shake={shake} disabled={busy} onComplete={step === 'set_pin' ? chooseFirstPin : confirmPin} />
          {busy && <p className="text-sm text-muted">Saving…</p>}
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {step === 'enter_pin' && (
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-lg font-semibold">Enter your PIN</h2>
          <p className="text-center text-sm text-muted">Hi {person.current?.name}. This number is already registered.</p>
          <PinPad label="PIN" resetKey={padKey} shake={shake} disabled={busy || locked} onComplete={enterPin} />
          {busy && <p className="text-sm text-muted">Checking…</p>}
          {locked ? <ErrorNote>Too many wrong tries. Wait {Math.ceil(lockMs / 1000)} seconds.</ErrorNote> : <ErrorNote>{error}</ErrorNote>}
          {isSuperPerson ? (
            <button
              className="mt-2 text-sm font-medium text-accent"
              onClick={() => {
                setError(null)
                setStep('forgot')
              }}
            >
              Forgot PIN
            </button>
          ) : (
            <p className="mt-2 text-sm text-muted">Forgot PIN? {isAdminPerson ? 'Ask the super admin to reset it.' : 'Ask your team admin to reset it.'}</p>
          )}
        </div>
      )}

      {step === 'forgot' && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submitRecovery()
          }}
        >
          <h2 className="text-lg font-semibold">Reset your PIN</h2>
          <Field label="Recovery code" hint="The 12-character code shown when you set up the app.">
            <input className="input uppercase tracking-widest" value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn-primary" disabled={busy || recoveryInput.trim().length < 12}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <button type="button" className="text-sm font-medium text-accent" onClick={() => setStep('enter_pin')}>
            Back
          </button>
        </form>
      )}

      {step === 'recovery' && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Your recovery code</h2>
          <p className="text-sm text-muted">Write this down. It’s the only way to reset your own PIN. It is shown only once.</p>
          <div className="card select-all py-5 text-center font-mono text-2xl font-bold tracking-widest" data-testid="recovery-code">
            {recoveryCode}
          </div>
          <label className="flex min-h-[44px] items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(155,28,31)]" checked={wroteDown} onChange={(e) => setWroteDown(e.target.checked)} />
            I have written it down
          </label>
          <button
            className="btn-primary"
            disabled={!wroteDown}
            onClick={() => {
              login(store.current!, pending.current!)
              navigate('/teams', { replace: true })
            }}
          >
            Continue
          </button>
        </div>
      )}

      <DevelopedBy className="mt-auto pt-10" />
    </div>
  )
}
