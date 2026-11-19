// Settings → Admins (super admin only, PLAN §65): who runs teams, adding an
// admin by mobile number, suspending / restoring, handing teams to another
// admin, PIN resets, and an overview of the whole app.
import { useState } from 'react'
import { Screen } from '../components/Screen'
import { Avatar, Confirm, Empty, ErrorNote, Field, MenuRow, PhoneInput, Pill, Sheet } from '../components/ui'
import { credentialOf } from '../lib/access'
import { daysBetween, fmtDate, todayISO } from '../lib/dates'
import { addAdmin, removeAdmin, resetPin, setAdminStatus, transferTeam } from '../lib/domain'
import { maskPhone, normalizePhone } from '../lib/phone'
import { useApp } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import type { AdminRecord, Team } from '../types'
import { pinStatus } from './Users'

export function Admins() {
  const { isSuper, admins, people, allTeams, creds, config, me, store } = useApp()
  const sheet = useSheet()

  if (!isSuper || !store || !me) {
    return (
      <Screen title="Admins" back="/settings">
        <Empty icon="🔒" title="Super admin only" />
      </Screen>
    )
  }

  const byId = new Map(people.map((p) => [p.id, p]))
  const teamsOf = (personId: string) => allTeams.filter((t) => t.adminId === personId)
  const playersIn = (teams: Team[]) => new Set(people.filter((p) => !p.isGuest && p.teamIds.some((id) => teams.some((t) => t.id === id))).map((p) => p.id)).size
  const sorted = [...admins].sort((a, b) => (a.status === b.status ? (byId.get(a.personId)?.name ?? '').localeCompare(byId.get(b.personId)?.name ?? '') : a.status === 'active' ? -1 : 1))
  // Teams whose admin is no longer an active admin: nobody can change them until they are handed over.
  const activeIds = new Set([config?.superAdminId, ...admins.filter((a) => a.status === 'active').map((a) => a.personId)])
  const stranded = allTeams.filter((t) => !t.archived && !activeIds.has(t.adminId))
  const players = people.filter((p) => !p.isGuest && p.teamIds.length > 0).length
  const keyDays = config?.tokenExpiresOn ? daysBetween(todayISO(), config.tokenExpiresOn) : null
  const selected = sheet.name === 'admin' ? admins.find((a) => a.personId === sheet.arg) : undefined

  return (
    <Screen title="Admins" back="/settings">
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted">Admins run their own teams: players, matches, scoring, expenses and funds. Everyone else only needs the access key and their number.</p>
        <button className="btn-primary" onClick={() => sheet.open('add')}>
          + Add admin
        </button>

        {stranded.length > 0 && (
          <div className="rounded-xl bg-warn/15 px-4 py-3 text-sm text-warn">
            <strong>{stranded.length === 1 ? '1 team has' : `${stranded.length} teams have`} no active admin</strong> ({stranded.map((t) => t.name).join(', ')}). Open that admin below and hand the team to someone else.
          </div>
        )}

        <section>
          <h2 className="section-title">Admins</h2>
          <div className="card divide-y divide-line overflow-hidden">
            <AdminRow name={`${me.name} (you)`} personId={me.id} last4={me.phoneLast4} teams={teamsOf(me.id)} players={playersIn(teamsOf(me.id))} tag={<Pill tone="brand">Super admin</Pill>} />
            {sorted.length === 0 && <p className="px-4 py-3 text-sm text-muted">No admins yet. Add one with their name and mobile number.</p>}
            {sorted.map((a) => {
              const p = byId.get(a.personId)
              const teams = teamsOf(a.personId)
              return (
                <AdminRow
                  key={a.personId}
                  name={p?.name ?? 'Unknown'}
                  personId={a.personId}
                  last4={p?.phoneLast4}
                  teams={teams}
                  players={playersIn(teams)}
                  sub={pinStatus(credentialOf(creds, a.personId))}
                  tag={a.status === 'active' ? <Pill tone="ok">Active</Pill> : <Pill tone="warn">Suspended</Pill>}
                  onClick={() => sheet.open('admin', a.personId)}
                />
              )
            })}
          </div>
        </section>

        <section>
          <h2 className="section-title">The app</h2>
          <div className="card divide-y divide-line overflow-hidden">
            <MenuRow label="Teams" hint={`${allTeams.filter((t) => !t.archived).length} active · ${allTeams.filter((t) => t.archived).length} archived`} />
            <MenuRow label="Players with access" hint={`${players} in a team`} />
            <MenuRow
              label="Access key"
              hint={keyDays === null ? 'Expiry date not set' : keyDays < 0 ? 'Expired — create a new one and share it' : `Expires ${fmtDate(config!.tokenExpiresOn!)} (${keyDays} day${keyDays === 1 ? '' : 's'})`}
              onClick={() => navigate('/settings?sheet=repo')}
            />
            <p className="px-4 py-3 text-xs text-muted">Everyone shares one access key, so all phones together share GitHub’s limit of 5,000 requests an hour. That is plenty for a few clubs.</p>
          </div>
        </section>
      </div>

      {sheet.name === 'add' && <AddAdminSheet onClose={sheet.close} />}
      {selected && <AdminSheet record={selected} onClose={sheet.close} />}
    </Screen>
  )
}

