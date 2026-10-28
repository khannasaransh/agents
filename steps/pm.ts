// PM: runs the PM Agent once on what the Run holds so far: its reviews, the new commits, its Discord
// messages and its health, with those of earlier Runs whose PM failed, which wait in the PM backlog.
// It records the Agent's answer as pm.json in the Run folder, for the Brief, with the Runs it covers
// and a fingerprint of what it was given, so a re-run answers again once an earlier Step changed that.
// When the Discord Step read a sprint post, the Agent also says how each of its tasks stands, starting
// from the last Run's report on the same post and with the work on the Repos' other branches since the
// post, and PM records the task status report beside its answer.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../src/agent.ts'
import { readdirSync } from 'node:fs'
import { readJson, readJsonFiles, writeJson } from '../src/files.ts'
import { readMemory } from '../src/memory.ts'
import { coversItsRuns, fingerprint, pmRunInputs } from '../src/pm-inputs.ts'
import { runDir, runsDir } from '../src/paths.ts'
import { readRun } from '../src/run.ts'
import type { SprintPost, SprintTask } from '../src/sprint.ts'
import { readPmBacklog, readWeeklyPmBacklog } from '../src/state.ts'
import { runAsStep } from '../src/step.ts'
import { callAgent } from '../src/worker.ts'
import { isWeekly } from '../src/weekly.ts'
import { pmMemory, type TaskStatus } from '../agents/pm/config.ts'
import type { BranchesRead } from './branches.ts'
import type { FetchResult } from './fetch.ts'

/** The PM Agent's answer, as its output schema shapes it. */
interface PmAnswer {
  repoLines: { repo: string; line: string }[]
  highlights: string[]
  todos: string[]
  /** The whole Memory the PM Agent proposes, which Save state applies or queues; null to leave it as it is. */
  memory: string | null
  taskStatus: { id: string; status: TaskStatus; note: string; evidence: string[] }[]
}

/** One task of the sprint post and how it stands. */
export interface TaskReportItem extends SprintTask {
  status: TaskStatus
  note: string
  evidence: string[]
  /** How the last report on the same post said it stood, when that was different. */
  was: TaskStatus | null
}

/** The task status report: the sprint post it reports on, and each of its tasks, in the post's order. */
export interface TaskReport {
  post: Omit<SprintPost, 'messages' | 'tasks' | 'updates'>
  tasks: TaskReportItem[]
}

/** What the answer covers: the Runs whose reviews, commits and messages it was given, oldest first, their fingerprint, and the Memory it read. A pm.json from before answers recorded them has none. */
interface Covered {
  runs: string[]
  inputs: string
  memoryRead: string
}

/** What PM writes, as pm.json in the Run folder. */
export type PmResult =
  | ({ status: 'answered' } & Omit<PmAnswer, 'taskStatus'> & Partial<Covered> & { /** Null without a sprint post; none in a pm.json from before the report. */ taskReport?: TaskReport | null })
  | { status: 'failed'; error: string }

/** The latest report on the same sprint post by an earlier Run, and that Run. */
function previousReport(runId: string, post: SprintPost): { run: string; report: TaskReport } | null {
  const earlier = readdirSync(runsDir())
    .filter((id) => id.localeCompare(runId, 'en', { numeric: true }) < 0)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  for (const id of earlier) {
    const file = join(runDir(id), 'pm.json')
    const result = existsSync(file) ? readJson<PmResult>(file) : null
    if (result?.status === 'answered' && result.taskReport?.post.link === post.link) return { run: id, report: result.taskReport }
  }
  return null
}

/** The report from the sprint post and the Agent's statuses. A task the Agent left out shows as having no signal, so the report always covers the whole post. */
function taskReport(post: SprintPost, statuses: PmAnswer['taskStatus'], previous: TaskReport | null): TaskReport {
  const { messages, tasks, updates, ...about } = post
  return {
    post: about,
    tasks: tasks.map((task) => {
      const answered = statuses.find((s) => s.id === task.id)
      const status = answered?.status ?? 'no-signal'
      const before = previous?.tasks.find((t) => t.id === task.id)?.status ?? null
      return {
        ...task,
        status,
        note: answered?.note ?? 'The PM Agent said nothing about this task.',
        evidence: answered?.evidence ?? [],
        was: before !== status ? before : null,
      }
    }),
  }
}

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
  const sprintFile = join(runFolder, 'sprint.json')
  const sprint = existsSync(sprintFile) ? readJson<SprintPost>(sprintFile) : null
  const previous = sprint ? previousReport(runId, sprint) : null
  const previousTaskStatus = previous && {
    run: previous.run,
    tasks: previous.report.tasks.map(({ id, status, note, evidence }) => ({ id, status, note, evidence })),
  }
  // The messages since the post are for the task status alone: their login links were To-dos in the Runs that read them.
  const forStatus = sprint && { ...sprint, updates: (sprint.updates ?? []).map(({ loginLinks, ...m }) => m) }
  const branchesFile = join(runFolder, 'branches.json')
  // Only the work since this post counts, so not a read from before the post was read again.
  const read = sprint && existsSync(branchesFile) ? readJson<BranchesRead>(branchesFile) : null
  const branches = read && read.since === new Date(Date.parse(sprint!.postedAt)).toISOString() ? read.repos : null
  const inputs = { ...fromRuns, runHealth, memory, sprint: forStatus, previousTaskStatus, branches }
  try {
    const answer = (await callAgent(pm, inputs, { cwd: runFolder, dryRun: run.dryRun ?? false, worker: run.worker })) as PmAnswer
    const { taskStatus, ...rest } = answer
    const report = sprint && taskReport(sprint, taskStatus, previous?.report ?? null)
    writeJson(out, { status: 'answered', ...rest, taskReport: report, runs, inputs: fingerprint(fromRuns), memoryRead: memory } satisfies PmResult)
    console.log(`PM answered: ${answer.repoLines.length} Repo lines, ${answer.todos.length} To-dos${report ? `, the status of ${report.tasks.length} sprint tasks` : ''}`)
  } catch (error) {
    const result: PmResult = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    writeJson(out, result)
    throw new Error(`PM failed: ${result.error}`)
  }
})
