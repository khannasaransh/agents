import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { git, makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

test('agents step fetch skips Repos already fetched in the Run, and redoes them with --force', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  await ws.agents('run', 'daily')
  const [id] = ws.runIds()
  const baseline = ws.fetchResult(id, 'crux_flutter').head
  const pushed = repo.pushCommit('Late change')

  const rerun = await ws.agents('step', 'fetch', '--run', id)

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.fetchResult(id, 'crux_flutter').head, baseline)
  assert.equal(git(repo.folder, 'rev-parse', 'origin/main'), baseline, 'no fetch happened')

  const forced = await ws.agents('step', 'fetch', '--run', id, '--force')

  assert.equal(forced.status, 0, forced.stderr)
  assert.equal(ws.fetchResult(id, 'crux_flutter').head, pushed)
})

test('re-running a failed Step retries what failed and updates the Run record', async () => {
  ws = makeWorkspace()
  const good = ws.addRepo('crux_flutter')
  const broken = ws.addBrokenRepo('gone')
  ws.writeRepoList()
  const pmAnswer = { repoLines: [], highlights: [], todos: [], memory: null, taskStatus: [] }
  ws.setWorkerCli('codex', {
    stdout: [
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(pmAnswer) } },
      { type: 'turn.completed' },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n'),
  })
  await ws.agents('run', 'daily')
  const [id] = ws.runIds()
  const before = ws.readRun(id)
  assert.equal(before.status, 'partial')
  ws.writeRepoList([good.entry, { ...broken, remote: good.entry.remote }])

  const rerun = await ws.agents('step', 'fetch', '--run', id)

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.fetchResult(id, 'gone').status, 'baseline')
  const after = ws.readRun(id)
  const fetch = after.steps.find((s) => s.name === 'fetch')!
  assert.equal(fetch.status, 'succeeded')
  assert.ok(fetch.startedAt! > before.steps.find((s) => s.name === 'fetch')!.startedAt!)
  assert.equal(after.status, 'succeeded')
})

test('agents step brief keeps the written Brief, and rewrites it with --force', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  await ws.agents('run', 'daily', '--dry-run')
  repo.pushCommit('Before')
  await ws.agents('run', 'daily', '--dry-run')
  const [, id] = ws.runIds()
  repo.pushCommit('Late change')
  await ws.agents('step', 'fetch', '--run', id, '--force')

  await ws.agents('step', 'brief', '--run', id)
  assert.doesNotMatch(ws.readRunFile(id, 'brief.md'), /Late change/)

  await ws.agents('step', 'brief', '--run', id, '--force')
  assert.match(ws.readRunFile(id, 'brief.md'), /Late change/)
})

test('agents step refuses a Run that does not exist', async () => {
  ws = makeWorkspace()
  ws.writeRepoList([])

  const result = await ws.agents('step', 'fetch', '--run', '2026-01-01-0300')

  assert.equal(result.status, 1)
  assert.deepEqual(ws.runIds(), [])
})
