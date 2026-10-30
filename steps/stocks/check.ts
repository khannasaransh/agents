// Check: records the final Order lists in ash_new, then reads how each paper Book stands and each
// real Book's orders, for the Brief. It hands the Portfolio Manager's judgement to `pd check --plan
// plan.json --judgement judgement.json --run <id>`, which holds each change to the final check: those
// the Book's Judgement mode and Playbook allow, buying only Pool names, whose Decision records cite
// only figures in the Run's inputs, go out once the whole Book passes the Mandate as the list would
// leave it; else the Rule plan, once it passes; else only its exits and Disaster stops, with a To-do
// this Step raises. A Portfolio Manager that failed, or didn't run, sends the Rule plans (its
// judgement is marked failed, with why). A buy whose Desk review is missing (issue 39) waits a
// session: the judgement names each review the review list required that the Desk didn't give
// (desk.json's, or every one when the Desk Step failed or didn't run), and ash_new holds back their
// buys, and every buy the review list required a review of when the Portfolio Manager failed; sales
// and Disaster stops go out all the same. ash_new records each accepted change as an Override, and
// each rules-only paper Book's own Rule plan unchanged; each paper order fills at the next open
// (ash_new's daily chain fills them once its Health report passes). Each real Book's list (issue 42)
// goes through the same final check under its real side's Judgement mode, and its orders are recorded
// proposed, for Saransh to place: a buy that needs a sale's money listed under that sale, with the
// Disaster stops to place or raise. A real Book starts with its first plan outside Hold mode with a
// strategy at Real-small or Real-full. ash_new first expires each real order still proposed once its
// session is over. ash_new records nothing for a plan made from a Book state, Mandate or Playbook
// that is no longer current, and says why; it starts a paper Book and its rules-only paper Book
// together. A list for a session that already has one (a Run started again) supersedes it, and no
// order is recorded twice. This Step records nothing unless this Run's Plan Step succeeded: it says
// why and skips itself. A dry run records nothing (`--dry-run`). Either way it then runs `pd
// paper-books`, `pd judgement show` (each Book's Judgement modes and the proposals waiting on
// Saransh) and `pd orders show` (each real Book's orders, stops and own trades), kept as
// paper-books.json, judgement-show.json and orders.json, and keeps what pd check printed, or why it
// didn't run, as check.json.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { requiredReviews, type DeskResult } from '../../src/desk.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { pdJson, type PdCheck, type PdJudgement, type PdJudgementShow, type PdMissingReview, type PdOrders, type PdPaperBooks, type PdPlan } from '../../src/pd.ts'
import { analystName } from '../../src/plans.ts'
import { readRun, type RunRecord } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'
import type { PortfolioManagerResult } from './portfolio-manager.ts'

/** How long pd check may take: each plan's Book state read again, and its lists recorded. */
const checkMs = 5 * 60_000
/** How long pd paper-books, pd judgement show and pd orders show may take: a few rows per Book. */
const standingMs = 2 * 60_000

/** What the Check Step did: what pd check printed, or why it recorded nothing. */
export interface CheckResult {
  check: PdCheck | null
  why: string | null
}

const applied = { judgement: "with the Portfolio Manager's changes", rule_plan: 'as its Rule plan', exits_only: 'with only its exits and Disaster stops' }

/**
 * Each review the review list required that the Desk didn't give: desk.json's, or every one when the
 * Desk Step didn't review (it failed before writing, or didn't run); none when it skipped itself, no
 * analyst being needed.
 */
function missingReviews(run: RunRecord, plan: PdPlan, desk: DeskResult | null): PdMissingReview[] {
  if (desk) return desk.missing
  const step = run.steps.find((s) => s.name === 'desk')
  if (step?.status === 'skipped') return []
  const why = step ? `The Desk Step ${step.status}, so it reviewed nothing` : "The Desk Step isn't in this Run"
  return requiredReviews(plan.review).map((r) => ({ ...r, why }))
}

