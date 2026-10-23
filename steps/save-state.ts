// Save state: runs after every Step but the Brief. It records each first-Run baseline, and advances
// a Repo's last reviewed commit to the new head only when its review in this Run succeeded, so a
// failed review is retried in the next Run. A dry run's reviews came from the fake Worker, so they
// never count. Memory the Reviewer proposed in a review that counts is applied and recorded in the
// Run, or, when the Reviewer's config sets memoryChanges to 'review', queued for Saransh to accept or
// reject with `agents memory`.
// A Repo whose state has moved on since this Run fetched it is left alone, so re-running an older
// Run's Save state never moves state back.
import { join } from 'node:path'
import { loadAgent } from '../src/agent.ts'
import { readJsonFiles } from '../src/files.ts'
import { queueProposal, settleProposal } from '../src/memory.ts'
import { readRun } from '../src/run.ts'
import { readRepoState, writeRepoState } from '../src/state.ts'
import { runAsStep } from '../src/step.ts'
import type { FetchResult } from './fetch.ts'
import type { ReviewResult } from './review.ts'

const short = (sha: string | null) => sha?.slice(0, 7) ?? 'nothing'

await runAsStep(async ({ runId, runFolder }) => {
  const { dryRun = false } = readRun(runId)
  const reviewer = await loadAgent('reviewer')
  const { memoryChanges = 'apply' } = reviewer.config
  const state = readRepoState()
  const reviews = new Map(readJsonFiles<ReviewResult>(join(runFolder, 'review')).map((r) => [r.repo, r]))

  for (const fetched of readJsonFiles<FetchResult>(join(runFolder, 'fetch'))) {
    if (fetched.status !== 'baseline' && fetched.status !== 'new-commits') continue
    const current = state[fetched.repo]?.lastReviewed ?? null
    if (current !== fetched.previous) {
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
      if (review.memory !== null) {
        const proposal = { agent: reviewer.name, name: fetched.repo, run: runId, memory: review.memory }
        if (memoryChanges === 'review') {
          queueProposal(proposal)
          console.log(`${fetched.repo}: the Reviewer proposed a change to its Memory, waiting for Saransh (agents memory)`)
        } else {
          settleProposal(proposal, 'applied')
          console.log(`${fetched.repo}: applied the change the Reviewer proposed to its Memory`)
        }
      }
    }
    state[fetched.repo] = { lastReviewed: fetched.head }
    console.log(`${fetched.repo}: last reviewed ${short(fetched.previous)} -> ${short(fetched.head)}`)
  }
  writeRepoState(state)
})
