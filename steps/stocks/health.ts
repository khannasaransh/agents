// Health: when the Lake Step failed or the Lake isn't healthy, or this Run's MarketSmith fetch went
// wrong, runs the read-only Health Agent in ash_new's folder to work out why, and records its
// diagnosis, the fix it proposes (never applied) and the evidence it read as health.json in the Run
// folder, for the Brief. The Lake isn't healthy when its status couldn't be read, the Data gate
// failed, or the Health report isn't ok or flags anything. The fetch went wrong when a region's fetch
// failed, a results calendar couldn't be read, or a fetch or a backup wasn't whole
// (marketsmithProblems): ash_new keeps neither, and the Agent checks what was kept. Otherwise the
// Step skips itself. A Health Agent that fails on both Workers is recorded as
// failed, and fails the Step.
// The Corrections the Agent proposes are recorded in ash_new with `pd corrections propose`, where
// they wait for Saransh's approval (a dry run records none). Failing to record them is recorded too,
// and fails the Step; a re-run records them again without asking the Agent again. Once they are
// recorded, the Lake's status is read again as health/status.json, so the Brief lists them as waiting.
// What the Agent finds out about securities the Lake no longer gets prices for (delistings) is kept
// in the state area, and given to it again, so a later Run looks each up only once (a dry run keeps none).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../../src/agent.ts'
import { ashNewFolder } from '../../src/env.ts'
import { readDelistings, recordDelistings, type Delisting } from '../../src/delistings.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { pdJson, type CorrectionChange, type PdCorrectionsPropose, type PdMarketSmith, type PdStatus } from '../../src/pd.ts'
import { marketsmithProblems } from '../../src/marketsmith.ts'
import { readRun, type RunRecord } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import type { AdversaryResult, WithAdversary } from '../../src/adversary.ts'
import { callAgent } from '../../src/worker.ts'
import type { LakeResult } from './lake.ts'

/** The Health Agent's answer, as its output schema shapes it. */
interface HealthAnswer extends WithAdversary {
  diagnosis: string
  fix: string
  evidence: { source: string; shows: string }[]
  corrections: CorrectionChange[]
  delistings: Delisting[]
}

/** What became of the Corrections the Agent proposed: what ash_new recorded, why it couldn't, or that a dry run recorded none. */
/** `printed`: what `pd corrections propose` printed. */
export type Proposals = { status: 'recorded'; printed: PdCorrectionsPropose } | { status: 'failed'; error: string } | { status: 'dry-run' }

/** What Health writes, as health.json in the Run folder: why it ran, then the diagnosis or why there is none. */
export type HealthResult = { why: string[]; inputs: string } & (({ status: 'diagnosed'; proposals?: Proposals } & HealthAnswer) | { status: 'failed'; error: string })

/** How much of the Lake Step's log the Agent is given: the end, where a refresh says why it stopped. */
const logLines = 300

/** How long `pd corrections propose` may take: it writes a few rows. */
const proposeMs = 2 * 60_000

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

