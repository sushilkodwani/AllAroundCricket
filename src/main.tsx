import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UpdatePrompt } from './components/UpdatePrompt.tsx'
import { AppProvider } from './state/AppContext.tsx'
import { ThemeProvider } from './state/ThemeContext.tsx'

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <AppProvider>
      <App />
      <UpdatePrompt />
    </AppProvider>
  </ThemeProvider>,
)

// Dev server only: ?seed-showcase fills this browser with the intro's showcase club (src/dev), logged in
// as a player; ?seed-showcase=super logs in as its super admin. Not in builds.
const seedAs = import.meta.env.DEV ? new URLSearchParams(location.search).get('seed-showcase') : null
if (import.meta.env.DEV && seedAs !== null) {
  void import('./dev/seedShowcase').then(async (m) => {
    const r = await m.seedShowcase({ as: seedAs === 'super' ? 'super' : 'player' })
    document.title = `seeded ${r.results.length}`
    location.replace(`${location.pathname}#/teams`)
  })
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // updateViaCache 'none': always compare sw.js with the server, never the HTTP
  // cache, so a new deploy is noticed on the next check.
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
    .then((reg) => {
      // An installed PWA can sit in the background for days; check for a new
      // version whenever it comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {})
      })
    })
    .catch(() => {})
}
