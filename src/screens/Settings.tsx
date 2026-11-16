import { useState } from 'react'
import { DataCard } from '../components/DataCard'
import { NotificationsCard } from '../components/NotificationsCard'
import { ChangePinSheet, RecoveryCodeSheet } from '../components/PinSheets'
import { Screen } from '../components/Screen'
import { Confirm, ErrorNote, Field, MenuRow, NumberInput, Segmented, Sheet, Toggle } from '../components/ui'
import { addDays, daysBetween, fmtDate, fmtStamp, todayISO } from '../lib/dates'
import { lowBalanceThreshold, updateConfig } from '../lib/domain'
import { getPref, setPref } from '../lib/session'
import { APP_BUILT_AT, APP_VERSION, reloadToLatest } from '../lib/version'
import { useApp } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import { useTheme, type ThemePref } from '../state/ThemeContext'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <div className="card divide-y divide-line overflow-hidden">{children}</div>
    </section>
  )
}

/** Days before the token's expiry from which the admin is warned. */
export const TOKEN_WARN_DAYS = 14

export function Settings() {
  const { me, role, isAdmin, teams, allTeams, people, config, store, session, logout, flushSaves, replaceToken, toast, creds } = useApp()
  const { pref, setPref: setTheme } = useTheme()
  const sheet = useSheet()
  const [pinOnOpen, setPinOnOpen] = useState(() => getPref('pinOnOpen', false))
  const [showArchived, setShowArchived] = useState(() => getPref('showArchived', false))
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [showSecurity, setShowSecurity] = useState(false)
  const [expiry, setExpiry] = useState(config?.tokenExpiresOn ?? '')
  const [threshold, setThreshold] = useState(String(store ? lowBalanceThreshold(store) : 500))
  const [newToken, setNewToken] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const myTeams = (isAdmin ? allTeams.filter((t) => me?.teamIds.includes(t.id)) : teams).map((t) => t.name)
  const users = people.filter((p) => !p.isGuest && p.id !== config?.adminPersonId)
  const pinSetAt = creds.find((c) => c.personId === session?.personId)?.pinSetAt

  async function hardRefresh() {
    // Never reload over an edit that hasn't reached the repo yet.
    if (!(await flushSaves())) return toast('Your latest change isn’t saved yet — check your connection.')
    await reloadToLatest()
  }

  return (
    <Screen title="Settings">
      <div className="flex flex-col gap-5 p-4">
        <Section title="Account">
          <div className="px-4 py-3">
            <div className="font-semibold">{me?.name ?? '—'}</div>
            <div className="text-sm text-muted">
              {role === 'admin' ? 'Admin · full access' : '👁 View only'}
              {myTeams.length > 0 && ` · ${myTeams.join(', ')}`}
            </div>
          </div>
          <MenuRow label="Change PIN" hint={pinSetAt ? `PIN set ${fmtStamp(pinSetAt)}` : undefined} onClick={() => sheet.open('pin')} />
          <MenuRow
            label="Ask for PIN when the app opens"
            hint="Useful on a shared phone."
            right={
              <Toggle
                label="Ask for PIN when the app opens"
                checked={pinOnOpen}
                onChange={(v) => {
                  setPref('pinOnOpen', v)
                  setPinOnOpen(v)
                }}
              />
            }
          />
          <button className="row font-medium text-bad active:bg-alt" onClick={() => setConfirmLogout(true)}>
            Log out
          </button>
        </Section>

        <section>
          <h2 className="section-title">Notifications</h2>
          <NotificationsCard />
        </section>

        <section>
          <h2 className="section-title">Appearance</h2>
          <Segmented<ThemePref>
            value={pref}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </section>

        {isAdmin && (
          <>
            <Section title="Admin">
              <MenuRow label="Users" hint={`${users.length} player${users.length === 1 ? '' : 's'} · access and PIN resets`} onClick={() => navigate('/settings/users')} />
              <MenuRow label="Expense categories" hint="What gets split after a match" onClick={() => navigate('/settings/categories')} />
            <MenuRow label="Grounds" hint="Venues with map link, pitch and fee" onClick={() => navigate('/settings/grounds')} />
              <MenuRow label="Funds" hint={`Low balance below ₹${store ? lowBalanceThreshold(store) : 500}`} onClick={() => sheet.open('funds')} />
              <MenuRow
                label="Data repo"
                hint={config?.tokenExpiresOn ? `Token expires ${fmtDate(config.tokenExpiresOn)}` : 'Token expiry date not set'}
                onClick={() => sheet.open('repo')}
              />
              <MenuRow
                label="Show archived teams"
                right={
                  <Toggle
                    label="Show archived teams"
                    checked={showArchived}
                    onChange={(v) => {
                      setPref('showArchived', v)
                      setShowArchived(v)
                    }}
                  />
                }
              />
              <MenuRow label="Recovery code" hint="Create a new one (needs your PIN)" onClick={() => sheet.open('recovery')} />
            </Section>

            <section>
              <h2 className="section-title">Data</h2>
              <DataCard />
            </section>
          </>
        )}

        <Section title="General">
          <MenuRow label="Refresh app" hint="Clears the app cache and reloads the latest version." onClick={() => void hardRefresh()} />
          <div className="px-4 py-3 text-xs text-muted">
            Version {APP_VERSION} · built {fmtStamp(APP_BUILT_AT)}
          </div>
        </Section>

        <Section title="About security">
          <button className="row active:bg-alt" onClick={() => setShowSecurity((v) => !v)} aria-expanded={showSecurity}>
            <span className="flex-1">How your data is protected — and the limits</span>
            <span className="text-muted">{showSecurity ? '▾' : '▸'}</span>
          </button>
          {showSecurity && (
            <div className="space-y-2 px-4 py-3 text-sm text-muted">
              <p>All data lives in a private GitHub repo. Everyone uses one shared access token; view-only is enforced by this app.</p>
              <p>
                <strong className="text-ink">1.</strong> Someone holding the token could skip the app and edit the repo directly. Every change is a git commit with full history, so anything
                can be restored.
              </p>
              <p>
                <strong className="text-ink">2.</strong> The 6-digit PIN is a lock, not a vault. PINs are stored only as slow one-way hashes — nobody, including the admin, can read them — but
                someone with the token could try guesses offline.
              </p>
              <p>
                <strong className="text-ink">3.</strong> If the token expires or is replaced, every phone must enter the new one.
              </p>
              <p>Phone numbers are never stored in plain text and players can’t see anyone’s number.</p>
            </div>
          )}
        </Section>
      </div>

      {sheet.name === 'pin' && <ChangePinSheet onClose={sheet.close} />}
      {sheet.name === 'recovery' && <RecoveryCodeSheet onClose={sheet.close} />}

      {sheet.name === 'funds' && store && (
        <Sheet title="Funds" onClose={sheet.close}>
          <div className="flex flex-col gap-4">
            <Field label="Low balance threshold (₹)" hint="Players below this show up under the “Low balance” filter in Funds.">
              <NumberInput value={threshold} onChange={setThreshold} maxLength={6} ariaLabel="Low balance threshold" />
            </Field>
            <button
              className="btn-primary"
              onClick={() => {
                updateConfig(store, { lowBalanceThreshold: Number(threshold) || 0 })
                sheet.close()
              }}
            >
              Save
            </button>
          </div>
        </Sheet>
      )}

      {sheet.name === 'repo' && store && (
        <Sheet title="Data repo" onClose={sheet.close}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {session?.owner}/{session?.repo}
            </p>
            <Field label="Token expiry date" hint={`You’ll see a reminder from ${TOKEN_WARN_DAYS} days before this date.`}>
              <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <button
                className="btn-primary flex-1"
                onClick={() => {
                  updateConfig(store, { tokenExpiresOn: expiry || undefined })
                  toast('Expiry date saved')
                }}
              >
                Save date
              </button>
              <button className="btn-secondary" onClick={() => setExpiry(addDays(todayISO(), 365))}>
                +1 year
              </button>
            </div>
            <hr className="border-line" />
            <Field label="Replace the token on this device" hint="After creating a new token, enter it here. Everyone else enters it when their app asks.">
              <input className="input" type="password" value={newToken} onChange={(e) => setNewToken(e.target.value)} autoComplete="off" placeholder="github_pat_…" />
            </Field>
            <ErrorNote>{tokenError}</ErrorNote>
            <button
              className="btn-secondary"
              disabled={busy || !newToken.trim()}
              onClick={async () => {
                setBusy(true)
                setTokenError(null)
                try {
                  await replaceToken(newToken)
                  setNewToken('')
                  toast('Token replaced on this device')
                } catch (e) {
                  setTokenError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Checking…' : 'Replace token'}
            </button>
          </div>
        </Sheet>
      )}

      {confirmLogout && (
        <Confirm
          title="Log out?"
          message="This phone forgets the repo, the token and your login. You’ll need the token, your number and your PIN to come back."
          confirmLabel="Log out"
          danger
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setConfirmLogout(false)
            void logout().then(() => navigate('/onboard', { replace: true }))
          }}
        />
      )}
    </Screen>
  )
}

/** Banner for the admin when the shared token is about to expire (PLAN §5.8). */
export function TokenExpiryBanner() {
  const { isAdmin, config } = useApp()
  if (!isAdmin || !config?.tokenExpiresOn) return null
  const days = daysBetween(todayISO(), config.tokenExpiresOn)
  if (days > TOKEN_WARN_DAYS) return null
  return (
    <button className="mx-4 mt-3 block w-[calc(100%-2rem)] rounded-xl bg-warn/15 px-4 py-3 text-left text-sm text-warn" onClick={() => navigate('/settings?sheet=repo')}>
      <strong>{days < 0 ? 'The access token has expired.' : days === 0 ? 'The access token expires today.' : `The access token expires in ${days} day${days === 1 ? '' : 's'}.`}</strong>{' '}
      Create a new token and share it with everyone.
    </button>
  )
}
