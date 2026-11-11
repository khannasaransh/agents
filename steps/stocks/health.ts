// Health: when the Lake Step failed or the Lake isn't healthy, or this Run's MarketSmith fetch went
// wrong, runs the read-only Health Agent in ash_new's folder to work out why, and records its
// diagnosis, the fix it proposes (never applied) and the evidence it read as health.json in the Run
// folder, for the Brief. The Lake isn't healthy when its status couldn't be read, the Data gate
// failed, the Health report fails or names a problem with a whole market's data, or it has flags that
// need attention. A flag needs attention (the audit of 10 November 2026, docs/audit) when it is new
// (quarantined by this Run's Health report), when it is on a security the Books hold or may trade
// (the last Run's watched names, src/watched.ts, and the real Books' holdings this Run's Broker inbox
// Step read), or when it is a security the Lake no longer gets prices for that hasn't been looked up.
// The Agent is given those flags and their Quarantines, and told how many were left out. Until then
// every flag called it every day: 513 on 10 November, none on a security a Book held, at 9.5 million
// tokens a Run. The fetch went wrong when a region's fetch
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
import { readDelistings, recordDelistings, type Delisting, type KeptDelisting } from '../../src/delistings.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { pdJson, type CorrectionChange, type PdCorrectionsPropose, type PdMarketSmith, type PdStatus } from '../../src/pd.ts'
import { marketsmithProblems } from '../../src/marketsmith.ts'
import { readRun, type RunRecord } from '../../src/run.ts'
import { readWatched } from '../../src/watched.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import type { AdversaryResult, WithAdversary } from '../../src/adversary.ts'
import { callAgent } from '../../src/worker.ts'
import type { BrokerInboxResult } from './broker-inbox.ts'
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

type Flag = NonNullable<PdStatus['health']>['flags'][number]

/** A stale security is looked up once the Lake has had no price for it for more than this many sessions. */
const lookUpAfterSessions = 10
/** A security nothing was found out about is looked up again after this many days. */
const lookUpAgainDays = 7

/** Whether a flag is a security the Lake no longer gets prices for that still has to be looked up, on the Run's day `on`. */
function toLookUp(flag: Flag, known: Record<string, KeptDelisting>, on: string): boolean {
  if (flag.check !== 'stale') return false
  const behind = /^(\d+) sessions? behind/.exec(flag.detail)
  if (behind && Number(behind[1]) <= lookUpAfterSessions) return false
  const found = known[flag.security_id]
  if (!found) return true
  const days = (Date.parse(on) - Date.parse(found.run.slice(0, 10))) / 86_400_000
  return found.status === 'unknown' && days > lookUpAgainDays
}

/** The Health report's flags that need the Agent's attention, and how many of each kind. */
interface Attention {
  flags: Flag[]
  fresh: number
  watched: Flag[]
  lookUps: number
}

/**
 * The flags that need attention: those this Run's Health report quarantined (new), those on a
 * security the Books hold or may trade (`watched`), and the securities the Lake no longer gets
 * prices for that haven't been looked up.
 */
