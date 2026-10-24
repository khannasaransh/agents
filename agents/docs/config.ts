import type { AgentConfig } from '../../src/agent.ts'

/** The wiki's main line, where Saransh merges the docs branch once he has reviewed it. */
export const mainLine = 'main'

/** The one rolling branch the Docs Agent works on, until Saransh merges it. */
export const docsBranch = 'agents/docs'

const docs: AgentConfig = {
  worker: { name: 'claude-code', model: 'opus', effort: 'high' },
  fallbackWorker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  // The folder it runs in: its own worktree of the wiki.
  permissions: { write: ['.'] },
  inputs: {
    pages: 'The wiki pages to update: each with the sources it cites that new commits changed, and those changed files',
    repos: 'Each Repo with new commits: its production branch, local clone, the last reviewed commit (from) and its pin (to), its new head',
    pinsFile: 'The pins file naming each of those Repos at its pin, for your Tools',
  },
  tools: {
    code: 'code <pins file> <repo> show <path> | ls [<path>] | grep <pattern> [<path>] | log <from> [<path>] | diff <from> [<path>]: reads a Repo at its pin, the only way you read code',
    finish: "finish <pins file> <page>…: runs the wiki's regions, stamp and check tools on the pages you changed; exits 0 once the check reports no errors",
  },
  outputs: {
    pages: 'Each page you changed, with one line on what changed in it',
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pages'],
    properties: {
      pages: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['page', 'summary'], properties: { page: { type: 'string' }, summary: { type: 'string' } } },
      },
    },
  },
  timeoutSeconds: 1800,
  maxTurns: 80,
}

export default docs
