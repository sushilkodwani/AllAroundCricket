// Saver mode: when the club's GitHub allowance for the hour runs low, phones
// make fewer background requests so the scorer's saves keep getting through.
// A check that finds nothing changed is free, so what costs is downloading
// changed files (live scores) and writing (usage counts). Scoring itself is
// never slowed. It ends by itself when the hour's allowance resets.
import { useSyncExternalStore } from 'react'
import { currentRate, latestRate, subscribeRate, type Rate } from './usage'

export type SaverLevel = 'normal' | 'saver' | 'critical'

/** Below this share of the hour's allowance saver mode starts; below CRITICAL_SHARE it gets stronger. */
export const SAVER_SHARE = 0.1
export const CRITICAL_SHARE = 0.05

export function saverLevel(r: Rate | null = currentRate()): SaverLevel {
  if (!r || !r.limit) return 'normal'
  const share = r.remaining / r.limit
  return share < CRITICAL_SHARE ? 'critical' : share < SAVER_SHARE ? 'saver' : 'normal'
}

/** How often a live score refreshes itself for viewers. */
export const liveRefreshMs = (l: SaverLevel) => (l === 'normal' ? 20_000 : l === 'saver' ? 60_000 : 120_000)

/** How long after the last refresh coming back to the app checks again. */
export const resumeGapMs = (l: SaverLevel) => (l === 'normal' ? 30_000 : l === 'saver' ? 5 * 60_000 : 10 * 60_000)

/** Usage counts wait on the phone while the allowance is low. */
export const usageSyncAllowed = (l: SaverLevel) => l === 'normal'

export const everyText = (ms: number) => (ms < 60_000 ? `${ms / 1000} s` : ms === 60_000 ? 'minute' : `${ms / 60_000} minutes`)

/** The level now, re-rendering when the allowance changes (or the hour resets). */
export function useSaverLevel(): SaverLevel {
  const r = useSyncExternalStore(subscribeRate, latestRate, latestRate)
  return saverLevel(r && Date.now() >= r.resetAt ? null : r)
}
