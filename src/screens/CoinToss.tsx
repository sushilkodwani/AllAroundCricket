// Coin toss (opened from Settings, for everyone): tap the coin, it flies up
// toward you, tumbles and lands, with a coin sound. A fair random flip;
// nothing is saved or sent anywhere.
import { useEffect, useRef, useState } from 'react'
import { Screen } from '../components/Screen'
import { flipCoin, SIDE_LABEL, type Side } from '../lib/coin'
import { buzz, playToss } from '../lib/coinSound'

const SIZE = 190
const THICK = 16
const METAL = 'conic-gradient(from 25deg, #f3f4f6, #9ca3af, #e5e7eb, #6b7280, #f9fafb, #9ca3af, #e5e7eb, #6b7280, #f3f4f6)'
const INK = 'rgba(55,65,81,.9)'

/** One engraved emblem: a bat and ball on heads, the stumps on tails. */
function Emblem({ side }: { side: Side }) {
  return (
    <svg viewBox="0 0 100 100" width="58%" height="58%" style={{ filter: 'drop-shadow(0 1.5px 0 rgba(255,255,255,.75)) drop-shadow(0 -1px 0 rgba(0,0,0,.25))' }} aria-hidden>
      {side === 'heads' ? (
        <g fill={INK}>
          <g transform="rotate(-35 50 50)">
            <rect x="46.5" y="6" width="7" height="24" rx="3.5" />
            <rect x="38" y="30" width="24" height="52" rx="5" />
          </g>
          <circle cx="70" cy="76" r="11" />
          <path d="M62 70 Q70 76 78 70 M62 82 Q70 76 78 82" stroke="#e5e7eb" strokeWidth="1.8" fill="none" />
        </g>
      ) : (
        <g fill={INK}>
          <rect x="30" y="26" width="9" height="58" rx="4" />
          <rect x="45.5" y="26" width="9" height="58" rx="4" />
          <rect x="61" y="26" width="9" height="58" rx="4" />
          <rect x="31" y="19" width="22" height="5" rx="2.5" />
          <rect x="47" y="19" width="22" height="5" rx="2.5" />
        </g>
      )}
    </svg>
  )
}

const disc: React.CSSProperties = { position: 'absolute', inset: 0, borderRadius: '50%' }

