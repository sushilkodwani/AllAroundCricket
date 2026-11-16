// File layout of the private data repo (PLAN §6.1).
export const P = {
  config: 'config/app.json',
  categories: 'config/expense-categories.json',
  people: 'people.json',
  creds: 'auth/credentials.json',
  teams: 'teams.json',
  subs: 'push/subscriptions.json',
  opponents: 'opponents.json',
  tournaments: 'tournaments.json',
  grounds: 'grounds.json',
  outbox: 'push/outbox.json',
  availability: (teamId: string) => `teams/${teamId}/availability.json`,
  /** Ball-by-ball log of one match. Deliberately not matches.json: the notifier watches that. */
  scoring: (teamId: string, matchId: string) => `teams/${teamId}/scoring/${matchId}.json`,
  members: (teamId: string) => `teams/${teamId}/members.json`,
  matches: (teamId: string) => `teams/${teamId}/matches.json`,
  funds: (teamId: string) => `teams/${teamId}/funds.json`,
}
