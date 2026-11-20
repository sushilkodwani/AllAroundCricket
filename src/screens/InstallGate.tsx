// On a phone or tablet the app only runs once it is installed (opened from the Home Screen).
// In the browser this screen explains how to install it, with step-by-step pictures. Computers and
// public scorecard links are not affected.
import { useEffect, useState, type ReactNode } from 'react'
import { DevelopedBy } from '../components/DevelopedBy'
import { isIOS, isStandalone } from '../components/InstallBanner'

const DEV_BYPASS = 'aac.devBrowser'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Android Chrome offers its install dialog once, early: keep it for the Install button.
let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((f) => f())
  })
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent)
}

/** Phones and tablets in a browser tab must install first. */
export function mustInstall(): boolean {
  if (isStandalone()) return false
  if (!(isIOS() || isAndroid())) return false
  if (import.meta.env.DEV && sessionStorage.getItem(DEV_BYPASS) === '1') return false
  return true
}

/** Opened inside another app (WhatsApp, Instagram…), where installing isn't possible. */
function inAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/i.test(navigator.userAgent)
}

export function InstallGate() {
  const ios = isIOS()
  const android = isAndroid()
  const [canPrompt, setCanPrompt] = useState(!!deferred)
  const [installed, setInstalled] = useState(false)
  const [open, setOpen] = useState<string | null>(ios ? 'iphone' : android ? 'android' : null)

  useEffect(() => {
    const on = () => setCanPrompt(!!deferred)
    listeners.add(on)
    const done = () => setInstalled(true)
    window.addEventListener('appinstalled', done)
    return () => {
      listeners.delete(on)
      window.removeEventListener('appinstalled', done)
    }
  }, [])

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    setCanPrompt(false)
    if (outcome === 'accepted') setInstalled(true)
  }

  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))

  return (
    <div className="mx-auto flex min-h-app max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center pb-5 pt-10 text-center">
        <img src="./icon.svg" alt="" className="h-20 w-20 rounded-[22%]" />
        <h1 className="mt-3 text-2xl font-bold">All Around Cricket</h1>
        <p className="mt-2 text-sm text-muted">This app works only once it’s installed on your phone. It takes a few seconds, then open it from your Home Screen to log in.</p>
      </div>

      {installed ? (
        <div className="rounded-xl bg-ok/15 px-4 py-3 text-sm text-ok" role="status">
          <strong>Installed.</strong> Close this browser tab and open <strong>All Around Cricket</strong> from your Home Screen.
        </div>
      ) : (
        canPrompt && (
          <button className="btn-primary mb-4 w-full" onClick={() => void install()}>
            Install app
          </button>
        )
      )}

      {inAppBrowser() && (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <p className="font-semibold text-warn">Opened inside another app?</p>
          <p className="mt-1">Installing isn’t possible here. Tap the ⋯ or ⋮ menu and choose <strong>Open in {ios ? 'Safari' : 'Chrome'}</strong> (or “Open in browser”), then follow the steps below.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Section id="iphone" title="iPhone or iPad" open={open === 'iphone'} onToggle={toggle}>
          <p className="text-sm text-muted">Use Safari. In Chrome on iPhone the Share button is at the top right; the steps are the same.</p>
          <Step n={1} text={<>Tap the <strong>Share</strong> button at the bottom of Safari.</>}>
            <IosShareBar />
          </Step>
          <Step n={2} text={<>Scroll down and tap <strong>Add to Home Screen</strong>.</>}>
            <IosShareSheet />
          </Step>
          <Step n={3} text={<>Tap <strong>Add</strong> at the top right.</>}>
            <IosAddDialog />
          </Step>
          <Step n={4} text={<>Open <strong>All Around Cricket</strong> from your Home Screen and log in there.</>}>
            <HomeScreen />
          </Step>
          <p className="text-xs text-muted">The Home Screen app keeps its own login, separate from Safari, so log in inside the app.</p>
        </Section>

        <Section id="android" title="Android" open={open === 'android'} onToggle={toggle}>
          <p className="text-sm text-muted">Use Chrome. {canPrompt ? 'The Install app button above does steps 1–3 for you.' : ''}</p>
          <Step n={1} text={<>Tap the <strong>⋮</strong> menu at the top right of Chrome.</>}>
            <AndroidBar />
          </Step>
          <Step n={2} text={<>Tap <strong>Install app</strong> (on some phones it says <strong>Add to Home screen</strong>).</>}>
            <AndroidMenu />
          </Step>
          <Step n={3} text={<>Tap <strong>Install</strong>.</>}>
            <AndroidDialog />
          </Step>
          <Step n={4} text={<>Open <strong>All Around Cricket</strong> from your Home Screen or app list and log in there.</>}>
            <HomeScreen />
          </Step>
        </Section>
      </div>

      {import.meta.env.DEV && (
        <button
          className="mt-6 text-sm font-medium text-accent"
          onClick={() => {
            sessionStorage.setItem(DEV_BYPASS, '1')
            location.reload()
          }}
        >
          Continue in the browser (dev server only)
        </button>
      )}

      <DevelopedBy className="mt-auto pt-8" />
    </div>
  )
}

function Section({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <button className="row font-semibold active:bg-alt" aria-expanded={open} onClick={() => onToggle(id)}>
        <span className="flex-1">{title}</span>
        <span className="text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="flex flex-col gap-4 border-t border-line px-4 py-4">{children}</div>}
    </section>
  )
}

function Step({ n, text, children }: { n: number; text: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex gap-2 text-sm">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-on-brand">{n}</span>
        <span className="pt-0.5">{text}</span>
      </p>
      <div className="mx-auto w-full max-w-[260px]">{children}</div>
    </div>
  )
}

// ---------- step pictures (drawn, not photos; they follow the light/dark theme) ----------
const C = {
  frame: 'rgb(var(--border))',
  screen: 'rgb(var(--surface))',
  alt: 'rgb(var(--surface-alt))',
  ink: 'rgb(var(--text))',
  muted: 'rgb(var(--text-muted))',
  brand: 'rgb(var(--brand))',
}

/** A phone-shaped crop: the part of the screen a step is about. */
function Pic({ label, h = 120, children }: { label: string; h?: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 240 ${h}`} role="img" aria-label={label} className="block w-full">
      <rect x="1" y="1" width="238" height={h - 2} rx="16" fill={C.screen} stroke={C.frame} strokeWidth="2" />
      {children}
    </svg>
  )
}

/** The ring that points at what to tap. */
const Tap = ({ x, y, r = 16 }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} fill="none" stroke={C.brand} strokeWidth="3" />

const T = ({ x, y, children, size = 11, bold, fill = C.ink, anchor = 'start' }: { x: number; y: number; children: ReactNode; size?: number; bold?: boolean; fill?: string; anchor?: 'start' | 'middle' | 'end' }) => (
  <text x={x} y={y} fontSize={size} fontWeight={bold ? 700 : 400} fill={fill} textAnchor={anchor} fontFamily="system-ui, sans-serif">
    {children}
  </text>
)

function ShareIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 8} ${y - 10})`} fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1v12M4 5l4-4 4 4" />
      <path d="M3 9H1v10h14V9h-2" />
    </g>
  )
}

