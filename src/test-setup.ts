// Node 18 has Web Crypto but not as a global — the app code expects `crypto`.
import { webcrypto } from 'node:crypto'

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}
