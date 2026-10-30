import type { AgentConfig } from '../../src/agent.ts'
import { analystOutputSchema } from '../../src/desk.ts'

const events: AgentConfig = {
  // Codex first; Claude Code, its fallback, gives the Desk a second model's view.
  worker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  fallbackWorker: { name: 'claude-code', model: 'opus', effort: 'medium' },
  permissions: 'read-only',
  // Only to check one item, citing its source; nothing about Saransh's money is in its inputs to search for.
  webSearch: true,
  inputs: {
    names: "The names you review today, each with its Book, its paper Book's plan, whether it is a buy or a holding, the events coming in the next 5 sessions and those new since your last view (by id), and what you read of its dossier: MarketSmith's snapshot, its fundamentals, its events from the Feeds (results dates, announcements, pledges, filings, insiders' trades) and the strategy and signal behind its order",
    feeds: "Each Feeds source in this Run: whether it was fetched, or failed so its events are as last fetched; null when the Feeds weren't fetched",
  },
  outputs: {
    views: 'Your view of each name: none, veto, trim or exit, with your reasons and the evidence you cite',
    searches: 'Each web search you made: its query and the link of the source it found',
  },
  outputSchema: analystOutputSchema,
  timeoutSeconds: 900,
  maxTurns: 25,
}

export default events
