// More panels for a player's Insights tab: how they do under pressure, who gets the better of
// them (and who they get the better of), and their partners. See lib/playerInsights.ts.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { DataTable, Insights, Panel } from '../components/playerViz'
import type { PlayerData } from '../lib/playerAnalysis'
import { BALANCE_HIGH, BALANCE_LOW, MIN_BALLS, MIN_VS, TIGHT_RUNS, bowledAt, catchDuos, clutchOf, facedBowlers, fastestOff, lineEcon, lineSr, mostOuts, partnersOf, tightOvers, type Line, type VsPlayer } from '../lib/playerInsights'
import type { ScoreFile } from '../types'

interface Props {
  personId: string
  d: PlayerData
  files: ScoreFile[]
  personName: (id: string) => string
}

const signed = (n: number, digits = 0) => {
  const r = Number(n.toFixed(digits))
  return `${r > 0 ? '+' : r < 0 ? '–' : ''}${Math.abs(r).toFixed(digits)}`
}

// ---------- under pressure ----------
/** One figure against the player's own overall figure; green when it is better, with the gap. */
function VsOverall({ label, sub, mine, base, digits, lowerBetter, balls }: { label: string; sub?: string; mine: number | null; base: number | null; digits: number; lowerBetter?: boolean; balls: number }) {
  const enough = balls >= MIN_BALLS && mine !== null && base !== null
  const diff = enough ? mine - base : 0
  const better = lowerBetter ? diff < 0 : diff > 0
  const flat = !enough || Math.abs(diff) < Math.pow(10, -digits)
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{enough ? `${sub ? `${sub} · ` : ''}${balls} balls · overall ${base.toFixed(digits)}` : `needs ${MIN_BALLS}+ balls (${balls} so far)`}</span>
      </span>
      <strong className="text-lg">{enough ? mine.toFixed(digits) : '–'}</strong>
      {enough && !flat && <span className={`w-14 rounded-full border px-2 py-0.5 text-center text-[11px] font-semibold ${better ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-alt text-muted'}`}>{signed(diff, digits)}</span>}
    </div>
  )
}

