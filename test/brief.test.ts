import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { FetchResult } from '../steps/fetch.ts'
import type { Finding, ReviewResult } from '../steps/review.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'
const sha = (n: number) => String(n).repeat(40)

function prepareRun(
  results: FetchResult[],
  { steps = [{ name: 'fetch', status: 'succeeded' }, { name: 'brief', status: 'pending' }], reviews = [] as ReviewResult[], dryRun = false } = {},
) {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId, { steps, dryRun })
  for (const result of results) ws.writeRunFile(runId, `fetch/${result.repo}.json`, result)
  for (const result of reviews) ws.writeRunFile(runId, `review/${result.repo}.json`, result)
}

async function brief(): Promise<string> {
  const result = await ws.agents('step', 'brief', '--run', runId)
  assert.equal(result.status, 0, result.stderr)
  return ws.readRunFile(runId, 'brief.md')
}

const commit = (n: number, subject: string) => ({ sha: sha(n), author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject })

test("the Brief lists each Repo's new commits grouped by Team, in Team order", async () => {
  prepareRun([
    { repo: 'news-read-go', team: 'backend', branch: 'master', previous: sha(1), status: 'new-commits', head: sha(2), commits: [commit(2, 'Cache headlines')] },
    { repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(3), status: 'new-commits', head: sha(5), commits: [commit(5, 'Fix paywall copy'), commit(4, 'Add paywall')] },
    { repo: 'inpix-panel', team: 'frontend', branch: 'main', previous: sha(6), status: 'unchanged', head: sha(6), commits: [] },
  ])

  const text = await brief()

  const flutterAt = text.indexOf('## flutter')
  const backendAt = text.indexOf('## backend')
  const frontendAt = text.indexOf('## frontend')
  assert.ok(flutterAt >= 0 && flutterAt < backendAt && backendAt < frontendAt, text)
  assert.equal(
    text.slice(flutterAt, backendAt).trim(),
    [
      '## flutter',
      '',
      '### crux_flutter',
      '',
      '2 new commits on main:',
      '',
      '- `5555555` Fix paywall copy (Asha)',
      '- `4444444` Add paywall (Asha)',
      '',
      'No review of these commits in this Run.',
    ].join('\n'),
  )
  assert.match(text.slice(backendAt, frontendAt), /1 new commit on master:\n\n- `2222222` Cache headlines \(Asha\)/)
  assert.match(text.slice(frontendAt), /Unchanged: inpix-panel/)
})

