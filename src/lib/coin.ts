// Coin toss: a fair flip, and what the call means.
export type Side = 'heads' | 'tails'

/** A fair flip: unbiased bits from the browser's secure random source. */
export function flipCoin(random: (max: number) => number = secureInt): Side {
  return random(2) === 0 ? 'heads' : 'tails'
}

function secureInt(max: number): number {
  const c = globalThis.crypto
  if (!c?.getRandomValues) return Math.floor(Math.random() * max)
  // Reject the few values that would make some outcomes likelier than others.
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  do c.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % max
}

/** Did the caller win? No call means there is nothing to win. */
export const wonToss = (call: Side | undefined, result: Side): boolean | undefined => (call ? call === result : undefined)

export const SIDE_LABEL: Record<Side, string> = { heads: 'Heads', tails: 'Tails' }
