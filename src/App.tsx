import { useEffect } from 'react'
import { NotifyPrompt } from './components/NotificationsCard'
import { Screen, TabBar } from './components/Screen'
import { Empty } from './components/ui'
import { CompleteMatch } from './screens/CompleteMatch'
import { ExpenseCategories } from './screens/ExpenseCategories'
import { Funds } from './screens/Funds'
import { BootError, NoAccess, PinGate, Splash, TokenGate } from './screens/Gates'
import { SplitExpenses } from './screens/SplitExpenses'
import { MatchDetail } from './screens/MatchDetail'
import { Matches } from './screens/Matches'
import { Onboard } from './screens/Onboard'
import { ScoreMatch } from './screens/ScoreMatch'
import { ScoreView } from './screens/ScoreView'
import { ScoringSetup } from './screens/ScoringSetup'
import { Settings } from './screens/Settings'
import { SquadPicker } from './screens/SquadPicker'
import { TeamDetail } from './screens/TeamDetail'
import { Teams } from './screens/Teams'
import { Users } from './screens/Users'
import { useApp } from './state/AppContext'
import { navigate, useRoute } from './state/router'

function Placeholder({ title }: { title: string }) {
  return (
    <Screen title={title} back="/teams">
      <Empty icon="🤷" title={title} text="There is nothing at this address." />
    </Screen>
  )
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
  const stray = phase === 'out' && a !== 'onboard' && a !== 'setup'
  useEffect(() => {
    if (stray) navigate('/onboard', { replace: true })
  }, [stray])

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

  if (phase === 'boot') return <Splash />
  if (phase === 'error') return <BootError />
  if (phase === 'out') return <Onboard mode={a === 'setup' ? 'setup' : 'join'} />
  if (gate === 'token') return <TokenGate />
  if (gate === 'no_access') return <NoAccess />
  if (gate === 'locked') return <PinGate />
  if (home) return <Splash />

  let screen: React.ReactNode
  let tabs = true
  if (a === 'teams' && !b) screen = <Teams />
  else if (a === 'teams' && b && !c) screen = <TeamDetail teamId={b} />
  else if (a === 'teams' && b && c === 'matches' && d) {
    // Squad picker, complete and split are full-screen flows with their own footer.
    tabs = !e
    if (!e) screen = <MatchDetail teamId={b} matchId={d} />
    else if (e === 'squad') screen = <SquadPicker teamId={b} matchId={d} />
    else if (e === 'complete') screen = <CompleteMatch teamId={b} matchId={d} />
    else if (e === 'expenses') screen = <SplitExpenses teamId={b} matchId={d} />
    else if (e === 'setup') screen = <ScoringSetup teamId={b} matchId={d} />
    else if (e === 'score') screen = <ScoreMatch teamId={b} matchId={d} />
    else if (e === 'live') screen = <ScoreView teamId={b} matchId={d} />
    else screen = <Placeholder title="Not found" />
  } else if (a === 'matches') screen = <Matches />
  else if (a === 'funds') screen = <Funds />
  else if (a === 'settings' && b === 'users') screen = <Users />
  else if (a === 'settings' && b === 'categories') screen = <ExpenseCategories />
  else if (a === 'settings') screen = <Settings />
  else screen = <Placeholder title="Not found" />

  return (
    <>
      {screen}
      {tabs && <TabBar />}
      <NotifyPrompt />
    </>
  )
}
