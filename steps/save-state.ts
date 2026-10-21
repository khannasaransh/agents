// Save state: the Run's last Step. It records each first-Run baseline, and advances a Repo's last
// reviewed commit to the new head only when its review in this Run succeeded, so a failed review
// is retried in the next Run. A dry run's reviews came from the fake Worker, so they never count.
// A Repo whose state has moved on since this Run fetched it is left alone, so re-running an older
// Run's Save state never moves state back.
import { join } from 'node:path'
import { readJsonFiles } from '../src/files.ts'
import { readRun } from '../src/run.ts'
import { readRepoState, writeRepoState } from '../src/state.ts'
import { runAsStep } from '../src/step.ts'
import type { FetchResult } from './fetch.ts'
import type { ReviewResult } from './review.ts'

const short = (sha: string | null) => sha?.slice(0, 7) ?? 'nothing'

await runAsStep(({ runId, runFolder }) => {
  const { dryRun = false } = readRun(runId)
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
    }
    state[fetched.repo] = { lastReviewed: fetched.head }
    console.log(`${fetched.repo}: last reviewed ${short(fetched.previous)} -> ${short(fetched.head)}`)
  }
  writeRepoState(state)
})
