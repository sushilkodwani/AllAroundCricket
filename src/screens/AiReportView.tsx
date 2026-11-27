// One AI report on its own screen: the whole text, with WhatsApp and Copy.
import { ReportShare } from '../components/AiReportCard'
import { Markdown } from '../components/Markdown'
import { Screen } from '../components/Screen'
import { Empty } from '../components/ui'
import { KIND_LABEL } from '../lib/aiPrompts'
import { fmtDate, fmtStamp } from '../lib/dates'
import { P } from '../lib/paths'
import { useApp, useFile, useTeam } from '../state/AppContext'
import type { AiFile } from '../types'

export function AiReportView({ teamId, reportId }: { teamId: string; reportId: string }) {
  const { teams, personName } = useApp()
  const data = useTeam(teamId)
  const file = useFile<AiFile>(P.ai(teamId))
  const report = file?.reports.find((r) => r.id === reportId)
  const team = teams.find((t) => t.id === teamId)
  const match = report?.matchId ? data.matches.find((m) => m.id === report.matchId) : undefined
  const back = report?.kind === 'player' ? `/teams/${teamId}/players/${report.personId}` : report?.matchId ? `/teams/${teamId}/matches/${report.matchId}` : `/teams/${teamId}`

  if (!report) {
    return (
      <Screen title="AI report" back={`/teams/${teamId}`}>
        {file ? <Empty icon="🤷" title="Report not found" text="It may have been replaced by a newer one." /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>}
      </Screen>
    )
  }
  const subject = report.kind === 'player' ? personName(report.personId ?? '') : `${team?.shortName ?? 'Our team'} vs ${match?.opponent ?? ''}${match ? `, ${fmtDate(match.date)}` : ''}`
  return (
    <Screen title={KIND_LABEL[report.kind]} back={back}>
      <div className="flex flex-col gap-4 p-4">
        <div className="card flex flex-col gap-3 p-4">
          <div>
            <h2 className="text-lg font-bold">✨ {subject}</h2>
            <p className="text-xs text-muted">
              Made {fmtStamp(report.createdAt)}
              {report.createdBy ? ` by ${personName(report.createdBy)}` : ''} · AI suggestion
            </p>
          </div>
          <ReportShare report={report} heading={`${KIND_LABEL[report.kind]} · ${subject}`} />
        </div>
        <div className="card p-4">
          <Markdown text={report.text} />
        </div>
        <p className="px-1 text-xs text-muted">Made from the team’s own numbers. It is advice, not a guarantee, and a small number of matches can make any pattern look stronger than it is.</p>
      </div>
    </Screen>
  )
}
