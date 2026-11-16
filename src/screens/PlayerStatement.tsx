// A player's money statement for one team (PLAN §36), plus the payment
// reminder the admin can send from it (PLAN §37).
import { useMemo, useState } from 'react'
import { HeaderButton, Screen } from '../components/Screen'
import { Avatar, Empty, Pill, Sheet } from '../components/ui'
import { fmtDayMonth, money } from '../lib/dates'
import { queueDuesReminder } from '../lib/domain'
import { buildStatement, duesText, statementText } from '../lib/statement'
import { useApp, useTeam } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'

async function shareText(text: string, toast: (m: string) => void) {
  if (navigator.share) {
    await navigator.share({ text }).catch(() => {})
  } else {
    await navigator.clipboard?.writeText(text)
    toast('Copied')
  }
}

/** Send a push reminder, or copy a message to paste into a chat. */
export function RemindSheet({ teamId, teamName, personIds, onClose }: { teamId: string; teamName: string; personIds: string[]; onClose: () => void }) {
  const { store, personName, toast } = useApp()
  const data = useTeam(teamId)
  const [sent, setSent] = useState(false)
  const one = personIds.length === 1 ? personIds[0] : null
  return (
    <Sheet title={one ? `Remind ${personName(one)}` : `Remind ${personIds.length} players`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <button
          className="btn-primary"
          disabled={sent}
          onClick={() => {
            queueDuesReminder(store!, teamId, personIds)
            setSent(true)
            toast('Reminder queued')
          }}
        >
          {sent ? '✓ Reminder queued' : '🔔 Send a notification'}
        </button>
        <p className="px-1 text-xs text-muted">
          Each player gets a notification with their own pending amount, about a minute later. It only reaches players who turned notifications on, and needs the notifier set up in the data repo (see the notifier guide).
        </p>
        {one && (
          <button className="btn-secondary" onClick={() => void shareText(duesText(data.matches, one, personName(one), teamName), toast)}>
            Share a message instead
          </button>
        )}
      </div>
    </Sheet>
  )
}

export function PlayerStatement({ teamId, personId }: { teamId: string; personId: string }) {
  const { isAdmin, personName, toast } = useApp()
  const sheet = useSheet()
  const data = useTeam(teamId)
  const st = useMemo(() => buildStatement(data.funds, data.matches, personId), [data.funds, data.matches, personId])
  const name = personName(personId)
  const back = `/funds`

  if (!data.ready || !data.team) {
    return (
      <Screen title="Statement" back={back}>
        <p className="p-10 text-center text-sm text-muted">Loading…</p>
      </Screen>
    )
  }
  const team = data.team
  const tiles: [string, string, string?][] = [
    ['Contributed', money(st.contributed)],
    ['Match shares', money(st.shares)],
    ['Fund balance', money(st.balance), st.balance > 0 ? 'text-ok' : ''],
    ['To pay', money(st.pending), st.pending > 0 ? 'text-warn' : ''],
  ]

  return (
    <Screen
      title="Statement"
      back={back}
      actions={
        <HeaderButton label="Share statement" onClick={() => void shareText(statementText(st, name, team.name), toast)}>
          ↗
        </HeaderButton>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Avatar name={name} color={team.color} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{name}</p>
            <p className="text-sm text-muted">
              {team.name} · {st.matches} paid match{st.matches === 1 ? '' : 'es'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([label, value, tone]) => (
            <div key={label} className="card p-3">
              <p className="text-xs text-muted">{label}</p>
              <p className={`text-xl font-semibold ${tone ?? ''}`}>{value}</p>
            </div>
          ))}
        </div>
        <p className="px-1 text-xs text-muted">
          Of the match shares: {money(st.fromFunds)} came from the fund, {money(st.paidDirect)} was paid directly
          {st.refunded > 0 && `, ${money(st.refunded)} was refunded`}
          {st.adjustments !== 0 && `, adjustments ${money(st.adjustments)}`}.
        </p>

        {isAdmin && st.pending > 0 && (
          <button className="btn-secondary" onClick={() => sheet.open('remind')}>
            🔔 Remind about {money(st.pending)}
          </button>
        )}

        <section>
          <h2 className="section-title">Every entry</h2>
          {st.lines.length === 0 ? (
            <Empty icon="🧾" title="Nothing yet" text="Contributions and match shares appear here." />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {st.lines.map((l, n) => (
                <button key={n} className="row text-sm active:bg-alt" disabled={!l.matchId} onClick={() => l.matchId && navigate(`/teams/${teamId}/matches/${l.matchId}`)}>
                  <span className="w-14 shrink-0 text-xs text-muted">{fmtDayMonth(l.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{l.label}</span>
                    {l.note && <span className="block truncate text-xs text-muted">{l.note}</span>}
                  </span>
                  {l.pending > 0 ? <Pill tone="warn">{money(l.pending)} due</Pill> : l.fund !== 0 ? <span className={`font-semibold ${l.fund > 0 ? 'text-ok' : ''}`}>{l.fund > 0 ? `+${money(l.fund)}` : money(l.fund)}</span> : <span className="text-xs text-muted">paid</span>}
                </button>
              ))}
            </div>
          )}
          <p className="mt-1 px-1 text-xs text-muted">The amount on the right is the change to the fund balance. Money paid directly to the admin does not change it.</p>
        </section>
      </div>

      {sheet.name === 'remind' && isAdmin && <RemindSheet teamId={teamId} teamName={team.name} personIds={[personId]} onClose={sheet.close} />}
    </Screen>
  )
}
