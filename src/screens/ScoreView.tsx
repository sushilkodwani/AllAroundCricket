// What everyone sees (PLAN §26): Live, Scorecard, Commentary, Analysis, Teams.
// Nothing here polls: the score is fetched when the screen opens and again
// only when the viewer taps Refresh.
import { useMemo, useState, type ReactNode } from 'react'
import { BarList, ChartCard, LineChart, Manhattan, type Series } from '../components/charts'
import { AwardsList } from '../components/Awards'
import { BallChip, GroundMap } from '../components/scoring'
import { HeaderButton, Screen } from '../components/Screen'
import { ChoiceChips, Empty, Pill, Sheet } from '../components/ui'
import { fmtDate } from '../lib/dates'
import { chaseView, milestoneText, milestonesOf } from '../lib/insights'
import { drawResultCard, shareResultCard } from '../lib/resultCard'
import { P } from '../lib/paths'
import { ballNumbers, ballText, economy, fmtRate, howOut, scoreLine, strikeRate, summarize, type InningsSummary } from '../lib/scorecard'
import { BALLS, ballRuns, battingSide, bowlingSide, isBall, oversText } from '../lib/scoring'
import { useApp, useFile, useTeam } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import { WICKET_LABELS, type ScoreFile, type WicketKind } from '../types'

