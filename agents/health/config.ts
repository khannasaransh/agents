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
    status: "The Lake's status as `pd status` printed it after the refresh: each market's latest session, the last refresh job, the Health report's verdict and flags, the Data gate's verdict with its reasons, the open Quarantines and the Corrections waiting for approval; null when it couldn't be read",
  },
  outputs: {
    diagnosis: 'What went wrong and why, in plain words',
    fix: 'The fix you propose, as text: what Saransh should do or change. It is never applied',
    evidence: 'Each thing you read that the diagnosis rests on: where you read it and what it shows',
    corrections: "The Corrections you propose for corporate actions Yahoo got wrong, in the Corrections file's format; none when no flag is one. They wait for Saransh's approval",
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['diagnosis', 'fix', 'evidence', 'corrections'],
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
      corrections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['security_id', 'kind', 'date', 'ratio', 'value', 'why'],
          properties: {
            security_id: { type: 'string', description: 'As the flag names it: IN:BHAGYANGR' },
            kind: { type: 'string', enum: ['split', 'dividend', 'demerger'] },
            date: { type: 'string', description: 'Its day, YYYY-MM-DD: the ex-date' },
            ratio: { type: ['number', 'null'], description: "A split's shares after per share before (2 for a 2-for-1 split or a 1:1 bonus); a demerger's share of the value the company kept, above 0 and under 1; null for a dividend" },
            value: { type: ['number', 'null'], description: "A dividend's cash per share, or null to drop it; null for a split or demerger" },
            why: { type: 'string', description: 'The evidence it rests on, in a sentence or two' },
          },
        },
      },
    },
  },
  timeoutSeconds: 900,
  maxTurns: 40,
}

export default health
