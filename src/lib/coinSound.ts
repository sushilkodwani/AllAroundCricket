// Coin sounds, made with the Web Audio API so there is no file to download:
// a bright "ting" as the coin leaves the thumb, a soft whirr while it spins,
// and a few shrinking clinks as it lands. Everything fails quietly.
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx ??= new Ctor()
    // Phones keep audio suspended until a tap; the toss button is that tap.
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** A metallic hit: a few non-harmonic partials that fade away quickly. */
function ting(c: AudioContext, at: number, volume: number, pitch = 1) {
  const master = c.createGain()
  master.gain.setValueAtTime(0.0001, at)
  master.gain.exponentialRampToValueAtTime(volume, at + 0.004)
  master.gain.exponentialRampToValueAtTime(0.0001, at + 1.1)
  master.connect(c.destination)
  for (const [freq, level, life] of [
    [2480, 1, 1.0],
    [3720, 0.6, 0.7],
    [5890, 0.4, 0.45],
    [8110, 0.2, 0.25],
  ] as const) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * pitch
    g.gain.setValueAtTime(level, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + life)
    osc.connect(g).connect(master)
    osc.start(at)
    osc.stop(at + life + 0.05)
  }
}

/** A short click of filtered noise: the whirr of a spinning coin is a run of these. */
function tick(c: AudioContext, at: number, volume: number) {
  const len = Math.floor(c.sampleRate * 0.012)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 4200
  const g = c.createGain()
  g.gain.value = volume
  src.connect(filter).connect(g).connect(c.destination)
  src.start(at)
}

/** Plays the whole toss: launch ting, whirr for `seconds`, then the landing clinks. */
export function playToss(seconds: number): void {
  const c = audio()
  if (!c) return
  const t0 = c.currentTime + 0.02
  ting(c, t0, 0.5)
  // The spin slows as the coin comes down, so the ticks space out.
  let t = 0.12
  let gap = 0.035
  while (t < seconds - 0.05) {
    tick(c, t0 + t, 0.05 * (1 - (t / seconds) * 0.5))
    t += gap
    gap *= 1.06
  }
  const land = t0 + seconds
  ting(c, land, 0.45, 0.9)
  ting(c, land + 0.17, 0.2, 1.05)
  ting(c, land + 0.29, 0.1, 1.1)
  ting(c, land + 0.37, 0.05, 1.15)
}

/** A tiny buzz on phones that support it. */
export function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}
