// First-run tour (before "Get started"): what the app does for a player, shown with real screenshots
// of the app (public/intro, made by scripts/shoot-intro.mjs). It slides on its own and can be swiped;
// Skip or the last slide's button goes on to log in. Shown once per device, and again from Settings.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { DevelopedBy } from '../components/DevelopedBy'

interface Slide {
  img: string
  title: string
  text: string
}

export const SLIDES: Slide[] = [
  { img: 'home', title: 'Your club in one place', text: 'Your team, the next match, recent form and the team fund at a glance.' },
  { img: 'live', title: 'Follow every ball live', text: 'Live score, win chance and par score, updated as the match is scored.' },
  { img: 'scorecard', title: 'Full scorecards', text: 'Every batter and bowler, how each wicket fell and the player of the match.' },
  { img: 'analysis', title: 'Match analysis', text: 'Score progression, run rate, phases of the innings and partnerships.' },
  { img: 'detailed', title: 'Go deeper', text: 'Wagon wheel, where the boundaries went, batter against bowler and more.' },
  { img: 'player', title: 'Your own stats', text: 'Runs, strike rate, wickets and your form over the season.' },
  { img: 'team-stats', title: 'Team records', text: 'Top run-scorers and wicket-takers, and how the team does batting first or chasing.' },
  { img: 'availability', title: 'Say if you can play', text: 'Tap In, Maybe or Out for the next match and see who else is playing.' },
  { img: 'funds', title: 'Money made simple', text: 'Your fund balance, match costs split fairly, and what you owe.' },
]

const AUTO_MS = 4500
/** After a swipe or tap, wait this long before sliding on again. */
const PAUSE_MS = 9000

export function Intro({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pausedUntil, setPausedUntil] = useState(0)
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const width = useRef(1)
  const last = index === SLIDES.length - 1
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(SLIDES.length - 1, i))), [])
  const pause = () => setPausedUntil(Date.now() + PAUSE_MS)

  // Slide on by itself, stopping at the last slide.
  useEffect(() => {
    if (last || dragging) return
    const wait = Math.max(AUTO_MS, pausedUntil - Date.now())
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, SLIDES.length - 1)), wait)
    return () => clearTimeout(t)
  }, [index, last, dragging, pausedUntil])

  // Arrow keys on a computer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') (pause(), go(index + 1))
      if (e.key === 'ArrowLeft') (pause(), go(index - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, go])

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    start.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId }
    width.current = e.currentTarget.clientWidth || 1
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragging(true)
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.id !== e.pointerId) return
    const dx = e.clientX - start.current.x
    // Resist past the first and last slide.
    const edge = (index === 0 && dx > 0) || (last && dx < 0)
    setDrag(edge ? dx / 3 : dx)
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.id !== e.pointerId) return
    const dx = e.clientX - start.current.x
    const fast = Math.abs(dx) / Math.max(1, Date.now() - start.current.t) > 0.4
    if (Math.abs(dx) > width.current * 0.2 || (fast && Math.abs(dx) > 20)) go(index + (dx < 0 ? 1 : -1))
    start.current = null
    setDrag(0)
    setDragging(false)
    pause()
  }

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-bg pb-[max(1rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between px-5 pt-3">
        <div className="flex items-center gap-2">
          <img src="./icon.svg" alt="" className="h-8 w-8 rounded-[22%]" />
          <span className="font-bold">All Around Cricket</span>
        </div>
        {!last && (
          <button className="min-h-[44px] px-2 text-sm font-semibold text-muted" onClick={onDone}>
            Skip
          </button>
        )}
      </div>

      <div
        className="relative min-h-0 flex-1 touch-pan-y select-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-roledescription="carousel"
        aria-label="What the app does"
      >
        <div
          className="flex h-full"
          style={{
            width: `${SLIDES.length * 100}%`,
            transform: `translateX(calc(${(-index * 100) / SLIDES.length}% + ${drag}px))`,
            transition: dragging || reduced ? 'none' : 'transform 350ms ease',
          }}
        >
          {SLIDES.map((s, i) => (
            <section
              key={s.img}
              className="flex h-full flex-col items-center px-6 pt-4"
              style={{ width: `${100 / SLIDES.length}%` }}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}: ${s.title}`}
              aria-hidden={i !== index}
            >
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <div className="h-full max-h-[min(60dvh,520px)] overflow-hidden rounded-[28px] border-[6px] border-ink/90 bg-surface shadow-xl" style={{ aspectRatio: '375 / 812' }}>
                  {/* Neighbouring slides load early so a swipe never shows an empty frame. */}
                  {Math.abs(i - index) <= 1 && <img src={`./intro/${s.img}.jpg`} alt={`Screenshot: ${s.title}`} className="h-full w-full object-cover object-top" draggable={false} />}
                </div>
              </div>
              <h2 className="mt-5 text-center text-xl font-bold">{s.title}</h2>
              <p className="mt-1 min-h-[3rem] text-center text-sm text-muted">{s.text}</p>
            </section>
          ))}
        </div>
      </div>

      <div className="flex justify-center gap-1.5 py-3" role="tablist" aria-label="Slides">
        {SLIDES.map((s, i) => (
          <button
            key={s.img}
            role="tab"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1}: ${s.title}`}
            className="flex h-6 items-center justify-center px-0.5"
            onClick={() => (pause(), go(i))}
          >
            <span className={`block h-2 rounded-full transition-all ${i === index ? 'w-6 bg-brand' : 'w-2 bg-chip-line'}`} />
          </button>
        ))}
      </div>

      <div className="flex gap-3 px-5">
        {last ? (
          <button className="btn-primary flex-1" onClick={onDone}>
            Get started
          </button>
        ) : (
          <button className="btn-primary flex-1" onClick={() => (pause(), go(index + 1))}>
            Next
          </button>
        )}
      </div>
      <DevelopedBy className="pt-3" />
    </div>
  )
}
