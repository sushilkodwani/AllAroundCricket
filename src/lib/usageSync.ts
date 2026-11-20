// Sends this phone's usage counts to the person's monthly usage file (see usage.ts).
import type { Store } from './store'
import { addToFile, byMonth, localDate, markSynced, returnPending, takePending, thisDevice, usagePath, type UsageFile } from './usage'

let running: Promise<boolean> | null = null

/** Adds the waiting counts to the repo. Resolves false (counts kept for next time) when it can't. */
export function syncUsage(store: Store, personId: string, deviceId: string): Promise<boolean> {
  running ??= doSync(store, personId, deviceId).finally(() => (running = null))
  return running
}

async function doSync(store: Store, personId: string, deviceId: string): Promise<boolean> {
  const days = takePending(personId)
  const groups = byMonth(days)
  const now = new Date().toISOString()
  const thisMonth = localDate().slice(0, 7)
  // This month's file is always touched, so it records this phone and when it last synced.
  const months = [...new Set([...Object.keys(groups), thisMonth])].sort()
  const left = { ...groups }
  try {
    for (const month of months) {
      const path = usagePath(month, personId)
      await store.refresh(path)
      const next = addToFile(store.get<UsageFile>(path), personId, groups[month] ?? {}, month === thisMonth ? thisDevice(deviceId, now) : null, now)
      if (!store.write(path, next, 'Usage counts')) throw new Error('not allowed')
      // From here the store owns these counts (it keeps retrying until they are saved).
      delete left[month]
    }
  } catch {
    returnPending(personId, Object.assign({}, ...Object.values(left)))
    return false
  }
  markSynced(personId, now)
  return true
}
