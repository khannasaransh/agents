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
// A Correction the Agent is confident of doesn't wait (11 November 2026): the Step approves it in the
// Agent's name (`pd corrections approve --by`) and builds its security's prices again there and then
// (`pd corrections apply`), so the Rule plans that follow are made on the corrected prices. One it
// isn't confident of waits for Saransh, its security in Quarantine, and the Run goes on without it.
// The Step keeps limits of its own whatever the Agent answers: none is approved on a security the
// Books hold or may trade, none when a Run has more than ten confident ones (something wider is
// wrong), none in a dry run, and none at all with HEALTH_AUTO_APPROVE=false in the env file. An
// approval that can't be applied doesn't fail the Step: ash_new's plans leave a security alone until
// its Corrections are applied, and a To-do says so.
// What the Agent finds out about securities the Lake no longer gets prices for (delistings) is kept
// in the state area, and given to it again, so a later Run looks each up only once (a dry run keeps none).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../../src/agent.ts'
import { ashNewFolder, healthAutoApprove } from '../../src/env.ts'
import { readDelistings, recordDelistings, type Delisting, type KeptDelisting } from '../../src/delistings.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { pdJson, runPd, type CorrectionChange, type PdCorrection, type PdCorrectionDecided, type PdCorrectionsPropose, type PdMarketSmith, type PdStatus } from '../../src/pd.ts'
import { marketsmithProblems } from '../../src/marketsmith.ts'
import { readRun, type RunRecord } from '../../src/run.ts'
import { readWatched } from '../../src/watched.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'
import type { AdversaryResult, WithAdversary } from '../../src/adversary.ts'
import { callAgent } from '../../src/worker.ts'
import type { BrokerInboxResult } from './broker-inbox.ts'
import type { LakeResult } from './lake.ts'

/** The Health Agent's answer, as its output schema shapes it. */
interface HealthAnswer extends WithAdversary {
  diagnosis: string
  fix: string
  evidence: { source: string; shows: string }[]
  corrections: ProposedChange[]
  delistings: Delisting[]
}

/** A Correction as the Health Agent proposes it: with whether it is confident of it. A diagnosis from before 11 November 2026 says nothing, which is not confident. */
export type ProposedChange = CorrectionChange & { confident?: boolean }

/** A Correction the Agent was confident of, as ash_new holds it (its id null when ash_new refused it). */
export interface Confident {
  id: number | null
  security_id: string
  kind: CorrectionChange['kind']
  date: string
  ratio: number | null
  value: number | null
}

/** What became of the Corrections the Agent was confident of. */
export interface Approvals {
  /** Those the Step approved in the Agent's name. */
  approved: Confident[]
  /** Those that wait for Saransh all the same, each with why. */
  left: (Confident & { why: string })[]
  /** Whether the approved ones were applied to the Lake's prices in this Run; null when none was approved. */
  applied: 'applied' | 'failed' | null
  /** Why they couldn't be applied. */
  error?: string
  /** Each approved Correction whose flag still stands after it was applied, as "US:TOPS: jump on 2026-11-09". */
  standing: string[]
}

/** What became of the Corrections the Agent proposed: what ash_new recorded, why it couldn't, or that a dry run recorded none. */
/** `printed`: what `pd corrections propose` printed. `approvals`: what became of those the Agent was confident of, when it was of any. */
export type Proposals = { status: 'recorded'; printed: PdCorrectionsPropose; approvals?: Approvals } | { status: 'failed'; error: string } | { status: 'dry-run' }

/** What Health writes, as health.json in the Run folder: why it ran, then the diagnosis or why there is none. */
export type HealthResult = { why: string[]; inputs: string } & (({ status: 'diagnosed'; proposals?: Proposals } & HealthAnswer) | { status: 'failed'; error: string })

/** How much of the Lake Step's log the Agent is given: the end, where a refresh says why it stopped. */
const logLines = 300

/** How long `pd corrections propose` may take: it writes a few rows. */
const proposeMs = 2 * 60_000

/** How long `pd corrections apply` may take: a few securities' histories fetched, then the panels, the live tracks and the Health report. */
const applyMs = 30 * 60_000

