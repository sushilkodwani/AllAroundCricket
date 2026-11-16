// Public scorecard link (PLAN §44). There is no server and the data repo is
// private, so the scorecard itself travels inside the link: a compact summary,
// compressed and put after the # of the app's own address. Opening the link
// shows it without any login. Nothing is uploaded anywhere, and the link holds
// player names and scores only — never numbers, money or the access token.
import type { ScoreFile } from '../types'
import { howOut, summarize } from './scorecard'
import { battingSide, oversText } from './scoring'

export interface PublicInnings {
  team: string
  total: number
  wickets: number
  overs: string
  /** b, lb, wd, nb, pen */
  extras: [number, number, number, number, number]
  /** name, how out, runs, balls, fours, sixes */
  bat: [string, string, number, number, number, number][]
  /** name, overs, maidens, runs, wickets */
  bowl: [string, string, number, number, number][]
  fow: string
}

export interface PublicCard {
  v: 1
  title: string
  date?: string
  venue?: string
  toss: string
  result?: string
  awards?: { potm?: string; batter?: string; bowler?: string }
  innings: PublicInnings[]
}

export function buildPublicCard(file: ScoreFile, nameOf: (id: string) => string, meta: { date?: string; venue?: string }): PublicCard {
  const named = (id?: string) => (id ? nameOf(id) : undefined)
  return {
    v: 1,
    title: `${file.home.name} v ${file.away.name}`,
    date: meta.date,
    venue: meta.venue,
    toss: `${file[file.toss.wonBy].name} won the toss and chose to ${file.toss.chose}`,
    result: file.result?.text,
    awards: file.awards ? { potm: named(file.awards.potm), batter: named(file.awards.batter), bowler: named(file.awards.bowler) } : undefined,
    innings: file.innings.map((inn, idx) => {
      const s = summarize(file, idx)
      return {
        team: battingSide(file, inn).name,
        total: s.total,
        wickets: s.wickets,
        overs: s.overs,
        extras: [s.extras.b, s.extras.lb, s.extras.wd, s.extras.nb, s.extras.pen],
        bat: s.batters.map((b) => [nameOf(b.id), inn.closed && !b.out && !b.retiredHurt ? 'not out' : howOut(b, nameOf), b.runs, b.balls, b.fours, b.sixes]),
        bowl: s.bowlers.filter((b) => b.balls > 0 || b.runs > 0).map((b) => [nameOf(b.id), oversText(b.balls), b.maidens, b.runs, b.wickets]),
        fow: s.fow.map((f) => `${f.score}-${f.n} (${nameOf(f.who)}, ${f.over})`).join(', '),
      }
    }),
  }
}

// ---------- link encoding ----------
const toB64Url = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64Url = (text: string): Uint8Array => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  // Errors surface through the readable side; these two must not go unhandled as well.
  writer.write(bytes).catch(() => {})
  writer.close().catch(() => {})
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

/** "z…" = compressed, "j…" = plain (browsers without CompressionStream). */
export async function encodeCard(card: PublicCard): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(card))
  if (typeof CompressionStream === 'function') return `z${toB64Url(await pipe(bytes, new CompressionStream('deflate')))}`
  return `j${toB64Url(bytes)}`
}

export async function decodeCard(code: string): Promise<PublicCard> {
  let bytes: Uint8Array
  try {
    bytes = fromB64Url(code.slice(1))
    if (code[0] === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('old-browser')
      bytes = await pipe(bytes, new DecompressionStream('deflate'))
    } else if (code[0] !== 'j') throw new Error('bad')
    const card = JSON.parse(new TextDecoder().decode(bytes)) as PublicCard
    if (card?.v !== 1 || !Array.isArray(card.innings) || typeof card.title !== 'string') throw new Error('bad')
    return card
  } catch (e) {
    throw new Error((e as Error).message === 'old-browser' ? 'This browser is too old to open the scorecard. Try a newer one.' : 'This scorecard link is incomplete or damaged. Ask for it to be sent again.')
  }
}

/** The full address to share. */
export const cardUrl = (code: string): string => `${window.location.origin}${window.location.pathname}#/s/${code}`
