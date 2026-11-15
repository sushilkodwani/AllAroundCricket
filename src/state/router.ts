// Tiny hash router. Every screen and every open sheet is a URL, so Android's
// Back button and a reload both behave: Back closes a sheet or goes up a screen
// instead of closing the app.
import { useMemo, useSyncExternalStore } from 'react'

export interface Route {
  /** Everything after '#', e.g. "/teams/abc?tab=matches&sheet=add". */
  full: string
  path: string
  segs: string[]
  query: URLSearchParams
}

// How many in-app navigations deep we are; 0 means "Back would leave the app".
let depth = (window.history.state as { idx?: number } | null)?.idx ?? 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

window.addEventListener('popstate', () => {
  depth = (window.history.state as { idx?: number } | null)?.idx ?? 0
  emit()
})
window.addEventListener('hashchange', emit)

const currentHash = () => window.location.hash.slice(1) || '/'

export function parseRoute(full: string): Route {
  const [rawPath, rawQuery = ''] = full.split('?')
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  return { full, path, segs: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(rawQuery) }
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === currentHash()) return
  if (opts.replace) window.history.replaceState({ idx: depth }, '', `#${to}`)
  else window.history.pushState({ idx: ++depth }, '', `#${to}`)
  emit()
}

/** Go back one step; when there is no in-app history (deep link, reload) go to `fallback`. */
export function goBack(fallback: string): void {
  if (depth > 0) window.history.back()
  else navigate(fallback, { replace: true })
}

/** The same route with some query params changed (null removes one). */
export function withQuery(route: Route, patch: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams(route.query)
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) q.delete(k)
    else q.set(k, v)
  }
  const s = q.toString()
  return s ? `${route.path}?${s}` : route.path
}

export function useRoute(): Route {
  const full = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    currentHash,
  )
  return useMemo(() => parseRoute(full), [full])
}

/**
 * Sheets live in the URL (?sheet=name&arg=…): opening one pushes a history
 * entry, so Back closes it.
 */
export function useSheet() {
  const route = useRoute()
  return {
    name: route.query.get('sheet'),
    arg: route.query.get('arg'),
    open: (name: string, arg?: string) => navigate(withQuery(route, { sheet: name, arg: arg ?? null })),
    close: () => goBack(withQuery(route, { sheet: null, arg: null })),
    /** Close the sheet and land on another screen without leaving the sheet in history. */
    replaceWith: (to: string) => navigate(to, { replace: true }),
  }
}
