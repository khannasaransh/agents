// Save state: applies the Portfolio Manager's Journal, its Memory. Its answer's new entries are added
// under the Run's id, the oldest Runs' dropped past what the Journal keeps, and what is still open is
// replaced by the answer's, so the Journal carries what is open from Run to Run. The change is
// applied and recorded in the Run, or queued for Saransh (`agents memory`) when the Journal changed
// after the Agent read it, so applying it never undoes that change. A Run whose Portfolio Manager
// didn't answer leaves the Journal as it is, and a dry run's ran on the fake Worker, so it never
// counts. A re-run applies nothing the Run already settled.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { journalMemory } from '../../agents/portfolio-manager/config.ts'
import { readJson } from '../../src/files.ts'
import { journalWith } from '../../src/journal.ts'
import { buildsOnCurrent, isSettled, queueProposal, settleProposal, type MemoryProposal } from '../../src/memory.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import type { PortfolioManagerResult } from './portfolio-manager.ts'

const agent = 'portfolio-manager'

await runAsStep(async ({ runId, runFolder }) => {
  const file = join(runFolder, 'portfolio-manager.json')
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
})
