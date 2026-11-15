// In-memory stand-in for the GitHub Contents API with the same sha / ETag /
// conflict behaviour. Used by unit tests, and — on the dev server only — as a
// "demo" data repo kept in localStorage so every flow can be tried without a
// real repo or token.
import { ApiError, NetworkError, type Backend, type ReadResult } from './github'

interface FakeFile {
  text: string
  sha: string
}

export interface FakeBackend extends Backend {
  files: Map<string, FakeFile>
  /** Commit messages in order — lets tests assert on Actor trailers. */
  commits: { path: string; message: string }[]
  /** While true every call fails like a dropped connection. */
  offline: boolean
  /** Simulates another device writing straight to the repo. */
  remoteWrite(path: string, data: unknown): void
  json<T>(path: string): T | null
  counts: { read: number; notModified: number; write: number }
}

export function fakeBackend(persist?: { load(): Record<string, FakeFile> | null; save(files: Record<string, FakeFile>): void }): FakeBackend {
  let seq = 0
  const nextSha = () => `sha-${++seq}-${Math.random().toString(36).slice(2, 8)}`
  const files = new Map<string, FakeFile>(Object.entries(persist?.load() ?? {}))
  const save = () => persist?.save(Object.fromEntries(files))

  const backend: FakeBackend = {
    files,
    commits: [],
    offline: false,
    counts: { read: 0, notModified: 0, write: 0 },

    remoteWrite(path, data) {
      files.set(path, { text: JSON.stringify(data), sha: nextSha() })
      save()
    },

    json<T>(path: string) {
      const f = files.get(path)
      return f ? (JSON.parse(f.text) as T) : null
    },

    async checkRepo() {
      if (backend.offline) throw new NetworkError()
      return { canPush: true }
    },

    async read(path, etag): Promise<ReadResult> {
      if (backend.offline) throw new NetworkError()
      backend.counts.read++
      const f = files.get(path)
      if (!f) return { kind: 'missing' }
      if (etag && etag === `"${f.sha}"`) {
        backend.counts.notModified++
        return { kind: 'not_modified' }
      }
      return { kind: 'ok', data: JSON.parse(f.text), sha: f.sha, etag: `"${f.sha}"` }
    },

    async write(path, data, message, sha) {
      if (backend.offline) throw new NetworkError()
      const f = files.get(path)
      if (f && !sha) throw new ApiError(422, 'sha was not supplied')
      if (f && f.sha !== sha) throw new ApiError(409, 'sha does not match')
      if (!f && sha) throw new ApiError(409, 'file no longer exists')
      const next = { text: JSON.stringify(data), sha: nextSha() }
      files.set(path, next)
      backend.commits.push({ path, message })
      backend.counts.write++
      save()
      return next.sha
    },
  }
  return backend
}

/** Owner name that selects the built-in demo repo on the dev server. */
export const DEMO_OWNER = 'demo'

export function demoBackend(repo: string): FakeBackend {
  const key = `aac.demo.${repo}`
  return fakeBackend({
    load: () => {
      try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, FakeFile> | null
      } catch {
        return null
      }
    },
    save: (files) => localStorage.setItem(key, JSON.stringify(files)),
  })
}