function Face({ side }: { side: Side }) {
  return (
    <div style={{ ...disc, background: METAL, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: side === 'heads' ? `translateZ(${THICK / 2}px)` : `rotateX(180deg) translateZ(${THICK / 2}px)`, boxShadow: 'inset 0 0 0 3px rgba(255,255,255,.45), inset 0 0 18px rgba(0,0,0,.35)' }}>
      {/* the milled rim */}
      <div style={{ ...disc, background: 'repeating-conic-gradient(rgba(0,0,0,.32) 0 1.6deg, rgba(255,255,255,.22) 1.6deg 3.2deg)', WebkitMask: 'radial-gradient(circle, transparent 0 86%, #000 87%)', mask: 'radial-gradient(circle, transparent 0 86%, #000 87%)' }} />
      {/* the raised field with the emblem */}
      <div style={{ ...disc, inset: '9%', background: 'radial-gradient(circle at 35% 30%, #f3f4f6, #b6bcc7 60%, #8b93a1)', boxShadow: 'inset 0 2px 5px rgba(255,255,255,.7), inset 0 -3px 6px rgba(0,0,0,.3), 0 0 0 2px rgba(0,0,0,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Emblem side={side} />
      </div>
      {/* a soft highlight that sweeps over the metal */}
      <div style={{ ...disc, background: 'linear-gradient(115deg, rgba(255,255,255,.35) 0%, transparent 38%, transparent 62%, rgba(255,255,255,.12) 100%)' }} />
    </div>
  )
}

export function CoinToss() {
  const [shown, setShown] = useState<Side>('heads')
  const [result, setResult] = useState<Side | null>(null)
  const [flipping, setFlipping] = useState(false)
  const [history, setHistory] = useState<Side[]>([])
  const coin = useRef<HTMLDivElement>(null)
  const lift = useRef<HTMLDivElement>(null)
  const shadow = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function toss() {
    if (flipping || !coin.current || !lift.current) return
    const outcome = flipCoin()
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const ms = calm ? 700 : 2300
    const turns = calm ? 1 : 6 + Math.floor(Math.random() * 4)
    const from = shown === 'tails' ? 180 : 0
    const to = (outcome === 'tails' ? 180 : 0) + 360 * turns
    // The coin never spins perfectly: it wobbles a little as it tumbles.
    const lean = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 12)
    setResult(null)
    setFlipping(true)
    playToss(ms / 1000)
    buzz(20)

    coin.current.animate(
      [
        { transform: `rotateZ(0deg) rotateY(0deg) rotateX(${from}deg)`, offset: 0 },
        { transform: `rotateZ(${lean}deg) rotateY(${lean / 2}deg) rotateX(${from + (to - from) * 0.5}deg)`, offset: 0.5 },
        { transform: `rotateZ(${-lean / 2}deg) rotateY(${-lean / 3}deg) rotateX(${from + (to - from) * 0.88}deg)`, offset: 0.88 },
        { transform: `rotateZ(0deg) rotateY(0deg) rotateX(${to}deg)`, offset: 1 },
      ],
      { duration: ms, easing: 'cubic-bezier(.2,.55,.3,1)', fill: 'forwards' },
    )
    if (!calm) {
      // Up toward the camera, a hang in the air, down again, and a small bounce.
      lift.current.animate(
        [
          { transform: 'translateY(0) scale(1)', offset: 0, easing: 'cubic-bezier(.15,.7,.35,1)' },
          { transform: 'translateY(-40px) scale(1.45)', offset: 0.45, easing: 'cubic-bezier(.6,0,.85,.45)' },
          { transform: 'translateY(0) scale(1)', offset: 0.86, easing: 'ease-out' },
          { transform: 'translateY(-16px) scale(1.04)', offset: 0.93, easing: 'ease-in' },
          { transform: 'translateY(0) scale(1)', offset: 1 },
        ],
        { duration: ms, fill: 'forwards' },
      )
      shadow.current?.animate(
        [
          { transform: 'scale(1)', opacity: 0.5, offset: 0 },
          { transform: 'scale(1.4)', opacity: 0.1, offset: 0.45 },
          { transform: 'scale(1)', opacity: 0.5, offset: 0.86 },
          { transform: 'scale(.9)', opacity: 0.4, offset: 0.93 },
          { transform: 'scale(1)', opacity: 0.5, offset: 1 },
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

  const heads = history.filter((s) => s === 'heads').length

  return (
    <Screen title="Coin toss" back="/settings">
      <div className="mx-3 mt-3 flex flex-col items-center rounded-3xl px-4 pb-6 pt-5" style={{ background: 'radial-gradient(ellipse at 50% 30%, #2a2f3a 0%, #0d0f14 75%)' }}>
        <p className="h-6 text-sm font-medium text-white/70" aria-live="polite">
          {flipping ? '' : result ? 'Tap to flip again' : 'Tap the coin to flip'}
        </p>

        <button
          type="button"
          onClick={toss}
          disabled={flipping}
          aria-label={flipping ? 'Coin in the air' : 'Flip the coin'}
          className="relative flex h-[420px] w-full items-center justify-center overflow-hidden outline-none"
          style={{ perspective: 650, WebkitTapHighlightColor: 'transparent' }}
        >
          <div ref={shadow} className="absolute rounded-full bg-black" style={{ width: SIZE * 0.8, height: 22, bottom: 92, filter: 'blur(9px)', opacity: 0.5 }} />
          <div ref={lift} style={{ width: SIZE, height: SIZE, willChange: 'transform' }}>
            <div ref={coin} style={{ position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d', willChange: 'transform' }}>
              {/* the thickness of the coin: a stack of thin discs between the two faces */}
              {Array.from({ length: THICK - 2 }, (_, i) => (
                <div key={i} style={{ ...disc, transform: `translateZ(${i - (THICK - 2) / 2 + 0.5}px)`, background: i % 2 ? '#7b8494' : '#a1a8b5' }} />
              ))}
              <Face side="heads" />
              <Face side="tails" />
            </div>
          </div>
        </button>

        <p className="h-12 text-3xl font-extrabold text-white" aria-live="polite">
          {!flipping && result ? `It’s ${SIDE_LABEL[result]}.` : ''}
        </p>

        {history.length > 0 && (
          <div className="mt-3 text-center text-sm text-white/60">
            <p>
              Last {history.length}: {heads} heads, {history.length - heads} tails
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {history.map((s, n) => (
                <span key={n} className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/80">
                  {s === 'heads' ? 'H' : 'T'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="px-4 pt-4">
        <button className="btn-primary w-full" onClick={toss} disabled={flipping}>
          {flipping ? 'Flipping…' : result ? 'Flip again' : 'Flip the coin'}
        </button>
      </div>
    </Screen>
  )
}
