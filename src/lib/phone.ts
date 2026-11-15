// Phone numbers: 10-digit Indian mobiles, never stored or logged in plain text
// (PLAN §5.2). Only a salted hash and the last 4 digits reach the data repo.
import { fromB64, pbkdf2, toB64 } from './bytes'

export const PHONE_ITERATIONS = 100_000

/** Keep digits only, capped at 10 — for controlled inputs while typing. */
export function digitsOnly(input: string, max = 10): string {
  return input.replace(/\D/g, '').slice(0, max)
}

/**
 * For the phone field while typing or pasting: strips spaces/dashes/brackets,
 * drops a pasted +91 or leading 0, and caps at 10 digits. The cleanup must
 * happen before the cap, or "+91 98765 43210" would keep the wrong 10 digits.
 */
export function cleanPhoneInput(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}

export type PhoneResult = { ok: true; phone: string } | { ok: false; error: string }

/** Cleans pasted input (+91, leading 0, spaces, dashes) and validates. */
export function normalizePhone(raw: string): PhoneResult {
  let d = raw.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length !== 10) return { ok: false, error: 'Enter a 10-digit mobile number.' }
  if (!/^[6-9]/.test(d)) return { ok: false, error: 'Mobile numbers start with 6, 7, 8 or 9.' }
  return { ok: true, phone: d }
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw).ok
}

export async function hashPhone(phone: string, saltB64: string): Promise<string> {
  return toB64(await pbkdf2(phone, fromB64(saltB64), PHONE_ITERATIONS))
}

export const last4 = (phone: string) => phone.slice(-4)

/** What the admin sees: ••••••3210 */
export const maskPhone = (phoneLast4?: string) => (phoneLast4 ? `••••••${phoneLast4}` : 'No number')
