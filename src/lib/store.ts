// The data store: GitHub (or the fake) + a local cache + an offline write queue.
//
// - Every file read is kept in memory and in the cache, so the app renders
//   instantly and still opens offline.
// - A write updates memory and the cache at once and is marked "dirty"; a
//   debounced flush sends it to the repo. Dirty files survive a reload, so
//   edits made offline are sent when the connection returns.
// - Every repo write carries the last known sha. If another device wrote first
//   the store re-reads the file and does an id-based 3-way merge (merge.ts).
// - Every write passes the access guard first (access.ts).
import type { AdminsFile, AppConfig, PeopleFile, TeamsFile } from '../types'
import { canWrite, type Actor, type Lookup } from './access'
import type { KV } from './cache'
import { ApiError, describeRepoError, NetworkError, type Backend } from './github'
import { mergeFile } from './merge'
import { P } from './paths'

interface Entry {
  data: unknown
  /** Last copy known to be in the repo — the merge base. */
  base: unknown
  sha?: string
  etag?: string
  /** Commit message of the unsent change, when there is one. */
  dirty?: string
  /** Checked against the repo during this app session. */
  fresh?: boolean
  /** The file is to be deleted from the repo (sent with the next flush). */
  deleted?: boolean
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error'

export interface StoreStatus {
  save: SaveState
  online: boolean
  /** The repo rejected the token (401) — the app asks for a new one. */
  authFailed: boolean
  error: string | null
  pending: number
}

const RETRY_MS = 15_000
const MAX_ATTEMPTS = 5

/** Pictures and funds.json first, then matches.json (PLAN §14.4); teams.json (derived stats) last. */
function priority(path: string): number {
  // A picture goes before the people / teams stamp that points at it.
  if (path.startsWith('images/')) return 0
  if (path.endsWith('/funds.json')) return 0
  if (path.endsWith('/matches.json')) return 1
  if (path === 'teams.json') return 9
  return 5
}

export class Store {
  actor: Actor = { role: 'none' }
  version = 0
  status: StoreStatus = { save: 'idle', online: true, authFailed: false, error: null, pending: 0 }

  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private reads = new Map<string, Promise<void>>()
  private flushChain: Promise<boolean> = Promise.resolve(true)
  private flushing = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private savedTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private backend: Backend,
    private kv: KV,
    private debounceMs = 1200,
  ) {}

  // ---------- subscriptions ----------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = (): number => this.version

  private notify(): void {
    this.version++
    this.status = { ...this.status, pending: this.dirtyPaths().length }
    for (const fn of this.listeners) fn()
  }

  private setStatus(patch: Partial<StoreStatus>): void {
    this.status = { ...this.status, ...patch }
    this.notify()
  }

  /** Swap the backend after the user enters a new token. */
  setBackend(backend: Backend): void {
    this.backend = backend
    this.setStatus({ authFailed: false, error: null })
    if (this.dirtyPaths().length) void this.flush()
  }

  // ---------- reading ----------
  /** Loads every cached file into memory. Call once at startup. */
  async hydrate(): Promise<void> {
    for (const key of await this.kv.keys()) {
      const e = (await this.kv.get(key)) as Entry | undefined
      if (e && !this.entries.has(key)) this.entries.set(key, { ...e, fresh: false })
    }
    this.notify()
    if (this.dirtyPaths().length) this.schedule(0)
  }

  get<T>(path: string): T | null {
    return (this.entries.get(path)?.data as T | undefined) ?? null
  }

  has(path: string): boolean {
    return this.entries.has(path)
  }

  /**
   * Cache-first read: returns what is known right away and refreshes in the
   * background; waits for the network only when nothing is cached.
   */
  async load<T>(path: string): Promise<T | null> {
    const e = this.entries.get(path)
    if (e) {
      if (!e.fresh) void this.refresh(path).catch(() => {})
      return e.data as T | null
    }
    await this.refresh(path)
    return this.get<T>(path)
  }

  /** Checks the repo for a newer copy (a free 304 when nothing changed). */
  refresh(path: string): Promise<void> {
    const running = this.reads.get(path)
    if (running) return running
    const p = this.doRefresh(path).finally(() => this.reads.delete(path))
    this.reads.set(path, p)
    return p
  }

  async refreshAll(paths?: string[]): Promise<void> {
    await Promise.all((paths ?? [...this.entries.keys()]).map((p) => this.refresh(p)))
  }

