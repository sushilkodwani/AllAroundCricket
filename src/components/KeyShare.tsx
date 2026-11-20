// Super admin only: make a person's personal access key with one tap and send it by WhatsApp, SMS or copy.
// The key is tied to the number saved for the person (only its hash is stored), so no number is typed.
import { useState } from 'react'
import { keyMessage, makePersonalKey } from '../lib/personalKey'
import { useApp } from '../state/AppContext'
import type { Person } from '../types'
import { ErrorNote } from './ui'

/** `phone` is the number when it was just typed (adding someone): it lets WhatsApp and SMS open their chat. */
export function PersonalKeyShare({ person, phone }: { person: Person; phone?: string }) {
  const { isSuper, realSession, toast } = useApp()
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!isSuper || !realSession) return null

  async function make() {
    setError(null)
    if (!person.phoneHash) return setError(`${person.name} has no mobile number saved. Add their number first.`)
    setBusy(true)
    try {
      setKey(await makePersonalKey(realSession!.token, person.phoneHash))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!key) {
    return (
      <div className="flex flex-col gap-2">
        <button className="btn-secondary" disabled={busy} onClick={() => void make()}>
          {busy ? 'Making key…' : `🔑 Make ${person.name}’s access key`}
        </button>
        <ErrorNote>{error}</ErrorNote>
      </div>
    )
  }

  const text = keyMessage(person.name, key)
  // Without the number, the apps open their own contact picker.
  const wa = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`
  const sms = phone ? `sms:+91${phone}?body=${encodeURIComponent(text)}` : `sms:?body=${encodeURIComponent(text)}`
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{person.name}’s personal access key</span>
      <div className="card select-all break-all px-3 py-2 font-mono text-xs">{key}</div>
      <div className="flex flex-wrap gap-2">
        <a className="btn-primary flex-1" href={wa} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
        <a className="btn-secondary flex-1" href={sms}>
          SMS
        </a>
        <button
          className="btn-secondary flex-1"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(key)
              .then(() => toast('Key copied'))
              .catch(() => {})
          }
        >
          Copy
        </button>
      </div>
      <p className="text-xs text-muted">
        It works only with {person.name}’s number ({`••••••${person.phoneLast4 ?? ''}`}).{!phone && ' WhatsApp and SMS let you pick the contact.'} When you replace the main key, send everyone a new one.
      </p>
    </div>
  )
}
