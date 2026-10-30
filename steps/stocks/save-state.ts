// Save state: applies the Portfolio Manager's Journal, its Memory, and records the promotions it
// proposed. Its answer's new entries are added under the Run's id, the oldest Runs' dropped past what
// the Journal keeps, and what is still open is replaced by the answer's, so the Journal carries what
// is open from Run to Run. The change is applied and recorded in the Run, or queued for Saransh
// (`agents memory`) when the Journal changed after the Agent read it, so applying it never undoes
// that change. Each promotion is recorded in ash_new (`pd stages propose`), to wait for Saransh's
// Answer in the Brief; ash_new refuses one that isn't due, and says why. What became of each is kept
// as promotions.json, for the Brief. So is each narrower Playbook range it proposes for a Lever that
// lost to the Rule plan (issue 40; `pd judgement propose --playbook`), kept as narrower.json; one
// that changes another Lever's range isn't proposed, and ash_new refuses one that widens a range
// without the override scorecard's support. A Run whose Portfolio
// Manager didn't answer leaves the Journal as it is, and a dry run's ran on the fake Worker, so it
// never counts. A re-run applies nothing the Run already settled, and ash_new records no promotion
// twice.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { journalMemory } from '../../agents/portfolio-manager/config.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { journalWith } from '../../src/journal.ts'
import { buildsOnCurrent, isSettled, queueProposal, settleProposal, type MemoryProposal } from '../../src/memory.ts'
import { bookNames } from '../../src/brokers.ts'
import { pdJson, rangeLevers, type PdJudgementProposed, type PdStagesDecided } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { stageName } from '../../src/stages.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import type { NarrowerRanges, PortfolioManagerResult } from './portfolio-manager.ts'

const agent = 'portfolio-manager'
/** Who proposes a promotion, as ash_new records it. */
const proposer = 'the Portfolio Manager'
/** How long pd stages propose may take: the Sleeve's review again, its backtest read back. */
const proposeMs = 10 * 60_000

/** What Save state recorded of the Portfolio Manager's promotions, as promotions.json. */
export interface PromotionsResult {
  promotions: { sleeve: number; why: string; decided: PdStagesDecided }[]
}

/** What Save state recorded of the narrower ranges the Portfolio Manager proposed, as narrower.json. */
export interface NarrowerResult {
  narrower: (NarrowerRanges & { proposed: PdJudgementProposed })[]
}

await runAsStep(async ({ runId, runFolder }) => {
  const file = join(runFolder, 'portfolio-manager.json')
  const out = join(runFolder, 'promotions.json')
  const narrowerOut = join(runFolder, 'narrower.json')
  // What an earlier run of this Step recorded is recorded again from the answer, or not at all.
  rmSync(out, { force: true })
  rmSync(narrowerOut, { force: true })
  const result = existsSync(file) ? readJson<PortfolioManagerResult>(file) : null
  if (result?.status !== 'answered') throw new StepSkipped("The Portfolio Manager didn't answer in this Run, so its Journal stays as it is")
  if (readRun(runId).dryRun) throw new StepSkipped('The Portfolio Manager ran only on the fake Worker, so its Journal stays as it is')
  const memory = journalWith(result.journalRead, runId, result.answer.journal)
  const proposal: MemoryProposal = { agent, name: journalMemory, run: runId, memory, base: result.journalRead }
  if (isSettled(proposal)) {
    console.log('The Journal is already settled in this Run')
  } else if (!buildsOnCurrent(proposal)) {
    if (queueProposal(proposal)) console.log('Queued the Journal for Saransh (agents memory), since it changed after the Portfolio Manager read it')
    else console.log("Left the Journal out of the queue, since a later Run's change waits there")
  } else {
    settleProposal(proposal, 'applied')
    console.log(`Applied the Journal: ${result.answer.journal.entries.length} new entries, ${result.answer.journal.open.length} items open`)
  }

  const recorded: PromotionsResult = { promotions: [] }
  for (const { sleeve, why } of result.answer.promotions) {
    // It exits 1 when there is no such Sleeve, still saying why as JSON.
    const decided = await pdJson<PdStagesDecided>(['stages', 'propose', String(sleeve), '--why', why, '--by', proposer], { cwd: runFolder, timeoutMs: proposeMs, exitCodes: [0, 1] })
    recorded.promotions.push({ sleeve, why, decided })
    writeJson(out, recorded)
    if (decided.changed && decided.proposal) console.log(`Proposed promoting Sleeve ${sleeve} into ${stageName(decided.proposal.stage)}, as promotion ${decided.proposal.id}, for Saransh's Answer`)
    else console.log(`Didn't propose promoting Sleeve ${sleeve}: ${decided.why}`)
  }
  writeJson(out, recorded)

  const narrowed: NarrowerResult = { narrower: [] }
  for (const each of result.answer.narrower) {
    const book = bookNames[each.book] ?? each.book
    const others = each.ranges.filter(({ name }) => rangeLevers[name] !== each.lever).map(({ name }) => name)
    const ranges = each.ranges.flatMap(({ name, value }) => ['--playbook', `${name}=${value}`])
    // It exits 1 when it can't be made, saying why as JSON.
    const proposed: PdJudgementProposed = others.length
      ? { error: `It changes ${others.join(', ')}, which ${others.length === 1 ? "isn't" : "aren't"} the ${each.lever} Lever's range` }
      : await pdJson<PdJudgementProposed>(['judgement', 'propose', each.book, ...ranges, '--why', each.why, '--by', proposer], { cwd: runFolder, timeoutMs: proposeMs, exitCodes: [0, 1] })
    narrowed.narrower.push({ ...each, proposed })
    writeJson(narrowerOut, narrowed)
    if ('proposal' in proposed) console.log(`Proposed narrowing the ${each.lever} Lever in ${book}, as proposal ${proposed.proposal.id}, for Saransh's Answer`)
    else console.log(`Didn't propose narrowing the ${each.lever} Lever in ${book}: ${proposed.error}`)
  }
  writeJson(narrowerOut, narrowed)
})
