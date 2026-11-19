import { describe, expect, it } from 'vitest'
import { cleanPhoneInput, hashPhone, maskPhone, normalizePhone } from './phone'
import { generateRecoveryCode, hashPin, isValidPin, isWeakPin, needsRehash, verifyPin, verifyRecoveryCode, hashRecoveryCode } from './pin'

describe('phone', () => {
  it('cleans pasted numbers', () => {
    expect(normalizePhone('98765 43210')).toEqual({ ok: true, phone: '9876543210' })
    expect(normalizePhone('+91 98765-43210')).toEqual({ ok: true, phone: '9876543210' })
    expect(normalizePhone('09876543210')).toEqual({ ok: true, phone: '9876543210' })
    expect(normalizePhone('(987) 654 3210')).toEqual({ ok: true, phone: '9876543210' })
  })
  it('cleans the field before capping it at 10 digits', () => {
    expect(cleanPhoneInput('+91 98765 43210')).toBe('9876543210')
    expect(cleanPhoneInput('098765-43210')).toBe('9876543210')
    expect(cleanPhoneInput('9198765432')).toBe('9198765432') // a real number that happens to start with 91
    expect(cleanPhoneInput('98765432109')).toBe('9876543210')
    expect(cleanPhoneInput('98a7')).toBe('987')
  })
  it('rejects wrong lengths and first digits', () => {
    expect(normalizePhone('987654321').ok).toBe(false)
    expect(normalizePhone('98765432101').ok).toBe(false)
    expect(normalizePhone('5876543210').ok).toBe(false)
  })
  it('hashes with the salt and never returns the number', async () => {
    const salt = 'AAAAAAAAAAAAAAAAAAAAAA=='
    const a = await hashPhone('9876543210', salt)
    expect(a).toBe(await hashPhone('9876543210', salt))
    expect(a).not.toBe(await hashPhone('9876543211', salt))
    expect(a).not.toBe(await hashPhone('9876543210', 'AQEBAQEBAQEBAQEBAQEBAQ=='))
    expect(a).not.toContain('9876543210')
    expect(maskPhone('3210')).toBe('••••••3210')
  })
})

describe('pin', () => {
  it('same PIN with a new salt gives a different hash', async () => {
    const a = await hashPin('482915')
    const b = await hashPin('482915')
    expect(a.hash).not.toBe(b.hash)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iterations).toBe(310_000)
  })
  it('verifies the right PIN and only the right PIN', async () => {
    const stored = await hashPin('482915')
    expect(await verifyPin('482915', stored)).toBe(true)
    expect(await verifyPin('482916', stored)).toBe(false)
  })
  it('validates shape and rejects weak PINs', () => {
    expect(isValidPin('482915')).toBe(true)
    expect(isValidPin('48291')).toBe(false)
    expect(isValidPin('48291a')).toBe(false)
    for (const weak of ['000000', '111111', '123456', '654321', '123123', '121212']) expect(isWeakPin(weak)).toBe(true)
    expect(isWeakPin('543210', '9876543210')).toBe(true)
    expect(isWeakPin('482915', '9876543210')).toBe(false)
  })
  it('supports raising the iteration count later', async () => {
    const old = await hashPin('482915', undefined, 1000)
    expect(await verifyPin('482915', old)).toBe(true)
    expect(needsRehash(old)).toBe(true)
    expect(needsRehash(await hashPin('482915'))).toBe(false)
  })
  it('recovery codes are XXXX-XXXX-XXXX and verify regardless of dashes/case', async () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    const stored = await hashRecoveryCode(code)
    expect(await verifyRecoveryCode(code.toLowerCase().replace(/-/g, ' '), stored)).toBe(true)
    expect(await verifyRecoveryCode('AAAA-AAAA-AAAA', stored)).toBe(false)
  })
})

