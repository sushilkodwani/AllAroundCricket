// Coin toss (opened from Settings, for everyone): call heads or tails, flip,
// watch the coin spin and land, with a coin sound. The result is a fair
// random flip; nothing is saved or sent anywhere.
import { useEffect, useRef, useState } from 'react'
import { ChoiceChips } from '../components/ui'
import { Screen } from '../components/Screen'
import { flipCoin, SIDE_LABEL, wonToss, type Side } from '../lib/coin'
import { buzz, playToss } from '../lib/coinSound'

const SOUND_KEY = 'aac.tossSound'
const readSound = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

const GOLD = 'radial-gradient(circle at 32% 28%, #fde68a 0%, #f59e0b 55%, #b45309 100%)'
const face: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: '50%',
  background: GOLD,
  border: '6px solid #b45309',
  boxShadow: 'inset 0 0 0 4px rgba(255,255,255,.25), inset 0 -6px 14px rgba(120,53,15,.45)',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#78350f',
}

export function CoinToss() {
  const [call, setCall] = useState<Side | undefined>(undefined)
  const [shown, setShown] = useState<Side>('heads')
  const [result, setResult] = useState<Side | null>(null)
  const [flipping, setFlipping] = useState(false)
  const [sound, setSound] = useState(readSound)
  const [history, setHistory] = useState<Side[]>([])
  const coin = useRef<HTMLDivElement>(null)
  const lift = useRef<HTMLDivElement>(null)
  const shadow = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function toggleSound(on: boolean) {
    setSound(on)
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
    } catch {
      /* private mode */
    }
  }

  function toss() {
    if (flipping || !coin.current || !lift.current) return
    const outcome = flipCoin()
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const ms = calm ? 700 : 1900
    const turns = calm ? 1 : 5 + Math.floor(Math.random() * 3)
    const from = shown === 'tails' ? 180 : 0
    const to = (outcome === 'tails' ? 180 : 0) + 360 * turns
    setResult(null)
    setFlipping(true)
    if (sound) playToss(ms / 1000)
    buzz(20)

    coin.current.animate([{ transform: `rotateX(${from}deg)` }, { transform: `rotateX(${to}deg)` }], { duration: ms, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' })
    if (!calm) {
      // Up fast, hang a moment, fall, and a small bounce on landing.
      lift.current.animate(
        [
          { transform: 'translateY(0) scale(1)', offset: 0, easing: 'cubic-bezier(.2,.7,.4,1)' },
          { transform: 'translateY(-170px) scale(1.25)', offset: 0.45, easing: 'cubic-bezier(.6,0,.9,.5)' },
          { transform: 'translateY(0) scale(1)', offset: 0.85, easing: 'ease-out' },
          { transform: 'translateY(-14px) scale(1.02)', offset: 0.92, easing: 'ease-in' },
          { transform: 'translateY(0) scale(1)', offset: 1 },
        ],
        { duration: ms, fill: 'forwards' },
      )
      shadow.current?.animate(
        [
          { transform: 'scale(1)', opacity: 0.35, offset: 0 },
          { transform: 'scale(0.45)', opacity: 0.12, offset: 0.45 },
          { transform: 'scale(1)', opacity: 0.35, offset: 0.85 },
          { transform: 'scale(0.9)', opacity: 0.3, offset: 0.92 },
          { transform: 'scale(1)', opacity: 0.35, offset: 1 },
        ],
        { duration: ms, fill: 'forwards' },
      )
    }

    timer.current = window.setTimeout(() => {
      // Keep the landing position as a plain style, then drop the finished animations.
      if (coin.current) {
        coin.current.getAnimations().forEach((a) => a.cancel())
        coin.current.style.transform = `rotateX(${outcome === 'tails' ? 180 : 0}deg)`
      }
      lift.current?.getAnimations().forEach((a) => a.cancel())
      shadow.current?.getAnimations().forEach((a) => a.cancel())
      setShown(outcome)
      setResult(outcome)
      setHistory((h) => [outcome, ...h].slice(0, 10))
      setFlipping(false)
      buzz(40)
    }, ms)
  }

  const won = result ? wonToss(call, result) : undefined
  const heads = history.filter((s) => s === 'heads').length

  return (
    <Screen title="Coin toss" back="/settings">
      <div className="flex flex-col items-center gap-5 px-4 pt-6">
        <div className="w-full">
          <span className="label">Your call (optional)</span>
          <ChoiceChips
            options={[
              { value: 'heads', label: 'Heads' },
              { value: 'tails', label: 'Tails' },
            ]}
            value={call}
            onChange={(v) => !flipping && setCall(v === call ? undefined : v)}
          />
        </div>

        <div className="relative flex h-72 w-full items-end justify-center pb-6" style={{ perspective: 700 }}>
          <div ref={shadow} className="absolute bottom-3 h-4 w-28 rounded-full bg-black" style={{ opacity: 0.35, filter: 'blur(6px)' }} />
          <div ref={lift} className="relative h-36 w-36" style={{ willChange: 'transform' }}>
            <div ref={coin} className="relative h-full w-full" style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}>
              <div style={face}>
                <span className="text-5xl leading-none" aria-hidden>
                  🏏
                </span>
                <span className="mt-1 text-sm font-extrabold tracking-widest">HEADS</span>
              </div>
              <div style={{ ...face, transform: 'rotateX(180deg)' }}>
                <span className="text-5xl leading-none" aria-hidden>
                  🔴
                </span>
                <span className="mt-1 text-sm font-extrabold tracking-widest">TAILS</span>
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-[72px] text-center" aria-live="polite">
          {flipping && <p className="text-lg font-semibold text-muted">Flipping…</p>}
          {!flipping && result && (
            <>
              <p className="text-3xl font-extrabold">{SIDE_LABEL[result]}!</p>
              {won !== undefined && <p className={`mt-1 text-lg font-semibold ${won ? 'text-ok' : 'text-bad'}`}>{won ? `You called ${SIDE_LABEL[result]} — you win the toss` : `You called ${SIDE_LABEL[call!]} — you lose the toss`}</p>}
            </>
          )}
          {!flipping && !result && <p className="text-muted">Tap the button to flip the coin.</p>}
        </div>

        <button className="btn-primary w-full max-w-sm" onClick={toss} disabled={flipping}>
          {flipping ? 'Flipping…' : result ? 'Flip again' : 'Flip the coin'}
        </button>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={sound} onChange={(e) => toggleSound(e.target.checked)} />
          Coin sound
        </label>

        {history.length > 0 && (
          <div className="w-full text-center text-sm text-muted">
            <p>
              Last {history.length}: {heads} heads, {history.length - heads} tails
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {history.map((s, n) => (
                <span key={n} className="rounded-full bg-alt px-2 py-0.5 text-xs font-semibold">
                  {s === 'heads' ? 'H' : 'T'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Screen>
  )
}
