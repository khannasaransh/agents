import type { AgentConfig } from '../../src/agent.ts'

const health: AgentConfig = {
  // Claude Code first: on Windows, Codex's unelevated sandbox can't enforce the deny-read rules that
  // keep it from the Tools this Agent doesn't declare, so Codex refuses to start there.
  worker: { name: 'claude-code', model: 'opus', effort: 'high' },
  fallbackWorker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  permissions: 'read-only',
  inputs: {
    why: 'Why you were called: the Lake Step failed, its status couldn\'t be read, the Data gate failed, or the Health report flags something',
    lake: 'What the Lake Step did in this Run: the refreshes it cleared, each run of pd daily with its exit code, and whether one succeeded; null when it recorded nothing',
    lakeLog: "The end of the Lake Step's log in this Run, which holds pd daily's output",
    status: "The Lake's status as `pd status` printed it after the refresh: each market's latest session, the last refresh job, the Health report's verdict and flags, and the Data gate's verdict with its reasons; null when it couldn't be read",
  },
  outputs: {
    diagnosis: 'What went wrong and why, in plain words',
    fix: 'The fix you propose, as text: what Saransh should do or change. It is never applied',
    evidence: 'Each thing you read that the diagnosis rests on: where you read it and what it shows',
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['diagnosis', 'fix', 'evidence'],
    properties: {
      diagnosis: { type: 'string' },
      fix: { type: 'string' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'shows'],
          properties: {
            source: { type: 'string', description: "A path from ash_new's folder, or the name of an input" },
            shows: { type: 'string', description: 'What it shows, in one line' },
          },
        },
      },
    },
  },
  timeoutSeconds: 900,
  maxTurns: 40,
}

export default health
