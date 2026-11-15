import { useRef, useState, type ReactNode } from 'react'

const REVEAL = 88
/** Minimum finger movement, in px, before committing to a swipe direction. */
const DIRECTION_THRESHOLD = 8

/**
 * Row that slides left on touch to reveal an action. Pointer devices use the
 * row's own sheet for the same action, so this is additive, not the only path.
 */
export function SwipeRow({
  onAction,
  actionLabel = 'Remove',
  disabled,
  children,
}: {
  onAction: () => void
  actionLabel?: string
  disabled?: boolean
  children: ReactNode
}) {
  const [dx, setDx] = useState(0)
  const startX = useRef(0)
  const startY = useRef(0)
  const startDx = useRef(0)
  const active = useRef(false)
  // Undecided until the finger has moved enough to tell a scroll from a swipe,
  // so a vertical scroll over a row never nudges it sideways.
  const direction = useRef<'none' | 'horizontal' | 'vertical'>('none')

  function onTouchStart(e: React.TouchEvent) {
    if (disabled) return
    active.current = true
    direction.current = 'none'
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    startDx.current = dx
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!active.current) return
    const deltaX = e.touches[0].clientX - startX.current
    const deltaY = e.touches[0].clientY - startY.current
    if (direction.current === 'none') {
      if (Math.abs(deltaX) < DIRECTION_THRESHOLD && Math.abs(deltaY) < DIRECTION_THRESHOLD) return
      direction.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical'
    }
    if (direction.current !== 'horizontal') return
    setDx(Math.min(0, Math.max(-REVEAL, startDx.current + deltaX)))
  }

  function onTouchEnd() {
    if (!active.current) return
    active.current = false
    if (direction.current === 'horizontal') setDx(dx < -REVEAL / 2 ? -REVEAL : 0)
    direction.current = 'none'
  }

  return (
    <div className="relative overflow-hidden">
      {!disabled && dx < 0 && (
        <button
          className="absolute inset-y-0 right-0 flex items-center justify-center bg-bad px-2 text-sm font-semibold text-white"
          style={{ width: REVEAL }}
          onClick={() => {
            setDx(0)
            onAction()
          }}
        >
          {actionLabel}
        </button>
      )}
      <div
        className="relative bg-surface transition-transform"
        style={{ transform: `translateX(${dx}px)`, transitionDuration: active.current ? '0ms' : '150ms' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}
