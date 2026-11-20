import { describe, expect, it } from 'vitest'
import { keyFits, makePersonalKey, openPersonalKey } from './personalKey'

const FINE = 'github_pat_11ABCDEFG0abcdefghijkl_MNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ'
// Stored number hashes, as people.json keeps them.
const A = 'hashOfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const B = 'hashOfBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='

describe('personal access keys', () => {
  it('opens to the repo key and fits only the person it was made for', async () => {
    const key = await makePersonalKey(FINE, A)
    const opened = await openPersonalKey(key)
    expect(opened?.token).toBe(FINE)
    expect(await keyFits(opened!, A)).toBe(true)
    expect(await keyFits(opened!, B)).toBe(false)
    expect(await keyFits(opened!, undefined)).toBe(false)
  })

  it('is the same each time for one person, different per person, and hides the prefix', async () => {
    const a = await makePersonalKey(FINE, A)
    expect(await makePersonalKey(FINE, A)).toBe(a)
    const b = await makePersonalKey(FINE, B)
    expect(a).not.toBe(b)
    for (const k of [a, b]) {
      expect(k).not.toContain('github_pat_')
      expect(k).toMatch(/^[A-Za-z0-9!@]+$/)
    }
  })

  it('fails on a typo and ignores spaces and line breaks', async () => {
    const key = await makePersonalKey(FINE, A)
    const at = key.length - 2
    const typo = key.slice(0, at) + (key[at] === 'x' ? 'y' : 'x') + key.slice(at + 1)
    const t = await openPersonalKey(typo)
    expect(t && (await keyFits(t, A))).toBeFalsy()
    const spaced = await openPersonalKey(`  ${key.slice(0, 20)}\n${key.slice(20)} `)
    expect(spaced?.token).toBe(FINE)
    expect(await keyFits(spaced!, A)).toBe(true)
  })

  it('keeps other prefixes and keys without one', async () => {
    for (const token of ['ghp_abcDEF123456', 'demo-token']) {
      const o = await openPersonalKey(await makePersonalKey(token, A))
      expect(o?.token).toBe(token)
      expect(await keyFits(o!, A)).toBe(true)
    }
  })

  it('treats the plain key and junk as not personal', async () => {
    expect(await openPersonalKey(FINE)).toBeNull()
    expect(await openPersonalKey('abc')).toBeNull()
    expect(await openPersonalKey('')).toBeNull()
  })
})
