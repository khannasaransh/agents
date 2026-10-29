// Check: records the final Order lists in ash_new, then reads how each paper Book stands, for the
// Brief. It runs `pd check --plan plan.json --run <id>`, which records each paper Book's Order list
// (its Rule plan unchanged, until the Portfolio Manager's changes in issue 34) and each rules-only
// paper Book's (its own Rule plan, always unchanged), each order with an id, placed to fill at the
// next open (ash_new's daily chain fills them once its Health report passes). ash_new records
// nothing for a plan made from a Book state, Mandate or Playbook that is no longer current, and says
// why; it starts a paper Book and its rules-only paper Book together. A list
// for a session that already has one (a Run started again) supersedes it, and no order is recorded
// twice. This Step records nothing unless this Run's Plan Step succeeded: it says why and skips
// itself. A dry run records nothing (`--dry-run`). Either way it then runs `pd paper-books`, kept as
// paper-books.json, and keeps what pd check printed, or why it didn't run, as check.json.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdCheck, type PdPaperBooks } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'

/** How long pd check may take: each plan's Book state read again, and its lists recorded. */
const checkMs = 5 * 60_000
/** How long pd paper-books may take: a few rows per Book. */
const standingMs = 2 * 60_000

/** What the Check Step did: what pd check printed, or why it recorded nothing. */
export interface CheckResult {
  check: PdCheck | null
  why: string | null
}

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'check.json')
  const standingFile = join(runFolder, 'paper-books.json')
  // What an earlier run of this Step recorded would say nothing true about this one.
  rmSync(out, { force: true })
  rmSync(standingFile, { force: true })
  const { dryRun = false, steps } = readRun(runId)
  const plan = steps.find((s) => s.name === 'plan')
  const planFile = join(runFolder, 'plan.json')
  let why: string | null = null
  if (plan?.status !== 'succeeded') why = `the Plan Step ${plan ? plan.status : 'is not in this Run'}, so there is no Rule plan to record`
  else if (!existsSync(planFile)) why = 'the Plan Step left no plan.json'
  let check: PdCheck | null = null
  if (why === null) {
    check = await pdJson<PdCheck>(['check', '--plan', planFile, '--run', runId, ...(dryRun ? ['--dry-run'] : [])], { cwd: runFolder, timeoutMs: checkMs })
    for (const list of check.lists) {
      const done = { recorded: 'recorded', unchanged: 'recorded already', not_recorded: 'not recorded', would_record: 'would be recorded (dry run)' }[list.status]
      const superseded = list.superseded ? `, superseding ${list.superseded} orders` : ''
      console.log(`${list.name}: Order list${list.session ? ` for ${list.session}` : ''} ${done}${superseded}${list.why ? `: ${list.why}` : ''}`)
    }
  }
  writeJson(out, { check, why } satisfies CheckResult)
  writeJson(standingFile, await pdJson<PdPaperBooks>(['paper-books'], { cwd: runFolder, timeoutMs: standingMs }))
  if (why !== null) throw new StepSkipped(`Nothing recorded: ${why}`)
})
