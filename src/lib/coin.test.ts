import { describe, expect, it } from 'vitest'
import { flipCoin, wonToss } from './coin'

describe('coin toss', () => {
  it('maps the random bit to heads or tails', () => {
    expect(flipCoin(() => 0)).toBe('heads')
    expect(flipCoin(() => 1)).toBe('tails')
  })
  it('is roughly fair with the real random source', () => {
    let heads = 0
    for (let i = 0; i < 4000; i++) if (flipCoin() === 'heads') heads++
    expect(heads).toBeGreaterThan(1800)
    expect(heads).toBeLessThan(2200)
  })
  it('only judges a call that was made', () => {
    expect(wonToss(undefined, 'heads')).toBeUndefined()
    expect(wonToss('heads', 'heads')).toBe(true)
    expect(wonToss('heads', 'tails')).toBe(false)
  })
})
