// Backtests: after the Brief is written, has ash_new backtest again each strategy whose newest run the
// Lake's refresh made stale (`pd backtests-update`), so every strategy's figures on its dashboard are
// on the latest data without Saransh's clicking (the PRD's story 17).
//
// It was a step of `pd daily`, inside the Lake Step, until the audit of 10 November 2026 (docs/audit):
// there it took 44 of the Lake Step's 53 minutes, so that day's Brief was written at 09:38 on this
// machine's clock, after Hong Kong had opened at 09:30. No other Step reads what it stores: the Rule
// plans, the reviews and the Book backtests run their strategies on the panels themselves. So the Lake
// Step now runs `pd daily --backtests-later`, and this Step runs last, after the Brief, which says so.
//
// It skips itself in a dry run, which refreshes nothing, and when this Run's Lake Step didn't bring
// the Lake up to date: the backtests would run on the data the last refresh left, and that refresh's
// own backtests are done or waiting on the next one. A `pd backtests-update` that fails fails the
// Step; the next Run's refresh leaves the same strategies stale, so they are run again then.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../../src/files.ts'
import { runPd } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import type { LakeResult } from './lake.ts'

/** How long `pd backtests-update` may take: every strategy stale, each over its ten years. */
const backtestsMs = Number(process.env.AGENTS_BACKTESTS_TIMEOUT_SECONDS ?? 3 * 60 * 60) * 1000

await runAsStep(async ({ runId, runFolder }) => {
  if (readRun(runId).dryRun) throw new StepSkipped('Dry run: no backtest is run again')
  const lakeFile = join(runFolder, 'lake.json')
  const refreshed = existsSync(lakeFile) && readJson<LakeResult>(lakeFile).refreshed
  if (!refreshed) throw new StepSkipped("This Run's Lake Step didn't bring the Lake up to date, so no backtest is stale because of it")
  // Its output goes to the Step's log as it comes: which strategies ran again, and which couldn't.
  const { code, timedOut } = await runPd(['backtests-update'], { cwd: runFolder, timeoutMs: backtestsMs, echo: { stdout: true, stderr: true } })
  if (timedOut) throw new Error(`pd backtests-update timed out after ${Math.round(backtestsMs / 60_000)} minutes`)
  if (code !== 0) throw new Error(`pd backtests-update exited with ${code}: the strategies left stale are run again after the next refresh`)
})
