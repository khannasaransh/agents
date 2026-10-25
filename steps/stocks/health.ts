// Health: when the Lake Step failed or the Lake isn't healthy, runs the read-only Health Agent in
// ash_new's folder to work out why, and records its diagnosis, the fix it proposes (never applied)
// and the evidence it read as health.json in the Run folder, for the Brief. The Lake isn't healthy
// when its status couldn't be read, the Data gate failed, or the Health report isn't ok or flags
// anything. A healthy Lake skips the Step. A Health Agent that fails on both Workers is recorded as
// failed, and fails the Step.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../../src/agent.ts'
import { ashNewFolder } from '../../src/env.ts'
import { readJson, writeJson } from '../../src/files.ts'
import type { PdStatus } from '../../src/pd.ts'
import { readRun, type RunRecord } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { callAgent } from '../../src/worker.ts'
import type { LakeResult } from './lake.ts'

/** The Health Agent's answer, as its output schema shapes it. */
interface HealthAnswer {
  diagnosis: string
  fix: string
  evidence: { source: string; shows: string }[]
}

/** What Health writes, as health.json in the Run folder: why it ran, then the diagnosis or why there is none. */
export type HealthResult = { why: string[]; inputs: string } & ({ status: 'diagnosed' } & HealthAnswer | { status: 'failed'; error: string })

/** How much of the Lake Step's log the Agent is given: the end, where a refresh says why it stopped. */
const logLines = 300

/** Why the Lake needs a diagnosis, or nothing when it is healthy. */
function reasons(lakeStep: RunRecord['steps'][number] | undefined, status: PdStatus | null): string[] {
  const why: string[] = []
  if (lakeStep?.status !== 'succeeded') why.push(lakeStep?.status === 'failed' ? 'The Lake Step failed.' : `The Lake Step didn't succeed: it is ${lakeStep?.status ?? 'not in this Run'}.`)
  if (!status) return [...why, "The Lake's status couldn't be read."]
  if (status.gate.verdict === 'fail') why.push(`The Data gate failed: ${status.gate.reasons.join('; ')}`)
  const { health } = status
  if (health && health.status !== 'ok') why.push(`The Health report of ${health.date} is ${health.status}.`)
  if (health?.flags.length) why.push(`The Health report of ${health.date} has ${health.flags.length} flag${health.flags.length === 1 ? '' : 's'}.`)
  return why
}

/** The last `lines` lines of a log, or nothing when there is no log. */
function tail(file: string, lines: number): string {
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n') : ''
}

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'health.json')
  const run = readRun(runId)
  const read = <T>(file: string) => (existsSync(join(runFolder, file)) ? readJson<T>(join(runFolder, file)) : null)
  const lakeStep = run.steps.find((s) => s.name === 'lake')
  const status = read<PdStatus>(join('lake', 'status.json'))
  const why = reasons(lakeStep, status)
  if (!why.length) {
    // A diagnosis an earlier run of this Step made is about a Lake that has since been refreshed.
    rmSync(out, { force: true })
    throw new StepSkipped('The Lake is healthy: the Lake Step succeeded, the Data gate passed and the Health report flags nothing')
  }

  const inputs = { why, lake: read<LakeResult>('lake.json'), lakeLog: tail(join(runFolder, lakeStep?.log ?? join('logs', 'lake.log')), logLines), status }
  // What it was given, so a re-run diagnoses again once the Lake Step has been re-run.
  const fingerprint = createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
  const earlier = read<HealthResult>('health.json')
  if (!force && earlier?.status === 'diagnosed' && earlier.inputs === fingerprint) {
    console.log('The Health Agent already diagnosed this Lake in this Run, skipping')
    return
  }
  for (const line of why) console.log(line)

  try {
    const cwd = ashNewFolder()
    if (!existsSync(cwd)) throw new Error(`ash_new isn't at ${cwd}: set ASH_NEW_FOLDER in the env file`)
    const agent = await loadAgent('health')
    const answer = (await callAgent(agent, inputs, { cwd, dryRun: run.dryRun ?? false })) as HealthAnswer
    writeJson(out, { why, inputs: fingerprint, status: 'diagnosed', ...answer } satisfies HealthResult)
    console.log(`Diagnosis: ${answer.diagnosis}\nProposed fix: ${answer.fix}`)
  } catch (error) {
    const result: HealthResult = { why, inputs: fingerprint, status: 'failed', error: error instanceof Error ? error.message : String(error) }
    writeJson(out, result)
    throw new Error(`The Health Agent failed: ${result.error}`)
  }
})