function IosShareBar() {
  return (
    <Pic label="Safari's bottom bar with the Share button circled" h={110}>
      <rect x="14" y="16" width="212" height="26" rx="8" fill={C.alt} />
      <T x={120} y={33} anchor="middle" fill={C.muted}>
        cricket.kiasoftinnovations.com
      </T>
      <line x1="2" y1="62" x2="238" y2="62" stroke={C.frame} />
      {['‹', '›'].map((g, i) => (
        <T key={g} x={30 + i * 44} y={92} size={22} fill="#2a78d6" anchor="middle">
          {g}
        </T>
      ))}
      <ShareIcon x={120} y={86} />
      <rect x="162" y="76" width="14" height="14" rx="2" fill="none" stroke="#2a78d6" strokeWidth="2" />
      <rect x="198" y="74" width="16" height="16" rx="3" fill="none" stroke="#2a78d6" strokeWidth="2" />
      <Tap x={120} y={84} r={18} />
    </Pic>
  )
}

function IosShareSheet() {
  const rows = ['Copy', 'Add to Reading List', 'Add Bookmark', 'Add to Home Screen']
  return (
    <Pic label="The Share sheet with Add to Home Screen circled" h={170}>
      {rows.map((r, i) => (
        <g key={r}>
          <rect x="16" y={16 + i * 36} width="208" height="30" rx="8" fill={C.alt} />
          <T x={28} y={35 + i * 36} bold={i === 3}>
            {r}
          </T>
          {i === 3 && <rect x="196" y={23 + i * 36} width="16" height="16" rx="4" fill="none" stroke={C.ink} strokeWidth="1.6" />}
          {i === 3 && <T x={204} y={36 + i * 36} anchor="middle" bold>+</T>}
        </g>
      ))}
      <rect x="10" y={16 + 3 * 36 - 4} width="220" height="38" rx="10" fill="none" stroke={C.brand} strokeWidth="3" />
    </Pic>
  )
}

