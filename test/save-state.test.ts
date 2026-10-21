import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { FetchResult } from '../steps/fetch.ts'
import type { ReviewResult } from '../steps/review.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'
const sha = (n: number) => String(n).repeat(40)

function prepareRun(state: Record<string, { lastReviewed: string }>, fetched: FetchResult[], reviews: ReviewResult[], { dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId, { dryRun })
  ws.writeRepoState(state)
  for (const result of fetched) ws.writeRunFile(runId, `fetch/${result.repo}.json`, result)
  for (const result of reviews) ws.writeRunFile(runId, `review/${result.repo}.json`, result)
}

const changed = (repo: string, previous: string, head: string): FetchResult => ({
  repo,
  team: 'flutter',
  branch: 'main',
  previous,
  status: 'new-commits',
  head,
  commits: [{ sha: head, author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject: 'Change' }],
})

const reviewed = (repo: string, from: string, to: string): ReviewResult => ({ repo, team: 'flutter', branch: 'main', from, to, status: 'reviewed', summary: 'Fine.', findings: [] })

async function saveState() {
  const result = await ws.agents('step', 'save-state', '--run', runId)
  assert.equal(result.status, 0, result.stderr)
}

test('Save state advances the last reviewed commit only for Repos whose review succeeded, and records first-Run baselines', async () => {
  prepareRun(
    { crux_flutter: { lastReviewed: sha(1) }, 'inpix-panel': { lastReviewed: sha(3) }, 'news-read-go': { lastReviewed: sha(5) }, 'skill-up': { lastReviewed: sha(7) } },
    [
      changed('crux_flutter', sha(1), sha(2)),
      changed('inpix-panel', sha(3), sha(4)),
      { repo: 'news-read-go', team: 'backend', branch: 'master', previous: sha(5), status: 'unchanged', head: sha(5), commits: [] },
      changed('skill-up', sha(7), sha(8)),
      { repo: 'tangy_tv_flutter', team: 'flutter', branch: 'development', previous: null, status: 'baseline', head: sha(6), commits: [] },
      { repo: 'gone', team: 'android', branch: 'main', previous: null, status: 'failed', error: 'fatal: repository not found' },
    ],
    [reviewed('crux_flutter', sha(1), sha(2)), { ...reviewed('inpix-panel', sha(3), sha(4)), status: 'failed', error: 'Quota limit reached' }],
  )

  await saveState()

  assert.deepEqual(ws.readRepoState(), {
    crux_flutter: { lastReviewed: sha(2) },
    'inpix-panel': { lastReviewed: sha(3) },
    'news-read-go': { lastReviewed: sha(5) },
    'skill-up': { lastReviewed: sha(7) },
    tangy_tv_flutter: { lastReviewed: sha(6) },
  })
})

test('Save state never moves a Repo back when its state has moved on since this Run fetched it', async () => {
  prepareRun(
    { crux_flutter: { lastReviewed: sha(9) }, tangy_tv_flutter: { lastReviewed: sha(9) } },
    [
      changed('crux_flutter', sha(1), sha(2)),
      { repo: 'tangy_tv_flutter', team: 'flutter', branch: 'development', previous: null, status: 'baseline', head: sha(6), commits: [] },
    ],
    [reviewed('crux_flutter', sha(1), sha(2))],
  )

  await saveState()

  assert.deepEqual(ws.readRepoState(), { crux_flutter: { lastReviewed: sha(9) }, tangy_tv_flutter: { lastReviewed: sha(9) } })
})

test("a dry run's Save state records first-Run baselines but never counts a fake review as done", async () => {
  prepareRun(
    { crux_flutter: { lastReviewed: sha(1) } },
    [changed('crux_flutter', sha(1), sha(2)), { repo: 'tangy_tv_flutter', team: 'flutter', branch: 'development', previous: null, status: 'baseline', head: sha(6), commits: [] }],
    [reviewed('crux_flutter', sha(1), sha(2))],
    { dryRun: true },
  )

  await saveState()

  assert.deepEqual(ws.readRepoState(), { crux_flutter: { lastReviewed: sha(1) }, tangy_tv_flutter: { lastReviewed: sha(6) } })
})
