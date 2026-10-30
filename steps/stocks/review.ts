// Review: on Saturdays, gets the weekly review's figures from ash_new (`pd review`) and keeps them as
// review.json, for the Portfolio Manager (who writes the review's commentary and proposes the
// promotions due) and the Brief. Each Book's paper Book and each Sleeve from Paper up is measured by
// its live record against its backtest's range (the ten years before the record began) and its
// benchmark, and each real Book's latest Reconciliation is given with its differences. ash_new applies
// the demotion rule by itself: a Sleeve whose live drawdown passes 1.5 times its backtest's worst, or
// whose rolling 12-month return falls under its backtest's 5th percentile after 12 months live, moves
// down a Stage, unless the Data gate fails (it says so, and demotes nothing). It runs after the Lake
// Step, so it measures the refreshed Lake, and before the Stages Step and the Plan Step, so a demotion
// is in this Run's Stages and Rule plans. It skips itself on other days. A dry run demotes nothing
// (`--dry-run`).
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { capitalised } from '../../src/answers.ts'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdReview } from '../../src/pd.ts'
import { percent } from '../../src/plans.ts'
import { readRun } from '../../src/run.ts'
import { runWeekday } from '../../src/schedule.ts'
import { stageName } from '../../src/stages.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'

/** How long pd review may take: each Sleeve's backtest and each paper Book's Book backtest, read back once stored. */
const reviewMs = 30 * 60_000

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'review.json')
  // A review an earlier run of this Step got would say nothing about a Run that skipped it.
  rmSync(out, { force: true })
  const day = runWeekday(runId)
  if (day !== 'saturday') throw new StepSkipped(`The weekly review is on Saturdays, and this Run started on a ${capitalised(day)}`)
  const { dryRun = false } = readRun(runId)
  const review = await pdJson<PdReview>(['review', ...(dryRun ? ['--dry-run'] : [])], { cwd: runFolder, timeoutMs: reviewMs })
  writeJson(out, review)
  for (const book of review.books) {
    const paper = book.paper.record ? `paper Book ${percent(book.paper.record.return)} since ${book.paper.record.start}` : 'paper Book not started'
    console.log(`${book.name}: ${paper}; ${book.sleeves.length} Sleeve${book.sleeves.length === 1 ? '' : 's'} reviewed`)
  }
  for (const d of review.demotions) {
    const done = d.status === 'demoted' ? 'Demoted' : 'Would demote'
    console.log(`${done} ${d.strategy_id} in the ${d.book} Book from ${stageName(d.from)} to ${stageName(d.to)}: ${d.why}${d.held_why ? ` (${d.held_why})` : ''}`)
  }
  for (const p of review.promotions_due) console.log(`Due: ${p.strategy_id} in the ${p.book} Book, from ${stageName(p.from)} to ${p.to_name}, since ${p.due}`)
})
