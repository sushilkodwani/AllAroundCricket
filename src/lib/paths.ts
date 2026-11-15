// File layout of the private data repo (PLAN §6.1).
export const P = {
  config: 'config/app.json',
  categories: 'config/expense-categories.json',
  people: 'people.json',
  creds: 'auth/credentials.json',
  teams: 'teams.json',
  subs: 'push/subscriptions.json',
  members: (teamId: string) => `teams/${teamId}/members.json`,
  matches: (teamId: string) => `teams/${teamId}/matches.json`,
  funds: (teamId: string) => `teams/${teamId}/funds.json`,
}
