// Pick, preview and remove a picture (player photo or team logo). The picture
// is shrunk on the phone before anything is saved (see lib/images.ts).
import { useRef, useState } from 'react'
import { resizeToSquare } from '../lib/images'
import { ErrorNote } from './ui'

export function PhotoPicker({
  label,
  current,
  onChange,
  round = true,
  fallback,
}: {
  label: string
  /** What is shown now: the saved picture, a newly picked one, or null. */
  current: string | null
  onChange: (dataUrl: string | null) => void
  round?: boolean
  /** Shown when there is no picture (initials, short name…). */
  fallback: React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shape = round ? 'rounded-full' : 'rounded-2xl'

  async function picked(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      onChange(await resizeToSquare(file))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-4">
        {current ? (
          <img src={current} alt="" className={`h-20 w-20 shrink-0 border border-line bg-white object-cover ${shape}`} />
        ) : (
          <span className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden border border-dashed border-chip-line bg-chip text-2xl font-bold text-muted ${shape}`}>{fallback}</span>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-secondary min-h-[40px] px-4" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Preparing…' : current ? 'Change' : 'Choose picture'}
          </button>
          {current && (
            <button type="button" className="min-h-[36px] text-left text-sm font-semibold text-bad" disabled={busy} onClick={() => onChange(null)}>
              Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void picked(e.target.files?.[0])} aria-label={label} />
      </div>
      <p className="mt-1.5 text-xs text-muted">Cropped to a square and shrunk to a small size before saving.</p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  )
}
