// PM: runs the PM Agent once on what the Run holds so far: its reviews, the new commits, its Discord
// messages and its health. It records the Agent's answer as pm.json in the Run folder, for the Brief.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../src/agent.ts'
import { readJson, readJsonFiles, writeJson } from '../src/files.ts'
import { readMemory } from '../src/memory.ts'
import { readRun } from '../src/run.ts'
import { runAsStep } from '../src/step.ts'
import { callAgent } from '../src/worker.ts'
import { pmMemory } from '../agents/pm/config.ts'
import type { DiscordRead } from './discord.ts'
import type { FetchResult } from './fetch.ts'
import type { ReviewResult } from './review.ts'

/** The PM Agent's answer, as its output schema shapes it. */
interface PmAnswer {
  repoLines: { repo: string; line: string }[]
  highlights: string[]
  todos: string[]
  /** The whole Memory the PM Agent proposes, which Save state applies or queues; null to leave it as it is. */
  memory: string | null
}

/** What PM writes, as pm.json in the Run folder. */
export type PmResult = ({ status: 'answered' } & PmAnswer) | { status: 'failed'; error: string }

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'pm.json')
  if (!force && existsSync(out) && readJson<PmResult>(out).status === 'answered') {
    console.log('PM already answered in this Run, skipping')
    return
  }
  const run = readRun(runId)
  const pm = await loadAgent('pm')
  const results = readJsonFiles<FetchResult>(join(runFolder, 'fetch'))
  const covers = (review: ReviewResult) =>
    results.some((r) => r.repo === review.repo && r.status === 'new-commits' && r.previous === review.from && r.head === review.to)
  const reviews = readJsonFiles<ReviewResult>(join(runFolder, 'review'))
    .filter(covers)
    .map((review) => {
      if (review.status !== 'reviewed') return review
      const { memory, ...reviewed } = review
      return reviewed
    })
  const commits = results.flatMap((r) =>
    r.status === 'new-commits' ? [{ repo: r.repo, team: r.team, branch: r.branch, commits: r.commits.map(({ sha, author, subject }) => ({ sha, author, subject })) }] : [],
  )
  const earlier = run.steps.slice(0, run.steps.findIndex((s) => s.name === 'pm'))
  const runHealth = {
    steps: earlier.filter((s) => s.status !== 'succeeded').map(({ name, status }) => ({ name, status })),
    failedToFetch: results.flatMap((r) => (r.status === 'failed' ? [{ repo: r.repo, team: r.team, error: r.error }] : [])),
  }
  const discordFile = join(runFolder, 'discord.json')
  const discord = existsSync(discordFile) ? readJson<DiscordRead>(discordFile).messages : null
  const inputs = { reviews, commits, discord, runHealth, memory: readMemory(pm.name, pmMemory) }
  try {
    const answer = (await callAgent(pm, inputs, { cwd: runFolder, dryRun: run.dryRun ?? false })) as PmAnswer
    writeJson(out, { status: 'answered', ...answer } satisfies PmResult)
    console.log(`PM answered: ${answer.repoLines.length} Repo lines, ${answer.todos.length} To-dos`)
  } catch (error) {
    const result: PmResult = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    writeJson(out, result)
    throw new Error(`PM failed: ${result.error}`)
  }
})
