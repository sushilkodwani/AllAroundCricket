// Year-end summary (PLAN §43): per player, matches played, total of their
// shares, what they paid and the cost per match.
import { useMemo, useState } from 'react'
import { HeaderButton, Screen } from '../components/Screen'
import { ChoiceChips, Empty } from '../components/ui'
import { money } from '../lib/dates'
import { shareMessage } from '../lib/messages'
import { activeYears, yearSummary } from '../lib/statement'
import { useApp, useTeam } from '../state/AppContext'
import { navigate } from '../state/router'

export function YearSummary({ teamId }: { teamId: string }) {
  const { personName, toast } = useApp()
  const data = useTeam(teamId)
  const years = useMemo(() => activeYears(data.funds, data.matches), [data.funds, data.matches])
  const [pick, setPick] = useState<string | null>(null)
  const year = pick ?? years[0] ?? String(new Date().getFullYear())
  const rows = useMemo(() => yearSummary(data.funds, data.matches, year).sort((a, b) => b.shares - a.shares || personName(a.personId).localeCompare(personName(b.personId))), [data.funds, data.matches, year, personName])
  const total = rows.reduce((t, r) => ({ shares: t.shares + r.shares, paid: t.paid + r.paid, pending: t.pending + r.pending }), { shares: 0, paid: 0, pending: 0 })
  const completed = data.matches.filter((m) => !m.cancelled && m.lifecycle === 'completed' && m.date.startsWith(year)).length

  if (!data.team) {
    return (
      <Screen title="Year summary" back="/funds">
        <Empty icon="🤷" title="Team not found" text="It may have been removed, or you’re not in it." />
      </Screen>
    )
  }

  function share() {
    const lines = [`*${data.team?.name ?? 'Team'} — ${year} summary*`, `${completed} completed match${completed === 1 ? '' : 'es'} · total spent ${money(total.shares)}`, '']
    for (const r of rows) lines.push(`${personName(r.personId)}: ${r.played} played · share ${money(r.shares)}${r.perMatch !== null ? ` (${money(r.perMatch)}/match)` : ''} · paid ${money(r.paid)}${r.pending > 0 ? ` · *${money(r.pending)} due*` : ''}`)
    void shareMessage(lines.join('\n')).then((how) => how === 'copied' && toast('Copied'))
  }

  return (
    <Screen
      title="Year summary"
      back="/funds"
      actions={
        rows.length > 0 ? (
          <HeaderButton label="Share summary" onClick={share}>
            ↗
          </HeaderButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {years.length > 1 && <ChoiceChips options={years.map((y) => ({ value: y, label: y }))} value={year} onChange={setPick} />}
        {!data.ready ? (
          <p className="p-10 text-center text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <Empty icon="🧾" title={`Nothing in ${year}`} text="Matches and fund entries of the year appear here." />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['Completed matches', String(completed)],
                  ['Spent on matches', money(total.shares)],
                  ['Still due', money(total.pending)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="card p-3">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-alt text-xs text-muted">
                    <th className="px-3 py-1.5 text-left font-semibold">Player</th>
                    {['Played', 'Share', 'Per match', 'Paid', 'Due'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.personId} className="active:bg-alt" onClick={() => navigate(`/teams/${teamId}/statement/${r.personId}`)}>
                      <td className="max-w-[130px] truncate px-3 py-2.5 font-medium">{personName(r.personId)}</td>
                      <td className="px-2 text-right">{r.played}</td>
                      <td className="px-2 text-right font-semibold">{money(r.shares)}</td>
                      <td className="px-2 text-right">{r.perMatch === null ? '–' : money(r.perMatch)}</td>
                      <td className="px-2 text-right">{money(r.paid)}</td>
                      <td className={`px-2 pr-3 text-right ${r.pending > 0 ? 'font-semibold text-warn' : 'text-muted'}`}>{r.pending > 0 ? money(r.pending) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-1 text-xs text-muted">
              Played = completed matches in the squad. Share = total of the player’s match shares. Paid = fund contributions (less refunds) plus shares paid directly. Money put into the fund in one year can pay for matches in the next, so Paid and Share need not match.
            </p>
          </>
        )}
      </div>
    </Screen>
  )
}
