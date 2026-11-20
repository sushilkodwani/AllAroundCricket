/* eslint-disable react-refresh/only-export-components */
// App state: the logged-in session, the data store, and what the current
// person is allowed to see. Screens read data through useApp()/useFile() and
// change it through the functions in lib/domain.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { checkSession, credentialOf, isAdminRole, roleOf, type Role } from '../lib/access'
import { CORE_PATHS, createBackend, deviceHashOf, forgetDevice, isOldData, OLD_DATA, openStore } from '../lib/connect'
import { adminsOf, configOf, credsOf, loadTeam, matchesOf, peopleOf, teamsOf } from '../lib/domain'
import { describeRepoError, withKeyPrefix } from '../lib/github'
import { P } from '../lib/paths'
import { KEY_NOT_YOURS, keyFits, openPersonalKey } from '../lib/personalKey'
import { disablePush } from '../lib/push'
import { clearSession, forgetEverything, getPref, loadSession, saveSession, type Session } from '../lib/session'
import type { Store, StoreStatus } from '../lib/store'
import type { AdminRecord, AppConfig, Credential, FundEntry, FundsFile, Match, MatchesFile, MembersFile, Membership, Person, Team } from '../types'

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
  /** Who the app is showing: while the super admin acts as an admin, that admin. */
  session: Session | null
  /** The person really logged in on this phone (never the admin being acted as). */
  realSession: Session | null
  /** The admin the super admin is acting as, or null. */
  mock: Person | null
  startMock: (personId: string) => void
  stopMock: () => void
  status: StoreStatus
  config: AppConfig | null
  admins: AdminRecord[]
  people: Person[]
  creds: Credential[]
  /** Every team in the repo. */
  allTeams: Team[]
  /** Teams anyone may look at: every active team, plus archived ones this person runs (all of them for the super admin). */
  teams: Team[]
  /** Teams this person plays in or runs — the Matches and Funds tabs. */
  myTeams: Team[]
  me: Person | null
  role: Role
  /** The app owner. */
  isSuper: boolean
  /** Super admin or admin: may create teams, opponents, grounds and tournaments. */
  isAdmin: boolean
  /** Runs this team (only its own admin changes a team). */
  canManage: (teamId: string | undefined) => boolean
  /** Funds and expenses of a team: its players, its admin and the super admin. */
  canSeeMoney: (teamId: string | undefined) => boolean
  personName: (id: string) => string
  login: (store: Store, session: Session) => void
  logout: () => Promise<void>
  /** Keep repo + token, forget who is logged in. */
  switchNumber: () => void
  unlock: () => void
  /** A personal key needs the person's own number; the super admin may also use the plain key. */
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
  /** Super admin only, kept in memory: the admin being acted as. A reload ends it. */
  const [mockId, setMockId] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(UNLOCK_KEY) === '1')
  const [toastState, setToastState] = useState<ToastState | null>(null)
  const [bootCount, setBootCount] = useState(0)
  /** Hash of this phone's login secret, compared with the credentials file. */
  const [deviceHash, setDeviceHash] = useState('')

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
    Promise.all([openStore(saved), deviceHashOf(saved.deviceSecret)])
      .then(async ([s, hash]) => {
        if (cancelled) return
        setDeviceHash(hash)
        setStore(s)
        if (CORE_PATHS.every((p) => s.has(p)) && !isOldData(configOf(s))) {
          setPhase('in')
          void s.refreshAll(CORE_PATHS).catch(() => {})
          return
        }
        try {
          await s.refreshAll(CORE_PATHS)
          if (isOldData(configOf(s))) throw new Error(OLD_DATA)
          if (!cancelled) setPhase('in')
        } catch (e) {
          // Never wipe the login on a failed load — offer a retry instead.
          if (!cancelled) {
            setBootError((e as Error).message === OLD_DATA ? OLD_DATA : describeRepoError(e))
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
  const admins = store ? adminsOf(store) : []
  const people = store ? peopleOf(store) : []
  const creds = store ? credsOf(store) : []
  const allTeams = store ? teamsOf(store) : []
  const realRole: Role = phase === 'in' && session ? roleOf(session.personId, config, people, admins) : 'denied'
  // Acting as someone is for the super admin only, and only as an active admin.
  const actingId = mockId && realRole === 'super' && roleOf(mockId, config, people, admins) === 'admin' ? mockId : undefined
  const effectiveId = actingId ?? session?.personId
  const role: Role = phase === 'in' && session ? roleOf(effectiveId, config, people, admins) : 'denied'
  const viewSession = useMemo(() => (session && actingId ? { ...session, personId: actingId } : session), [session, actingId])
  const isSuper = role === 'super'
  const isAdmin = isAdminRole(role)
  const me = effectiveId ? (people.find((p) => p.id === effectiveId) ?? null) : null
  const myId = me?.id

  // The store enforces who may change what, so it must always know who is acting.
  if (store && phase === 'in' && session) {
    // A player an admin made scorer of a match may write that match's score (PLAN §31).
    const scorerMatchIds = me ? me.teamIds.flatMap((id) => matchesOf(store, id)).filter((m) => m.scorerId === me.id).map((m) => m.id) : undefined
    store.actor = { role: role === 'denied' ? 'none' : role, personId: effectiveId, viaId: actingId ? session.personId : undefined, scorerMatchIds }
  }

  const canManage = useCallback((teamId: string | undefined) => isAdmin && !!myId && allTeams.some((t) => t.id === teamId && t.adminId === myId), [isAdmin, myId, allTeams])
  const canSeeMoney = useCallback(
    (teamId: string | undefined) => !!teamId && (isSuper || canManage(teamId) || !!me?.teamIds.includes(teamId) || !!me?.guestOfTeamIds?.includes(teamId)),
    [isSuper, canManage, me],
  )

  const teams = useMemo(() => allTeams.filter((t) => !t.archived || isSuper || (isAdmin && t.adminId === myId)), [allTeams, isSuper, isAdmin, myId])
  const myTeams = useMemo(() => teams.filter((t) => t.adminId === myId || me?.teamIds.includes(t.id)), [teams, myId, me])

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const personName = useCallback((id: string) => names.get(id) ?? 'Unknown', [names])

  // The admin was suspended or removed while being acted as: back to being the super admin.
  useEffect(() => {
    if (mockId && phase === 'in' && !actingId && realRole !== 'denied') setMockId(null)
  }, [mockId, actingId, phase, realRole])

  // ---------- session checks (PLAN §5.6) ----------
  const loaded = !!store && phase === 'in' && !!config && store.has(P.people) && store.has(P.creds)
  const check = loaded && session && deviceHash ? checkSession(session, deviceHash, config, people, creds, admins) : 'ok'

  useEffect(() => {
    if ((check !== 'pin_reset' && check !== 'signed_out') || !store) return
    // PIN reset by an admin, or this phone is no longer one of the person's logged-in phones:
    // end the login, keep repo + token.
    clearSession()
    setSession(null)
    setNotice(check === 'pin_reset' ? 'Your PIN was reset by your admin. Set a new PIN to continue.' : 'This phone was logged out. Enter your PIN to continue.')
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
    setMockId(null)
    // This phone's key was just written for this login; the check starts once its hash is known.
    setDeviceHash('')
    void deviceHashOf(next.deviceSecret).then(setDeviceHash)
    setStore(s)
    setSession(next)
    setPhase('in')
  }, [])

  const logout = useCallback(async () => {
    if (store) {
      // This phone stops receiving notifications for the person logging out, and its login key stops working.
      if (session) await disablePush(store, session.personId).catch(() => {})
      if (session) await forgetDevice(store, session.personId, session.deviceId).catch(() => {})
      await store.flush().catch(() => false)
      await store.clear()
    }
    forgetEverything()
    sessionStorage.removeItem(UNLOCK_KEY)
    setMockId(null)
    setStore(null)
    setSession(null)
    setNotice(null)
    setPhase('out')
  }, [store, session])

  const switchNumber = useCallback(() => {
    setMockId(null)
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
    async (input: string) => {
      if (!store || !session) return
      let token: string
      let personalKey: string | undefined
      // The person is known here, so their key is checked against their own stored number.
      const mine = people.find((x) => x.id === session.personId)
      const opened = await openPersonalKey(input)
      if (opened && (await keyFits(opened, mine?.phoneHash))) {
        token = opened.token
        personalKey = opened.personalKey
      } else if (realRole === 'super') {
        token = withKeyPrefix(input)
      } else {
        throw new Error('This key isn’t yours. Ask the super admin for your new personal key.')
      }
      const next = { ...session, token, personalKey }
      const backend = createBackend(next)
      try {
        const { canPush } = await backend.checkRepo()
        if (!canPush) throw new Error('This access key can look but not save changes.')
      } catch (e) {
        throw new Error(describeRepoError(e))
      }
      saveSession(next)
      setSession(next)
      store.setBackend(backend)
      await store.refreshAll(CORE_PATHS).catch(() => {})
    },
    [store, session, people, realRole],
  )

  const startMock = useCallback((personId: string) => setMockId(personId), [])
  const stopMock = useCallback(() => setMockId(null), [])

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
    session: viewSession,
    realSession: session,
    mock: actingId ? me : null,
    startMock,
    stopMock,
    status,
    config,
    admins,
    people,
    creds,
    allTeams,
    teams,
    myTeams,
    me,
    role,
    isSuper,
    isAdmin,
    canManage,
    canSeeMoney,
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
