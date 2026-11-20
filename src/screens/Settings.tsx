import { useState } from 'react'
import { DataCard } from '../components/DataCard'
import { NotificationsCard } from '../components/NotificationsCard'
import { ChangePinSheet, RecoveryCodeSheet } from '../components/PinSheets'
import { ProfileSheet, RoleTag } from '../components/Profile'
import { Screen } from '../components/Screen'
import { Avatar, Confirm, ErrorNote, Field, MenuRow, NumberInput, Segmented, Sheet, Toggle } from '../components/ui'
import { addDays, daysBetween, fmtDate, fmtStamp, todayISO } from '../lib/dates'
import { updateConfig } from '../lib/domain'
import { getPref, setPref } from '../lib/session'
import { DevelopedBy } from '../components/DevelopedBy'
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
  const { me, role, isAdmin, isSuper, myTeams, allTeams, admins, people, config, store, session, logout, flushSaves, replaceToken, toast, creds, mock, stopMock } = useApp()
  const { pref, setPref: setTheme } = useTheme()
  const sheet = useSheet()
  const [pinOnOpen, setPinOnOpen] = useState(() => getPref('pinOnOpen', false))
  const [showArchived, setShowArchived] = useState(() => getPref('showArchived', false))
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [showSecurity, setShowSecurity] = useState(false)
  const [expiry, setExpiry] = useState(config?.tokenExpiresOn ?? '')
  const [newToken, setNewToken] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Teams this person plays in (their stats live there) and teams they run.
  const playsIn = myTeams.filter((t) => me?.teamIds.includes(t.id))
  const runs = myTeams.filter((t) => t.adminId === me?.id)
  const myTeamNames = [...new Set([...playsIn, ...runs].map((t) => t.name))]
  const runIds = new Set(runs.map((t) => t.id))
  const staff = new Set([config?.superAdminId, ...admins.map((a) => a.personId)])
  const users = people.filter((p) => !p.isGuest && !staff.has(p.id) && (isSuper || p.teamIds.some((id) => runIds.has(id))))
  const activeAdmins = admins.filter((a) => a.status === 'active').length
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
          <div className="flex items-center gap-3 px-4 py-3">
            {me && <Avatar name={me.name} personId={me.id} color={allTeams.find((t) => me.teamIds.includes(t.id))?.color} size={48} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-semibold">
                <span className="truncate">{me?.name ?? '—'}</span>
                <RoleTag person={me} />
              </div>
              <div className="text-sm text-muted">
                {role === 'super' ? 'Super admin' : role === 'admin' ? 'Admin' : '👁 View only'}
                {myTeamNames.length > 0 && ` · ${myTeamNames.join(', ')}`}
              </div>
            </div>
          </div>
          {me && <MenuRow label="Edit my profile" hint="Photo, role, batting, bowling, jersey" onClick={() => sheet.open('profile')} />}
          {me && playsIn[0] && <MenuRow label="My stats" hint="Batting, bowling and fielding figures" onClick={() => navigate(`/teams/${playsIn[0].id}/players/${me.id}`)} />}
          {mock ? (
            <MenuRow label="Stop acting as this admin" hint="Back to your own super admin screens" onClick={() => { stopMock(); navigate('/settings/admins') }} />
          ) : (
            <MenuRow label="Change PIN" hint={pinSetAt ? `PIN set ${fmtStamp(pinSetAt)}` : undefined} onClick={() => sheet.open('pin')} />
          )}
          {!mock && <MenuRow
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
          />}
          {!isSuper && !mock && <MenuRow label="Access key" hint="Replace the access key on this device" onClick={() => sheet.open('repo')} />}
          {!mock && (
            <button className="row font-medium text-bad active:bg-alt" onClick={() => setConfirmLogout(true)}>
              Log out
            </button>
          )}
        </Section>

        {!mock && (
          <section>
            <h2 className="section-title">Notifications</h2>
            <NotificationsCard />
          </section>
        )}

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

        {isSuper && (
          <>
            <Section title="Super admin">
              <MenuRow label="Admins" hint={`${activeAdmins} active · add, suspend, hand over teams`} onClick={() => navigate('/settings/admins')} />
              <MenuRow
                label="Data repo"
                hint={config?.tokenExpiresOn ? `Access key expires ${fmtDate(config.tokenExpiresOn)}` : 'Access key expiry date not set'}
                onClick={() => sheet.open('repo')}
              />
              <MenuRow label="Personal access keys" hint="Send each player and admin their own key" onClick={() => navigate('/settings/keys')} />
              <MenuRow label="Recovery code" hint="Create a new one (needs your PIN)" onClick={() => sheet.open('recovery')} />
            </Section>

            <section>
              <h2 className="section-title">Data</h2>
              <DataCard />
            </section>
          </>
        )}

        {isAdmin && (
          <Section title="Admin">
            {runs.length === 0 && <p className="px-4 py-3 text-sm text-muted">Create a team from the Teams tab. Its players, matches, expenses and funds are yours to run.</p>}
            <MenuRow label="Users" hint={`${users.length} player${users.length === 1 ? '' : 's'}${isSuper ? ' in all teams' : ' in your teams'} · access and PIN resets`} onClick={() => navigate('/settings/users')} />
            <MenuRow label="Grounds" hint="Venues with map link, pitch and fee" onClick={() => navigate('/settings/grounds')} />
            <p className="px-4 py-3 text-xs text-muted">Expense categories and the low-balance line are set per team: open the team, then its ⋯ menu.</p>
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
          </Section>
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
              <p>All data lives in a secure key based system. Everyone uses one shared access key; who may change what (super admin, admins, players) is enforced by this app.</p>
              <p>
                <strong className="text-ink">2.</strong> The 6-digit PIN is a lock, not a vault. PINs are stored only as slow one-way hashes — nobody, not even an admin, can read them
              </p>
              <p>
                <strong className="text-ink">3.</strong> If the key expires or is replaced, every phone must enter the new one.
              </p>
              <p>Phone numbers are never stored in plain text and players can’t see anyone’s number.</p>
            </div>
          )}
        </Section>

        <DevelopedBy className="pb-2 pt-2" />
      </div>

      {sheet.name === 'pin' && <ChangePinSheet onClose={sheet.close} />}
      {sheet.name === 'recovery' && <RecoveryCodeSheet onClose={sheet.close} />}

      {sheet.name === 'profile' && me && <ProfileSheet person={me} onClose={sheet.close} />}

      {sheet.name === 'repo' && store && (
        <Sheet title={isSuper ? "Data repo" : "Access key"} onClose={sheet.close}>
          <div className="flex flex-col gap-4">
            {isSuper && (
              <p className="text-sm text-muted">
                {session?.owner}/{session?.repo}
              </p>
            )}
            {isSuper && (
            <>
            <Field label="Access key expiry date" hint={`You’ll see a reminder from ${TOKEN_WARN_DAYS} days before this date.`}>
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
            </>
            )}
            <Field label="Replace the access key on this device" hint={isSuper ? 'The new plain key. Then send everyone their new personal key.' : 'Your new personal key from the super admin.'}>
              <input className="input" type="password" value={newToken} onChange={(e) => setNewToken(e.target.value)} autoComplete="off"  />
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
                  toast('Access key replaced on this device')
                  if (isSuper) navigate('/settings/keys')
                } catch (e) {
                  setTokenError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Checking…' : 'Replace key'}
            </button>
          </div>
        </Sheet>
      )}

      {confirmLogout && (
        <Confirm
          title="Log out?"
          message="This phone forgets the access key and your login. You’ll need the access key, your number and your PIN to come back."
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
  const { isSuper, config } = useApp()
  if (!isSuper || !config?.tokenExpiresOn) return null
  const days = daysBetween(todayISO(), config.tokenExpiresOn)
  if (days > TOKEN_WARN_DAYS) return null
  return (
    <button className="mx-4 mt-3 block w-[calc(100%-2rem)] rounded-xl bg-warn/15 px-4 py-3 text-left text-sm text-warn" onClick={() => navigate('/settings?sheet=repo')}>
      <strong>{days < 0 ? 'The access token has expired.' : days === 0 ? 'The access token expires today.' : `The access token expires in ${days} day${days === 1 ? '' : 's'}.`}</strong>{' '}
      Create a new token and share it with everyone.
    </button>
  )
}
