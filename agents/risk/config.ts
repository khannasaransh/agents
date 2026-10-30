import type { AgentConfig } from '../../src/agent.ts'
import { analystOutputSchema } from '../../src/desk.ts'

const risk: AgentConfig = {
  worker: { name: 'claude-code', model: 'opus', effort: 'medium' },
  fallbackWorker: { name: 'codex', model: 'gpt-6-astra', effort: 'medium' },
  permissions: 'read-only',
  // Only to check one item, citing its source; nothing about Saransh's money is in its inputs to search for.
  webSearch: true,
  inputs: {
    names: "Each Book's buys today, which you review together, each with its Book, its paper Book's plan, and what you read of its dossier: its sector and industry, its last three months of daily bars with volume, MarketSmith's snapshot (its ratings, red flags and estimates), its events from the Feeds and the strategy and signal behind its order",
    holdings: "By Book, the names its paper Book holds now, each with its sector and its results and board meetings to come: what the buys add to. No shares or values",
    feeds: "Each Feeds source in this Run: whether it was fetched, or failed so its events are as last fetched; null when the Feeds weren't fetched",
  },
  outputs: {
    views: 'Your view of each buy: none, veto or trim, with your reasons and the evidence you cite',
    searches: 'Each web search you made: its query and the link of the source it found',
  },
  outputSchema: analystOutputSchema,
  timeoutSeconds: 900,
  maxTurns: 25,
}

export default risk