export function Pressure({ files, d, personId }: Pick<Props, 'files' | 'd' | 'personId'>) {
  const c = useMemo(() => clutchOf(files, d, personId), [files, d, personId])
  const batting = c.overall.bat.balls >= MIN_BALLS
  const bowling = c.overall.bowl.balls >= MIN_BALLS
  if (!batting && !bowling) return null
  const wk = (l: Line) => (l.wickets === 1 ? '1 wicket' : `${l.wickets} wickets`)
  return (
    <Panel title="Under pressure" sub={`Death overs are the last quarter of an innings. "In the balance" is a chase ball when your side's win chance was between ${BALANCE_LOW}% and ${BALANCE_HIGH}%. Compared with your own overall figure.`}>
      {batting && (
        <>
          <p className="text-sm font-semibold">Batting strike rate</p>
          <div className="divide-y divide-line">
            <VsOverall label="Death overs" mine={lineSr(c.death.bat)} base={lineSr(c.overall.bat)} digits={0} balls={c.death.bat.balls} />
            <VsOverall label="Match in the balance" sub={`${c.balance.bat.wickets} out`} mine={lineSr(c.balance.bat)} base={lineSr(c.overall.bat)} digits={0} balls={c.balance.bat.balls} />
          </div>
        </>
      )}
      {bowling && (
        <>
          <p className="mt-3 text-sm font-semibold">Bowling economy (lower is better)</p>
          <div className="divide-y divide-line">
            <VsOverall label="Death overs" sub={wk(c.death.bowl)} mine={lineEcon(c.death.bowl)} base={lineEcon(c.overall.bowl)} digits={1} lowerBetter balls={c.death.bowl.balls} />
            <VsOverall label="Match in the balance" sub={wk(c.balance.bowl)} mine={lineEcon(c.balance.bowl)} base={lineEcon(c.overall.bowl)} digits={1} lowerBetter balls={c.balance.bowl.balls} />
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-muted">Chase balls are only in matches where your side batted or bowled second. The win chance is a rough estimate.</p>
    </Panel>
  )
}

// ---------- rivals ----------
const NamesCtx = createContext<(id: string) => string>((id) => id)

function VsList({ title, rows, right }: { title: string; rows: VsPlayer[]; right: (r: VsPlayer) => ReactNode }) {
  const name = useContext(NamesCtx)
  if (!rows.length) return null
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <div className="card divide-y divide-line overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="row">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{name(r.id)}</span>
            <span className="text-right text-sm">{right(r)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const runsBalls = (r: VsPlayer) => `${r.runs} (${r.balls})`

export function Rivals({ d, personName }: Pick<Props, 'd' | 'personName'>) {
  const faced = useMemo(() => facedBowlers(d), [d])
  const at = useMemo(() => bowledAt(d), [d])
  const nemesis = mostOuts(faced)
  const victims = fastestOff(faced)
  const regulars = mostOuts(at)
  const hitters = fastestOff(at)
  if (!nemesis.length && !victims.length && !regulars.length && !hitters.length) return null
  return (
    <NamesCtx.Provider value={personName}>
      <Panel title="Rivals" sub={`Who gets the better of you, and who you get the better of. The scoring lists need ${MIN_VS}+ balls.`}>
        <div className="flex flex-col gap-4">
          <VsList
            title="Bowlers who got you out most"
            rows={nemesis}
            right={(r) => (
              <>
                <strong>{r.outs}×</strong> <span className="text-xs text-muted">{runsBalls(r)}</span>
              </>
            )}
          />
          <VsList
            title="Bowlers you score fastest off"
            rows={victims}
            right={(r) => (
              <>
                <strong>{((r.runs * 100) / r.balls).toFixed(0)}</strong> <span className="text-xs text-muted">SR · {runsBalls(r)}</span>
              </>
            )}
          />
          <VsList
            title="Batters you get out most"
            rows={regulars}
            right={(r) => (
              <>
                <strong>{r.outs}×</strong> <span className="text-xs text-muted">{runsBalls(r)} against</span>
              </>
            )}
          />
          <VsList
            title="Batters who hit you hardest"
            rows={hitters}
            right={(r) => (
              <>
                <strong>{((r.runs * 6) / r.balls).toFixed(1)}</strong> <span className="text-xs text-muted">an over · {runsBalls(r)}</span>
              </>
            )}
          />
        </div>
      </Panel>
    </NamesCtx.Provider>
  )
}

// ---------- partners ----------
export function Partners({ d, files, personId, personName }: Props) {
  const rows = useMemo(() => partnersOf(d), [d])
  const duos = useMemo(() => catchDuos(files, personId), [files, personId])
  const tight = useMemo(() => tightOvers(files, personId), [files, personId])
  const bestRate = [...rows].filter((r) => r.balls >= 12).sort((a, b) => b.runs / b.balls - a.runs / a.balls)[0]
  if (!rows.length && !duos.offMe.length && !duos.iTookFor.length && tight.tight === 0) return null
  const list = (xs: { id: string; n: number }[]) => xs.slice(0, 3).map((x) => `${personName(x.id)} (${x.n})`).join(', ')
  return (
    <Panel title="Partners" sub="Batting partners, bowling pairs and catching duos.">
      {rows.length > 0 && (
        <>
          <p className="mb-1 text-sm font-semibold">Batting partners</p>
          <DataTable
            head={['Partner', 'Stands', 'Runs', 'Balls', 'An over', 'Best']}
            rows={rows.slice(0, 5).map((r) => [personName(r.id), r.stands, r.runs, r.balls, r.balls >= 6 ? ((r.runs * 6) / r.balls).toFixed(1) : '–', r.best])}
            note={rows.length > 5 ? `Top 5 of ${rows.length} partners, by runs together.` : 'By runs together.'}
          />
        </>
      )}
      <Insights
        items={[
          bestRate && rows.length > 1 && (
            <>
              You and <strong>{personName(bestRate.id)}</strong> score fastest together: <strong>{((bestRate.runs * 6) / bestRate.balls).toFixed(1)}</strong> an over over {bestRate.stands} stand{bestRate.stands === 1 ? '' : 's'}.
            </>
          ),
          tight.tight >= 2 && (
            <>
              <strong>{tight.followed}</strong> of your <strong>{tight.tight}</strong> tight overs ({TIGHT_RUNS} runs or fewer) were followed by a wicket in the next over
              {tight.by[0] && tight.by[0].wickets > 0 ? `, most often for ${personName(tight.by[0].id)} (${tight.by[0].wickets})` : ''}.
            </>
          ),
          duos.offMe.length > 0 && (
            <>
              Catches and stumpings off your bowling: <strong>{list(duos.offMe)}</strong>.
            </>
          ),
          duos.iTookFor.length > 0 && (
            <>
              You took them off the bowling of: <strong>{list(duos.iTookFor)}</strong>.
            </>
          ),
        ]}
      />
      {tight.tight === 1 && <p className="mt-2 text-xs text-muted">One tight over so far; the "wicket in the next over" count appears from two.</p>}
    </Panel>
  )
}
