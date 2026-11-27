// A player's page (PLAN §28, §39, §40): profile card, then the detailed
// analysis in four tabs (Batting, Bowling, Compare, Face off) over a set of matches.
import { useMemo, useState } from 'react'
import { squadOf } from '../lib/scoring'
import { FilterChips } from '../components/playerViz'
import { AiReportCard } from '../components/AiReportCard'
import { ProfileCard, ProfileSheet } from '../components/Profile'
import { Screen } from '../components/Screen'
import { useScores } from '../components/StatsTab'
import { BadgesCard } from '../components/Badges'
import { GoalsCard } from '../components/Goals'
import { badgesOf, earnedBadges } from '../lib/badges'
import { drawSeasonCard } from '../lib/seasonCard'
import type { Wrapped } from '../lib/playerSeason'
import type { Report } from '../lib/seasonReport'
import { careerStats } from '../lib/career'
import { fmtDate } from '../lib/dates'
import { drawHighlightCard, type HighlightKind } from '../lib/highlightCard'
import { shareResultCard } from '../lib/resultCard'
import { groundByName } from '../lib/domain'
import { inYear, playerData, yearsOf, type PlayerCtx } from '../lib/playerAnalysis'
import { useApp, useTeam } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import type { Match } from '../types'
import { BattingTab, BowlingTab } from './PlayerTabs'
import { InsightsTab } from './PlayerInsights'
import { CompareTab, FaceOffTab } from './PlayerVs'

/** Last few scores as chips, newest first. */
export function FormStrip({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="w-12 text-xs text-muted">{label}</span>
      {values.map((v, n) => (
        <span key={n} className={`rounded-md px-2 py-0.5 text-xs font-semibold ${n === 0 ? 'bg-ink text-bg' : 'bg-alt'}`}>
          {v}
        </span>
      ))}
    </p>
  )
}

export function PlayerStats({ teamId, personId }: { teamId: string; personId: string }) {
  const data = useTeam(teamId)
  return <PlayerStatsView personId={personId} teamId={teamId} matches={data.matches} loading={!data.ready} back={`/teams/${teamId}`} teamName={data.team?.name ?? ''} color={data.team?.color} />
}