/** The most Corrections the Step approves by itself in a Run: more confident ones than this at once point at something wider, so all of them wait. */
export const maxAutoApprovals = 10

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

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Whether two Corrections change the same thing. */
const sameChange = (a: CorrectionChange, b: CorrectionChange) => a.security_id === b.security_id && a.kind === b.kind && a.date === b.date && a.ratio === b.ratio && a.value === b.value

/**
 * Approves, in the Agent's name, each Correction it was confident of that the Step's own limits
 * allow, then applies them to the Lake's prices. Nothing when it was confident of none.
 */
async function approveConfident(corrections: ProposedChange[], printed: PdCorrectionsPropose, watched: Set<string>, { runId, runFolder }: { runId: string; runFolder: string }): Promise<Approvals | undefined> {
  const confident = corrections.filter((c) => c.confident === true)
  if (!confident.length) return undefined
  const approvals: Approvals = { approved: [], left: [], applied: null, standing: [] }
  const named = (c: CorrectionChange, id: number | null): Confident => ({ id, security_id: c.security_id, kind: c.kind, date: c.date, ratio: c.ratio, value: c.value })
  const leave = (c: CorrectionChange, id: number | null, why: string) => approvals.left.push({ ...named(c, id), why })
  let eligible: { change: ProposedChange; row: PdCorrection }[] = []
  for (const change of confident) {
    const row = [...printed.recorded, ...printed.known].find((r) => sameChange(r, change))
    if (!row) leave(change, null, "ash_new refused it: it isn't a Correction as proposed")
    else if (row.status !== 'waiting') leave(change, row.id, `it was ${row.status} already`)
    else if (!healthAutoApprove()) leave(change, row.id, 'the Health Agent approves nothing by itself: HEALTH_AUTO_APPROVE is false')
    else if (watched.has(change.security_id)) leave(change, row.id, 'a Book holds or may trade its security, so it is yours to approve')
    else eligible.push({ change, row })
  }
  if (eligible.length > maxAutoApprovals) {
    for (const { change, row } of eligible) leave(change, row.id, `the Health Agent was confident of ${eligible.length} at once, over the ${maxAutoApprovals} it may approve by itself in a Run: something wider may be wrong`)
    eligible = []
  }
  for (const { change, row } of eligible) {
    try {
      const decided = await pdJson<PdCorrectionDecided>(['corrections', 'approve', String(row.id), '--by', `the Health Agent, Run ${runId}`], { cwd: runFolder, timeoutMs: proposeMs })
      if (decided.changed) approvals.approved.push(named(change, row.id))
      else leave(change, row.id, decided.why ?? 'ash_new changed nothing')
    } catch (error) {
      leave(change, row.id, `it couldn't be approved: ${message(error)}`)
    }
  }
  for (const c of approvals.approved) console.log(`Approved by the Health Agent, confident of it: Correction ${c.id}, ${c.security_id}, ${c.kind} on ${c.date}`)
  for (const c of approvals.left) console.log(`Confident, but left for Saransh: ${c.id === null ? 'a Correction' : `Correction ${c.id}`}, ${c.security_id}, ${c.kind} on ${c.date}: ${c.why}`)
  if (approvals.approved.length) {
    // Its output goes to the Step's log as it comes, as pd daily's does to the Lake Step's.
    const { code, timedOut } = await runPd(['corrections', 'apply'], { cwd: runFolder, timeoutMs: applyMs, echo: { stdout: true, stderr: true } })
    approvals.applied = code === 0 ? 'applied' : 'failed'
    if (code !== 0) approvals.error = timedOut ? `pd corrections apply timed out after ${Math.round(applyMs / 60_000)} minutes` : `pd corrections apply exited with ${code}`
    console.log(code === 0 ? "Applied to the Lake's prices in this Run" : `Not applied in this Run: ${approvals.error}`)
  }
  return approvals
}

/**
 * The approved Corrections whose flag still stands in `status`, read after they were applied. A
 * dividend given a value leaves its day's fall in the close, which a jump flag reads, so it isn't
 * looked for.
 */