  private async doRefresh(path: string): Promise<void> {
    // Never read while a write of the same file may be in flight.
    if (this.flushing) await this.flushChain.catch(() => {})
    const before = this.entries.get(path)
    let res
    try {
      res = await this.backend.read(path, before?.etag)
    } catch (e) {
      this.noteFailure(e)
      throw e
    }
    if (!this.status.online) this.setStatus({ online: true })
    const cur = this.entries.get(path)
    if (cur?.deleted) {
      // A delete is waiting to be sent: only learn the current sha (or that it is already gone).
      if (res.kind === 'ok') this.entries.set(path, { ...cur, sha: res.sha, etag: res.etag })
      else if (res.kind === 'missing') this.entries.delete(path)
      this.persist(path)
      this.notify()
      return
    }
    if (res.kind === 'not_modified') {
      if (cur && !cur.fresh) {
        cur.fresh = true
        this.notify()
      }
      return
    }
    const remote = res.kind === 'ok' ? res.data : null
    const data = cur?.dirty ? mergeFile(path, cur.base, cur.data, remote) : remote
    this.entries.set(path, {
      data,
      base: remote,
      sha: res.kind === 'ok' ? res.sha : undefined,
      etag: res.kind === 'ok' ? res.etag : undefined,
      dirty: cur?.dirty,
      fresh: true,
    })
    this.persist(path)
    this.notify()
  }

  // ---------- writing ----------
  /**
   * Debounced write. Returns false (and does nothing) when the access guard
   * refuses it.
   */
  write(path: string, data: unknown, message: string): boolean {
    if (!this.put(path, data, message)) return false
    this.schedule(this.debounceMs)
    return true
  }

  /**
   * Immediate, awaited write for things that must be in the repo before the
   * app continues (PINs). Rolls back and throws when it can't be saved.
   */
  async writeNow(path: string, data: unknown, message: string): Promise<void> {
    const before = this.entries.get(path)
    if (!this.put(path, data, message)) throw new Error('You do not have permission to change this.')
    const ok = await this.flush()
    if (!ok && this.entries.get(path)?.dirty) {
      if (before) this.entries.set(path, before)
      else this.entries.delete(path)
      this.persist(path)
      this.notify()
      throw new Error(this.status.online ? (this.status.error ?? 'Could not save.') : 'No connection. Try again when you are online.')
    }
  }

  /**
   * Deletes a file from the repo (debounced like a write). Returns false (and
   * does nothing) when the access guard refuses it.
   */
  remove(path: string, message: string): boolean {
    const cur = this.entries.get(path)
    if (cur?.deleted) return true
    if (!canWrite(this.actor, path, cur?.data ?? null, null, this.lookup)) {
      console.warn(`Delete of ${path} refused for role "${this.actor.role}".`)
      return false
    }
    this.entries.set(path, { data: null, base: cur?.base ?? null, sha: cur?.sha, etag: cur?.etag, dirty: message, fresh: cur?.fresh, deleted: true })
    this.persist(path)
    this.notify()
    this.schedule(this.debounceMs)
    return true
  }

  private put(path: string, data: unknown, message: string): boolean {
    const cur = this.entries.get(path)
    if (!canWrite(this.actor, path, cur?.data ?? null, data, this.lookup)) {
      console.warn(`Write to ${path} refused for role "${this.actor.role}".`)
      return false
    }
    this.entries.set(path, { data, base: cur?.base ?? null, sha: cur?.sha, etag: cur?.etag, dirty: message, fresh: cur?.fresh })
    this.persist(path)
    this.notify()
    return true
  }

  /** What the write guard needs to know, read from the current data. */
  readonly lookup: Lookup = {
    teamAdmin: (id) => this.get<TeamsFile>(P.teams)?.teams.find((t) => t.id === id)?.adminId,
    person: (id) => this.get<PeopleFile>(P.people)?.people.find((p) => p.id === id),
    isStaff: (id) => this.get<AppConfig>(P.config)?.superAdminId === id || !!this.get<AdminsFile>(P.admins)?.admins.some((a) => a.personId === id),
  }

  private persist(path: string): void {
    const e = this.entries.get(path)
    const op = e ? this.kv.set(path, { data: e.data, base: e.base, sha: e.sha, etag: e.etag, dirty: e.dirty, deleted: e.deleted }) : this.kv.del(path)
    op.catch(() => {})
  }

