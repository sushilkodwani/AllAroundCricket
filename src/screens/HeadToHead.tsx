// The Head to head tab on an opponent's page: our results against them, the
// streak, batting first or chasing, best and worst totals, and who does best.
import { useMemo } from 'react'
import { useScores } from '../components/StatsTab'
import { Empty } from '../components/ui'
import type { Career } from '../lib/career'
import { fmtDayMonth } from '../lib/dates'
import { headToHeadOf } from '../lib/headToHead'
import { useApp } from '../state/AppContext'
import { navigate } from '../state/router'
import { RESULT_LABELS, type Match, type MatchResult, type Opponent } from '../types'

const LETTER: Record<MatchResult, string> = { won: 'W', lost: 'L', tied: 'T', draw: 'D', no_result: 'N', abandoned: 'A' }
const LETTER_TONE: Record<MatchResult, string> = { won: 'bg-ok text-white', lost: 'bg-bad text-white', tied: 'bg-alt', draw: 'bg-alt', no_result: 'bg-alt', abandoned: 'bg-alt' }

export function HeadToHeadTab({ opponent, matches }: { opponent: Opponent; matches: Match[] }) {
  const { personName, teams } = useApp()
  const { files, ready } = useScores(matches)
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const h = useMemo(() => headToHeadOf(matches, files), [stamp, matches])
  const open = (x?: { matchId: string; teamId: string }) => x && navigate(`/teams/${x.teamId}/matches/${x.matchId}`)
  const ourTeams = [...new Set(matches.map((m) => m.teamId))]
  const ourName = ourTeams.length === 1 ? (teams.find((t) => t.id === ourTeams[0])?.shortName ?? 'Our') : 'Our'

  if (!ready) return <p className="p-10 text-center text-sm text-muted">Loading…</p>
  if (h.played === 0 && files.length === 0)
    return (
      <div className="p-4">
        <Empty icon="🤝" title="No results yet" text={`Our record against ${opponent.name} appears after the first match.`} />
      </div>
    )

  const tile = (label: string, value: string | number) => (
    <div className="rounded-xl bg-alt px-2 py-2.5 text-center">
      <p className="text-lg font-bold leading-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">{label}</p>
    </div>
  )
  const rec = (x: { played: number; won: number }) => (x.played ? `${x.won} of ${x.played} won` : '–')
  const total = (t?: { runs: number; wickets: number; date: string }) => (t ? `${t.runs}/${t.wickets} · ${fmtDayMonth(t.date)}` : '–')
  const list = (rows: Career[], value: (c: Career) => string) =>
    rows.length ? (
      <ul className="flex flex-col gap-1">
        {rows.map((c) => (
          <li key={c.id} className="flex justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{personName(c.id)}</span>
            <span className="shrink-0 font-semibold">{value(c)}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted">–</p>
    )
  const rows: [string, string, { matchId: string; teamId: string } | undefined][] = [
    ['Batting first', rec(h.battingFirst), undefined],
    ['Chasing', rec(h.chasing), undefined],
    [`${ourName} highest total`, total(h.highest), h.highest],
    [`${ourName} lowest total`, total(h.lowest), h.lowest],
    [`${opponent.name} highest total`, total(h.theirHighest), h.theirHighest],
    ['Biggest win', h.biggestWin ? h.biggestWin.text.replace(/^.*? won/, 'Won') : '–', h.biggestWin],
    ['Heaviest defeat', h.heaviestLoss ? h.heaviestLoss.text.replace(/^.*? won/, 'Lost by') .replace('Lost by by', 'Lost by') : '–', h.heaviestLoss],
  ]

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="card p-4">
        <h3 className="font-semibold">Our record against {opponent.name}</h3>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {tile('Played', h.played)}
          {tile('Won', h.won)}
          {tile('Lost', h.lost)}
          {tile('Win %', h.winPct === null ? '–' : `${h.winPct}%`)}
        </div>
        {h.other > 0 && <p className="mt-2 text-xs text-muted">{h.other} tied, drawn or with no result.</p>}
        {h.form.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted">Results, latest first. Tap one to open the match.</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {h.form.slice(0, 10).map((f) => (
                <button key={f.matchId} className={`flex h-8 min-w-[32px] items-center justify-center rounded-lg px-1.5 text-sm font-bold ${LETTER_TONE[f.result]}`} onClick={() => open(f)} aria-label={`${RESULT_LABELS[f.result]} on ${fmtDayMonth(f.date)}`}>
                  {LETTER[f.result]}
                </button>
              ))}
            </div>
          </div>
        )}
        {h.streak && h.streak.count > 1 && (
          <p className="mt-3 rounded-xl border-l-4 border-brand bg-alt px-3 py-2 text-sm">
            {h.streak.result === 'won' ? 'We have won' : 'We have lost'} the last <strong className="font-semibold">{h.streak.count}</strong> against them
          </p>
        )}
      </section>

      {files.length > 0 && (
        <>
          <section className="card divide-y divide-line">
            {rows.map(([label, value, link]) => (
              <button key={label} className="row w-full text-left" disabled={!link} onClick={() => open(link)}>
                <span className="min-w-0 flex-1 text-sm text-muted">{label}</span>
                <span className="text-right text-sm font-medium">{value}</span>
              </button>
            ))}
          </section>

          <section className="card p-4">
            <h3 className="font-semibold">Who does best</h3>
            <p className="text-sm text-muted">In the scored matches against {opponent.name}</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold text-muted">OUR RUNS</p>
                {list(h.ourBat, (c) => String(c.bat.runs))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted">OUR WICKETS</p>
                {list(h.ourBowl, (c) => String(c.bowl.wickets))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted">THEIR RUNS</p>
                {list(h.theirBat, (c) => String(c.bat.runs))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted">THEIR WICKETS</p>
                {list(h.theirBowl, (c) => String(c.bowl.wickets))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
