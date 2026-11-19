// The page behind a public scorecard link (PLAN §44). It needs no login and
// reads nothing from the data repo: everything it shows came inside the link.
import { useEffect, useState } from 'react'
import { decodeCard, type PublicCard } from '../lib/publicCard'

export function PublicScorecard({ code }: { code: string }) {
  const [card, setCard] = useState<PublicCard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setCard(null)
    setError(null)
    decodeCard(code)
      .then((c) => live && setCard(c))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [code])

  return (
    <div className="mx-auto min-h-screen max-w-2xl">
      <header className="app-header pt-[env(safe-area-inset-top)]">
        <div className="flex min-h-[52px] items-center px-4">
          <h1 className="text-lg font-bold">🏏 All Around Cricket</h1>
        </div>
      </header>
      <main className="flex flex-col gap-3 p-3 pb-10">
        {error && <p className="card px-4 py-8 text-center text-sm text-muted">{error}</p>}
        {!card && !error && <p className="p-10 text-center text-sm text-muted">Opening scorecard…</p>}
        {card && (
          <>
            <div className="card p-4">
              <p className="text-xs text-muted">{[card.date, card.venue].filter(Boolean).join(' · ')}</p>
              <h2 className="mt-0.5 text-lg font-bold">{card.title}</h2>
              <div className="mt-2">
                {card.innings.map((inn, n) => (
                  <div key={n} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-lg">{inn.team}</span>
                    <span className="shrink-0 text-xl font-semibold">
                      {inn.total}/{inn.wickets} <span className="text-sm font-normal text-muted">({inn.overs} ov)</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 border-t border-line pt-2 font-semibold">{card.result ?? 'Match in progress when this link was made'}</p>
              {card.awards?.potm && <p className="mt-1 text-sm">🏆 Player of the match: <strong>{card.awards.potm}</strong></p>}
              {card.awards?.batter && <p className="text-sm text-muted">Best batter: {card.awards.batter}</p>}
              {card.awards?.bowler && <p className="text-sm text-muted">Best bowler: {card.awards.bowler}</p>}
              <p className="mt-1 text-xs text-muted">{card.toss}</p>
            </div>

            {card.innings.map((inn, n) => (
              <section key={n} className="card overflow-hidden">
                <h3 className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2.5 font-semibold">
                  <span className="min-w-0 truncate">{inn.team}</span>
                  <span>
                    {inn.total}/{inn.wickets} <span className="text-sm font-normal text-muted">({inn.overs} ov)</span>
                  </span>
                </h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-alt text-xs text-muted">
                      <th className="px-2 py-1.5 text-left font-semibold">Batter</th>
                      {['R', 'B', '4s', '6s', 'SR'].map((h) => (
                        <th key={h} className="px-1.5 py-1.5 text-right font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {inn.bat.map(([name, how, r, b, fours, sixes], i) => (
                      <tr key={i}>
                        <td className="max-w-0 px-2 py-2" style={{ width: '46%' }}>
                          <span className="block truncate font-medium">{name}</span>
                          <span className="block truncate text-xs text-muted">{how}</span>
                        </td>
                        <td className="px-1.5 text-right font-bold">{r}</td>
                        <td className="px-1.5 text-right">{b}</td>
                        <td className="px-1.5 text-right">{fours}</td>
                        <td className="px-1.5 text-right">{sixes}</td>
                        <td className="px-1.5 pr-2 text-right">{b > 0 ? ((r * 100) / b).toFixed(1) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="space-y-1 border-y border-line px-3 py-2.5 text-sm">
                  <p>
                    <span className="font-semibold">Extras {inn.extras.reduce((s, x) => s + x, 0)}</span>{' '}
                    <span className="text-muted">
                      (b {inn.extras[0]}, lb {inn.extras[1]}, wd {inn.extras[2]}, nb {inn.extras[3]}
                      {inn.extras[4] ? `, pen ${inn.extras[4]}` : ''})
                    </span>
                  </p>
                  {inn.fow && (
                    <p>
                      <span className="font-semibold">Fall of wickets:</span> <span className="text-muted">{inn.fow}</span>
                    </p>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-alt text-xs text-muted">
                      <th className="px-2 py-1.5 text-left font-semibold">Bowler</th>
                      {['O', 'M', 'R', 'W'].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-right font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {inn.bowl.map(([name, overs, m, r, w], i) => (
                      <tr key={i}>
                        <td className="max-w-0 truncate px-2 py-2 font-medium" style={{ width: '52%' }}>
                          {name}
                        </td>
                        <td className="px-2 text-right">{overs}</td>
                        <td className="px-2 text-right">{m}</td>
                        <td className="px-2 text-right">{r}</td>
                        <td className="px-2 text-right font-bold">{w}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            <p className="px-2 text-center text-xs text-muted">Scored ball by ball with All Around Cricket. This page shows the score as it was when the link was shared.</p>
          </>
        )}
      </main>
    </div>
  )
}
