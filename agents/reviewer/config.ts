import type { AgentConfig } from '../../src/agent.ts'
import type { JsonSchema } from '../../src/schema.ts'

/** Worst first. */
export const severities = ['critical', 'high', 'medium', 'low'] as const
export type Severity = (typeof severities)[number]

const finding: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['severity', 'file', 'line', 'commit', 'author', 'summary'],
  properties: {
    severity: { type: 'string', enum: severities },
    file: { type: 'string', description: 'Path from the Repo root' },
    line: { type: ['integer', 'null'], description: 'Null when the finding is about the whole file' },
    commit: { type: 'string', description: 'Full sha of the commit that introduced the problem' },
    author: { type: 'string', description: "That commit's author name" },
    summary: { type: 'string', description: 'One line: what is wrong and why it matters' },
  },
}

const reviewer: AgentConfig = {
  // A different model from the one that usually writes the code, for a genuine second opinion.
  worker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  fallbackWorker: { name: 'claude-code', model: 'opus', effort: 'high' },
  permissions: 'read-only',
  inputs: {
    repo: 'The Repo name',
    branch: 'Its production branch, checked out at `to` in the folder you run in',
    from: 'The last reviewed commit',
    to: 'The new head of the production branch',
    commits: 'The commits in from..to, newest first, with sha, author, date and subject',
    memory: 'Your Memory of this Repo: its conventions and the findings Saransh has waved off. Empty when you have none yet',
  },
  outputs: {
    summary: 'A short summary of what the commits change',
    findings: 'The problems the commits introduce, worst first',
    memory: 'The whole of your Memory of this Repo as you propose it, or null to leave it as it is',
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'findings', 'memory'],
    properties: {
      summary: { type: 'string' },
      findings: { type: 'array', items: finding },
      // Null first, so the fake Worker's smallest answer proposes no Memory.
      memory: { type: ['null', 'string'] },
    },
  },
  // 'review' instead queues each change for Saransh to accept or reject with `agents memory`.
  memoryChanges: 'apply',
  timeoutSeconds: 900,
  maxTurns: 40,
}

export default reviewer
