import type { AgentConfig } from '../../src/agent.ts'

/** The wiki's main line, where Saransh merges the docs branch once he has reviewed it. */
export const mainLine = 'main'

/** The one rolling branch the Docs Agent works on, until Saransh merges it. */
export const docsBranch = 'agents/docs'

const docs: AgentConfig = {
  worker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  fallbackWorker: { name: 'claude-code', model: 'opus', effort: 'high' },
  // The folder it runs in: its own worktree of the wiki.
  permissions: { write: ['.'] },
  inputs: {
    pages: 'The wiki pages to update: each with the sources it cites that new commits changed, and those changed files',
    repos: 'Each Repo with commits the wiki is not up to date with: its production branch, local clone, the commit the wiki was last brought up to (from) and its pin (to), its new head',
    pinsFile: 'The pins file naming each of those Repos at its pin, for your Tools',
    prds: 'Each file waiting in the PRD inbox: its name there (file), where it is staged in the folder you run in (staged), and the Discord message it was posted in, or null when Saransh dropped it in by hand (discordMessage)',
    prdPinsFile: 'The pins file naming every Repo fetched in this Run at its pin, for tracing PRDs; null when the PRD inbox is empty',
  },
  tools: {
    code: 'code <pins file> <repo> show <path> | ls [<path>] | grep <pattern> [<path>] | log <from> [<path>] | diff <from> [<path>]: reads a Repo at its pin, the only way you read code',
    finish: "finish <pins file> <page>…: runs the wiki's regions, stamp and check tools on the pages you changed, stopping at the first that fails; exits 0 once each succeeds and the check reports no errors",
    prd: "prd convert <staged file> | add <staged file> <codebase> <feature>: convert prints where it wrote a staged Word file as Markdown, for reading; add copies a staged file into the Codebase's PRD sources under its own name and converts it into _runs/prds/<feature>/ for the PRD skill",
  },
  outputs: {
    pages: 'Each page you changed from new commits, with one line on what changed in it',
    prds: 'Each file from the PRD inbox you turned into a PRD page: its name in the inbox, its Codebase, its PRD page, and one line on what the PRD covers',
    skipped: "Each file from the PRD inbox you didn't turn into a PRD page, with one line on why",
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pages', 'prds', 'skipped'],
    properties: {
      pages: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['page', 'summary'], properties: { page: { type: 'string' }, summary: { type: 'string' } } },
      },
      prds: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['file', 'codebase', 'page', 'summary'],
          properties: { file: { type: 'string' }, codebase: { type: 'string' }, page: { type: 'string' }, summary: { type: 'string' } },
        },
      },
      skipped: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['file', 'reason'], properties: { file: { type: 'string' }, reason: { type: 'string' } } },
      },
    },
  },
  // A PRD takes the wiki's whole PRD skill: converting, tracing the code, writing, checking and verifying.
  timeoutSeconds: 3600,
  maxTurns: 200,
}

export default docs
