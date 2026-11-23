// Settings → Usage (super admin only): the shared hourly GitHub allowance, and how the app is used —
// by whom, which features, on which phones. Counts come from each phone once a day (lib/usage.ts).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { BarList, ChartCard } from '../components/charts'
import { RoleTag } from '../components/Profile'
import { Screen } from '../components/Screen'
import { Avatar, Confirm, Empty, Pill, Segmented, Toggle } from '../components/ui'
import { pauseApp, resumeApp } from '../lib/domain'
import { roleOf } from '../lib/access'
import { fmtDate, fmtDayMonth, fmtTime } from '../lib/dates'
import { currentRate, FEATURES, featureLabel, isLow, latestRate, localDate, pendingOf, subscribeRate, usagePath, type FeatureGroup, type Rate, type UsageFile } from '../lib/usage'
import { SAVER_SHARE, everyText, liveRefreshMs, resumeGapMs, saverLevel } from '../lib/saver'
import { buildReport, daysInMonth, recentMonths, type FeatureUsage, type PersonUsage } from '../lib/usageReport'
import { APP_VERSION } from '../lib/version'
import { useApp } from '../state/AppContext'

const num = (n: number) => n.toLocaleString('en-IN')
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
const hourLabel = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`)
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

function ago(iso: string | null, now: number): string {
  if (!iso) return 'never'
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** Ticks every 30 s, for "resets in" and "synced … ago". */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function useRate(): Rate | null {
  const raw = useSyncExternalStore(subscribeRate, latestRate)
  const now = useNow()
  return raw ? currentRate(now) : null
}

// ---------- the allowance ----------
function AllowanceCard() {
  const { store } = useApp()
  const rate = useRate()
  const now = useNow()
  const [checking, setChecking] = useState(false)

  const check = () => {
    if (!store) return
    setChecking(true)
    void store.rateLimit().finally(() => setChecking(false))
  }
  useEffect(() => {
    if (!store) return
    void store.rateLimit()
    const t = setInterval(() => void store.rateLimit(), 60_000)
    return () => clearInterval(t)
  }, [store])

  if (!rate) {
    return (
      <section className="card p-4">
        <h3 className="font-semibold">GitHub requests this hour</h3>
        <p className="mt-1 text-sm text-muted">Not known yet. It appears after the app’s next request.</p>
        <button className="btn-secondary mt-3" onClick={check} disabled={checking}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </section>
    )
  }
  const used = rate.limit - rate.remaining
  const share = rate.remaining / rate.limit
  const tone = isLow(rate) ? 'bg-bad' : share < 0.25 ? 'bg-warn' : 'bg-ok'
  const mins = Math.max(0, Math.ceil((rate.resetAt - now) / 60_000))
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">GitHub requests this hour</h3>
          <p className="text-sm text-muted">Shared by everyone using the app.</p>
        </div>
        <button className="btn-ghost min-h-[36px] text-sm" onClick={check} disabled={checking}>
          {checking ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      <p className="mt-3">
        <span className="text-3xl font-bold">{num(rate.remaining)}</span>
        <span className="text-muted"> left of {num(rate.limit)}</span>
      </p>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-alt" role="meter" aria-valuemin={0} aria-valuemax={rate.limit} aria-valuenow={rate.remaining} aria-label="Requests left this hour">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(share * 100, rate.remaining ? 1 : 0)}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {num(used)} used · starts afresh at {fmtTime(new Date(rate.resetAt).toTimeString().slice(0, 5))} (in {mins} min)
      </p>
      {isLow(rate) && <p className="mt-2 text-sm font-medium text-bad">⚠ Less than 10% left. Saving and refreshing may fail until it starts afresh.</p>}
      <p className="mt-2 rounded-xl bg-alt px-3 py-2 text-sm">
        <strong className="font-semibold">Saver mode: {saverLevel(rate) === 'normal' ? 'off' : saverLevel(rate) === 'saver' ? 'on' : 'on (strong)'}</strong>
        <span className="block text-xs text-muted">
          {saverLevel(rate) === 'normal'
            ? `Turns on by itself below ${Math.round(SAVER_SHARE * 100)}% left: live scores refresh less often, phones check less on reopening, and usage counts wait. Scoring is never slowed.`
            : `Live scores refresh every ${everyText(liveRefreshMs(saverLevel(rate)))}, phones check at most every ${everyText(resumeGapMs(saverLevel(rate)))} on reopening, and usage counts wait on the phones. Scoring is never slowed. Ends when the hour starts afresh.`}
        </span>
      </p>
      <p className="mt-2 text-xs text-muted">Checks that find nothing changed are free and aren’t counted. Checked {ago(new Date(rate.at).toISOString(), now)}.</p>
    </section>
  )
}

// ---------- hard stop ----------
const timeOf = (ms: number) => fmtTime(new Date(ms).toTimeString().slice(0, 5))

/** Pauses the app for everyone else until the allowance starts afresh; it lifts by itself then. */
function HardStopCard() {
  const { store, pausedUntil: paused, realSession, toast } = useApp()
  const rate = useRate()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only a reset time still ahead can be used (an old figure counts as already reset).
  const resetAt = rate && rate.resetAt > Date.now() + 60_000 ? rate.resetAt : null

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      toast(done)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Hard stop</h3>
          <p className="text-sm text-muted">
            {paused
              ? `On. Everyone else sees “under maintenance” until ${timeOf(Date.parse(paused))}; it turns off by itself then.`
              : 'Stops everyone except you from using the app until the hourly limit starts afresh.'}
          </p>
        </div>
        <Toggle
          label="Hard stop"
          checked={!!paused}
          disabled={busy || !store || (!paused && !resetAt)}
          onChange={(on) => {
            if (!store) return
            if (on) setAsking(true)
            else void run(() => resumeApp(store), 'The app is open again for everyone')
          }}
        />
      </div>
      {!paused && !resetAt && <p className="mt-2 text-xs text-muted">Available once the time the limit starts afresh is known (tap Refresh above).</p>}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      {asking && resetAt && (
        <Confirm
          title="Stop the app for everyone?"
          message={`Until ${timeOf(resetAt)}, everyone except you will see that the app is under maintenance and will be back at ${timeOf(resetAt)}. Unsaved changes on their phones wait until then. It turns off by itself, or you can turn it off earlier here.`}
          confirmLabel={busy ? 'Stopping…' : `Stop until ${timeOf(resetAt)}`}
          danger
          onCancel={() => setAsking(false)}
          onConfirm={() => void run(() => pauseApp(store!, new Date(resetAt), realSession!.personId), `App stopped until ${timeOf(resetAt)}`)}
        />
      )}
    </section>
  )
}

// ---------- charts ----------
const CW = 340
const CH = 150
const CM = { l: 30, r: 6, t: 8, b: 22 }

function niceMax(v: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]) if (v / s <= 4) return s * Math.max(1, Math.ceil(v / s))
  return Math.ceil(v / 10000) * 10000
}

/** One column per day or hour; tap or hover a column to read it. */
function Columns({ values, label, tick, readout, idle }: { values: number[]; label: string; tick: (i: number) => string | null; readout: (i: number, v: number) => string; idle: string }) {
  const [at, setAt] = useState<number | null>(null)
  const max = niceMax(Math.max(1, ...values))
  const pw = CW - CM.l - CM.r
  const ph = CH - CM.t - CM.b
  const slot = pw / values.length
  const bw = Math.max(2, slot - 2)
  const steps = [0, max / 2, max]
  return (
    <ChartCard title={label} subtitle={at === null ? idle : readout(at, values[at])}>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        className="w-full touch-pan-y"
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.floor(((((e.clientX - r.left) / r.width) * CW - CM.l) / pw) * values.length)
          setAt(i >= 0 && i < values.length ? i : null)
        }}
        onPointerLeave={() => setAt(null)}
      >
        <g fontSize="9" fill="rgb(var(--text-muted))">
          {steps.map((s) => {
            const y = CM.t + ph - (s / max) * ph
            return (
              <g key={s}>
                <line x1={CM.l} x2={CW - CM.r} y1={y} y2={y} stroke="var(--grid)" />
                <text x={CM.l - 4} y={y + 3} textAnchor="end">
                  {s >= 1000 ? `${s / 1000}k` : s}
                </text>
              </g>
            )
          })}
          {values.map((_, i) => {
            const t = tick(i)
            return t ? (
              <text key={i} x={CM.l + i * slot + slot / 2} y={CH - 6} textAnchor="middle">
                {t}
              </text>
            ) : null
          })}
        </g>
        {at !== null && <rect x={CM.l + at * slot} y={CM.t} width={slot} height={ph} fill="rgb(var(--text))" opacity="0.07" />}
        {values.map((v, i) => {
          const h = (v / max) * ph
          if (h <= 0) return null
          const x = CM.l + i * slot + (slot - bw) / 2
          const y = CM.t + ph - h
          const r = Math.min(2, bw / 2, h)
          return <path key={i} d={`M${x},${CM.t + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${CM.t + ph} Z`} fill="var(--series-1)" />
        })}
      </svg>
    </ChartCard>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  )
}

/** Each feature on its own line, so long names are never cut: name and figures, then the bar. */
function FeatureBars({ rows }: { rows: FeatureUsage[] }) {
  if (rows.length === 0) return <p className="py-3 text-center text-sm text-muted">Nothing yet</p>
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{featureLabel(r.key)}</span>
            <span className="shrink-0">
              <span className="font-semibold">{num(r.count)}</span>
              <span className="text-muted"> · {plural(r.people, 'person', 'people')}</span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded-r" style={{ width: `${(r.count / max) * 100}%`, minWidth: 3, background: 'var(--series-1)' }} />
        </div>
      ))}
    </div>
  )
}

const PLATFORM: Record<string, string> = { iphone: 'iPhone / iPad', android: 'Android', computer: 'Computer' }

function PersonRow({ u, now, open, onToggle }: { u: PersonUsage; now: number; open: boolean; onToggle: () => void }) {
  const { people, allTeams, admins, config } = useApp()
  const p = people.find((x) => x.id === u.personId)
  const name = p?.name ?? 'Removed person'
  const team = allTeams.find((t) => p?.teamIds.includes(t.id) || t.adminId === p?.id)
  const top = Object.entries(u.features)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const isAdmin = admins.some((a) => a.personId === u.personId && a.status === 'active')
  return (
    <div>
      <button className="row active:bg-alt" aria-expanded={open} onClick={onToggle}>
        <Avatar name={name} personId={u.personId} color={team?.color} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            <span className="truncate">{name}</span>
            {config?.superAdminId === u.personId ? <Pill tone="brand">Super admin</Pill> : isAdmin ? <Pill tone="brand">Admin</Pill> : <RoleTag person={p ?? null} />}
          </span>
          <span className="block truncate text-xs text-muted">
            {plural(u.req, 'request')} · {plural(u.opens, 'open')} · {plural(u.activeDays, 'day')}
          </span>
        </span>
        <span className="text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-sm">
          <p className="text-muted">
            {num(u.writes)} of the requests were saves. Counts last sent {ago(u.syncedAt, now)}.
          </p>
          {top.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {top.map(([k, v]) => (
                <span key={k} className="chip">
                  {featureLabel(k)} <span className="text-muted">{v}</span>
                </span>
              ))}
            </div>
          )}
          {u.devices.map((d) => (
            <p key={d.id} className="text-muted">
              📱 {PLATFORM[d.platform] ?? d.platform} · {d.installed ? 'installed' : 'in a browser'} · version {d.version} · seen {fmtDayMonth(localDate(new Date(d.lastSeen)))}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- the screen ----------
export function Usage() {
  const { isSuper, store, people, config, admins, realSession, personName } = useApp()
  const now = useNow()
  const months = useMemo(() => recentMonths(new Date(), 6), [])
  const [month, setMonth] = useState(months[0])
  const [group, setGroup] = useState<FeatureGroup>('player')
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const withAccess = useMemo(() => people.filter((p) => roleOf(p.id, config, people, admins) !== 'denied').map((p) => p.id), [people, config, admins])
  const key = withAccess.join(',')

  // Each person's file for the month: read once per app session (an unchanged one costs nothing).
  useEffect(() => {
    if (!store || !isSuper) return
    const paths = key
      .split(',')
      .filter(Boolean)
      .map((id) => usagePath(month, id))
      .filter((p) => !store.isFresh(p))
    if (paths.length === 0) return
    setLoading(true)
    void Promise.allSettled(paths.map((p) => store.refresh(p))).finally(() => setLoading(false))
  }, [store, isSuper, month, key])

  if (!isSuper) {
    return (
      <Screen title="Usage" back="/settings">
        <Empty icon="🔒" title="Super admin only" />
      </Screen>
    )
  }

  const myId = realSession?.personId
  const report = buildReport(
    month,
    withAccess.map((id) => ({ personId: id, file: store?.get<UsageFile>(usagePath(month, id)) ?? null, extra: id === myId ? pendingOf(id) : undefined })),
    withAccess,
  )
  const thisMonth = month === localDate().slice(0, 7)
  const dayCount = thisMonth ? new Date().getDate() : daysInMonth(month)
  const groupFeatures = FEATURES.filter((f) => f.group === group || (group === 'admin' && f.group === 'super'))
  const used = report.features.filter((f) => groupFeatures.some((g) => g.key === f.key))
  const unused = groupFeatures.filter((g) => !report.features.some((f) => f.key === g.key))
  const busiest = report.byHour.indexOf(Math.max(...report.byHour))

  return (
    <Screen title="Usage" back="/settings">
      <div className="flex flex-col gap-4 p-4">
        <AllowanceCard />
        <HardStopCard />

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist" aria-label="Month">
          {months.map((m) => (
            <button key={m} role="tab" aria-selected={m === month} className={`chip shrink-0 min-h-[36px] px-3 ${m === month ? 'chip-on' : ''}`} onClick={() => setMonth(m)}>
              {monthLabel(m)}
            </button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-muted">
          Each phone sends its counts once a day, so the latest day can be incomplete.{loading ? ' Loading…' : ''}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Tile label="Requests" value={num(report.req)} note={`${num(Math.round(report.req / Math.max(1, dayCount)))} a day on average`} />
          <Tile label="People using the app" value={`${report.people.length}`} note={`of ${withAccess.length} with access`} />
          <Tile label="App opens" value={num(report.opens)} />
          <Tile label="Screens viewed" value={num(report.screens)} />
        </div>

        {report.people.length === 0 ? (
          <Empty icon="📊" title="No usage counted yet" text={thisMonth ? 'Counts arrive as people open the app, about once a day per phone.' : 'Nothing was counted this month.'} />
        ) : (
          <>
            <Columns
              label="Requests by day"
              values={report.byDay}
              tick={(i) => (i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : null)}
              readout={(i, v) => `${fmtDate(`${month}-${String(i + 1).padStart(2, '0')}`)}: ${plural(v, 'request')}`}
              idle="Tap a day to see its requests."
            />
            <Columns
              label="Busiest hours"
              values={report.byHour}
              tick={(h) => (h % 6 === 0 ? hourLabel(h) : null)}
              readout={(h, v) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)}: ${plural(v, 'request')}`}
              idle={`Busiest: ${hourLabel(busiest)}–${hourLabel((busiest + 1) % 24)}. Tap an hour to see it.`}
            />

            <section>
              <h2 className="section-title">Who uses it most</h2>
              <div className="card divide-y divide-line overflow-hidden">
                {report.people.map((u) => (
                  <PersonRow key={u.personId} u={u} now={now} open={open === u.personId} onToggle={() => setOpen(open === u.personId ? null : u.personId)} />
                ))}
              </div>
            </section>

            <section>
              <h2 className="section-title">Features</h2>
              <Segmented<FeatureGroup>
                value={group}
                onChange={setGroup}
                options={[
                  { value: 'player', label: 'Player features' },
                  { value: 'admin', label: 'Admin features' },
                ]}
              />
              <div className="card mt-3 p-4">
                <h3 className="font-semibold">Most used</h3>
                <p className="mb-3 text-sm text-muted">Times opened this month, and by how many people.</p>
                <FeatureBars rows={used} />
              </div>
              <div className="card mt-3 p-4">
                <h3 className="font-semibold">Not used this month</h3>
                {unused.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">Every feature here was used at least once.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {unused.map((f) => (
                      <span key={f.key} className="chip">
                        {f.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="section-title">Phones</h2>
              <div className="card space-y-3 p-4 text-sm">
                <BarList rows={Object.entries(report.platforms).map(([k, v]) => ({ label: PLATFORM[k], value: v }))} slot={1} />
                <p className="text-muted">
                  {report.installed} of {plural(report.installed + report.browser, 'device')} use the installed app{report.browser ? `; ${num(report.browser)} open it in a browser` : ''}.
                </p>
                <div>
                  <div className="font-medium">App versions</div>
                  {report.versions.map((v) => (
                    <div key={v.version} className="flex justify-between text-muted">
                      <span>
                        {v.version}
                        {v.version === APP_VERSION && ' (this version)'}
                      </span>
                      <span>{plural(v.devices, 'device')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {report.idle.length > 0 && (
          <section>
            <h2 className="section-title">Not opened this month ({report.idle.length})</h2>
            <div className="card flex flex-wrap gap-1.5 p-4">
              {report.idle.map((id) => (
                <span key={id} className="chip">
                  {personName(id)}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </Screen>
  )
}
