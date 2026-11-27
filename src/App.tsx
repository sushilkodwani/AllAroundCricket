import { useEffect, useState } from 'react'
import { NotifyPrompt } from './components/NotificationsCard'
import { Screen, TabBar } from './components/Screen'
import { Empty } from './components/ui'
import { Admins } from './screens/Admins'
import { CompleteMatch } from './screens/CompleteMatch'
import { ExpenseCategories } from './screens/ExpenseCategories'
import { Funds } from './screens/Funds'
import { BootError, Maintenance, NoAccess, PinGate, Splash, TokenGate } from './screens/Gates'
import { SplitExpenses } from './screens/SplitExpenses'
import { MatchDetail } from './screens/MatchDetail'
import { Matches } from './screens/Matches'
import { Onboard } from './screens/Onboard'
import { CoinToss } from './screens/CoinToss'
import { AiReportView } from './screens/AiReportView'
import { Grounds } from './screens/Grounds'
import { OpponentDetail, OpponentPlayerStats, OpponentScout } from './screens/OpponentDetail'
import { PublicScorecard } from './screens/PublicScorecard'
import { YearSummary } from './screens/YearSummary'
import { PlayerStats } from './screens/PlayerStats'
import { ScoreMatch } from './screens/ScoreMatch'
import { ScoreView } from './screens/ScoreView'
import { ScoringSetup } from './screens/ScoringSetup'
import { OpponentXiPicker } from './screens/OpponentXiPicker'
import { Settings } from './screens/Settings'
import { SquadPicker } from './screens/SquadPicker'
import { PlayerStatement } from './screens/PlayerStatement'
import { TeamDetail } from './screens/TeamDetail'
import { SeasonDetail, Seasons } from './screens/Seasons'
import { TournamentDetail, Tournaments } from './screens/Tournaments'
import { Teams } from './screens/Teams'
import { Users } from './screens/Users'
import { Keys } from './screens/Keys'
import { InstallGate, mustInstall } from './screens/InstallGate'
import { Intro } from './screens/Intro'
import { getPref, setPref } from './lib/session'
import { featureOf, track } from './lib/usage'
import { Usage } from './screens/Usage'
import { LowAllowanceBar } from './components/LowAllowanceBar'
import { useApp } from './state/AppContext'
import { navigate, useRoute } from './state/router'

function Placeholder({ title }: { title: string }) {
  return (
    <Screen title={title} back="/teams">
      <Empty icon="🤷" title={title} text="There is nothing at this address." />
    </Screen>
  )
}

/** Shown on every screen while the super admin acts as an admin. */
function MockBar() {
  const { mock, stopMock } = useApp()
  useEffect(() => {
    if (!mock) return
    document.documentElement.setAttribute('data-mock', '')
    return () => document.documentElement.removeAttribute('data-mock')
  }, [mock])
  if (!mock) return null
  return (
    <div className="mock-bar sticky top-0 z-50 flex items-center gap-2 bg-ink px-3 text-sm text-bg" role="status">
      <span aria-hidden="true">🎭</span>
      <span className="min-w-0 flex-1 truncate">
        Acting as <strong>{mock.name}</strong> (admin)
      </span>
      <button
        className="min-h-[32px] shrink-0 rounded-lg border border-bg/60 px-3 font-semibold"
        onClick={() => {
          stopMock()
          navigate('/settings/admins')
        }}
      >
        Stop
      </button>
    </div>
  )
}

/** Logged out: the app tour comes first, once per device, then Get started. */
function FirstRun({ mode }: { mode: 'join' | 'setup' }) {
  const [seen, setSeen] = useState(() => getPref('introSeen', false))
  if (mode === 'join' && !seen) {
    return (
      <Intro
        onDone={() => {
          setPref('introSeen', true)
          setSeen(true)
        }}
      />
    )
  }
  return <Onboard mode={mode} />
}