/** The Portfolio Manager's judgement as pd check reads it: its answer, or why there is none, with the reviews the Desk didn't give. */
function judgementOf(run: RunRecord, result: PortfolioManagerResult | null, missing: PdMissingReview[]): PdJudgement {
  if (result?.status === 'answered') return { status: 'answered', why: null, inputs: result.inputs, missing_reviews: missing, books: result.answer.books }
  const step = run.steps.find((s) => s.name === 'portfolio-manager')
  let why = "The Portfolio Manager Step isn't in this Run"
  if (result?.status === 'failed') why = `The Portfolio Manager failed: ${result.error}`
  else if (step) why = `The Portfolio Manager Step ${step.status}, so it judged nothing`
  return { status: 'failed', why, inputs: [], missing_reviews: missing, books: [] }
}

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'check.json')
  const standingFile = join(runFolder, 'paper-books.json')
  const modesFile = join(runFolder, 'judgement-show.json')
  const ordersFile = join(runFolder, 'orders.json')
  // What an earlier run of this Step recorded would say nothing true about this one.
  for (const file of [out, standingFile, modesFile, ordersFile]) rmSync(file, { force: true })
  const run = readRun(runId)
  const { dryRun = false, steps } = run
  const plan = steps.find((s) => s.name === 'plan')
  const planFile = join(runFolder, 'plan.json')
  let why: string | null = null
  if (plan?.status !== 'succeeded') why = `the Plan Step ${plan ? plan.status : 'is not in this Run'}, so there is no Rule plan to record`
  else if (!existsSync(planFile)) why = 'the Plan Step left no plan.json'
  let check: PdCheck | null = null
  const todos: string[] = []
  if (why === null) {
    const pmFile = join(runFolder, 'portfolio-manager.json')
    const judgementFile = join(runFolder, 'judgement.json')
    const deskFile = join(runFolder, 'desk.json')
    const missing = missingReviews(run, readJson<PdPlan>(planFile), existsSync(deskFile) ? readJson<DeskResult>(deskFile) : null)
    const judgement = judgementOf(run, existsSync(pmFile) ? readJson<PortfolioManagerResult>(pmFile) : null, missing)
    writeJson(judgementFile, judgement)
    if (judgement.why) console.log(`${judgement.why}: each real and paper Book's Rule plan goes out instead, once it passes the final check, without the buys the Desk reviewed`)
    for (const m of missing) console.log(`${m.security_id}'s review by ${analystName[m.analyst]} is missing, so its buy waits a session: ${m.why}`)
    const args = ['check', '--plan', planFile, '--judgement', judgementFile, '--run', runId, ...(dryRun ? ['--dry-run'] : [])]
    check = await pdJson<PdCheck>(args, { cwd: runFolder, timeoutMs: checkMs })
    for (const list of check.lists) {
      const done = { recorded: 'recorded', unchanged: 'recorded already', not_recorded: 'not recorded', would_record: 'would be recorded (dry run)' }[list.status]
      const superseded = list.superseded ? `, superseding ${list.superseded} orders` : ''
      const judged = list.judgement ? ` ${applied[list.judgement.applied]}` : ''
      console.log(`${list.name}: Order list${list.session ? ` for ${list.session}` : ''}${judged} ${done}${superseded}${list.why ? `: ${list.why}` : ''}`)
      for (const change of list.judgement?.changes ?? []) if (!change.accepted) console.log(`${list.name}: dropped the Portfolio Manager's ${change.kind}: ${change.why}`)
      if (list.judgement?.applied === 'rule_plan' && list.judgement.why) console.log(`${list.name}: the Rule plan went out: ${list.judgement.why}`)
      for (const held of list.judgement?.held_back ?? []) console.log(`${list.name}: held back the buy of ${held.order.security_id} a session: ${held.why}`)
      if (list.judgement?.todo && list.status !== 'not_recorded') todos.push(list.judgement.todo)
    }
  }
  writeTodos(runFolder, 'check', todos)
  writeJson(out, { check, why } satisfies CheckResult)
  writeJson(standingFile, await pdJson<PdPaperBooks>(['paper-books'], { cwd: runFolder, timeoutMs: standingMs }))
  writeJson(modesFile, await pdJson<PdJudgementShow>(['judgement', 'show'], { cwd: runFolder, timeoutMs: standingMs }))
  writeJson(ordersFile, await pdJson<PdOrders>(['orders', 'show'], { cwd: runFolder, timeoutMs: standingMs }))
  if (why !== null) throw new StepSkipped(`Nothing recorded: ${why}`)
})
