import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { FetchResult } from '../steps/fetch.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'
const sha = (n: number) => String(n).repeat(40)

function prepareRun(results: FetchResult[], steps = [{ name: 'fetch', status: 'succeeded' }, { name: 'brief', status: 'pending' }]) {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId, steps)
  for (const result of results) ws.writeRunFile(runId, `fetch/${result.repo}.json`, result)
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
    ['## flutter', '', '### crux_flutter', '', '2 new commits on main:', '', '- `5555555` Fix paywall copy (Asha)', '- `4444444` Add paywall (Asha)'].join('\n'),
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
    [{ name: 'fetch', status: 'failed' }, { name: 'brief', status: 'pending' }],
  )

  const health = (await brief()).split('## Run health')[1]

  assert.match(health, /- fetch: failed\. Log: logs\/fetch\.log/)
  assert.match(health, /- gone \(android\): fatal: repository not found\n/)
})

test('the Run health names skipped Steps', async () => {
  prepareRun([], [{ name: 'fetch', status: 'skipped' }, { name: 'brief', status: 'pending' }])

  assert.match((await brief()).split('## Run health')[1], /- fetch: skipped/)
})

test('a healthy Run says so in its Run health', async () => {
  prepareRun([{ repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(1), status: 'unchanged', head: sha(1), commits: [] }])

  assert.match((await brief()).split('## Run health')[1], /No Step failed or was skipped/)
})