/** A player's page over any set of matches (one of our teams, or every match against an opponent). */
export function PlayerStatsView({ personId, teamId, matches, loading, back, teamName, color }: { personId: string; /** Our own team: its admin can ask for the weekly AI plan. */ teamId?: string; matches: Match[]; loading?: boolean; back: string; teamName: string; color?: string }) {
  const { people, personName, canManage, session, store, toast } = useApp()
  const sheet = useSheet()
  const { files, scored, ready } = useScores(matches)
  const stamp = files.map((f) => f.updatedAt).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => careerStats(files).get(personId), [stamp, personId])
  const person = people.find((p) => p.id === personId)
  const name = personName(personId)
  const route = useRoute()
  const tabQ = route.query.get('ptab')
  const tab = tabQ === 'bowling' || tabQ === 'insights' || tabQ === 'compare' || tabQ === 'faceoff' ? tabQ : 'batting'
  const [year, setYear] = useState('all')
  const ctx: PlayerCtx = {
    styleOf: (id) => people.find((p) => p.id === id)?.bowlStyle,
    leftOf: (id) => !!people.find((p) => p.id === id)?.batsLeft,
    pitchOf: (mid) => (store ? groundByName(store, scored.find((m) => m.id === mid)?.venue)?.pitch : undefined),
    dateOf: (mid) => scored.find((m) => m.id === mid)?.date ?? '',
    opponentOf: (mid) => scored.find((m) => m.id === mid)?.opponent ?? '',
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => playerData(files, personId, ctx), [stamp, personId, people])
  const years = yearsOf(all)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const badges = useMemo(() => badgesOf(files, personId, (mid) => scored.find((m) => m.id === mid)?.date ?? ''), [stamp, personId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yearFiles = useMemo(() => (year === 'all' ? files : files.filter((f) => (scored.find((m) => m.id === f.matchId)?.date ?? '').startsWith(year))), [stamp, year])
  // Everyone who played in these matches, for Compare.
  const players = [...new Set(files.flatMap((f) => [...squadOf(f.home), ...squadOf(f.away)]))].sort((a, b) => personName(a).localeCompare(personName(b)))
  // Their own profile; the admin of a team they are in (or a player in no team); the super admin.
  // Profile and goals are the player's own: nobody else edits them, admins included.
  const canEdit = !!person && !!store && session?.personId === personId

  if (loading || !ready) {
    return (
      <Screen title={name} back={back}>
        <p className="p-10 text-center text-sm text-muted">Loading…</p>
      </Screen>
    )
  }

  const matchOf = (id: string) => scored.find((m) => m.id === id)
  const tabs = [
    { value: 'batting' as const, label: 'Batting' },
    { value: 'bowling' as const, label: 'Bowling' },
    { value: 'insights' as const, label: 'Insights' },
    { value: 'compare' as const, label: 'Compare' },
    { value: 'faceoff' as const, label: 'Face off' },
  ]
  const d = inYear(all, year)
  /** A picture of their innings or spell in one match, through the phone's share sheet. */
  async function share(matchId: string, kind: HighlightKind) {
    const file = files.find((f) => f.matchId === matchId)
    const m = matchOf(matchId)
    if (!file || !m) return
    try {
      const mine = squadOf(file.home).includes(personId) ? file.home : file.away
      const theirs = mine === file.home ? file.away : file.home
      const canvas = drawHighlightCard(file, personId, kind, { name, team: mine.name, color, opponent: theirs.name, date: fmtDate(m.date), venue: m.venue, jersey: person?.jersey }, personName)
      const how = await shareResultCard(canvas, `${name.replace(/\s+/g, '-')}-${kind === 'bat' ? 'batting' : 'bowling'}.png`, `${name} vs ${theirs.name}`)
      if (how === 'downloaded') toast('Image saved — share it from your photos or downloads')
    } catch (e) {
      toast((e as Error).message)
    }
  }
  /** The season (or all matches, for the chosen year) as one picture, through the phone's share sheet. */
  async function shareSeason(w: Wrapped) {
    try {
      const canvas = drawSeasonCard(w, { name, team: teamName, color, jersey: person?.jersey })
      const how = await shareResultCard(canvas, `${name.replace(/\s+/g, '-')}-${w.label.replace(/\s+/g, '-')}.png`, `${name} — ${w.label}`)
      if (how === 'downloaded') toast('Image saved — share it from your photos or downloads')
    } catch (e) {
      toast((e as Error).message)
    }
  }
  /** The full season report as a PDF: overview, batting, bowling and insights pages. */
  async function shareReport(r: Report) {
    try {
      const [{ drawReportPages }, { canvasesToPdf, sharePdf }] = await Promise.all([import('../lib/reportDraw'), import('../lib/pdf')])
      const pdf = await canvasesToPdf(drawReportPages(r), `${name} - ${r.label}`)
      const how = await sharePdf(pdf, `${name.replace(/\s+/g, '-')}-${r.label.replace(/\s+/g, '-')}.pdf`, `${name} — ${r.label}`)
      if (how === 'downloaded') toast('Report saved — find it in your downloads')
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const props = { personId, d, name, personName, left: !!person?.batsLeft, matchOf, career: year === 'all' ? c : careerStats(yearFiles).get(personId), share }

  return (
    <Screen title={name} back={back}>
      <div className="flex flex-col gap-4 p-4">
        <ProfileCard person={person} name={name} teamName={teamName} color={color} career={c} onEdit={canEdit ? () => sheet.open('profile') : undefined} />

        {teamId && c && person && <AiReportCard teamId={teamId} kind="player" id={personId} isAdmin={session?.personId === personId} />}

        {c && <BadgesCard badges={badges} name={name} />}
        {person && <GoalsCard person={person} data={all} canEdit={canEdit} own={session?.personId === personId} />}

        {!c && <p className="card px-4 py-5 text-center text-sm text-muted">No scored matches yet. Batting, bowling and fielding figures appear after the first ball-by-ball match.</p>}

        {c && (
          <>
            <div className="sticky top-0 z-10 -mx-4 bg-bg px-4 pb-2 pt-1">
              <div className="-mx-4 flex overflow-x-auto border-b border-line px-2 [scrollbar-width:none]" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t.value}
                    role="tab"
                    aria-selected={tab === t.value}
                    className={`min-h-[44px] shrink-0 border-b-2 px-3 text-sm font-semibold ${tab === t.value ? 'border-brand text-accent' : 'border-transparent text-muted'}`}
                    onClick={() => navigate(withQuery(route, { ptab: t.value }), { replace: true })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {years.length > 1 && (
                <div className="mt-2">
                  <FilterChips options={[{ value: 'all', label: 'All years' }, ...years.map((y) => ({ value: y, label: y }))]} value={year} onChange={setYear} />
                </div>
              )}
            </div>
            {tab === 'batting' && <BattingTab {...props} />}
            {tab === 'bowling' && <BowlingTab {...props} />}
            {tab === 'insights' && <InsightsTab personId={personId} badges={earnedBadges(badges).length} onShareSeason={shareSeason} meta={{ name, team: teamName, color, jersey: person?.jersey }} onShareReport={shareReport} d={d} files={yearFiles} ctx={ctx} personName={personName} matchOf={matchOf} />}
            {tab === 'compare' && <CompareTab personId={personId} d={d} files={yearFiles} ctx={ctx} personName={personName} players={players} matchOf={matchOf} />}
            {tab === 'faceoff' && <FaceOffTab personId={personId} d={d} personName={personName} ctx={ctx} matchOf={matchOf} />}
          </>
        )}
      </div>

      {sheet.name === 'profile' && person && canEdit && <ProfileSheet person={person} onClose={sheet.close} />}
    </Screen>
  )
}
