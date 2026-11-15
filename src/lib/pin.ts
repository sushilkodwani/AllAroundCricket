// PINs and the admin recovery code are stored only as salted, slow, one-way
// hashes (PLAN §5.3). They can be checked, never read back.
import type { PinHash } from '../types'
import { constantTimeEqual, fromB64, pbkdf2, randomBytes, toB64 } from './bytes'

export const PIN_ITERATIONS = 310_000

export async function hashPin(pin: string, salt: Uint8Array = randomBytes(16), iterations = PIN_ITERATIONS): Promise<PinHash> {
  const hash = await pbkdf2(pin, salt, iterations)
  return { algo: 'PBKDF2-SHA256', iterations, salt: toB64(salt), hash: toB64(hash) }
}

export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  if (stored.algo !== 'PBKDF2-SHA256') return false
  const hash = await pbkdf2(pin, fromB64(stored.salt), stored.iterations)
  return constantTimeEqual(hash, fromB64(stored.hash))
}

/** True when a stored hash uses fewer iterations than today's setting (re-hash on next login). */
export function needsRehash(stored: PinHash): boolean {
  return stored.iterations < PIN_ITERATIONS
}

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin)
}

const WEAK = new Set(['123456', '654321', '123123', '121212', '012345', '543210', '112233', '123321'])

/** Obvious PINs: one repeated digit, well-known patterns, or the person's own last 6 phone digits. */
export function isWeakPin(pin: string, phone?: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true
  if (WEAK.has(pin)) return true
  if (phone && phone.length >= 6 && phone.slice(-6) === pin) return true
  return false
}

// ---------- admin recovery code ----------
// 12 characters shown as XXXX-XXXX-XXXX; no look-alikes (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateRecoveryCode(): string {
  const bytes = randomBytes(24)
  let out = ''
  for (let i = 0; out.length < 12; i++) {
    // Reject bytes that would bias the pick; top up with fresh ones when needed.
    const b = i < bytes.length ? bytes[i] : randomBytes(1)[0]
    if (b < ALPHABET.length * 8) out += ALPHABET[b % ALPHABET.length]
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export const hashRecoveryCode = (code: string) => hashPin(normalizeRecoveryCode(code))
export const verifyRecoveryCode = (code: string, stored: PinHash) => verifyPin(normalizeRecoveryCode(code), stored)
