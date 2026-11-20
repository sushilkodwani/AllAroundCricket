// Personal access keys: the shared repo key packed together with a check tied to one person's mobile
// number, so the key the super admin sends works only with that number. It looks like an ordinary password.
//
// The check uses the number's stored hash (people.json never holds the number itself), so the super
// admin can make anyone's key with one tap, without knowing their number. At login the person types
// their number; the app finds them by it and the key must match that person.
//
// This deters forwarding a key; it is not encryption. Anyone holding a personal key and the app's code
// can recover the shared key. Phones that are already logged in keep the plain key in their session.
import { KNOWN_PREFIXES } from './github'

export const KEY_NOT_YOURS = 'This access key doesn’t match this mobile number. Ask the super admin for your personal key.'

/** Characters a repo key is made of, as 6-bit values. */
const KEY_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
/** Characters a personal key is written with. No "_" or "*", which chat apps turn into formatting. */
const OUT_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@'
const VERSION = 2
/** Prefix slot for a key that has none of the usual prefixes. */
const NO_PREFIX = 63
const SEED_LEN = 4
const CHECK_LEN = 4

const enc = new TextEncoder()

async function digest(text: string): Promise<Uint8Array> {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Secure crypto is unavailable. Open the app over HTTPS.')
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))
}

/** Four 6-bit values from the first 3 bytes of a digest. */
async function four(text: string): Promise<number[]> {
  const d = await digest(text)
  const bits = (d[0] << 16) | (d[1] << 8) | d[2]
  return [18, 12, 6, 0].map((s) => (bits >> s) & 63)
}

/** 6-bit values that scramble the key; they depend only on the seed written at the start of the key. */
async function stream(seed: string, length: number): Promise<number[]> {
  const out: number[] = []
  for (let block = 0; out.length < length; block++) {
    for (const b of await digest(`aac-key:${seed}:${block}`)) out.push(b & 63)
  }
  return out.slice(0, length)
}

const checkOf = (phoneHash: string, token: string) => four(`aac-check:${phoneHash}:${token}`)

function split(token: string): { prefix: number; body: string } {
  const i = KNOWN_PREFIXES.findIndex((p) => token.startsWith(p))
  return i >= 0 ? { prefix: i, body: token.slice(KNOWN_PREFIXES[i].length) } : { prefix: NO_PREFIX, body: token }
}

/** The key for the person whose stored number hash this is. The same person and repo key give the same key. */
export async function makePersonalKey(token: string, phoneHash: string): Promise<string> {
  const real = token.trim()
  const { prefix, body } = split(real)
  const plain = [
    VERSION,
    prefix,
    ...[...body].map((c) => {
      const v = KEY_ALPHA.indexOf(c)
      if (v < 0) throw new Error('This access key has a character the app can’t pack into a personal key.')
      return v
    }),
  ]
  const seed = (await four(`aac-seed:${phoneHash}:${real}`)).map((v) => OUT_ALPHA[v]).join('')
  const s = await stream(seed, plain.length)
  const mixed = plain.map((v, i) => (v + s[i]) & 63).map((v) => OUT_ALPHA[v]).join('')
  const check = (await checkOf(phoneHash, real)).map((v) => OUT_ALPHA[v]).join('')
  return seed + mixed + check
}

export interface OpenedKey {
  /** The repo key inside. */
  token: string
  /** The personal key as typed, without spaces. */
  personalKey: string
  check: number[]
}

/** Unpacks a personal key, or null when the text isn't one. Whose it is is checked with `keyFits`. */
export async function openPersonalKey(input: string): Promise<OpenedKey | null> {
  const key = input.replace(/\s+/g, '')
  if (KNOWN_PREFIXES.some((p) => key.startsWith(p))) return null
  if (key.length < SEED_LEN + CHECK_LEN + 3) return null
  const values = [...key].map((c) => OUT_ALPHA.indexOf(c))
  if (values.some((v) => v < 0)) return null
  const seed = key.slice(0, SEED_LEN)
  const mixed = values.slice(SEED_LEN, -CHECK_LEN)
  const s = await stream(seed, mixed.length)
  const plain = mixed.map((v, i) => (v - s[i] + 64) & 63)
  if (plain[0] !== VERSION) return null
  const prefix = plain[1]
  if (prefix !== NO_PREFIX && prefix >= KNOWN_PREFIXES.length) return null
  const token = (prefix === NO_PREFIX ? '' : KNOWN_PREFIXES[prefix]) + plain.slice(2).map((v) => KEY_ALPHA[v]).join('')
  return { token, personalKey: key, check: values.slice(-CHECK_LEN) }
}

/** True when the key was made for the person with this stored number hash. */
export async function keyFits(opened: OpenedKey, phoneHash: string | undefined): Promise<boolean> {
  if (!phoneHash) return false
  const want = await checkOf(phoneHash, opened.token)
  return want.every((v, i) => v === opened.check[i])
}

/** The message sent with a personal key. */
export function keyMessage(name: string, key: string): string {
  return [
    `Hi ${name}, here is your All Around Cricket access key:`,
    '',
    key,
    '',
    'It works only with your own mobile number. Please don’t share it.',
  ].join('\n')
}