test("the Brief notes a Repo's baseline on its first Run", async () => {
  prepareRun([{ repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: null, status: 'baseline', head: sha(7), commits: [] }])

  assert.match(await brief(), /### crux_flutter\n\nBaseline recorded at `7777777` on main/)
})

test('the Run health names failed Steps and the Repos that failed to fetch', async () => {
  prepareRun(
    [{ repo: 'gone', team: 'android', branch: 'main', previous: null, status: 'failed', error: 'fatal: repository not found\nmore detail' }],
    { steps: [{ name: 'fetch', status: 'failed' }, { name: 'brief', status: 'pending' }] },
  )

  const health = (await brief()).split('## Run health')[1]

  assert.match(health, /- fetch: failed\. Log: logs\/fetch\.log/)
  assert.match(health, /- gone \(android\): fatal: repository not found\n/)
})

test('the Run health names skipped Steps', async () => {
  prepareRun([], { steps: [{ name: 'fetch', status: 'skipped' }, { name: 'brief', status: 'pending' }] })

  assert.match((await brief()).split('## Run health')[1], /- fetch: skipped/)
})

test('a healthy Run says so in its Run health', async () => {
  prepareRun([{ repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(1), status: 'unchanged', head: sha(1), commits: [] }])

  assert.match((await brief()).split('## Run health')[1], /No Step failed or was skipped/)
})

const changed: FetchResult = {
  repo: 'crux_flutter',
  team: 'flutter',
  branch: 'main',
  previous: sha(1),
  status: 'new-commits',
  head: sha(3),
  commits: [commit(3, 'Fix paywall copy'), commit(2, 'Add paywall')],
}
const range = { repo: 'crux_flutter', team: 'flutter', branch: 'main', from: sha(1), to: sha(3) } as const

const finding = (severity: Finding['severity'], summary: string, bySaransh = false): Finding => ({
  severity,
  file: 'lib/paywall.dart',
  line: 42,
  commit: sha(bySaransh ? 3 : 2),
  author: bySaransh ? 'Saransh' : 'Asha',
  summary,
  bySaransh,
})

test("the Brief shows each changed Repo's review, with findings by severity and Saransh's own first", async () => {
  const findings = [finding('low', 'Unused import'), finding('medium', 'Copy is cut off', true), finding('critical', 'Paywall can be skipped'), finding('high', 'Price shows before it loads', true)]
  prepareRun([changed], { reviews: [{ ...range, status: 'reviewed', summary: 'Adds a paywall and fixes its copy.', findings, memory: null }] })

  const text = await brief()

  const review = text.slice(text.indexOf('Review:'), text.indexOf('## Run health')).trim()
  assert.equal(
    review,
    [
      'Review: Adds a paywall and fixes its copy.',
      '',
      '- **high** `lib/paywall.dart:42` in `3333333` by Saransh (yours): Price shows before it loads',
      '- **medium** `lib/paywall.dart:42` in `3333333` by Saransh (yours): Copy is cut off',
      '- **critical** `lib/paywall.dart:42` in `2222222` by Asha: Paywall can be skipped',
      '- **low** `lib/paywall.dart:42` in `2222222` by Asha: Unused import',
    ].join('\n'),
  )
})

test('the Brief says when a review found nothing', async () => {
  prepareRun([changed], { reviews: [{ ...range, status: 'reviewed', summary: 'Adds a paywall.', findings: [], memory: null }] })

  assert.match(await brief(), /Review: Adds a paywall\.\n\nNo findings\./)
})

test("the Brief says when a Repo's review failed, and its Run health names the Repo", async () => {
  prepareRun([changed], {
    steps: [{ name: 'fetch', status: 'succeeded' }, { name: 'review', status: 'failed' }, { name: 'brief', status: 'pending' }],
    reviews: [{ ...range, status: 'failed', error: 'Quota limit reached\nmore detail' }],
  })

  const [repos, health] = (await brief()).split('## Run health')

  assert.match(repos, /### crux_flutter[\s\S]*Review failed: Quota limit reached\n/)
  assert.match(health, /- review: failed/)
  assert.match(health, /Repos whose review failed:\n\n- crux_flutter \(flutter\): Quota limit reached\n/)
})

test('the Brief shows no review for commits it does not cover, such as after Fetch was re-run and found more', async () => {
  const older = { ...range, to: sha(2) }
  prepareRun([changed], {
    steps: [{ name: 'fetch', status: 'succeeded' }, { name: 'review', status: 'succeeded' }, { name: 'brief', status: 'pending' }],
    reviews: [{ ...older, status: 'reviewed', summary: 'Adds a paywall.', findings: [], memory: null }],
  })

  const text = await brief()

  assert.match(text, /- `2222222` Add paywall \(Asha\)\n\nNo review of these commits in this Run\.\n/)
  assert.doesNotMatch(text, /Review: Adds a paywall|No findings/)
})

test("a review that failed on other commits is not reported as this Run's failure", async () => {
  prepareRun([changed], { reviews: [{ ...range, from: sha(9), status: 'failed', error: 'Quota limit reached' }] })

  const text = await brief()

  assert.match(text, /No review of these commits in this Run\./)
  assert.doesNotMatch(text, /Quota limit reached/)
})

test('the Brief says when a changed Repo has no review at all', async () => {
  prepareRun([changed])

  assert.match(await brief(), /- `2222222` Add paywall \(Asha\)\n\nNo review of these commits in this Run\.\n/)
})

test("a dry run's Brief says its reviews came from the fake Worker", async () => {
  prepareRun([changed], { reviews: [{ ...range, status: 'reviewed', summary: 'Answered by the fake Worker.', findings: [], memory: null }], dryRun: true })

  assert.match(await brief(), /^# Brief 2026-10-22-0530\n\nDry run: every Agent ran on the fake Worker, so no review in this Brief is real, and none counts as done\./)
})
