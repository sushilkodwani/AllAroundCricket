// Shared building blocks: sheets, dialogs, form fields, small display pieces.
import { useEffect, useState, type ReactNode } from 'react'
import { cleanPhoneInput } from '../lib/phone'

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

/** Text input with tap-to-fill suggestions from earlier entries. */
export function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const q = value.trim().toLowerCase()
  const matches = suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q).slice(0, 5)
  return (
    <div>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && matches.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {matches.map((s) => (
            <button key={s} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Avatar({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
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
          className={`min-h-[40px] rounded-full border px-3.5 text-sm font-medium ${value === o.value ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
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
