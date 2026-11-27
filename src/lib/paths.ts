// File layout of the private data repo (PLAN §6.1).
export const P = {
  config: 'config/app.json',
  admins: 'config/admins.json',
  /** The Gemini key for the AI reports; written by the super admin only. */
  aiConfig: 'config/ai.json',
  people: 'people.json',
  creds: 'auth/credentials.json',
  teams: 'teams.json',
  subs: 'push/subscriptions.json',
  opponents: 'opponents.json',
  tournaments: 'tournaments.json',
  grounds: 'grounds.json',
  outbox: 'push/outbox.json',
  /** Each picture is its own small file so people.json / teams.json stay light. */
  personPhoto: (personId: string) => `images/people/${personId}.json`,
  teamLogo: (teamId: string) => `images/teams/${teamId}.json`,
  availability: (teamId: string) => `teams/${teamId}/availability.json`,
  /** Ball-by-ball log of one match. Deliberately not matches.json: the notifier watches that. */
  scoring: (teamId: string, matchId: string) => `teams/${teamId}/scoring/${matchId}.json`,
  members: (teamId: string) => `teams/${teamId}/members.json`,
  matches: (teamId: string) => `teams/${teamId}/matches.json`,
  funds: (teamId: string) => `teams/${teamId}/funds.json`,
  categories: (teamId: string) => `teams/${teamId}/categories.json`,
  seasons: (teamId: string) => `teams/${teamId}/seasons.json`,
  /** AI reports (match plans, match reviews, player plans) the team's admin generated; everyone in the team reads them. */
  ai: (teamId: string) => `teams/${teamId}/ai.json`,
}
