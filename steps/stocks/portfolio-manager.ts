// Portfolio Manager: the Portfolio Manager Agent judges each real and paper Book's Rule plan within
// its Playbook and that side's Judgement mode (a real Book's plan, issue 42, for Saransh to place):
// its exposure level for the day and its changes from the Rule plan, each with a Decision record, the
// Brief's commentary on each Book, and its Journal's new entries. On Saturdays it also writes the
// weekly review's commentary, proposes the promotions the review lists as due, and proposes a
// narrower range for each Lever the override scorecard (issue 40) says lost to the Rule plan over the
// last 3 months; on a month's first Saturday it writes the monthly review's commentary. It runs
// read-only in the Run folder, on Claude Code with Codex as fallback, given the Rule plans, the Book
// states, the Stages, the Health Agent's diagnosis, the review's figures (null on other days), the
// Desk's views (issue 39; null when the Desk didn't review) and its Journal; not the dossiers, which
// the Desk reads. Each Decision record names the Desk's views it follows. Its answer is kept as
// portfolio-manager.json, with the Journal it read, for the Check Step (which holds each change to
// the final check in ash_new) and Save state (which applies the Journal and records the promotions
// and the narrower ranges). It skips itself unless this Run's Plan Step succeeded with a real or
// paper Book's plan to judge, or there is a review to comment on. An Agent that fails on both Workers
// is recorded as failed, and fails the Step: the Rule plans go out instead.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { inputFiles, journalMemory } from '../../agents/portfolio-manager/config.ts'
import { loadAgent } from '../../src/agent.ts'
import type { DeskResult } from '../../src/desk.ts'
import { bookNames } from '../../src/brokers.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { readMemory } from '../../src/memory.ts'
import { percent } from '../../src/plans.ts'
import type { PdJudgedBook, PdLever, PdPlan, PdReview, playbookRanges } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { callAgent } from '../../src/worker.ts'

/** The Portfolio Manager's answer, as its output schema shapes it. */
export interface PortfolioManagerAnswer {
  books: PdJudgedBook[]
  /** On Saturdays, the weekly review's commentary; null on other days. */
  review: string | null
  /** On a month's first Saturday, the monthly review's commentary; null on other days. */
  monthly: string | null
  /** The promotions it proposes, each by its Sleeve's id. */
  promotions: { sleeve: number; why: string }[]
  /** The narrower Playbook ranges it proposes, each for a Lever that lost to the Rule plan over the last 3 months. */
  narrower: NarrowerRanges[]
  journal: { entries: string[]; open: string[] }
}

/** A narrower range the Portfolio Manager proposes for one Lever of a Book's Playbook: each range's new value, by its name. */
export interface NarrowerRanges {
  book: 'IN' | 'US' | 'HK'
  lever: PdLever
  ranges: { name: (typeof playbookRanges)[number]; value: number }[]
  why: string
}

/** What the Step writes, as portfolio-manager.json: the answer, with the Journal it read and the files its Decision records may cite, or why it failed. */
export type PortfolioManagerResult =
  | { status: 'answered'; answer: PortfolioManagerAnswer; journalRead: string; inputs: string[] }
  | { status: 'failed'; error: string }

/** The Desk's views and the reviews missing, as the Portfolio Manager reads them; null when the Desk didn't review. */
function deskOf(desk: DeskResult | null) {
  return desk && { views: desk.views.map(({ run, ...view }) => view), missing: desk.missing }
}

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'portfolio-manager.json')
  // What an earlier run of this Step judged was another Run of the Plan Step's plans.
  rmSync(out, { force: true })
  const run = readRun(runId)
  const plan = run.steps.find((s) => s.name === 'plan')
  const read = <T>(file: string) => (existsSync(join(runFolder, file)) ? readJson<T>(join(runFolder, file)) : null)
  const plans = plan?.status === 'succeeded' ? read<PdPlan>(inputFiles.plans) : null
  const judged = (plans?.plans ?? []).filter((p) => (p.kind === 'paper' || p.kind === 'real') && p.status === 'planned')
  // A weekly review is commented on even when there is no plan to judge.
  const review = read<PdReview>(inputFiles.review)
  if (!judged.length && !review) {
    if (plan?.status !== 'succeeded') throw new StepSkipped(`The Plan Step ${plan ? plan.status : 'is not in this Run'}, so there is no Rule plan to judge`)
    throw new StepSkipped(plans ? 'No real or paper Book has a Rule plan to judge' : `The Plan Step left no ${inputFiles.plans}`)
  }

  const journal = readMemory('portfolio-manager', journalMemory)
  const inputs = {
    plans,
    bookStates: read(inputFiles.bookStates),
    stages: read(inputFiles.stages),
    health: read(inputFiles.health),
    review,
    dossiers: null,
    desk: deskOf(read<DeskResult>('desk.json')),
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
    const name = (judged.find((p) => p.id === book.plan_id) ?? judged.find((p) => p.book === book.book))?.name ?? book.book
    console.log(`${name}: exposure level ${percent(book.exposure.level)}, ${book.changes.length} change${book.changes.length === 1 ? '' : 's'} from the Rule plan`)
  }
  for (const promotion of answer.promotions) console.log(`Proposes promoting Sleeve ${promotion.sleeve}: ${promotion.why}`)
  for (const each of answer.narrower) console.log(`Proposes narrowing the ${each.lever} Lever in ${bookNames[each.book] ?? each.book}: ${each.why}`)
})