export default function App() {
  const { phase, gate } = useApp()
  const route = useRoute()
  const [a, b, c, d, e] = route.segs

  // Each screen starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.path])

  // Logged-in users never sit on an onboarding URL, and "/" means Teams.
  const home = phase === 'in' && (!a || a === 'onboard' || a === 'setup' || a === 'pin')
  useEffect(() => {
    if (home) navigate('/teams', { replace: true })
  }, [home])

  // Logged out: the URL says so too (and a stale deep link doesn't linger).
  // A public scorecard link (PLAN §44) opens for anyone, logged in or not.
  const publicCard = a === 's' && !!b
  const stray = phase === 'out' && a !== 'onboard' && a !== 'setup' && !publicCard
  useEffect(() => {
    if (stray) navigate('/onboard', { replace: true })
  }, [stray])

  // Usage counts: each screen (and tab) opened, once per visit.
  const feature = phase === 'in' && !gate ? featureOf(route.segs, route.query) : null
  const visit = feature ? `${route.path}|${feature}` : null
  useEffect(() => {
    if (visit && feature) track(feature)
  }, [visit, feature])

  // Tapping a notification while the app is open: the service worker posts the
  // route to show (a closed app is simply opened at that URL).
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const url = (ev.data as { type?: string; url?: string } | null)?.type === 'open' ? (ev.data as { url?: string }).url : null
      if (url && url.startsWith('#/')) navigate(url.slice(1))
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])

  if (publicCard) return <PublicScorecard code={b} />
  // Phones and tablets use the installed app only; the browser tab explains how to install it.
  if (mustInstall()) return <InstallGate />
  if (phase === 'boot') return <Splash />
  if (phase === 'error') return <BootError />
  if (phase === 'out') return <FirstRun mode={a === 'setup' ? 'setup' : 'join'} />
  if (gate === 'token') return <TokenGate />
  if (gate === 'no_access') return <NoAccess />
  if (gate === 'paused') return <Maintenance />
  if (gate === 'locked') return <PinGate />
  if (home) return <Splash />
  // The app tour again, from Settings.
  if (a === 'tour') return <Intro onDone={() => navigate('/settings', { replace: true })} />

  let screen: React.ReactNode
  let tabs = true
  if (a === 'teams' && !b) screen = <Teams />
  else if (a === 'teams' && b && !c) screen = <TeamDetail teamId={b} />
  else if (a === 'teams' && b && c === 'matches' && d) {
    // Squad picker, complete and split are full-screen flows with their own footer.
    tabs = !e
    if (!e) screen = <MatchDetail teamId={b} matchId={d} />
    else if (e === 'squad') screen = <SquadPicker teamId={b} matchId={d} />
    else if (e === 'opponent-xi') screen = <OpponentXiPicker teamId={b} matchId={d} />
    else if (e === 'complete') screen = <CompleteMatch teamId={b} matchId={d} />
    else if (e === 'expenses') screen = <SplitExpenses teamId={b} matchId={d} />
    else if (e === 'setup') screen = <ScoringSetup teamId={b} matchId={d} />
    else if (e === 'score') screen = <ScoreMatch teamId={b} matchId={d} />
    else if (e === 'live') screen = <ScoreView teamId={b} matchId={d} />
    else screen = <Placeholder title="Not found" />
  } else if (a === 'teams' && b && c === 'players' && d && !e) screen = <PlayerStats teamId={b} personId={d} />
  else if (a === 'opponents' && b && !c) screen = <OpponentDetail opponentId={b} />
  else if (a === 'opponents' && b && c === 'scout' && !d) screen = <OpponentScout opponentId={b} />
  else if (a === 'teams' && b && c === 'year' && !d) screen = <YearSummary teamId={b} />
  else if (a === 'teams' && b && c === 'categories' && !d) screen = <ExpenseCategories teamId={b} />
  else if (a === 'teams' && b && c === 'ai' && d && !e) screen = <AiReportView teamId={b} reportId={d} />
  else if (a === 'teams' && b && c === 'seasons' && !d) screen = <Seasons teamId={b} />
  else if (a === 'teams' && b && c === 'seasons' && d && !e) screen = <SeasonDetail teamId={b} seasonId={d} />
  else if (a === 'settings' && b === 'grounds') screen = <Grounds />
  else if (a === 'settings' && b === 'toss') screen = <CoinToss />
  else if (a === 'opponents' && b && c === 'players' && d && !e) screen = <OpponentPlayerStats opponentId={b} personId={d} />
  else if (a === 'tournaments' && !b) screen = <Tournaments />
  else if (a === 'tournaments' && b && !c) screen = <TournamentDetail tournamentId={b} />
  else if (a === 'teams' && b && c === 'statement' && d && !e) screen = <PlayerStatement teamId={b} personId={d} />
  else if (a === 'matches') screen = <Matches />
  else if (a === 'funds') screen = <Funds />
  else if (a === 'settings' && b === 'users') screen = <Users />
  else if (a === 'settings' && b === 'admins') screen = <Admins />
  else if (a === 'settings' && b === 'keys') screen = <Keys />
  else if (a === 'settings' && b === 'usage') screen = <Usage />
  else if (a === 'settings') screen = <Settings />
  else screen = <Placeholder title="Not found" />

  return (
    <>
      <MockBar />
      <LowAllowanceBar />
      {screen}
      {tabs && <TabBar />}
      <NotifyPrompt />
    </>
  )
}
