// Check: records the final Order lists in ash_new, then reads how each paper Book stands, for the
// Brief. It hands the Portfolio Manager's judgement to `pd check --plan plan.json --judgement
// judgement.json --run <id>`, which holds each change to the final check: those the Book's Judgement
// mode and Playbook allow, buying only Pool names, whose Decision records cite only figures in the
// Run's inputs, go out once the whole Book passes the Mandate as the list would leave it; else the
// Rule plan, once it passes; else only its exits and Disaster stops, with a To-do this Step raises.
// A Portfolio Manager that failed, or didn't run, sends the Rule plans (its judgement is marked
// failed, with why). ash_new records each accepted change as an Override, and each rules-only paper
// Book's own Rule plan unchanged; each order fills at the next open (ash_new's daily chain fills
// them once its Health report passes). ash_new records nothing for a plan made from a Book state,
// Mandate or Playbook that is no longer current, and says why; it starts a paper Book and its
// rules-only paper Book together. A list for a session that already has one (a Run started again)
// supersedes it, and no order is recorded twice. This Step records nothing unless this Run's Plan
// Step succeeded: it says why and skips itself. A dry run records nothing (`--dry-run`). Either way
// it then runs `pd paper-books` and `pd judgement show` (each Book's Judgement modes and the
// proposals waiting on Saransh), kept as paper-books.json and judgement-show.json, and keeps what pd
// check printed, or why it didn't run, as check.json.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../../src/files.ts'
import { pdJson, type PdCheck, type PdJudgement, type PdJudgementShow, type PdPaperBooks } from '../../src/pd.ts'
import { readRun, type RunRecord } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'
import type { PortfolioManagerResult } from './portfolio-manager.ts'

/** How long pd check may take: each plan's Book state read again, and its lists recorded. */
const checkMs = 5 * 60_000
/** How long pd paper-books and pd judgement show may take: a few rows per Book. */
const standingMs = 2 * 60_000

/** What the Check Step did: what pd check printed, or why it recorded nothing. */
export interface CheckResult {
  check: PdCheck | null
  why: string | null
}

const applied = { judgement: "with the Portfolio Manager's changes", rule_plan: 'as its Rule plan', exits_only: 'with only its exits and Disaster stops' }

/** The Portfolio Manager's judgement as pd check reads it: its answer, or why there is none. */
function judgementOf(run: RunRecord, result: PortfolioManagerResult | null): PdJudgement {
  if (result?.status === 'answered') return { status: 'answered', why: null, inputs: result.inputs, books: result.answer.books }
  const step = run.steps.find((s) => s.name === 'portfolio-manager')
  let why = "The Portfolio Manager Step isn't in this Run"
  if (result?.status === 'failed') why = `The Portfolio Manager failed: ${result.error}`
  else if (step) why = `The Portfolio Manager Step ${step.status}, so it judged nothing`
  return { status: 'failed', why, inputs: [], books: [] }
}

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'check.json')
  const standingFile = join(runFolder, 'paper-books.json')
  const modesFile = join(runFolder, 'judgement-show.json')
  // What an earlier run of this Step recorded would say nothing true about this one.
  for (const file of [out, standingFile, modesFile]) rmSync(file, { force: true })
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
    const judgement = judgementOf(run, existsSync(pmFile) ? readJson<PortfolioManagerResult>(pmFile) : null)
    writeJson(judgementFile, judgement)
    if (judgement.why) console.log(`${judgement.why}: each paper Book's Rule plan goes out instead, once it passes the final check`)
    const args = ['check', '--plan', planFile, '--judgement', judgementFile, '--run', runId, ...(dryRun ? ['--dry-run'] : [])]
    check = await pdJson<PdCheck>(args, { cwd: runFolder, timeoutMs: checkMs })
    for (const list of check.lists) {
      const done = { recorded: 'recorded', unchanged: 'recorded already', not_recorded: 'not recorded', would_record: 'would be recorded (dry run)' }[list.status]
      const superseded = list.superseded ? `, superseding ${list.superseded} orders` : ''
      const judged = list.judgement ? ` ${applied[list.judgement.applied]}` : ''
      console.log(`${list.name}: Order list${list.session ? ` for ${list.session}` : ''}${judged} ${done}${superseded}${list.why ? `: ${list.why}` : ''}`)
      for (const change of list.judgement?.changes ?? []) if (!change.accepted) console.log(`${list.name}: dropped the Portfolio Manager's ${change.kind}: ${change.why}`)
      if (list.judgement?.applied === 'rule_plan' && list.judgement.why) console.log(`${list.name}: the Rule plan went out: ${list.judgement.why}`)
      if (list.judgement?.todo && list.status !== 'not_recorded') todos.push(list.judgement.todo)
    }
  }
  writeTodos(runFolder, 'check', todos)
  writeJson(out, { check, why } satisfies CheckResult)
  writeJson(standingFile, await pdJson<PdPaperBooks>(['paper-books'], { cwd: runFolder, timeoutMs: standingMs }))
  writeJson(modesFile, await pdJson<PdJudgementShow>(['judgement', 'show'], { cwd: runFolder, timeoutMs: standingMs }))
  if (why !== null) throw new StepSkipped(`Nothing recorded: ${why}`)
})
