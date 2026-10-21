import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

test('agents run daily creates a Run named by local start date and time that runs Fetch then Brief', async () => {
  ws = makeWorkspace()
  ws.addRepo('crux_flutter')
  ws.writeRepoList()

  const result = await ws.agents('run', 'daily')

  assert.equal(result.status, 0, result.stderr)
  const [id] = ws.runIds()
  const now = new Date()
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-')
  assert.match(id, new RegExp(`^${today}-\\d{4}`))

  const run = ws.readRun(id)
  assert.equal(run.pipeline, 'daily')
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['fetch', 'succeeded'],
      ['brief', 'succeeded'],
    ],
  )
  for (const step of run.steps) {
    assert.ok(step.startedAt && step.endedAt, `${step.name} has start and end times`)
    assert.ok(existsSync(join(ws.dataDir, 'runs', id, step.log)), `${step.name} log exists`)
  }
  assert.ok(existsSync(join(ws.dataDir, 'runs', id, 'brief.md')))
})

test('a Run whose Fetch fails still writes its Brief and ends partial', async () => {
  ws = makeWorkspace()
  ws.addBrokenRepo('gone')
  ws.addRepo('crux_flutter')
  ws.writeRepoList()

  const result = await ws.agents('run', 'daily')

  assert.notEqual(result.status, 0)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.status, 'partial')
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['fetch', 'failed'],
      ['brief', 'succeeded'],
    ],
  )
  assert.match(ws.readRunFile(id, 'brief.md'), /## Run health[\s\S]*fetch: failed/)
})

test("a Repo's second Run lists the commits pushed since its first", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  await ws.agents('run', 'daily')
  repo.pushCommit('Add paywall')

  await ws.agents('run', 'daily')

  const [first, second] = ws.runIds()
  assert.match(ws.readRunFile(first, 'brief.md'), /Baseline recorded/)
  assert.match(ws.readRunFile(second, 'brief.md'), /1 new commit on main:\n\n- `\w{7}` Add paywall/)
})
