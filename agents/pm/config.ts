import type { AgentConfig } from '../../src/agent.ts'

/** The name of the PM Agent's one Memory file. */
export const pmMemory = 'notes'

const pm: AgentConfig = {
  worker: { name: 'claude-code', model: 'opus', effort: 'medium' },
  fallbackWorker: { name: 'codex', model: 'gpt-6-astra', effort: 'medium' },
  permissions: 'read-only',
  inputs: {
    reviews: "This Run's reviews, one per Repo with new commits: its summary and findings, or why it failed",
    commits: 'The new commits on each Repo with any, newest first, with sha, author and subject',
    discord: "The Discord messages read in this Run; null when Discord wasn't read",
    runHealth: "The Steps before you that didn't succeed, and the Repos that failed to fetch",
    memory: 'Your Memory: the open items you carried from earlier Runs. Empty when you have none yet',
  },
  outputs: {
    repoLines: 'One line per Repo with new commits, on what changed',
    highlights: 'What on Discord matters to Saransh today',
    todos: 'What is pending on Saransh',
    memory: 'The whole of your Memory as you propose it, or null to leave it as it is',
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['repoLines', 'highlights', 'todos', 'memory'],
    properties: {
      repoLines: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['repo', 'line'], properties: { repo: { type: 'string' }, line: { type: 'string' } } },
      },
      highlights: { type: 'array', items: { type: 'string' } },
      todos: { type: 'array', items: { type: 'string' } },
      // Null first, so the fake Worker's smallest answer proposes no Memory.
      memory: { type: ['null', 'string'] },
    },
  },
  timeoutSeconds: 600,
  maxTurns: 10,
}

export default pm