/** Records the proposed Corrections in ash_new, where they wait for approval; a dry run records none. */
async function propose(corrections: CorrectionChange[], { runId, runFolder, dryRun }: { runId: string; runFolder: string; dryRun: boolean }): Promise<Proposals> {
  if (dryRun) {
    console.log(`Dry run: the ${corrections.length} Corrections proposed aren't recorded in ash_new`)
    return { status: 'dry-run' }
  }
  const file = join(runFolder, 'health', 'corrections.json')
  writeJson(file, { corrections })
  try {
    const printed = await pdJson<PdCorrectionsPropose>(['corrections', 'propose', file, '--by', `the Health Agent, Run ${runId}`], { cwd: runFolder, timeoutMs: proposeMs })
    console.log(`Corrections: ${printed.recorded.length} recorded, waiting for approval; ${printed.known.length} proposed before; ${printed.refused.length} refused`)
    for (const { index, why } of printed.refused) console.log(`Refused Correction ${index + 1} (${corrections[index]?.security_id}): ${why}`)
    try {
      writeJson(join(runFolder, 'health', 'status.json'), await pdJson<PdStatus>(['status'], { cwd: runFolder, timeoutMs: proposeMs }))
    } catch (error) {
      // The Brief then lists the Corrections waiting as the Lake Step found them, and says these were recorded.
      console.log(`The Lake's status couldn't be read again: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { status: 'recorded', printed }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'health.json')
  const run = readRun(runId)
  const dryRun = run.dryRun ?? false
  const read = <T>(file: string) => (existsSync(join(runFolder, file)) ? readJson<T>(join(runFolder, file)) : null)
  const lakeStep = run.steps.find((s) => s.name === 'lake')
  const status = read<PdStatus>(join('lake', 'status.json'))
  const marketsmith = read<PdMarketSmith>('marketsmith.json')
  const why = [...reasons(lakeStep, status), ...marketsmithProblems(marketsmith)]
  if (!why.length) {
    // A diagnosis an earlier run of this Step made is about a Lake that has since been refreshed.
    rmSync(out, { force: true })
    throw new StepSkipped('The Lake is healthy: the Lake Step succeeded, the Data gate passed, the Health report flags nothing and MarketSmith\'s fetch, if any, went well')
  }

  const inputs = { why, lake: read<LakeResult>('lake.json'), lakeLog: tail(join(runFolder, lakeStep?.log ?? join('logs', 'lake.log')), logLines), status, delistings: readDelistings(), marketsmith }
  // What it was given, so a re-run diagnoses again once the Lake Step has been re-run. Not the
  // delistings, which this Step itself adds to once the Agent answers.
  const { delistings: _known, ...fingerprinted } = inputs
  const fingerprint = createHash('sha256').update(JSON.stringify(fingerprinted)).digest('hex')
  const earlier = read<HealthResult>('health.json')
  let answer: HealthAnswer
  if (!force && earlier?.status === 'diagnosed' && earlier.inputs === fingerprint) {
    if (earlier.proposals?.status !== 'failed') {
      console.log('The Health Agent already diagnosed this Lake in this Run, skipping')
      return
    }
    console.log('The Health Agent already diagnosed this Lake in this Run; recording its Corrections again')
    answer = earlier
  } else {
    for (const line of why) console.log(line)
    try {
      const cwd = ashNewFolder()
      if (!existsSync(cwd)) throw new Error(`ash_new isn't at ${cwd}: set ASH_NEW_FOLDER in the env file`)
      const agent = await loadAgent('health')
      let adversary: AdversaryResult | undefined
      answer = (await callAgent(agent, inputs, { cwd, dryRun, worker: run.worker, onAdversary: result => { adversary = result } })) as HealthAnswer
      if (adversary) answer = { ...answer, adversary }
      console.log(`Diagnosis: ${answer.diagnosis}\nProposed fix: ${answer.fix}`)
    } catch (error) {
      const result: HealthResult = { why, inputs: fingerprint, status: 'failed', error: error instanceof Error ? error.message : String(error) }
      writeJson(out, result)
      throw new Error(`The Health Agent failed: ${result.error}`)
    }
  }

  // A diagnosis an earlier version of this Step recorded has no delistings.
  const { diagnosis, fix, evidence, corrections, delistings = [], adversary } = answer
  if (delistings.length) {
    const counts = (['delisted', 'renamed', 'trading', 'unknown'] as const).map((s) => [s, delistings.filter((d) => d.status === s).length] as const).filter(([, n]) => n)
    console.log(`Looked up ${delistings.length} securities the Lake no longer gets prices for: ${counts.map(([s, n]) => `${n} ${s}`).join(', ')}`)
    if (dryRun) console.log("Dry run: what it found isn't kept for later Runs")
    else recordDelistings(delistings, runId)
  }
  const proposals = corrections.length ? await propose(corrections, { runId, runFolder, dryRun }) : undefined
  writeJson(out, { why, inputs: fingerprint, status: 'diagnosed', diagnosis, fix, evidence, corrections, delistings, ...(adversary && { adversary }), ...(proposals && { proposals }) } satisfies HealthResult)
  if (proposals?.status === 'failed') throw new Error(`The Health Agent's Corrections couldn't be recorded in ash_new: ${proposals.error}`)
})
