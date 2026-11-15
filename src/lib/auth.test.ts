import { describe, expect, it } from 'vitest'
import type { AppConfig, Credential, Person } from '../types'
import { canWrite, checkSession, onboardStep, roleOf } from './access'
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

const config = { adminPersonId: 'admin' } as AppConfig
const mk = (id: string, patch: Partial<Person> = {}): Person => ({
  id,
  name: id,
  access: 'view',
  isGuest: false,
  teamIds: ['t1'],
  createdAt: '',
  updatedAt: '',
  ...patch,
})
const cred = (personId: string, patch: Partial<Credential> = {}): Credential => ({ personId, sessionEpoch: 1, updatedAt: '', ...patch })
const PIN = { algo: 'PBKDF2-SHA256', iterations: 1, salt: 's', hash: 'h' } as const

describe('roles', () => {
  it('resolves admin, viewer and denied', () => {
    const people = [mk('admin', { teamIds: [] }), mk('p1'), mk('blocked', { access: 'none' }), mk('teamless', { teamIds: [] }), mk('guest', { isGuest: true })]
    expect(roleOf('admin', config, people)).toBe('admin')
    expect(roleOf('p1', config, people)).toBe('viewer')
    expect(roleOf('blocked', config, people)).toBe('denied')
    expect(roleOf('teamless', config, people)).toBe('denied')
    expect(roleOf('guest', config, people)).toBe('denied')
    expect(roleOf('nobody', config, people)).toBe('denied')
  })
  it('picks the onboarding step', () => {
    expect(onboardStep(undefined, config, [])).toBe('no_access')
    expect(onboardStep(mk('p1', { access: 'none' }), config, [cred('p1')])).toBe('no_access')
    expect(onboardStep(mk('p1'), config, [cred('p1')])).toBe('set_pin')
    expect(onboardStep(mk('p1'), config, [cred('p1', { pin: PIN })])).toBe('enter_pin')
  })
  it('detects an admin PIN reset and lost access', () => {
    const people = [mk('p1')]
    const s = { personId: 'p1', sessionEpoch: 1 }
    expect(checkSession(s, config, people, [cred('p1', { pin: PIN })])).toBe('ok')
    expect(checkSession(s, config, people, [cred('p1', { pin: PIN, sessionEpoch: 2 })])).toBe('pin_reset')
    expect(checkSession(s, config, people, [cred('p1')])).toBe('pin_reset')
    expect(checkSession(s, config, [mk('p1', { access: 'none' })], [cred('p1', { pin: PIN })])).toBe('no_access')
  })
})

describe('write guard', () => {
  const viewer = { role: 'viewer', personId: 'p1' } as const
  const creds = (...c: Credential[]) => ({ schemaVersion: 1, credentials: c })
  it('admin may write anything; nobody may write when logged out', () => {
    expect(canWrite({ role: 'admin', personId: 'a' }, 'teams.json', null, {})).toBe(true)
    expect(canWrite({ role: 'none' }, 'teams.json', null, {})).toBe(false)
  })
  it('viewer may set only their own PIN', () => {
    const before = creds(cred('p1'), cred('p2'))
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1', { pin: PIN }), cred('p2')))).toBe(true)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1'), cred('p2', { pin: PIN })))).toBe(false)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1', { sessionEpoch: 2 }), cred('p2')))).toBe(false)
    expect(canWrite(viewer, 'auth/credentials.json', before, creds(cred('p1')))).toBe(false)
    expect(canWrite(viewer, 'people.json', null, {})).toBe(false)
    expect(canWrite(viewer, 'teams/t1/matches.json', null, {})).toBe(false)
  })
  it('viewer may add or remove only their own push subscription', () => {
    const sub = (deviceId: string, personId: string) => ({ deviceId, personId })
    const subs = (...s: ReturnType<typeof sub>[]) => ({ schemaVersion: 1, subscriptions: s })
    expect(canWrite(viewer, 'push/subscriptions.json', subs(sub('d2', 'p2')), subs(sub('d2', 'p2'), sub('d1', 'p1')))).toBe(true)
    expect(canWrite(viewer, 'push/subscriptions.json', subs(sub('d1', 'p1'), sub('d2', 'p2')), subs(sub('d2', 'p2')))).toBe(true)
    expect(canWrite(viewer, 'push/subscriptions.json', subs(sub('d1', 'p1'), sub('d2', 'p2')), subs(sub('d1', 'p1')))).toBe(false)
  })
})
