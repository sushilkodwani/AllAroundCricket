// Shared building blocks: sheets, dialogs, form fields, small display pieces.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useImage } from '../lib/images'
import { P } from '../lib/paths'
import { cleanPhoneInput } from '../lib/phone'
import { useApp } from '../state/AppContext'
import type { Team } from '../types'

/** Bottom sheet on phones, centred dialog on wider screens. Tap the backdrop to close. */
export function Sheet({ title, onClose, children, full }: { title?: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`sheet-in flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface sm:max-w-md sm:rounded-2xl ${full ? 'h-[92vh]' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="-mr-2 flex h-11 w-11 items-center justify-center text-xl text-muted" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">{children}</div>
      </div>
    </div>
  )
}

export function Confirm({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger,
  requireText,
  onConfirm,
  onCancel,
  children,
}: {
  title?: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** The user must type this exactly before the confirm button unlocks. */
  requireText?: string
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  const [typed, setTyped] = useState('')
  const ok = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase()
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-6" onClick={onCancel} role="alertdialog" aria-modal="true">
      <div className="sheet-in w-full max-w-sm rounded-2xl border border-line bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        {title && <h2 className="text-lg font-semibold">{title}</h2>}
        {message && <div className="mt-2 text-sm text-muted">{message}</div>}
        {children}
        {requireText && (
          <input className="input mt-3" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireText} aria-label={`Type ${requireText} to confirm`} />
        )}
        <div className="mt-5 flex gap-2">
          <button className="btn-secondary flex-1" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`${danger ? 'btn-danger' : 'btn-primary'} flex-1`} disabled={!ok} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

/** Digits-only input with the numeric keypad. */
export function NumberInput({
  value,
  onChange,
  maxLength = 10,
  placeholder,
  autoFocus,
  ariaLabel,
  className = 'input',
  allowNegative,
}: {
  value: string
  onChange: (v: string) => void
  maxLength?: number
  placeholder?: string
  autoFocus?: boolean
  ariaLabel?: string
  className?: string
  allowNegative?: boolean
}) {
  return (
    <input
      className={className}
      inputMode={allowNegative ? 'text' : 'numeric'}
      pattern={allowNegative ? '-?[0-9]*' : '[0-9]*'}
      autoComplete="off"
      value={value}
      maxLength={maxLength + (allowNegative ? 1 : 0)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value
        const neg = allowNegative && raw.trim().startsWith('-') ? '-' : ''
        onChange(neg + raw.replace(/\D/g, '').slice(0, maxLength))
      }}
    />
  )
}

/** 10-digit mobile number field: digits only, numeric keypad, cleans pasted +91 / spaces / dashes. */
export function PhoneInput({
  value,
  onChange,
  placeholder = '98765 43210',
  ariaLabel = 'Mobile number (10 digits)',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  autoFocus?: boolean
}) {
  return (
    <input
      className="input"
      type="tel"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onChange={(e) => onChange(cleanPhoneInput(e.target.value))}
    />
  )
}

/**
 * Searchable dropdown that also takes free text: type to filter the saved
 * options, tap one to pick it, or just keep what you typed if it is new.
 */
export function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  autoFocus,
  ariaLabel,
  newLabel = 'Use',
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  autoFocus?: boolean
  ariaLabel: string
  newLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // Close on a tap outside. (Closing on blur breaks phones: Safari doesn't focus a tapped button, so the list vanished before the tap landed.)
  useEffect(() => {
    if (!open) return
    const away = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  const q = value.trim().toLowerCase()
  const exact = options.some((o) => o.toLowerCase() === q)
  // A complete saved name shows the whole list, so it can be swapped for another.
  const shown = options.filter((o) => exact || !q || o.toLowerCase().includes(q))
  const close = () => setOpen(false)
  return (
    <div ref={box} className='relative'>
      <input
        className='input pr-11'
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        role='combobox'
        aria-expanded={open}
        autoComplete='off'
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Tab') && close()}
      />
      <button type='button' tabIndex={-1} className='absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted' aria-label={open ? 'Hide list' : 'Show list'} onClick={() => setOpen((v) => !v)}>
        {open ? '▴' : '▾'}
      </button>
      {open && (shown.length > 0 || (q && !exact)) && (
        <div className='mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface' role='listbox'>
          {q && !exact && (
            <button type='button' className='row min-h-[44px] border-b border-line py-2 font-medium text-accent active:bg-alt' onClick={close}>
              {newLabel} “{value.trim()}” (new)
            </button>
          )}
          {shown.map((o) => (
            <button
              key={o}
              type='button'
              role='option'
              aria-selected={o.toLowerCase() === q}
              className={`row min-h-[44px] py-2 active:bg-alt ${o.toLowerCase() === q ? 'font-semibold text-accent' : ''}`}
              onClick={() => {
                onChange(o)
                close()
              }}
            >
              <span className='min-w-0 flex-1 truncate'>{o}</span>
              {o.toLowerCase() === q && <span aria-hidden='true'>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Search field for the top of a list, with a clear button. */
export function SearchBox({ value, onChange, placeholder, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder: string; ariaLabel?: string }) {
  return (
    <div className='relative'>
      <span className='pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted' aria-hidden='true'>
        🔍
      </span>
      <input className='input pl-10 pr-11' type='search' enterKeyHint='search' autoComplete='off' value={value} placeholder={placeholder} aria-label={ariaLabel ?? placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type='button' className='absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted' aria-label='Clear search' onClick={() => onChange('')}>
          ✕
        </button>
      )}
    </div>
  )
}

/** Round player badge: their photo when they have one, initials otherwise. */
export function Avatar({ name, color, size = 40, personId }: { name: string; color?: string; size?: number; personId?: string }) {
  const { store, people } = useApp()
  const person = personId ? people.find((p) => p.id === personId) : undefined
  const photo = useImage(store, personId ? P.personPhoto(personId) : null, person?.photo)
  const initials = name
    .trim()
    .split(/s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  if (photo) return <img src={photo} alt="" aria-hidden="true" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size, background: color ?? '#475569' }} />
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color ?? '#475569', fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  )
}

/** A team's logo, or null when it has none (callers keep their usual badge). */
export function TeamLogo({ team, size = 40, rounded = 'rounded-xl' }: { team: Pick<Team, 'id' | 'logo' | 'name'>; size?: number; rounded?: string }) {
  const { store } = useApp()
  const logo = useImage(store, P.teamLogo(team.id), team.logo)
  if (!logo) return null
  return <img src={logo} alt={`${team.name} logo`} className={`shrink-0 bg-white object-cover ${rounded}`} style={{ width: size, height: size }} />
}

export type Tone = 'neutral' | 'ok' | 'bad' | 'warn' | 'brand'
const TONES: Record<Tone, string> = {
  neutral: 'bg-alt text-muted',
  ok: 'bg-ok/15 text-ok',
  bad: 'bg-bad/15 text-bad',
  warn: 'bg-warn/15 text-warn',
  brand: 'bg-brand text-on-brand',
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="text-5xl" aria-hidden="true">
        {icon}
      </div>
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-alt p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={`min-h-[40px] flex-1 rounded-lg px-2 text-sm font-semibold transition-colors ${value === o.value ? 'bg-brand text-on-brand' : 'text-muted'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-brand' : 'bg-line'}`}
      onClick={() => onChange(!checked)}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

/** Tappable chips for picking one value. */
export function ChoiceChips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={`min-h-[40px] rounded-full border px-3.5 text-sm font-medium ${value === o.value ? 'border-brand bg-brand text-on-brand' : 'border-chip-line bg-chip text-ink active:bg-line'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A dropdown you can type into to narrow the list — for long player lists. */
export function SearchSelect({ options, value, onChange, placeholder = 'Search…', ariaLabel }: { options: { value: string; label: string }[]; value: string | undefined; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const chosen = options.find((o) => o.value === value)
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQ('')
  }
  return (
    <div className="relative">
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={chosen && !open ? chosen.label : placeholder}
        value={open ? q : (chosen?.label ?? '')}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown.length > 0) {
            e.preventDefault()
            pick(shown[0].value)
          } else if (e.key === 'Escape') setOpen(false)
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
        ▾
      </span>
      {open && (
        <>
          <button type="button" tabIndex={-1} aria-label="Close list" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <ul role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-52 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
            {shown.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button type="button" className={`flex min-h-[44px] w-full items-center px-3 text-left text-sm active:bg-alt ${o.value === value ? 'font-semibold text-brand' : 'text-ink'}`} onClick={() => pick(o.value)}>
                  {o.label}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted">No match</li>}
          </ul>
        </>
      )}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">
      {children}
    </p>
  )
}

/** Settings-style list row with a chevron. */
export function MenuRow({ label, hint, onClick, right }: { label: string; hint?: ReactNode; onClick?: () => void; right?: ReactNode }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      {right ?? (onClick && <span className="text-muted">›</span>)}
    </>
  )
  return onClick ? (
    <button className="row active:bg-alt" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="row">{body}</div>
  )
}
