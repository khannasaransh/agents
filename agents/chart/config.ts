import type { AgentConfig } from '../../src/agent.ts'
import { analystOutputSchema } from '../../src/desk.ts'

const chart: AgentConfig = {
  // Claude Code first: on Windows, Codex's unelevated sandbox can't enforce a deny-read rule, so Codex
  // refuses to start there (see the Health Agent). No web access on either.
  worker: { name: 'claude-code', model: 'opus', effort: 'medium' },
  fallbackWorker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  permissions: 'read-only',
  inputs: {
    names: "The buys you review today, each with its Book, its paper Book's plan, and what you read of its dossier: its last session, about a year of daily bars (open, high, low, close, volume, the RS Rating that day and the close's distance from its 52-week high) and the strategy and signal behind its order",
  },
  outputs: {
    views: 'Your view of each buy: none, veto or trim, with your reasons and the evidence you cite',
    searches: 'Always empty: you have no web access',
  },
  outputSchema: analystOutputSchema,
  timeoutSeconds: 900,
  maxTurns: 25,
}

export default chart
