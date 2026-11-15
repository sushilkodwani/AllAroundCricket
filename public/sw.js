// Service worker: app-shell caching, update handling and push notifications.
//
// Caching strategy
// - Page loads (navigations, i.e. index.html): NETWORK FIRST. A new deploy is
//   picked up on the next launch; the cached copy is used only when offline or
//   when the network is too slow to answer in time.
// - Built assets under /assets/ have content hashes in their file names, so a
//   given URL never changes: CACHE FIRST is safe and fast.
// - Everything else same-origin (icons, manifest): stale-while-revalidate.
// - sw.js and version.json are never cached — caching either hides a new deploy.
// - Cross-origin requests (api.github.com) are never touched: data is always live.
//
// Bump VERSION to force every installed copy to drop its old caches.
const VERSION = 'v1'
const SHELL_CACHE = `aac-shell-${VERSION}`
const ASSET_CACHE = `aac-assets-${VERSION}`
const NAV_TIMEOUT_MS = 4000

self.addEventListener('install', () => {
  // Take over as soon as installed. Safe because page loads are network first:
  // the next launch always gets the HTML that matches the new assets.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE])
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE)
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone())
    return res
  })
  network.catch(() => {}) // avoid an unhandled rejection when the timeout wins
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS))
  try {
    const res = await Promise.race([network, timeout])
    if (res) return res
  } catch {
    // offline — fall through to the cache
  }
  const cached = (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./', { ignoreSearch: true }))
  return cached || network // nothing cached yet: wait for the network after all
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone())
      return res
    })
    .catch(() => cached)
  return cached || network
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/version.json')) return

  if (request.mode === 'navigate') event.respondWith(networkFirstPage(request))
  else if (url.pathname.includes('/assets/')) event.respondWith(cacheFirstAsset(request))
  else event.respondWith(staleWhileRevalidate(request))
})

// ---------- push notifications (PLAN §22.7) ----------
// Payload sent by the notifier Action in the data repo:
// { title, body, tag?, url? }   url = in-app route, e.g. "#/teams/<id>/matches/<id>"

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'AllAroundCricket', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './badge-72.png',
      tag: data.tag || undefined, // same tag replaces an older notification
      data: { url: data.url || '' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const route = (event.notification.data && event.notification.data.url) || ''
  const target = new URL(`./${route}`, self.registration.scope).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (existing) {
        existing.postMessage({ type: 'open', url: route })
        return existing.focus()
      }
      return self.clients.openWindow(target)
    })(),
  )
})

// If the browser rotates the subscription, the app re-saves it on next launch
// (see ensureSubscriptionSaved in src/lib/push.ts).
