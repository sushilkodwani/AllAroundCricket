/* eslint-disable react-refresh/only-export-components */
// App state: the logged-in session, the data store, and what the current
// person is allowed to see. Screens read data through useApp()/useFile() and
// change it through the functions in lib/domain.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { checkSession, credentialOf, roleOf, type Role } from '../lib/access'
import { CORE_PATHS, createBackend, openStore } from '../lib/connect'
import { categoriesOf, configOf, credsOf, loadTeam, matchesOf, peopleOf, teamsOf } from '../lib/domain'
import { describeRepoError } from '../lib/github'
import { P } from '../lib/paths'
import { disablePush } from '../lib/push'
import { clearSession, forgetEverything, getPref, loadSession, saveSession, type Session } from '../lib/session'
import type { Store, StoreStatus } from '../lib/store'
import type { AppConfig, Credential, ExpenseCategory, FundEntry, FundsFile, Match, MatchesFile, MembersFile, Membership, Person, Team } from '../types'

export type Phase = 'boot' | 'out' | 'in' | 'error'
export type Gate = null | 'no_access' | 'token' | 'locked'

interface ToastState {
  id: number
  message: string
  undo?: () => void
}

interface AppState {
  phase: Phase
  gate: Gate
  bootError: string | null
  /** Shown on the onboarding screen, e.g. after an admin PIN reset. */
  notice: string | null
  store: Store | null
  session: Session | null
  status: StoreStatus
  config: AppConfig | null
  people: Person[]
  creds: Credential[]
  /** Every team in the repo. */
  allTeams: Team[]
  /** Teams this person may see: all for the admin, own active teams for a viewer. */
  teams: Team[]
  categories: ExpenseCategory[]
  me: Person | null
  role: Role
  isAdmin: boolean
  personName: (id: string) => string
  login: (store: Store, session: Session) => void
  logout: () => Promise<void>
  /** Keep repo + token, forget who is logged in. */
  switchNumber: () => void
  unlock: () => void
  replaceToken: (token: string) => Promise<void>
  refresh: () => Promise<void>
  retryBoot: () => void
  flushSaves: () => Promise<boolean>
  toast: (message: string, undo?: () => void) => void
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}

