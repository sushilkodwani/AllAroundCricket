import { describe, expect, it } from 'vitest'
import { computeSplit, validateSplit } from './split'
import type { ExpenseLine } from '../types'

const line = (over: Partial<ExpenseLine> = {}): ExpenseLine => ({ categoryId: 'b', categoryName: 'Breakfast', mode: 'optional', total: 1000, excludedPersonIds: [], ...over })

describe('a player with their own amount', () => {
  it('pays exactly that and the rest share what is left', () => {
    const l = line({ fixed: { a: 400 } })
    const r = computeSplit({ lines: [l], payerIds: ['a', 'b', 'c', 'd'], available: {} })
    const by = (id: string) => r.shares.find((s) => s.personId === id)!.total
    expect(by('a')).toBe(400)
    expect(by('b')).toBe(200)
    expect(by('d')).toBe(200)
    expect(r.roundingExtra).toBe(0)
    expect(r.perLine.b).toEqual({ participants: 3, perHead: 200 })
  })
  it('rounds the others up, never the set amount', () => {
    const r = computeSplit({ lines: [line({ total: 1000, fixed: { a: 300 } })], payerIds: ['a', 'b', 'c', 'd'], available: {} })
    expect(r.shares.find((s) => s.personId === 'a')!.total).toBe(300)
    expect(r.shares.find((s) => s.personId === 'b')!.total).toBe(234)
    expect(r.roundingExtra).toBe(2)
  })
  it('is refused when the amounts add up to more than the total', () => {
    expect(validateSplit([line({ total: 100, fixed: { a: 80, b: 40 } })], ['a', 'b', 'c'])[0]).toMatch(/more than the total/)
  })
  it('is refused when nobody is left to cover the rest', () => {
    expect(validateSplit([line({ total: 100, fixed: { a: 30, b: 40 } })], ['a', 'b'])[0]).toMatch(/not covered/)
    expect(validateSplit([line({ total: 100, fixed: { a: 60, b: 40 } })], ['a', 'b'])).toEqual([])
  })
  it('ignores an amount for someone who is removed', () => {
    const r = computeSplit({ lines: [line({ excludedPersonIds: ['a'], fixed: { a: 400 } })], payerIds: ['a', 'b'], available: {} })
    expect(r.shares.find((s) => s.personId === 'a')!.total).toBe(0)
    expect(r.shares.find((s) => s.personId === 'b')!.total).toBe(1000)
  })
})
