import { useEffect } from 'react'
import { Screen, TabBar } from './components/Screen'
import { Empty } from './components/ui'
import { BootError, NoAccess, PinGate, Splash, TokenGate } from './screens/Gates'
import { Onboard } from './screens/Onboard'
import { Settings } from './screens/Settings'
import { Users } from './screens/Users'
import { useApp } from './state/AppContext'
import { navigate, useRoute } from './state/router'

function Placeholder({ title }: { title: string }) {
  return (
    <Screen title={title}>
      <Empty icon="🏏" title={title} text="This screen is built in a later step." />
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

  if (phase === 'boot') return <Splash />
  if (phase === 'error') return <BootError />
  if (phase === 'out') return <Onboard mode={a === 'setup' ? 'setup' : 'join'} />
  if (gate === 'token') return <TokenGate />
  if (gate === 'no_access') return <NoAccess />
  if (gate === 'locked') return <PinGate />
  if (home) return <Splash />

  let screen: React.ReactNode
  let tabs = true
  if (a === 'teams' && !b) screen = <Placeholder title="Teams" />
  else if (a === 'teams' && b && !c) screen = <Placeholder title="Team" />
  else if (a === 'teams' && b && c === 'matches' && d) {
    tabs = !e
    screen = <Placeholder title="Match" />
  } else if (a === 'matches') screen = <Placeholder title="Matches" />
  else if (a === 'funds') screen = <Placeholder title="Funds" />
  else if (a === 'settings' && b === 'users') screen = <Users />
  else if (a === 'settings' && b === 'categories') screen = <Placeholder title="Expense categories" />
  else if (a === 'settings') screen = <Settings />
  else screen = <Placeholder title="Not found" />

  return (
    <>
      {screen}
      {tabs && <TabBar />}
    </>
  )
}
