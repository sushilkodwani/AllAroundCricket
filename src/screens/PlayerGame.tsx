// More for a player's Insights tab: what kind of player the numbers say they are (with a
// shareable season card) and how steady they are. See lib/playerSeason.ts.
import { useMemo, useState } from 'react'
import { Insights, Panel, Tiles } from '../components/playerViz'
import type { PlayerData } from '../lib/playerAnalysis'
import { KICK_ON_RUNS, MIN_BAT_BALLS, MIN_BOWL_BALLS, MIN_INNINGS, START_RUNS, consistencyOf, type Archetype } from '../lib/playerSeason'

export function YourGame({ archetypes, onShare, onShareReport }: { archetypes: Archetype[]; onShare?: () => void; onShareReport?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <section className="card p-4">
      <h3 className="font-semibold">Your game</h3>
      {archetypes.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {archetypes.map((a) => (
            <div key={a.key} className="flex items-start gap-3 rounded-xl bg-alt px-3 py-2.5">
              <span className="text-2xl leading-none" aria-hidden>
                {a.emoji}
              </span>
              <span className="min-w-0">
                <strong className="block">{a.label}</strong>
                <span className="block text-sm text-muted">{a.why}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Not enough yet to say what kind of player you are. It needs {MIN_BAT_BALLS}+ balls batting over 3 innings, or {MIN_BOWL_BALLS}+ balls bowling.
        </p>
      )}
      {onShareReport && (
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onShareReport().finally(() => setBusy(false))
          }}
        >
          {busy ? 'Building your report…' : 'Share season report (PDF)'}
        </button>
      )}
      {onShare && (
        <button type="button" className="btn-secondary mt-2 w-full" onClick={onShare}>
          Share as a picture
        </button>
      )}
    </section>
  )
}

const f0 = (n: number) => String(Math.round(n))

export function Consistency({ d }: { d: PlayerData }) {
  const c = useMemo(() => consistencyOf(d), [d])
  if (!c.bat && !c.bowl) return null
  const b = c.bat
  const w = c.bowl
  return (
    <Panel title="Consistency" sub="How steady your scores and spells are. Not-out scores count as they stand.">
      {b && (
        <>
          <p className="text-sm font-semibold">Batting</p>
          <Tiles
            cols={3}
            items={[
              ['Median score', f0(b.median)],
              ['Best / worst', `${b.best} / ${b.worst}`],
              ['Ducks', b.ducks],
              [`${START_RUNS}+ scores`, `${b.starts} of ${b.innings}`],
              [`Went on to ${KICK_ON_RUNS}+`, b.starts > 0 ? `${b.kickedOn} of ${b.starts}` : '–'],
              ['Style', b.label ?? '–'],
            ]}
          />
          <Insights
            items={[
              b.starts >= 3 && (
                <>
                  You turn <strong>{Math.round((b.kickedOn * 100) / b.starts)}%</strong> of your {START_RUNS}+ starts into {KICK_ON_RUNS}+.
                </>
              ),
              b.label === 'Boom or bust' && <>A few big scores carry your average; the median shows what you usually make.</>,
              b.label === 'Steady' && <>Your scores stay close to your average, innings after innings.</>,
              b.label === null && <>A steadiness label needs {MIN_INNINGS}+ innings.</>,
            ]}
          />
        </>
      )}
      {w && (
        <>
          <p className={`text-sm font-semibold ${b ? 'mt-4' : ''}`}>Bowling</p>
          <Tiles
            cols={3}
            items={[
              ['Spells', w.innings],
              ['Took a wicket', `${w.withWicket} of ${w.innings}`],
              ['10+ an over', w.expensive],
            ]}
          />
        </>
      )}
      <p className="mt-2 text-xs text-muted">Style compares the spread of your scores with your average: under 0.8 is Steady, up to 1.3 Mixed, above that Boom or bust.</p>
    </Panel>
  )
}