const TABS = ['live', 'scorecard', 'commentary', 'analysis', 'teams'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { live: 'Live', scorecard: 'Scorecard', commentary: 'Commentary', analysis: 'Analysis', teams: 'Teams' }

const fmtClock = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ScoreView({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { store, isAdmin, people, personName, toast, session } = useApp()
  const route = useRoute()
  const sheet = useSheet()
  const match = useTeam(teamId).matches.find((m) => m.id === matchId)
  const path = P.scoring(teamId, matchId)
  const file = useFile<ScoreFile>(path)
  const loaded = !!store?.has(path)
  const base = `/teams/${teamId}/matches/${matchId}`
  const [busy, setBusy] = useState(false)
  const tab: Tab = (TABS as readonly string[]).includes(route.query.get('tab') ?? '') ? (route.query.get('tab') as Tab) : 'live'

  const summaries = useMemo(() => (file ? file.innings.map((_, i) => summarize(file, i)) : []), [file])
  const lefties = useMemo(() => new Set(people.filter((p) => p.batsLeft).map((p) => p.id)), [people])

  async function refresh() {
    if (!store || busy) return
    setBusy(true)
    const before = store.get<ScoreFile>(path)?.updatedAt
    try {
      await store.refresh(path)
      toast(store.get<ScoreFile>(path)?.updatedAt === before ? 'Already up to date' : 'Score updated')
    } catch {
      toast('Could not refresh — check your connection')
    } finally {
      setBusy(false)
    }
  }

  if (!file) {
    return (
      <Screen title="Scorecard" back={base}>
        {loaded ? <Empty icon="🏏" title="No live score yet" text="Scoring has not started for this match." /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>}
      </Screen>
    )
  }

  const cur = file.innings.length - 1
  const s = summaries[cur]
  const inn = file.innings[cur]
  const tossText = `${file[file.toss.wonBy].name} won the toss and chose to ${file.toss.chose}`
  const status =
    file.status === 'finished'
      ? file.result?.text
      : file.status === 'break'
        ? `Innings break — ${bowlingSide(file, inn).name} need ${s.total + 1} to win`
        : s.need
          ? `${battingSide(file, inn).name} need ${s.need.runs} from ${s.need.balls} balls`
          : tossText

  const shareText = [`${file.home.name} v ${file.away.name}`, ...file.innings.map((i, n) => `${battingSide(file, i).name} ${scoreLine(file, n)}`), status].filter(Boolean).join('\n')
  function shareAsText() {
    if (navigator.share) void navigator.share({ text: shareText }).catch(() => {})
    else void navigator.clipboard?.writeText(shareText).then(() => toast('Score copied'))
    sheet.close()
  }
  async function shareAsImage() {
    try {
      const canvas = drawResultCard(file!, personName, { date: match ? fmtDate(match.date) : '', venue: match?.venue })
      const how = await shareResultCard(canvas, `${file!.home.shortName}-v-${file!.away.shortName}.png`, shareText)
      if (how === 'downloaded') toast('Image saved — share it from your photos or downloads')
    } catch (e) {
      toast((e as Error).message)
    }
    sheet.close()
  }

  return (
    <Screen
      title={`${file.home.shortName} v ${file.away.shortName}`}
      back={base}
      actions={
        <>
          <HeaderButton label="Share score" onClick={() => sheet.open('share')}>
            ↗
          </HeaderButton>
          <HeaderButton label="Refresh score" onClick={() => void refresh()}>
            <span className={busy ? 'animate-spin' : ''}>⟳</span>
          </HeaderButton>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <div className="card p-4">
          {file.innings.map((i, n) => (
            <div key={n} className={`flex items-baseline justify-between gap-3 ${n === cur && file.status !== 'finished' ? 'font-bold' : ''}`}>
              <span className="min-w-0 truncate text-lg">{battingSide(file, i).name}</span>
              <span className="shrink-0 text-xl">
                {summaries[n].total}/{summaries[n].wickets} <span className="text-sm font-normal text-muted">({summaries[n].overs} ov)</span>
              </span>
            </div>
          ))}
          {file.innings.length === 1 && (
            <div className="flex items-baseline justify-between gap-3 text-muted">
              <span className="min-w-0 truncate text-lg">{bowlingSide(file, inn).name}</span>
              <span className="text-sm">yet to bat</span>
            </div>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm">
            {file.status !== 'finished' && <Pill tone="bad">LIVE</Pill>}
            <span className="font-medium">{status}</span>
          </p>
          {file.awards && (
            <div className="mt-2 border-t border-line pt-2">
              <AwardsList awards={file.awards} />
            </div>
          )}
          <p className="mt-1 text-xs text-muted">
            Last scored {fmtClock(file.updatedAt)} · tap ⟳ for the latest
            {(isAdmin || (!!match?.scorerId && match.scorerId === session?.personId)) && (
              <button className="ml-2 font-semibold text-accent" onClick={() => navigate(`${base}/score`)}>
                {file.status === 'finished' ? 'Open scoring' : 'Continue scoring'}
              </button>
            )}
          </p>
        </div>

        <div className="-mx-3 flex overflow-x-auto border-b border-line px-3" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              className={`min-h-[44px] shrink-0 border-b-2 px-3 text-sm font-semibold ${t === tab ? 'border-brand text-accent' : 'border-transparent text-muted'}`}
              onClick={() => navigate(withQuery(route, { tab: t }), { replace: true })}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {tab === 'live' && <LiveTab file={file} s={s} tossText={tossText} />}
        {tab === 'scorecard' && file.innings.map((_, n) => <InningsCard key={n} file={file} idx={n} s={summaries[n]} />)}
        {tab === 'commentary' && <CommentaryTab file={file} summaries={summaries} lefties={lefties} />}
        {tab === 'analysis' && <AnalysisTab file={file} summaries={summaries} lefties={lefties} />}
        {tab === 'teams' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(['home', 'away'] as const).map((k) => (
              <section key={k} className="card overflow-hidden">
                <h3 className="border-b border-line px-4 py-2.5 font-semibold">
                  {file[k].name} <span className="font-normal text-muted">({file[k].xi.length})</span>
                </h3>
                <ol className="divide-y divide-line text-sm">
                  {file[k].xi.map((id, n) => (
                    <li key={id} className="flex gap-3 px-4 py-2">
                      <span className="w-5 text-muted">{n + 1}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {personName(id)}
                        {file[k].keeperId === id && ' †'}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
      {sheet.name === 'share' && (
        <Sheet title="Share" onClose={sheet.close}>
          <div className="flex flex-col gap-2">
            <button className="btn-primary" onClick={() => void shareAsImage()}>
              🖼️ Share as a picture
            </button>
            <button className="btn-secondary" onClick={shareAsText}>
              Share as text
            </button>
            <p className="px-1 text-xs text-muted">The picture shows both scores, the result, the top two batters and bowlers of each side and the player of the match.</p>
          </div>
        </Sheet>
      )}
    </Screen>
  )
}

const Th = ({ children, left }: { children?: ReactNode; left?: boolean }) => <th className={`px-1.5 py-1.5 text-xs font-semibold text-muted ${left ? 'text-left' : 'text-right'}`}>{children}</th>
const Td = ({ children, strong }: { children?: ReactNode; strong?: boolean }) => <td className={`px-1.5 py-2 text-right ${strong ? 'font-bold' : ''}`}>{children}</td>

function BattingTable({ s, only, closed }: { s: InningsSummary; only?: 'crease'; closed?: boolean }) {
  const { personName } = useApp()
  const rows = only ? s.batters.filter((b) => b.atCrease) : s.batters
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-alt">
          <Th left>Batter</Th>
          <Th>R</Th>
          <Th>B</Th>
          <Th>4s</Th>
          <Th>6s</Th>
          <Th>SR</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((b) => (
          <tr key={b.id}>
            <td className="max-w-0 px-1.5 py-2" style={{ width: '46%' }}>
              <span className="block truncate font-medium">
                {personName(b.id)}
                {b.onStrike && '*'}
              </span>
              {!only && <span className="block truncate text-xs text-muted">{closed && !b.out && !b.retiredHurt ? 'not out' : howOut(b, personName)}</span>}
            </td>
            <Td strong>{b.runs}</Td>
            <Td>{b.balls}</Td>
            <Td>{b.fours}</Td>
            <Td>{b.sixes}</Td>
            <Td>{strikeRate(b.runs, b.balls)}</Td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} className="px-2 py-4 text-center text-muted">
              No batters yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function BowlingTable({ s, ids }: { s: InningsSummary; ids?: string[] }) {
  const { personName } = useApp()
  const rows = ids ? s.bowlers.filter((b) => ids.includes(b.id)) : s.bowlers
  if (rows.length === 0) return null
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-alt">
          <Th left>Bowler</Th>
          <Th>O</Th>
          <Th>M</Th>
          <Th>R</Th>
          <Th>W</Th>
          <Th>Eco</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((b) => (
          <tr key={b.id}>
            <td className="max-w-0 px-1.5 py-2" style={{ width: '46%' }}>
              <span className="block truncate font-medium">{personName(b.id)}</span>
              {!ids && (b.wides > 0 || b.noBalls > 0) && (
                <span className="block text-xs text-muted">
                  {[b.wides && `${b.wides} wd`, b.noBalls && `${b.noBalls} nb`].filter(Boolean).join(', ')}
                </span>
              )}
            </td>
            <Td>{oversText(b.balls)}</Td>
            <Td>{b.maidens}</Td>
            <Td>{b.runs}</Td>
            <Td strong>{b.wickets}</Td>
            <Td>{economy(b)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LiveTab({ file, s, tossText }: { file: ScoreFile; s: InningsSummary; tossText: string }) {
  const { personName } = useApp()
  const inn = file.innings[file.innings.length - 1]
  const balls = inn.events.filter(isBall)
  const recent = balls.slice(-12)
  const pair = s.partnerships[s.partnerships.length - 1]
  const lastOver = s.overLines[s.overLines.length - 1]
  const bowlerIds = [...new Set([inn.crease.bowler, lastOver?.bowler, s.overLines[s.overLines.length - 2]?.bowler].filter((x): x is string => !!x))]
  const chase = chaseView(file)
  const lastBall = balls[balls.length - 1]
  const reached = lastBall ? milestonesOf(file, file.innings.length - 1).get(lastBall.id) : undefined
  return (
    <>
      {reached && file.status === 'live' && <p className="rounded-xl bg-ok/15 px-3 py-2 text-center text-sm font-semibold text-ok">{reached.map((m) => milestoneText(m, personName, battingSide(file, inn).name)).join('  ')}</p>}
      {chase && (
        <div className="card p-3">
          <div className="flex justify-between gap-2 text-sm font-semibold">
            <span>
              {file[chase.chasing].shortName} {chase.chance}%
            </span>
            <span>
              {100 - chase.chance}% {file[chase.chasing === 'home' ? 'away' : 'home'].shortName}
            </span>
          </div>
          <div className="mt-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Win chance: ${file[chase.chasing].name} ${chase.chance} percent`}>
            <span style={{ width: `${chase.chance}%`, background: `var(--series-${chase.chasing === 'home' ? 1 : 2})` }} />
            <span className="flex-1" style={{ background: `var(--series-${chase.chasing === 'home' ? 2 : 1})` }} />
          </div>
          <p className="mt-2 text-sm">
            Par score now: <strong>{chase.par}</strong> ·{' '}
            {chase.ahead === 0 ? 'level with par' : `${Math.abs(chase.ahead)} run${Math.abs(chase.ahead) === 1 ? '' : 's'} ${chase.ahead > 0 ? 'ahead' : 'behind'}`}
          </p>
          <p className="mt-0.5 text-xs text-muted">Win chance is a rough estimate from runs needed, balls left, wickets in hand and the first innings’ scoring rate.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3">
          <p className="text-xs text-muted">Current run rate</p>
          <p className="text-2xl font-semibold">{fmtRate(s.runRate)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">{s.need ? 'Required run rate' : 'Projected at this rate'}</p>
          <p className="text-2xl font-semibold">{s.need ? fmtRate(s.need.rate) : s.runRate === null ? '–' : Math.round(s.runRate * inn.overs)}</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <BattingTable s={s} only="crease" />
        <BowlingTable s={s} ids={bowlerIds} />
        {pair?.unbroken && (
          <p className="border-t border-line px-3 py-2 text-sm">
            <span className="text-muted">Partnership</span>{' '}
            <strong>
              {pair.runs} ({pair.balls})
            </strong>
          </p>
        )}
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-line px-3 py-2">
          <span className="shrink-0 text-xs font-semibold uppercase text-muted">Recent</span>
          {recent.length === 0 && <span className="text-xs text-muted">No balls yet</span>}
          {recent.map((b) => (
            <BallChip key={b.id} ball={b} />
          ))}
        </div>
      </div>
      {s.fow.length > 0 && (
        <p className="px-1 text-sm text-muted">
          Last wicket: {personName(s.fow[s.fow.length - 1].who)} — {s.fow[s.fow.length - 1].score}/{s.fow[s.fow.length - 1].n} ({s.fow[s.fow.length - 1].over} ov)
        </p>
      )}
      <p className="px-1 text-xs text-muted">
        {tossText} · {file.overs} overs a side
      </p>
    </>
  )
}

function InningsCard({ file, idx, s }: { file: ScoreFile; idx: number; s: InningsSummary }) {
  const { personName } = useApp()
  const e = s.extras
  return (
    <section className="card overflow-hidden">
      <h3 className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2.5 font-semibold">
        <span className="min-w-0 truncate">{battingSide(file, file.innings[idx]).name}</span>
        <span>
          {s.total}/{s.wickets} <span className="text-sm font-normal text-muted">({s.overs} ov)</span>
        </span>
      </h3>
      <BattingTable s={s} closed={!!file.innings[idx].closed} />
      <div className="space-y-1.5 border-y border-line px-3 py-2.5 text-sm">
        <p>
          <span className="font-semibold">Extras {e.total}</span>{' '}
          <span className="text-muted">
            (b {e.b}, lb {e.lb}, wd {e.wd}, nb {e.nb}
            {e.pen ? `, pen ${e.pen}` : ''})
          </span>
        </p>
        <p>
          <span className="font-semibold">Run rate</span> <span className="text-muted">{fmtRate(s.runRate)}</span>
        </p>
        {s.yetToBat.length > 0 && (
          <p>
            <span className="font-semibold">Yet to bat:</span> <span className="text-muted">{s.yetToBat.map(personName).join(', ')}</span>
          </p>
        )}
        {s.fow.length > 0 && (
          <p>
            <span className="font-semibold">Fall of wickets:</span>{' '}
            <span className="text-muted">{s.fow.map((f) => `${f.score}-${f.n} (${personName(f.who)}, ${f.over} ov)`).join(', ')}</span>
          </p>
        )}
      </div>
      <BowlingTable s={s} />
    </section>
  )
}

function InningsPicker({ file, value, onChange }: { file: ScoreFile; value: number; onChange: (n: number) => void }) {
  if (file.innings.length < 2) return null
  return <ChoiceChips options={file.innings.map((i, n) => ({ value: String(n), label: `${battingSide(file, i).shortName} innings` }))} value={String(value)} onChange={(v) => onChange(Number(v))} />
}

function CommentaryTab({ file, summaries, lefties }: { file: ScoreFile; summaries: InningsSummary[]; lefties: Set<string> }) {
  const { personName } = useApp()
  const [pick, setPick] = useState<number | null>(null)
  const idx = Math.min(pick ?? file.innings.length - 1, file.innings.length - 1)
  const s = summaries[idx]
  const overs = [...s.overLines].reverse()
  const marks = milestonesOf(file, idx)
  const teamName = battingSide(file, file.innings[idx]).name
  return (
    <>
      <InningsPicker file={file} value={idx} onChange={setPick} />
      {overs.length === 0 && <Empty icon="🎙️" title="No commentary yet" text="It appears ball by ball once the innings starts." />}
      {overs.map((o) => {
        const labels = ballNumbers(o)
        const complete = o.balls.filter((b) => b.kind === 'legal').length === BALLS
        return (
          <section key={o.n} className="card overflow-hidden">
            <header className="flex items-baseline justify-between gap-2 bg-alt px-3 py-2 text-sm">
              <span className="font-semibold">
                {complete ? `End of over ${o.n}` : `Over ${o.n}`} <span className="font-normal text-muted">· {personName(o.bowler)}</span>
              </span>
              <span>
                {o.runs} run{o.runs === 1 ? '' : 's'}
                {o.wickets ? `, ${o.wickets} wkt` : ''} ·{' '}
                <strong>
                  {o.total}/{o.totalWickets}
                </strong>
              </span>
            </header>
            <ul className="divide-y divide-line">
              {o.balls
                .map((b, i) => ({ b, label: labels[i] }))
                .reverse()
                .map(({ b, label }) => (
                  <li key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-8 shrink-0 text-xs text-muted">{label}</span>
                    <BallChip ball={b} />
                    <span className={b.wicket || (b.kind !== 'wd' && (b.bat === 4 || b.bat === 6)) ? 'font-semibold' : ''}>
                      {ballText(b, personName, (id) => lefties.has(id))}
                      {marks.get(b.id)?.map((m, n) => (
                        <span key={n} className="mt-0.5 block font-semibold text-ok">
                          {milestoneText(m, personName, teamName)}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

function AnalysisTab({ file, summaries, lefties }: { file: ScoreFile; summaries: InningsSummary[]; lefties: Set<string> }) {
  const { personName } = useApp()
  const [pick, setPick] = useState<number | null>(null)
  const [batter, setBatter] = useState('all')
  const idx = Math.min(pick ?? file.innings.length - 1, file.innings.length - 1)
  const s = summaries[idx]
  const inn = file.innings[idx]
  const slot = (n: number): 1 | 2 => (file.innings[n].batting === 'home' ? 1 : 2)

  const perOver: Series[] = summaries.map((x, n) => ({ name: battingSide(file, file.innings[n]).shortName, slot: slot(n), values: x.overLines.map((o) => o.runs), wickets: x.overLines.map((o) => o.wickets) }))
  const worm: Series[] = summaries.map((x, n) => ({ name: battingSide(file, file.innings[n]).shortName, slot: slot(n), values: x.overLines.map((o) => o.total), wickets: x.overLines.map((o) => o.wickets) }))
  const rates: Series[] = summaries.map((x, n) => ({
    name: battingSide(file, file.innings[n]).shortName,
    slot: slot(n),
    values: x.overLines.map((o, i) => {
      const balls = i === x.overLines.length - 1 ? x.legal - i * BALLS || BALLS : BALLS
      return (o.total * BALLS) / (i * BALLS + balls)
    }),
  }))

  const boundaries = inn.events.filter(isBall).filter((b) => b.shot && (batter === 'all' || b.striker === batter))
  const hitters = [...new Set(inn.events.filter(isBall).filter((b) => b.shot).map((b) => b.striker))]
  const wicketRows = (Object.keys(s.wicketKinds) as WicketKind[]).map((k) => ({ label: WICKET_LABELS[k], value: s.wicketKinds[k] ?? 0 })).sort((a, b) => b.value - a.value)
  const maxPair = Math.max(1, ...s.partnerships.map((p) => p.runs))
  const extrasRuns = inn.events.filter(isBall).reduce((sum, b) => sum + ballRuns(b) - b.bat, 0)

  if (summaries.every((x) => x.legal === 0)) return <Empty icon="📊" title="No analysis yet" text="Charts appear once the first over is under way." />

  return (
    <>
      <Manhattan series={perOver} />
      <LineChart
        title="Score progression"
        series={worm}
        idle="Tap an over to see the score. ● = wicket"
        pace={file.innings[1]?.target ? { label: 'Pace needed in the chase', to: file.innings[1].target - 1, overs: file.innings[1].overs } : undefined}
      />
      <LineChart title="Run rate" series={rates} decimals={2} idle="Runs per over so far, after each over." fromZero={false} />

      <InningsPicker file={file} value={idx} onChange={(n) => (setPick(n), setBatter('all'))} />

      <ChartCard title="How the runs came" subtitle={`${battingSide(file, inn).name} — number of balls by result`}>
        <BarList
          slot={slot(idx)}
          rows={[
            { label: 'Dot balls', value: s.shots.dots },
            { label: 'Singles', value: s.shots.ones },
            { label: 'Twos', value: s.shots.twos },
            { label: 'Threes', value: s.shots.threes },
            { label: 'Fours', value: s.shots.fours },
            { label: 'Sixes', value: s.shots.sixes },
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          {s.shots.fours * 4 + s.shots.sixes * 6} runs in boundaries · {extrasRuns + s.extras.pen} in extras
        </p>
      </ChartCard>

      <ChartCard title="Wickets" subtitle={`${battingSide(file, inn).name} — how they got out`}>
        <BarList slot={slot(idx)} rows={wicketRows} />
      </ChartCard>

      <ChartCard title="Partnerships" subtitle={`${battingSide(file, inn).name} — runs (balls)`}>
        {s.partnerships.length === 0 && <p className="py-3 text-center text-sm text-muted">Nothing yet</p>}
        <div className="flex flex-col gap-3">
          {s.partnerships.map((p, n) => (
            <div key={n} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {personName(p.a)} <span className="text-muted">{p.aRuns} ({p.aBalls})</span>
                </span>
                <span className="min-w-0 truncate text-right">
                  {personName(p.b)} <span className="text-muted">{p.bRuns} ({p.bBalls})</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="h-3 rounded-r" style={{ width: `${(p.runs / maxPair) * 100}%`, minWidth: 3, maxWidth: 'calc(100% - 76px)', background: `var(--series-${slot(idx)})` }} />
                <span className="font-semibold">
                  {p.runs} ({p.balls}){p.unbroken ? '*' : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Wagon wheel" subtitle={`${battingSide(file, inn).name} — where the fours and sixes went`}>
        {hitters.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">No boundary directions recorded in this innings.</p>
        ) : (
          <>
            <ChoiceChips options={[{ value: 'all', label: 'All' }, ...hitters.map((id) => ({ value: id, label: personName(id) }))]} value={batter} onChange={setBatter} />
            <div className="mt-2 flex gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: 'var(--series-1)' }} />
                Fours ({boundaries.filter((b) => b.bat === 4).length})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: 'var(--series-2)' }} />
                Sixes ({boundaries.filter((b) => b.bat === 6).length})
              </span>
            </div>
            <GroundMap left={batter !== 'all' && lefties.has(batter)} shots={boundaries.map((b) => ({ shot: b.shot!, runs: b.bat }))} />
          </>
        )}
      </ChartCard>
    </>
  )
}