function AdminRow({ name, personId, last4, teams, players, sub, tag, onClick }: { name: string; personId: string; last4?: string; teams: Team[]; players: number; sub?: string; tag: React.ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <Avatar name={name} personId={personId} color={teams[0]?.color} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          {tag}
        </span>
        <span className="block truncate text-xs text-muted">
          {maskPhone(last4)} · {teams.length ? `${teams.map((t) => t.name).join(', ')} · ${players} player${players === 1 ? '' : 's'}` : 'No teams yet'}
        </span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      {onClick && <span className="text-muted">›</span>}
    </>
  )
  return onClick ? (
    <button className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-alt" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{body}</div>
  )
}

function AddAdminSheet({ onClose }: { onClose: () => void }) {
  const { store, toast } = useApp()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    const p = normalizePhone(phone)
    if (!p.ok) return setError(p.error)
    setBusy(true)
    try {
      const person = await addAdmin(store!, name, p.phone)
      toast(`${person.name} is now an admin`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add admin" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="text-sm text-muted">They open the app, enter the access key and this number, and set their own PIN. If the number already belongs to a player, that player becomes an admin and keeps their teams and stats.</p>
        <Field label="Name">
          <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Mobile number (10 digits)" hint="Never stored as-is.">
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={busy || !name.trim() || phone.length !== 10}>
          {busy ? 'Adding…' : 'Add admin'}
        </button>
      </form>
    </Sheet>
  )
}

function AdminSheet({ record, onClose }: { record: AdminRecord; onClose: () => void }) {
  const { store, people, allTeams, admins, me, creds, toast } = useApp()
  const [confirm, setConfirm] = useState<null | 'suspend' | 'reset' | 'remove'>(null)
  const [error, setError] = useState<string | null>(null)
  const person = people.find((p) => p.id === record.personId)
  const name = person?.name ?? 'This admin'
  const teams = allTeams.filter((t) => t.adminId === record.personId)
  // Who a team can go to: any other active admin, or the super admin.
  const targets = [
    ...(me ? [{ id: me.id, name: `${me.name} (you)` }] : []),
    ...admins.filter((a) => a.status === 'active' && a.personId !== record.personId).map((a) => ({ id: a.personId, name: people.find((p) => p.id === a.personId)?.name ?? 'Unknown' })),
  ].filter((t) => t.id !== record.personId)

  function run(fn: () => void, done: string) {
    setError(null)
    try {
      fn()
      toast(done)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title={name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="text-sm text-muted">
          {maskPhone(person?.phoneLast4)} · {pinStatus(credentialOf(creds, record.personId))}
          <br />
          Admin since {fmtDate(record.addedAt.slice(0, 10))}
        </div>

        <section>
          <span className="label">Teams ({teams.length})</span>
          {teams.length === 0 ? (
            <p className="text-sm text-muted">No teams yet. They create them from the Teams tab.</p>
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {teams.map((t) => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {t.name}
                    {t.archived && <span className="text-muted"> · archived</span>}
                  </span>
                  <select
                    className="input max-w-[55%] py-1 text-sm"
                    value=""
                    aria-label={`Hand ${t.name} to`}
                    onChange={(e) => {
                      const to = targets.find((x) => x.id === e.target.value)
                      if (to) run(() => transferTeam(store!, t.id, to.id), `${t.name} now belongs to ${to.name}`)
                    }}
                  >
                    <option value="">Hand to…</option>
                    {targets.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </section>

        <ErrorNote>{error}</ErrorNote>

        {record.status === 'active' ? (
          <button className="btn-secondary" onClick={() => setConfirm('suspend')}>
            Suspend admin
          </button>
        ) : (
          <button className="btn-primary" onClick={() => run(() => setAdminStatus(store!, record.personId, 'active'), `${name} is an admin again`)}>
            Restore admin
          </button>
        )}
        <button className="btn-secondary" onClick={() => setConfirm('reset')}>
          Reset PIN
        </button>
        <button className="btn-danger" disabled={teams.length > 0} onClick={() => setConfirm('remove')}>
          Remove as admin
        </button>
        {teams.length > 0 && <p className="-mt-2 text-xs text-muted">Hand their teams to someone else first.</p>}
      </div>

      {confirm === 'suspend' && (
        <Confirm
          title={`Suspend ${name}?`}
          message="They are logged out everywhere and can only look, not change anything. Their teams stay as they are until you restore them or hand the teams to someone else."
          confirmLabel="Suspend"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            run(() => setAdminStatus(store!, record.personId, 'suspended'), `${name} is suspended`)
          }}
        />
      )}
      {confirm === 'reset' && (
        <Confirm
          title="Reset PIN?"
          message={`${name} will be logged out on all phones and must set a new PIN.`}
          confirmLabel="Reset PIN"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            run(() => resetPin(store!, record.personId, me!.id), `PIN reset for ${name}`)
          }}
        />
      )}
      {confirm === 'remove' && (
        <Confirm
          title={`Remove ${name} as admin?`}
          message="They are logged out everywhere. If they play in a team they can log in again as a player."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            run(() => {
              removeAdmin(store!, record.personId)
              onClose()
            }, `${name} is no longer an admin`)
          }}
        />
      )}
    </Sheet>
  )
}