  private dirtyPaths(): string[] {
    return [...this.entries.entries()]
      .filter(([, e]) => e.dirty)
      .map(([p]) => p)
      .sort((a, b) => priority(a) - priority(b))
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), ms)
  }

  /** Sends every unsent change now. Resolves false if anything is still unsent. */
  flush(): Promise<boolean> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.flushChain = this.flushChain.catch(() => true).then(() => this.doFlush())
    return this.flushChain
  }

  private async doFlush(): Promise<boolean> {
    const paths = this.dirtyPaths()
    if (paths.length === 0) return true
    this.flushing = true
    this.setStatus({ save: 'saving' })
    try {
      for (const path of paths) {
        if (!(await this.flushOne(path))) return false
      }
    } finally {
      this.flushing = false
    }
    this.setStatus({ save: 'saved', error: null, online: true })
    if (this.savedTimer) clearTimeout(this.savedTimer)
    this.savedTimer = setTimeout(() => {
      if (this.status.save === 'saved') this.setStatus({ save: 'idle' })
    }, 1500)
    return true
  }

  private async flushOne(path: string): Promise<boolean> {
    await this.reads.get(path)?.catch(() => {})
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const e = this.entries.get(path)
      if (!e?.dirty) return true
      if (e.deleted) {
        const done = await this.flushDelete(path, e)
        if (done === 'retry') continue
        return done
      }
      const sent = e.data
      try {
        const sha = await this.backend.write(path, sent, this.withActor(e.dirty), e.sha)
        const cur = this.entries.get(path)!
        // An edit made while the request was in flight keeps the file dirty.
        this.entries.set(path, { ...cur, base: sent, sha, etag: undefined, dirty: cur.data === sent ? undefined : cur.dirty, fresh: true })
        this.persist(path)
      } catch (err) {
        if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
          // Another device wrote first: re-read, merge, try again with the new sha.
          let res
          try {
            res = await this.backend.read(path)
          } catch (readErr) {
            return this.failFlush(readErr)
          }
          const cur = this.entries.get(path)!
          const remote = res.kind === 'ok' ? res.data : null
          this.entries.set(path, {
            ...cur,
            data: mergeFile(path, cur.base, cur.data, remote),
            base: remote,
            sha: res.kind === 'ok' ? res.sha : undefined,
            etag: res.kind === 'ok' ? res.etag : undefined,
          })
          this.persist(path)
          this.notify()
          continue
        }
        return this.failFlush(err)
      }
    }
    if (this.entries.get(path)?.dirty) {
      this.setStatus({ save: 'error', error: 'The file kept changing on another device. Will retry.' })
      this.schedule(RETRY_MS)
      return false
    }
    return true
  }

  /** Sends one delete. 'retry' = the sha was stale and has been refreshed. */
  private async flushDelete(path: string, e: Entry): Promise<boolean | 'retry'> {
    try {
      let sha = e.sha
      if (!sha) {
        // Never read on this phone: learn the sha first (or that there is nothing to delete).
        const res = await this.backend.read(path)
        sha = res.kind === 'ok' ? res.sha : undefined
      }
      if (sha) await this.backend.remove(path, this.withActor(e.dirty!), sha)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
        let res
        try {
          res = await this.backend.read(path)
        } catch (readErr) {
          return this.failFlush(readErr)
        }
        const cur = this.entries.get(path)!
        this.entries.set(path, { ...cur, sha: res.kind === 'ok' ? res.sha : undefined })
        return 'retry'
      }
      return this.failFlush(err)
    }
    // Only forget it if nothing new was written to the path meanwhile.
    if (this.entries.get(path)?.deleted) {
      this.entries.delete(path)
      this.persist(path)
    }
    return true
  }

  private failFlush(err: unknown): false {
    this.noteFailure(err)
    this.setStatus(err instanceof NetworkError ? { save: 'offline' } : { save: 'error', error: describeRepoError(err) })
    this.schedule(RETRY_MS)
    return false
  }

  private noteFailure(err: unknown): void {
    if (err instanceof NetworkError && this.status.online) this.setStatus({ online: false })
    if (err instanceof ApiError && err.status === 401 && !this.status.authFailed) this.setStatus({ authFailed: true })
  }

  private withActor(subject: string): string {
    return this.actor.personId ? `${subject}\n\nActor: ${this.actor.personId}${this.actor.viaId ? ` (by super admin ${this.actor.viaId})` : ''}` : subject
  }

  /** Called when the browser reports the connection is back. */
  onOnline(): void {
    if (this.dirtyPaths().length) void this.flush()
  }

  /** Forget everything cached for this repo (log out). */
  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.entries.clear()
    await this.kv.clear().catch(() => {})
    this.notify()
  }
}
