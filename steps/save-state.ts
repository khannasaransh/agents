// Save state: runs after every Step but the Brief. It records each first-Run baseline, and advances
// a Repo's last reviewed commit to the new head only when its review in this Run succeeded, so a
// failed review is retried in the next Run. A dry run's reviews came from the fake Worker, so they
// never count. Memory the Reviewer proposed in a review that counts, and the PM Agent's proposed
// Memory, are applied and recorded in the Run, or, when the Agent's config sets memoryChanges to
// 'review', queued for Saransh to accept or reject with `agents memory`. A proposal is queued for
// him too when its Memory changed after the Agent read it, so applying it never undoes that change.
// It records how far the Docs Step brought the wiki per Repo, once it finished, and keeps a Run
// whose PM failed in the PM backlog, until a PM answer covers what it held.
// A Repo whose state has moved on since this Run fetched it is left alone, so re-running an older
// Run's Save state never moves state back. The weekly Pipeline keeps its own cursor and PM backlog,
// and leaves the daily Pipeline's, including how far the wiki was brought.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent, type Agent } from '../src/agent.ts'
import { readJson, readJsonFiles } from '../src/files.ts'
import { buildsOnCurrent, byRunStart, isSettled, queueProposal, settleProposal, type MemoryProposal } from '../src/memory.ts'
import { holdsPmInputs } from '../src/pm-inputs.ts'
import { readRun, type RunRecord } from '../src/run.ts'
import {
  readDocsState,
  readPmBacklog,
  readRepoState,
  readWeeklyPmBacklog,
  readWeeklyRepoState,
  writeDocsState,
  writePmBacklog,
  writeRepoState,
  writeWeeklyPmBacklog,
  writeWeeklyRepoState,
} from '../src/state.ts'
import { runAsStep } from '../src/step.ts'
import { isWeekly } from '../src/weekly.ts'
import { pmMemory } from '../agents/pm/config.ts'
import type { DocsResult } from './docs.ts'
import type { FetchResult } from './fetch.ts'
import type { PmResult } from './pm.ts'
import type { ReviewResult } from './review.ts'

const short = (sha: string | null) => sha?.slice(0, 7) ?? 'nothing'

/**
 * Applies the Memory an Agent proposed, or queues it for Saransh when the Agent's config asks for
 * review, or when the Memory changed after the Agent read it.
 */
function handOver(agent: Agent, proposal: MemoryProposal) {
  const what = `the change the ${agent.name} Agent proposed to its Memory ${proposal.name}`
  const changedSince = !buildsOnCurrent(proposal)
  if (agent.config.memoryChanges === 'review' || changedSince) {
    const why = changedSince ? ', since that Memory changed after the Agent read it,' : ''
    if (queueProposal(proposal)) console.log(`Queued ${what}${why} waiting for Saransh (agents memory)`)
    else console.log(`Left ${what} out of the queue, since a later Run's proposal waits there`)
  } else {
    settleProposal(proposal, 'applied')
    console.log(`Applied ${what}`)
  }
}

/** The Docs Step finished when it ended so and the Run records that it succeeded, so its commit is on the docs branch. */
function docsFinished(docs: DocsResult, run: RunRecord): boolean {
  return ['updated', 'no-edits', 'nothing-to-update'].includes(docs.status) && run.steps.find((s) => s.name === 'docs')?.status === 'succeeded'
}

/**
 * Advances each Repo's documentation to the head the Docs Step brought the wiki up to, once it
 * finished. Until it first finishes, a Repo's documentation starts where the Step started, so the
 * next Run documents the same commits again.
 */
function recordDocsProgress(docs: DocsResult, run: RunRecord) {
  const finished = docsFinished(docs, run)
  const state = readDocsState()
  for (const range of docs.ranges ?? []) {
    const current = state[range.repo]?.lastDocumented
    if (current !== undefined && current !== range.from) {
      console.log(`${range.repo}: the wiki's state has moved on to ${short(current)} since this Run's Docs Step, leaving it`)
    } else if (finished) {
      state[range.repo] = { lastDocumented: range.to }
      if (range.from !== range.to) console.log(`${range.repo}: wiki brought up ${short(range.from)} -> ${short(range.to)}`)
    } else if (current === undefined) {
      state[range.repo] = { lastDocumented: range.from }
      console.log(`${range.repo}: the Docs Step didn't finish, so the next Run documents it from ${short(range.from)}`)
    }
  }
  writeDocsState(state)
}

