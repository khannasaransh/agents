// Portfolio Manager: the Portfolio Manager Agent judges each paper Book's Rule plan within its
// Playbook: its exposure level for the day and its changes from the Rule plan, each with a Decision
// record, the Brief's commentary on each Book, and its Journal's new entries. It runs read-only in
// the Run folder, on Claude Code with Codex as fallback, given the Rule plans, the Book states, the
// Stages, the Health Agent's diagnosis and its Journal (the dossiers are null until issue 37). Its
// answer is kept as portfolio-manager.json, with the Journal it read, for the Check Step (which
// holds each change to the final check in ash_new) and Save state (which applies the Journal). It
// skips itself unless this Run's Plan Step succeeded with a paper Book's plan to judge. An Agent that
// fails on both Workers is recorded as failed, and fails the Step: the Rule plans go out instead.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { inputFiles, journalMemory } from '../../agents/portfolio-manager/config.ts'
import { loadAgent } from '../../src/agent.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { readMemory } from '../../src/memory.ts'
import { percent } from '../../src/plans.ts'
import type { PdJudgedBook, PdPlan } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { callAgent } from '../../src/worker.ts'

/** The Portfolio Manager's answer, as its output schema shapes it. */
export interface PortfolioManagerAnswer {
  books: PdJudgedBook[]
  journal: { entries: string[]; open: string[] }
}

/** What the Step writes, as portfolio-manager.json: the answer, with the Journal it read and the files its Decision records may cite, or why it failed. */
export type PortfolioManagerResult =
  | { status: 'answered'; answer: PortfolioManagerAnswer; journalRead: string; inputs: string[] }
  | { status: 'failed'; error: string }

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'portfolio-manager.json')
  // What an earlier run of this Step judged was another Run of the Plan Step's plans.
  rmSync(out, { force: true })
  const run = readRun(runId)
  const plan = run.steps.find((s) => s.name === 'plan')
  if (plan?.status !== 'succeeded') throw new StepSkipped(`The Plan Step ${plan ? plan.status : 'is not in this Run'}, so there is no Rule plan to judge`)
  const read = <T>(file: string) => (existsSync(join(runFolder, file)) ? readJson<T>(join(runFolder, file)) : null)
  const plans = read<PdPlan>(inputFiles.plans)
  if (!plans) throw new StepSkipped(`The Plan Step left no ${inputFiles.plans}`)
  const judged = plans.plans.filter((p) => p.kind === 'paper' && p.status === 'planned')
  if (!judged.length) throw new StepSkipped('No paper Book has a Rule plan to judge')

  const journal = readMemory('portfolio-manager', journalMemory)
  const inputs = {
    plans,
    bookStates: read(inputFiles.bookStates),
    stages: read(inputFiles.stages),
    health: read(inputFiles.health),
    dossiers: null,
    journal,
  }
  let answer: PortfolioManagerAnswer
  try {
    const agent = await loadAgent('portfolio-manager')
    answer = (await callAgent(agent, inputs, { cwd: runFolder, dryRun: run.dryRun ?? false })) as PortfolioManagerAnswer
  } catch (error) {
    const failed: PortfolioManagerResult = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    writeJson(out, failed)
    throw new Error(`The Portfolio Manager failed, so the Rule plans go out: ${failed.error}`)
  }
  const cited = Object.entries(inputFiles).flatMap(([name, file]) => (inputs[name as keyof typeof inputFiles] !== null ? [file] : []))
  writeJson(out, { status: 'answered', answer, journalRead: journal, inputs: cited } satisfies PortfolioManagerResult)
  for (const book of answer.books) {
    const name = judged.find((p) => p.book === book.book)?.name ?? book.book
    console.log(`${name}: exposure level ${percent(book.exposure.level)}, ${book.changes.length} change${book.changes.length === 1 ? '' : 's'} from the Rule plan`)
  }
})
