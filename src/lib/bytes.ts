// Small Web Crypto helpers shared by phone hashing and PIN hashing.

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** PBKDF2-HMAC-SHA256. Needs a secure context (HTTPS or localhost). */
export async function pbkdf2(secret: string, salt: Uint8Array, iterations: number, bytes = 32): Promise<Uint8Array> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Secure crypto is unavailable. Open the app over HTTPS.')
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bytes * 8)
  return new Uint8Array(bits)
}

/** SHA-256 of a text, base64. */
export async function sha256(text: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Secure crypto is unavailable. Open the app over HTTPS.')
  return toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

/** Compare without stopping at the first difference. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