/** Takes the Runs a PM answer covered out of the PM backlog, or adds this Run when its PM didn't answer on what it holds. */
function settlePmBacklog(runId: string, pm: PmResult | null, weekly: boolean) {
  const readBacklog = weekly ? readWeeklyPmBacklog : readPmBacklog
  const writeBacklog = weekly ? writeWeeklyPmBacklog : writePmBacklog
  const backlog = readBacklog()
  let next = backlog
  if (pm?.status === 'answered') {
    const covered = pm.runs ?? [runId]
    next = backlog.filter((id) => !covered.includes(id))
  } else if (holdsPmInputs(runId) && !backlog.includes(runId)) next = [...backlog, runId].sort(byRunStart)
  if (next.length === backlog.length) return
  writeBacklog(next)
  if (next.includes(runId)) console.log("The PM didn't answer in this Run, so the next PM is given what this Run held too")
  else console.log(`The PM answered on what Runs ${backlog.filter((id) => !next.includes(id)).join(', ')} held, so they left the PM backlog`)
}

await runAsStep(async ({ runId, runFolder }) => {
  const run = readRun(runId)
  const dryRun = run.dryRun ?? false
  const weekly = isWeekly(run.pipeline)
  const reviewer = await loadAgent('reviewer')
  const state = weekly ? readWeeklyRepoState() : readRepoState()
  const reviews = new Map(readJsonFiles<ReviewResult>(join(runFolder, 'review')).map((r) => [r.repo, r]))

  for (const fetched of readJsonFiles<FetchResult>(join(runFolder, 'fetch'))) {
    if (fetched.status !== 'baseline' && fetched.status !== 'new-commits') continue
    const current = state[fetched.repo]?.lastReviewed ?? null
    // A weekly Repo's first window has no saved cursor, so its start is the commit Fetch chose.
    if ((current !== null || !weekly) && current !== fetched.previous) {
      console.log(`${fetched.repo}: state has moved on to ${short(current)} since this Run fetched it, leaving it`)
      continue
    }
    if (fetched.status === 'new-commits') {
      if (dryRun) {
        console.log(`${fetched.repo}: reviewed only by the fake Worker, so the next real Run reviews it`)
        continue
      }
      const review = reviews.get(fetched.repo)
      if (review?.status !== 'reviewed' || review.to !== fetched.head) {
        console.log(`${fetched.repo}: not reviewed in this Run, so the next Run reviews it again`)
        continue
      }
      if (review.memory !== null) handOver(reviewer, { agent: reviewer.name, name: fetched.repo, run: runId, memory: review.memory, base: review.memoryRead })
    }
    state[fetched.repo] = { lastReviewed: fetched.head }
    console.log(`${fetched.repo}: last reviewed ${short(fetched.previous)} -> ${short(fetched.head)}`)
  }
  const writeState = weekly ? writeWeeklyRepoState : writeRepoState
  writeState(state)

  const docsFile = join(runFolder, 'docs.json')
  const pmFile = join(runFolder, 'pm.json')
  const pmResult = existsSync(pmFile) ? readJson<PmResult>(pmFile) : null
  // A dry run's Docs and PM ran on the fake Worker, so neither counts.
  if (dryRun) {
    if (pmResult?.status === 'answered' && pmResult.memory !== null) console.log('The pm Agent ran only on the fake Worker, so its proposed Memory is dropped')
    return
  }
  if (!weekly && existsSync(docsFile)) recordDocsProgress(readJson<DocsResult>(docsFile), run)
  settlePmBacklog(runId, pmResult, weekly)

  if (pmResult?.status === 'answered' && pmResult.memory !== null) {
    const pm = await loadAgent('pm')
    const proposal = { agent: pm.name, name: pmMemory, run: runId, memory: pmResult.memory, base: pmResult.memoryRead }
    // The PM's Memory has no state to say it was already handed over, so a re-run checks the Run.
    if (isSettled(proposal)) console.log(`The change the pm Agent proposed to its Memory ${pmMemory} is already settled in this Run`)
    else handOver(pm, proposal)
  }
})