function standing(approved: Confident[], status: PdStatus): string[] {
  const flags = status.health?.flags ?? []
  return approved
    .filter((c) => !(c.kind === 'dividend' && c.value !== null))
    .flatMap((c) => flags.filter((f) => f.security_id === c.security_id && f.date === c.date).map((f) => `${c.security_id}: ${f.check} on ${f.date}`))
}

/** The To-dos the approvals leave Saransh. */
function approvalTodos({ approved, applied, error, standing: stands }: Approvals): string[] {
  const ids = approved.map((c) => `${c.id} (${c.security_id})`).join(', ')
  return [
    ...(applied === 'failed'
      ? [
          `The Health Agent approved Correction${approved.length === 1 ? '' : 's'} ${ids}, but they couldn't be applied to the Lake's prices in this Run (${error}). No Rule plan trades their securities until they are: run \`uv run pd corrections apply\` in ash_new, or leave it to the next Run's refresh.`,
        ]
      : []),
    ...stands.map((flag) => `A Correction the Health Agent approved was applied, but its flag still stands (${flag}): check it. To undo it, remove its entry from ash_new's config/corrections.yaml; the next refresh builds the prices again without it.`),
  ]
}

/**
 * Records the proposed Corrections in ash_new, where they wait for approval, then approves and
 * applies those the Agent was confident of; a dry run records none.
 */
async function propose(corrections: ProposedChange[], watched: Set<string>, { runId, runFolder, dryRun }: { runId: string; runFolder: string; dryRun: boolean }): Promise<Proposals> {
  if (dryRun) {
    console.log(`Dry run: the ${corrections.length} Corrections proposed aren't recorded in ash_new`)
    return { status: 'dry-run' }
  }
  const file = join(runFolder, 'health', 'corrections.json')
  // As the Corrections file has them: ash_new refuses a field it doesn't know.
  writeJson(file, { corrections: corrections.map(({ confident: _confident, ...change }) => change) })
  try {
    const printed = await pdJson<PdCorrectionsPropose>(['corrections', 'propose', file, '--by', `the Health Agent, Run ${runId}`], { cwd: runFolder, timeoutMs: proposeMs })
    console.log(`Corrections: ${printed.recorded.length} recorded, waiting for approval; ${printed.known.length} proposed before; ${printed.refused.length} refused`)
    for (const { index, why } of printed.refused) console.log(`Refused Correction ${index + 1} (${corrections[index]?.security_id}): ${why}`)
    const approvals = await approveConfident(corrections, printed, watched, { runId, runFolder })
    try {
      const status = await pdJson<PdStatus>(['status'], { cwd: runFolder, timeoutMs: proposeMs })
      writeJson(join(runFolder, 'health', 'status.json'), status)
      if (approvals?.applied === 'applied') approvals.standing = standing(approvals.approved, status)
    } catch (error) {
      // The Brief then lists the Corrections waiting as the Lake Step found them, and says these were recorded.
      console.log(`The Lake's status couldn't be read again: ${message(error)}`)
    }
    if (approvals) writeTodos(runFolder, 'health', approvalTodos(approvals))
    return { status: 'recorded', printed, ...(approvals && { approvals }) }
  } catch (error) {
    return { status: 'failed', error: message(error) }
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
  const watched = watchedNow(read<BrokerInboxResult>('broker-inbox.json'))
  const found = status && attention(status, watched, known, runId.slice(0, 10))
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
    // The To-dos an earlier run of this Step raised were about an earlier diagnosis.
    writeTodos(runFolder, 'health', [])
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
  const proposals = corrections.length ? await propose(corrections, watched, { runId, runFolder, dryRun }) : undefined
  writeJson(out, { why, inputs: fingerprint, status: 'diagnosed', diagnosis, fix, evidence, corrections, delistings, ...(adversary && { adversary }), ...(proposals && { proposals }) } satisfies HealthResult)
  if (proposals?.status === 'failed') throw new Error(`The Health Agent's Corrections couldn't be recorded in ash_new: ${proposals.error}`)
})