const IDLE: StoreStatus = { save: 'idle', online: true, authFailed: false, error: null, pending: 0 }
const UNLOCK_KEY = 'aac.unlocked'
const noSubscribe = () => () => {}

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('boot')
  const [store, setStore] = useState<Store | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(UNLOCK_KEY) === '1')
  const [toastState, setToastState] = useState<ToastState | null>(null)
  const [bootCount, setBootCount] = useState(0)

  // Re-render whenever the store's data or status changes.
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getVersion ?? (() => 0))

  // ---------- boot: restore the session, render from cache, refresh behind ----------
  useEffect(() => {
    let cancelled = false
    const saved = loadSession()
    if (!saved) {
      setPhase('out')
      return
    }
    setSession(saved)
    openStore(saved)
      .then(async (s) => {
        if (cancelled) return
        setStore(s)
        if (CORE_PATHS.every((p) => s.has(p))) {
          setPhase('in')
          void s.refreshAll(CORE_PATHS).catch(() => {})
          return
        }
        try {
          await s.refreshAll(CORE_PATHS)
          if (!cancelled) setPhase('in')
        } catch (e) {
          // Never wipe the login on a failed load — offer a retry instead.
          if (!cancelled) {
            setBootError(describeRepoError(e))
            setPhase('error')
          }
        }
      })
      .catch((e) => {
        if (cancelled) return
        setBootError((e as Error).message)
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [bootCount])

  // ---------- derived ----------
  const config = store ? configOf(store) : null
  const people = store ? peopleOf(store) : []
  const creds = store ? credsOf(store) : []
  const allTeams = store ? teamsOf(store) : []
  const categories = store ? categoriesOf(store) : []
  const role: Role = phase === 'in' && session ? roleOf(session.personId, config, people) : 'denied'
  const isAdmin = role === 'admin'
  const me = session ? (people.find((p) => p.id === session.personId) ?? null) : null

  // The store enforces view-only, so it must always know who is acting.
  if (store && phase === 'in' && session) {
    // A player the admin made scorer of a match may write that match's score (PLAN §31).
    const scorerMatchIds = role === 'viewer' && me ? me.teamIds.flatMap((id) => matchesOf(store, id)).filter((m) => m.scorerId === me.id).map((m) => m.id) : undefined
    store.actor = { role: role === 'denied' ? 'none' : role, personId: session.personId, scorerMatchIds }
  }

  const teams = useMemo(
    () => (isAdmin ? allTeams : allTeams.filter((t) => !t.archived && me?.teamIds.includes(t.id))),
    [allTeams, isAdmin, me],
  )

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const personName = useCallback((id: string) => names.get(id) ?? 'Unknown', [names])

  // ---------- session checks (PLAN §5.6) ----------
  const loaded = !!store && phase === 'in' && !!config && store.has(P.people) && store.has(P.creds)
  const check = loaded && session ? checkSession(session, config, people, creds) : 'ok'

  useEffect(() => {
    if (check !== 'pin_reset' || !store) return
    // Admin reset the PIN (or it was never set): end the login, keep repo + token.
    clearSession()
    setSession(null)
    setNotice('Your PIN was reset by the admin. Set a new PIN to continue.')
    setPhase('out')
  }, [check, store])

  const status = store?.status ?? IDLE
  const pinOnOpen = getPref('pinOnOpen', false)
  const gate: Gate =
    phase !== 'in' ? null : status.authFailed ? 'token' : check === 'no_access' ? 'no_access' : pinOnOpen && !unlocked && !!credentialOf(creds, session?.personId ?? '')?.pin ? 'locked' : null

  // ---------- lifecycle: refresh on resume, flush on hide, retry when online ----------
  const lastRefresh = useRef(0)
  const refresh = useCallback(async () => {
    if (!store) return
    lastRefresh.current = Date.now()
    await store.refreshAll().catch(() => {})
  }, [store])

  useEffect(() => {
    if (!store || phase !== 'in') return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 30_000) void refresh()
    }
    const onOnline = () => {
      store.onOnline()
      void refresh()
    }
    const onHide = () => void store.flush()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pagehide', onHide)
    }
  }, [store, phase, refresh])

  // ---------- actions ----------
  const login = useCallback((s: Store, next: Session) => {
    saveSession(next)
    sessionStorage.setItem(UNLOCK_KEY, '1')
    setUnlocked(true)
    setNotice(null)
    setStore(s)
    setSession(next)
    setPhase('in')
  }, [])

  const logout = useCallback(async () => {
    if (store) {
      // This phone stops receiving notifications for the person logging out.
      if (session) await disablePush(store, session.personId).catch(() => {})
      await store.flush().catch(() => false)
      await store.clear()
    }
    forgetEverything()
    sessionStorage.removeItem(UNLOCK_KEY)
    setStore(null)
    setSession(null)
    setNotice(null)
    setPhase('out')
  }, [store, session])

  const switchNumber = useCallback(() => {
    clearSession()
    setSession(null)
    setNotice(null)
    setPhase('out')
  }, [])

  const unlock = useCallback(() => {
    sessionStorage.setItem(UNLOCK_KEY, '1')
    setUnlocked(true)
  }, [])

  const replaceToken = useCallback(
    async (token: string) => {
      if (!store || !session) return
      const next = { ...session, token: token.trim() }
      const backend = createBackend(next)
      try {
        const { canPush } = await backend.checkRepo()
        if (!canPush) throw new Error('This token can read the repo but not write to it.')
      } catch (e) {
        throw new Error(describeRepoError(e))
      }
      saveSession(next)
      setSession(next)
      store.setBackend(backend)
      await store.refreshAll(CORE_PATHS).catch(() => {})
    },
    [store, session],
  )

  const toast = useCallback((message: string, undo?: () => void) => setToastState({ id: Date.now(), message, undo }), [])

  useEffect(() => {
    if (!toastState) return
    const t = setTimeout(() => setToastState(null), toastState.undo ? 5000 : 3000)
    return () => clearTimeout(t)
  }, [toastState])

  const value: AppState = {
    phase,
    gate,
    bootError,
    notice,
    store,
    session,
    status,
    config,
    people,
    creds,
    allTeams,
    teams,
    categories,
    me,
    role,
    isAdmin,
    personName,
    login,
    logout,
    switchNumber,
    unlock,
    replaceToken,
    refresh,
    retryBoot: () => {
      setBootError(null)
      setPhase('boot')
      setBootCount((n) => n + 1)
    },
    flushSaves: () => store?.flush() ?? Promise.resolve(true),
    toast,
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastState && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[57] flex justify-center px-4" role="status">
          <div className="sheet-in pointer-events-auto flex max-w-md items-center gap-4 rounded-xl bg-ink px-4 py-3 text-sm text-bg shadow-lg">
            <span>{toastState.message}</span>
            {toastState.undo && (
              <button
                className="font-semibold underline"
                onClick={() => {
                  toastState.undo?.()
                  setToastState(null)
                }}
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

// ---------- data hooks ----------
/** A data file from the store; loads it (cache first) the first time it's asked for. */
export function useFile<T>(path: string | null): T | null {
  const { store } = useApp()
  useEffect(() => {
    if (store && path) void store.load(path).catch(() => {})
  }, [store, path])
  return store && path ? store.get<T>(path) : null
}

export interface TeamData {
  team: Team | undefined
  members: Membership[]
  matches: Match[]
  funds: FundEntry[]
  /** False until all three team files are available (from cache or network). */
  ready: boolean
}

export function useTeam(teamId: string | null | undefined): TeamData {
  const { allTeams, store } = useApp()
  const id = teamId ?? null
  const members = useFile<MembersFile>(id ? P.members(id) : null)
  const matches = useFile<MatchesFile>(id ? P.matches(id) : null)
  const funds = useFile<FundsFile>(id ? P.funds(id) : null)
  const ready = !!id && !!store && [P.members(id), P.matches(id), P.funds(id)].every((p) => store.has(p))
  return {
    team: allTeams.find((t) => t.id === id),
    members: members?.members ?? [],
    matches: matches?.matches ?? [],
    funds: funds?.entries ?? [],
    ready,
  }
}

/** Loads the files of several teams in the background (home cards, Matches tab). */
export function useTeamsLoaded(teamIds: string[]): void {
  const { store } = useApp()
  const key = teamIds.join(',')
  useEffect(() => {
    if (!store) return
    for (const id of key.split(',').filter(Boolean)) void loadTeam(store, id).catch(() => {})
  }, [store, key])
}
