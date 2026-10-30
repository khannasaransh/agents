import type { AgentConfig } from '../../src/agent.ts'

/** How a sprint task stands, from what the PM Agent can see. */
export const taskStatuses = ['no-signal', 'in-progress', 'in-testing', 'blocked', 'done'] as const
export type TaskStatus = (typeof taskStatuses)[number]

/** The name of the PM Agent's one Memory file. */
export const pmMemory = 'notes'

const pm: AgentConfig = {
  worker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  fallbackWorker: { name: 'claude-code', model: 'opus', effort: 'medium' },
  permissions: 'read-only',
  inputs: {
    reviews:
      "The reviews of this Run, and of earlier Runs whose PM failed, oldest Run first, one per Repo with new commits in that Run: its summary and findings, or why it failed",
    commits: 'The new commits on each Repo with any, in this Run and in earlier Runs whose PM failed, oldest Run first, each newest first, with sha, author and subject',
    discord:
      "The Discord messages read in this Run and in earlier Runs whose PM failed, oldest first, each with its channel, thread, author, time, content and link, whether it came in a DM with the bot, and whether it mentions Saransh or is his own; null when Discord wasn't read",
    runHealth: "The Steps before you that didn't succeed, and the Repos that failed to fetch",
    memory: 'Your Memory: the open items you carried from earlier Runs. Empty when you have none yet',
    sprint:
      "The latest sprint post in the sprint channel, whenever it was posted: who posted it and when, its link, the line naming the sprint, its tasks, each with an id, title, product, PM and assignees with their Team, and as `updates` every Discord message posted after it, oldest first, shaped as in `discord` but without PRD links; null when there is none",
    previousTaskStatus:
      'How you said each task of the same sprint post stood in the last Run that reported on it, with that Run and its status, note and evidence per task id; null when no earlier Run did',
    branches:
      "The work on each Repo's branches other than its production branch since the sprint post: per Repo, its Team, its production branch, and each branch with commits since the post that aren't on production, with their count and the latest of them, newest first, with sha, author, date and subject; null when they weren't read",
  },
  outputs: {
    repoLines: 'One line per Repo with new commits, on what changed',
    highlights: 'What on Discord matters to Saransh today',
    todos: 'What is pending on Saransh',
    memory: 'The whole of your Memory as you propose it, or null to leave it as it is',
    taskStatus: 'How each task of the sprint post stands, one per task id, with a note and the evidence for it',
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['repoLines', 'highlights', 'todos', 'memory', 'taskStatus'],
    properties: {
      repoLines: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['repo', 'line'], properties: { repo: { type: 'string' }, line: { type: 'string' } } },
      },
      highlights: { type: 'array', items: { type: 'string' } },
      todos: { type: 'array', items: { type: 'string' } },
      // Null first, so the fake Worker's smallest answer proposes no Memory.
      memory: { type: ['null', 'string'] },
      taskStatus: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'status', 'note', 'evidence'],
          properties: {
            id: { type: 'string', description: "The task's id in `sprint`" },
            status: { type: 'string', enum: taskStatuses },
            note: { type: 'string', description: 'One plain sentence on where it stands and what is next' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Each commit or message the status rests on, one line each' },
          },
        },
      },
    },
  },
  timeoutSeconds: 600,
  maxTurns: 10,
}

export default pm