function attention(status: PdStatus, watched: Set<string>, known: Record<string, KeptDelisting>, on: string): Attention {
  const health = status.health
  if (!health) return { flags: [], fresh: 0, watched: [], lookUps: 0 }
  const key = (f: { security_id: string; check: string; date: string | null }) => `${f.security_id}|${f.check}|${f.date}`
  const quarantinedNow = new Set(status.quarantines.filter((q) => q.since === health.date).map(key))
  const fresh = health.flags.filter((f) => quarantinedNow.has(key(f)))
  const held = health.flags.filter((f) => watched.has(f.security_id))
  const lookUps = health.flags.filter((f) => toLookUp(f, known, on))
  const wanted = new Set([...fresh, ...held, ...lookUps])
  return { flags: health.flags.filter((f) => wanted.has(f)), fresh: fresh.length, watched: held, lookUps: lookUps.length }
}

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Why the Lake needs a diagnosis, or nothing when it is healthy. */
function reasons(lakeStep: RunRecord['steps'][number] | undefined, status: PdStatus | null, found: Attention | null): string[] {
  const why: string[] = []
  if (lakeStep?.status !== 'succeeded') why.push(lakeStep?.status === 'failed' ? 'The Lake Step failed.' : `The Lake Step didn't succeed: it is ${lakeStep?.status ?? 'not in this Run'}.`)
  if (!status) return [...why, "The Lake's status couldn't be read."]
  if (status.gate.verdict === 'fail') why.push(`The Data gate failed: ${status.gate.reasons.join('; ')}`)
  const { health } = status
  if (!health || !found) return why
  if (health.status === 'fail') why.push(`The Health report of ${health.date} fails.`)
  for (const market of health.markets) {
    if (market.problems.length) why.push(`The Health report of ${health.date} names a problem with ${market.market}'s data: ${market.problems.join('; ')}`)
  }
  if (found.fresh) why.push(`The Health report of ${health.date} has ${counted(found.fresh, 'new flag')} (${health.flags.length} in all).`)
  if (found.watched.length) {
    const names = [...new Set(found.watched.map((f) => f.security_id))]
    why.push(`${counted(found.watched.length, 'flag is', 'flags are')} on ${counted(names.length, 'security', 'securities')} the Books hold or may trade: ${names.join(', ')}.`)
  }
  if (found.lookUps) why.push(`${counted(found.lookUps, 'security', 'securities')} the Lake no longer gets prices for ${found.lookUps === 1 ? "hasn't" : "haven't"} been looked up.`)
  return why
}

/**
 * The status as the Agent is given it: its flags and Quarantines cut to those that need attention
 * (and the Quarantines of their securities), with how many were left out; as it is when none was.
 */
function trimmed(status: PdStatus | null, found: Attention | null): { status: PdStatus | null; leftOut: { flags: number; quarantines: number } | null } {
  if (!status?.health || !found) return { status, leftOut: null }
  const securities = new Set(found.flags.map((f) => f.security_id))
  // A second source's gap is never a Health report's flag, so its Quarantine is always the Agent's to see.
  const quarantines = status.quarantines.filter((q) => securities.has(q.security_id) || q.check === 'second_source')
  const leftOut = { flags: status.health.flags.length - found.flags.length, quarantines: status.quarantines.length - quarantines.length }
  if (!leftOut.flags && !leftOut.quarantines) return { status, leftOut: null }
  return { status: { ...status, health: { ...status.health, flags: found.flags }, quarantines }, leftOut }
}

/** The securities the Books hold or may trade: the last Run's watched names, and the real Books' holdings this Run's Broker inbox Step read. */
function watchedNow(real: BrokerInboxResult | null): Set<string> {
  const names = new Set(readWatched()?.names ?? [])
  for (const book of real?.books?.books ?? []) for (const held of book.holdings) names.add(held.security_id)
  return names
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
  const known = readDelistings()
  const found = status && attention(status, watchedNow(read<BrokerInboxResult>('broker-inbox.json')), known, runId.slice(0, 10))
  const why = [...reasons(lakeStep, status, found), ...marketsmithProblems(marketsmith)]
  if (!why.length) {
    // A diagnosis an earlier run of this Step made is about a Lake that has since been refreshed.
    rmSync(out, { force: true })
    const flags = status?.health?.flags.length ?? 0
    const report = flags ? `the Health report's ${counted(flags, 'flag was', 'flags were')} diagnosed in earlier Runs and none is on a security the Books hold or may trade` : 'the Health report flags nothing'
    throw new StepSkipped(`The Lake is healthy: the Lake Step succeeded, the Data gate passed, ${report} and MarketSmith's fetch, if any, went well`)
  }

  const given = trimmed(status, found)
  const inputs = { why, lake: read<LakeResult>('lake.json'), lakeLog: tail(join(runFolder, lakeStep?.log ?? join('logs', 'lake.log')), logLines), status: given.status, leftOut: given.leftOut, delistings: known, marketsmith }
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
