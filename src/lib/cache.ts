// Local copy of every data file so the app renders instantly and works offline.
// IndexedDB first; localStorage when IndexedDB is unavailable (some private modes).

export interface KV {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}

export function memoryKV(): KV {
  const map = new Map<string, string>()
  return {
    async get(k) {
      const v = map.get(k)
      return v === undefined ? undefined : JSON.parse(v)
    },
    async set(k, v) {
      map.set(k, JSON.stringify(v))
    },
    async del(k) {
      map.delete(k)
    },
    async keys() {
      return [...map.keys()]
    },
    async clear() {
      map.clear()
    },
  }
}

function localStorageKV(prefix: string): KV {
  const p = `aac.cache.${prefix}:`
  const ownKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(p))
  return {
    async get(k) {
      const v = localStorage.getItem(p + k)
      return v === null ? undefined : JSON.parse(v)
    },
    async set(k, v) {
      localStorage.setItem(p + k, JSON.stringify(v))
    },
    async del(k) {
      localStorage.removeItem(p + k)
    },
    async keys() {
      return ownKeys().map((k) => k.slice(p.length))
    },
    async clear() {
      for (const k of ownKeys()) localStorage.removeItem(k)
    },
  }
}

const DB_NAME = 'allaroundcricket'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}

function idbKV(db: IDBDatabase, prefix: string): KV {
  const p = `${prefix}:`
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const ownKeys = async () => ((await run('readonly', (s) => s.getAllKeys())) as string[]).filter((k) => k.startsWith(p))
  return {
    get: (k) => run('readonly', (s) => s.get(p + k)),
    set: async (k, v) => void (await run('readwrite', (s) => s.put(v, p + k))),
    del: async (k) => void (await run('readwrite', (s) => s.delete(p + k))),
    keys: async () => (await ownKeys()).map((k) => k.slice(p.length)),
    clear: async () => {
      for (const k of await ownKeys()) await run('readwrite', (s) => s.delete(k))
    },
  }
}

/** One cache namespace per data repo. */
export async function openCache(prefix: string): Promise<KV> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB')
    return idbKV(await openDb(), prefix)
  } catch {
    return localStorageKV(prefix)
  }
}
