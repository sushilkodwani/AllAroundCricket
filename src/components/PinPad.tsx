import { useEffect, useState } from 'react'

/**
 * Six dots and a big numeric keypad. Calls onComplete with the 6 digits; the
 * parent clears it by changing `resetKey` (e.g. after a wrong PIN).
 */
export function PinPad({
  onComplete,
  resetKey = 0,
  shake,
  disabled,
  label,
}: {
  onComplete: (pin: string) => void
  resetKey?: number
  shake?: boolean
  disabled?: boolean
  label: string
}) {
  const [pin, setPin] = useState('')

  useEffect(() => {
    setPin('')
  }, [resetKey])

  function press(d: string) {
    if (disabled || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    if (next.length === 6) onComplete(next)
  }

  // Hardware keyboards (desktop) work too.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex w-full flex-col items-center">
      <div className={`flex gap-4 py-5 ${shake ? 'shake' : ''}`} role="status" aria-label={`${label}: ${pin.length} of 6 digits entered`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 ${i < pin.length ? 'border-brand bg-brand' : 'border-line'}`} />
        ))}
      </div>
      <div className="mt-2 grid w-full grid-cols-3 gap-3 sm:gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => press(d)} disabled={disabled}>
            {d}
          </Key>
        ))}
        <span />
        <Key onClick={() => press('0')} disabled={disabled}>
          0
        </Key>
        <Key onClick={() => setPin((p) => p.slice(0, -1))} disabled={disabled} label="Delete last digit">
          ⌫
        </Key>
      </div>
    </div>
  )
}

function Key({ children, onClick, disabled, label }: { children: string; onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      className="flex h-[4.25rem] items-center justify-center rounded-2xl border border-line bg-alt text-3xl font-medium active:bg-line disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
      aria-label={label ?? children}
    >
      {children}
    </button>
  )
}