function IosAddDialog() {
  return (
    <Pic label="The Add to Home Screen page with the Add button circled" h={120}>
      <T x={20} y={30} fill="#2a78d6">
        Cancel
      </T>
      <T x={120} y={30} anchor="middle" bold>
        Add to Home Screen
      </T>
      <T x={218} y={30} anchor="end" bold fill="#2a78d6">
        Add
      </T>
      <Tap x={206} y={26} r={17} />
      <rect x="20" y="52" width="200" height="50" rx="10" fill={C.alt} />
      <image href="./icon.svg" x="30" y="60" width="34" height="34" />
      <T x={76} y={82}>
        All Around Cricket
      </T>
    </Pic>
  )
}

function AndroidBar() {
  return (
    <Pic label="Chrome's top bar with the menu button circled" h={80}>
      <rect x="14" y="24" width="180" height="30" rx="15" fill={C.alt} />
      <T x={30} y={44} fill={C.muted}>
        cricket.kiasoftinnovations.com
      </T>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="214" cy={30 + i * 9} r="2.6" fill={C.ink} />
      ))}
      <Tap x={214} y={39} r={16} />
    </Pic>
  )
}

function AndroidMenu() {
  const rows = ['New tab', 'History', 'Downloads', 'Install app', 'Settings']
  return (
    <Pic label="Chrome's menu with Install app circled" h={200}>
      {rows.map((r, i) => (
        <T key={r} x={30} y={34 + i * 36} bold={i === 3}>
          {r}
        </T>
      ))}
      <rect x="14" y={34 + 3 * 36 - 22} width="212" height="34" rx="10" fill="none" stroke={C.brand} strokeWidth="3" />
    </Pic>
  )
}

function AndroidDialog() {
  return (
    <Pic label="The install dialog with the Install button circled" h={130}>
      <T x={24} y={34} bold size={13}>
        Install app?
      </T>
      <image href="./icon.svg" x="24" y="48" width="30" height="30" />
      <T x={64} y={68}>
        All Around Cricket
      </T>
      <T x={150} y={110} fill="#2a78d6" anchor="middle">
        Cancel
      </T>
      <T x={204} y={110} fill="#2a78d6" anchor="middle" bold>
        Install
      </T>
      <Tap x={204} y={106} r={20} />
    </Pic>
  )
}

function HomeScreen() {
  return (
    <Pic label="The Home Screen with the All Around Cricket icon circled" h={130}>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={28 + i * 50} y="22" width="36" height="36" rx="9" fill={C.alt} />
      ))}
      {[0, 2, 3].map((i) => (
        <rect key={i} x={28 + i * 50} y="76" width="36" height="36" rx="9" fill={C.alt} />
      ))}
      <image href="./icon.svg" x="78" y="76" width="36" height="36" />
      <Tap x={96} y={94} r={24} />
    </Pic>
  )
}
