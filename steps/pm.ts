// PM: runs the PM Agent once on what the Run holds so far: its reviews, the new commits, its Discord
// messages and its health, with those of earlier Runs whose PM failed, which wait in the PM backlog.
// It records the Agent's answer as pm.json in the Run folder, for the Brief, with the Runs it covers
// and a fingerprint of what it was given, so a re-run answers again once an earlier Step changed that.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../src/agent.ts'
import { readJson, readJsonFiles, writeJson } from '../src/files.ts'
import { readMemory } from '../src/memory.ts'
import { coversItsRuns, fingerprint, pmRunInputs } from '../src/pm-inputs.ts'
import { readRun } from '../src/run.ts'
import { readPmBacklog, readWeeklyPmBacklog } from '../src/state.ts'
import { runAsStep } from '../src/step.ts'
import { callAgent } from '../src/worker.ts'
import { isWeekly } from '../src/weekly.ts'
import { pmMemory } from '../agents/pm/config.ts'
import type { FetchResult } from './fetch.ts'

/** The PM Agent's answer, as its output schema shapes it. */
interface PmAnswer {
  repoLines: { repo: string; line: string }[]
  highlights: string[]
  todos: string[]
  /** The whole Memory the PM Agent proposes, which Save state applies or queues; null to leave it as it is. */
  memory: string | null
}

/** What the answer covers: the Runs whose reviews, commits and messages it was given, oldest first, their fingerprint, and the Memory it read. A pm.json from before answers recorded them has none. */
interface Covered {
  runs: string[]
  inputs: string
  memoryRead: string
}

/** What PM writes, as pm.json in the Run folder. */
export type PmResult = ({ status: 'answered' } & PmAnswer & Partial<Covered>) | { status: 'failed'; error: string }

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'pm.json')
  const earlier = existsSync(out) ? readJson<PmResult>(out) : null
  if (!force && earlier?.status === 'answered') {
    if (coversItsRuns(earlier)) {
      console.log('PM already answered in this Run, skipping')
      return
    }
    console.log('PM answered in this Run, but an earlier Step has changed what it was given since, so it answers again')
  }
  const run = readRun(runId)
  const pm = await loadAgent('pm')
  const runs = [...new Set([...(isWeekly(run.pipeline) ? readWeeklyPmBacklog() : readPmBacklog()), runId])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (runs.length > 1) console.log(`The PM backlog adds what Runs ${runs.filter((id) => id !== runId).join(', ')} held, since their PM failed`)
  const fromRuns = pmRunInputs(runs)
  const results = readJsonFiles<FetchResult>(join(runFolder, 'fetch'))
  const earlierSteps = run.steps.slice(0, run.steps.findIndex((s) => s.name === 'pm'))
  const runHealth = {
    steps: earlierSteps.filter((s) => s.status !== 'succeeded').map(({ name, status }) => ({ name, status })),
    failedToFetch: results.flatMap((r) => (r.status === 'failed' ? [{ repo: r.repo, team: r.team, error: r.error }] : [])),
  }
  const memory = readMemory(pm.name, pmMemory)
  const inputs = { ...fromRuns, runHealth, memory }
  try {
    const answer = (await callAgent(pm, inputs, { cwd: runFolder, dryRun: run.dryRun ?? false, worker: run.worker })) as PmAnswer
    writeJson(out, { status: 'answered', ...answer, runs, inputs: fingerprint(fromRuns), memoryRead: memory } satisfies PmResult)
    console.log(`PM answered: ${answer.repoLines.length} Repo lines, ${answer.todos.length} To-dos`)
  } catch (error) {
    const result: PmResult = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    writeJson(out, result)
    throw new Error(`PM failed: ${result.error}`)
  }
})
