// Charts for a team's money (Funds tab): the fund over time, money in and out
// each month, what each match cost, where the spending went, and who owes what.
// Worked out from the ledger and the submitted splits — nothing extra is stored.
import { BarList, ChartCard, TrendBars } from './charts'
import { fmtDayMonth, money } from '../lib/dates'
import { duesByPlayer, fundTimeline, matchCosts, monthlyFlow, shortMonth, spendByCategory } from '../lib/funds'
import { useApp, type TeamData } from '../state/AppContext'

const W = 340
const H = 150
const M = { l: 40, r: 10, t: 10, b: 22 }
const PW = W - M.l - M.r
const PH = H - M.t - M.b

/** Short rupee amounts for tight spaces: 950, 1.2k, 12k. */
const compact = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(n)))

function niceMax(v: number): number {
  for (const s of [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000]) if (v <= s) return s
  return Math.ceil(v / 100000) * 100000
}

/** The fund after each payment in or out. Steps, because the balance holds until the next entry. */
function FundLine({ points }: { points: { date: string; balance: number }[] }) {
  // One point per day: the balance at the end of that day.
  const days = [...new Map(points.map((p) => [p.date, p.balance])).entries()].map(([date, balance]) => ({ date, balance }))
  const t0 = new Date(days[0].date).getTime()
  const span = Math.max(1, new Date(days[days.length - 1].date).getTime() - t0)
  const max = niceMax(Math.max(1, ...days.map((d) => d.balance)))
  const x = (date: string) => M.l + ((new Date(date).getTime() - t0) / span) * PW
  const y = (v: number) => M.t + PH - (Math.max(0, v) / max) * PH
  let d = `M${x(days[0].date)},${y(0)} L${x(days[0].date)},${y(days[0].balance)}`
  for (let i = 1; i < days.length; i++) d += ` L${x(days[i].date)},${y(days[i - 1].balance)} L${x(days[i].date)},${y(days[i].balance)}`
  const last = days[days.length - 1]
  const ticks = [0, max / 2, max]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Team fund over time">
      <g fontSize="9" fill="rgb(var(--text-muted))">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={M.l - 4} y={y(t) + 3} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        <text x={M.l} y={H - 6} textAnchor="start">
          {fmtDayMonth(days[0].date)}
        </text>
        {days.length > 1 && (
          <text x={W - M.r} y={H - 6} textAnchor="end">
            {fmtDayMonth(last.date)}
          </text>
        )}
      </g>
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(last.date)} cy={y(last.balance)} r="4" fill="var(--series-1)" stroke="rgb(var(--surface))" strokeWidth="2" />
    </svg>
  )
}

export function FundCharts({ data }: { data: TeamData }) {
  const { personName } = useApp()
  const { funds, matches } = data
  const timeline = fundTimeline(funds)
  const flow = monthlyFlow(funds).slice(-8)
  const costs = matchCosts(matches).slice(-12)
  const categories = spendByCategory(matches)
  const dues = duesByPlayer(matches)
  if (timeline.length === 0 && costs.length === 0) return null
  const maxFlow = Math.max(1, ...flow.flatMap((f) => [f.moneyIn, f.moneyOut]))

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title !pb-0">Charts</h2>

      {timeline.length > 0 && (
        <ChartCard title="Team fund over time" subtitle={`Now ${money(timeline[timeline.length - 1].balance)}`}>
          <FundLine points={timeline} />
        </ChartCard>
      )}

      {flow.length > 0 && (
        <ChartCard title="Money in and out" subtitle="Paid in (contributions) and paid out (matches and refunds), by month">
          <div className="mb-2 flex gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-1)' }} />
              In
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-2)' }} />
              Out
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-3" style={{ height: 128, minWidth: flow.length * 52 }}>
              {flow.map((f) => (
                <div key={f.month} className="flex w-11 flex-col items-center justify-end gap-0.5" title={`In ${money(f.moneyIn)} · Out ${money(f.moneyOut)}`}>
                  <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 96 }}>
                    {[
                      { v: f.moneyIn, c: 'var(--series-1)' },
                      { v: f.moneyOut, c: 'var(--series-2)' },
                    ].map((b, i) => (
                      <div key={i} className="flex w-5 flex-col items-center justify-end">
                        <span className="text-[9px] font-medium">{b.v > 0 ? compact(b.v) : ''}</span>
                        <span className="w-full rounded-t" style={{ height: b.v > 0 ? Math.max(3, (b.v / maxFlow) * 60) : 0, background: b.c }} />
                      </div>
                    ))}
                  </div>
                  <span className="text-[10px] text-muted">{shortMonth(f.month)}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      )}

      {costs.length > 0 && (
        <ChartCard title="What each match cost" subtitle={`Total expenses of the last ${costs.length} split match${costs.length === 1 ? '' : 'es'} (₹)`}>
          <TrendBars points={costs.map((c) => ({ label: fmtDayMonth(c.match.date), value: c.total, note: `vs ${c.match.opponent}: ${money(c.total)}` }))} fmt={compact} slot={2} />
        </ChartCard>
      )}

      {categories.length > 0 && (
        <ChartCard title="Where the money went" subtitle="Everything spent so far, by expense category (₹)">
          <BarList slot={2} rows={categories.slice(0, 8).map((c) => ({ label: c.name, value: c.total }))} />
        </ChartCard>
      )}

      {dues.length > 0 && (
        <ChartCard title="Who owes what" subtitle="Unpaid shares of matches still being settled (₹)">
          <BarList slot={2} rows={dues.slice(0, 10).map((d) => ({ label: personName(d.personId), value: d.total }))} />
        </ChartCard>
      )}
    </section>
  )
}
