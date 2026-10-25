// Lake: brings ash_new's Lake up to date and records how fresh and healthy it is. It clears a
// refresh left running by a process that has gone, runs ash_new's daily chain (`pd daily`),
// retrying it once on failure, then records `pd status` as lake/status.json, the Data gate's
// verdict among it, even when the refresh failed twice, which fails the Step. It raises a To-do when
// ash_new's own schedule or Windows task is on, since only the stocks Pipeline should refresh the
// Lake on a Schedule (ADR 0002). A dry run refreshes nothing: it records the Lake's status as it is.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../../src/files.ts'
import { pdJson, runPd, type PdClearRefresh, type PdStatus } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'

/** One run of `pd daily`. */
export interface RefreshAttempt {
  startedAt: string
  endedAt: string
  exitCode: number | null
  timedOut: boolean
}

/** What the Lake Step did, as lake.json in the Run folder; the status it read is lake/status.json beside it. */
export interface LakeResult {
  dryRun: boolean
  /** What clearing a refresh left running did; null in a dry run. */
  cleared: PdClearRefresh | null
  /** Each run of `pd daily`, in order: at most two, none in a dry run. */
  attempts: RefreshAttempt[]
  /** Whether a run of `pd daily` succeeded. */
  refreshed: boolean
}

/** How long pd clear-refresh and pd status may take, which is seconds as a rule. */
const quickCommandMs = 5 * 60_000
const refreshMs = Number(process.env.AGENTS_LAKE_TIMEOUT_SECONDS ?? 3 * 60 * 60) * 1000

async function refresh(runFolder: string): Promise<RefreshAttempt> {
  const startedAt = new Date().toISOString()
  const { code, stdout, stderr, timedOut } = await runPd(['daily'], { cwd: runFolder, timeoutMs: refreshMs })
  // pd daily reports as it goes; its output goes to the Step's log, which the Health Agent reads.
  if (stdout) console.log(stdout.trimEnd())
  if (stderr) console.error(stderr.trimEnd())
  if (timedOut) console.error(`pd daily timed out after ${Math.round(refreshMs / 60_000)} minutes`)
  return { startedAt, endedAt: new Date().toISOString(), exitCode: code, timedOut }
}

/** The To-dos for ash_new's own schedule, found on. */
function scheduleTodos({ own_schedule: own }: PdStatus): string[] {
  return [
    ...(own.enabled
      ? ["ash_new's own schedule is on, so it refreshes the Lake beside the stocks Pipeline: turn it off on its Settings page, or set enabled = false under [schedule] in its config/settings.toml."]
      : []),
    ...(own.task_registered ? ["ash_new's Windows task is registered: remove it with `uv run pd schedule-task remove` in ash_new."] : []),
  ]
}

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'lake.json')
  if (!force && existsSync(out) && readJson<LakeResult>(out).refreshed) {
    console.log('The Lake was already brought up to date in this Run, skipping')
    return
  }
  const { dryRun = false } = readRun(runId)
  const result: LakeResult = { dryRun, cleared: null, attempts: [], refreshed: false }

  if (dryRun) console.log('Dry run: reading the Lake as it is, without refreshing it')
  else {
    // It exits 1 when it refused, still saying why as JSON. Failing to clear never stops the refresh, which says why it can't start.
    try {
      result.cleared = await pdJson<PdClearRefresh>(['clear-refresh'], { cwd: runFolder, timeoutMs: quickCommandMs, exitCodes: [0, 1] })
      for (const job of result.cleared.cleared) console.log(`Cleared refresh job ${job.job}: ${job.error}`)
      if (result.cleared.refused) console.log(`Left the running refresh alone: ${result.cleared.refused}`)
    } catch (error) {
      console.error(`Couldn't clear a refresh left running: ${error instanceof Error ? error.message : error}`)
    }

    for (let attempt = 1; attempt <= 2 && !result.refreshed; attempt++) {
      if (attempt === 2) console.log('pd daily failed; retrying once')
      const ran = await refresh(runFolder)
      result.attempts.push(ran)
      result.refreshed = ran.exitCode === 0
    }
  }
  // Recorded before the status is read, so the Brief has the attempts even when it can't be.
  writeJson(out, result)

  const statusFile = join(runFolder, 'lake', 'status.json')
  // A status an earlier run of this Step read would say nothing true about the Lake now.
  rmSync(statusFile, { force: true })
  const status = await pdJson<PdStatus>(['status'], { cwd: runFolder, timeoutMs: quickCommandMs })
  writeJson(statusFile, status)
  writeTodos(runFolder, 'lake', scheduleTodos(status))
  console.log(`Data gate: ${status.gate.verdict}${status.gate.reasons.map((reason) => `\n- ${reason}`).join('')}`)
  if (!dryRun && !result.refreshed) throw new Error('pd daily failed twice, so the Lake is as the last refresh left it')
})
