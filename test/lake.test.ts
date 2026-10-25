import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'
const stocksSteps = ['lake', 'brief'].map((name) => ({ name, status: 'pending' }))

function prepare({ dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: stocksSteps, dryRun })
}

const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const lake = () => JSON.parse(ws.readRunFile(runId, 'lake.json'))
const todos = () => (ws.runFiles(runId, 'todos').includes('lake.json') ? JSON.parse(ws.readRunFile(runId, 'todos', 'lake.json')) : [])

test('on a healthy Lake, the Lake Step clears nothing, refreshes once with pd daily and records the status', async () => {
  prepare()
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.nothing.json' }, daily: { stdout: 'Data health: ok, 5 flags\n' }, status: { example: 'status.healthy.json' } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['clear-refresh'], ['daily'], ['status']],
  )
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'lake', 'status.json')), example('status.healthy.json'))
  const recorded = lake()
  assert.equal(recorded.refreshed, true)
  assert.deepEqual(recorded.cleared, example('clear-refresh.nothing.json'))
  assert.deepEqual(
    recorded.attempts.map((a: { exitCode: number }) => a.exitCode),
    [0],
  )
  assert.deepEqual(todos(), [])
  assert.match(ws.readRunFile(runId, 'logs', 'lake.log'), /Data health: ok, 5 flags/, "pd daily's output is in the Step's log")
})

test('a refresh that fails is retried once, and the Lake Step succeeds when the retry does', async () => {
  prepare()
  ws.setPd({
    'clear-refresh': { example: 'clear-refresh.nothing.json' },
    daily: [{ stderr: 'Stopped: Yahoo answered 429\n', exitCode: 1 }, { stdout: 'Data health: ok\n' }],
    status: { example: 'status.healthy.json' },
  })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args[0]),
    ['clear-refresh', 'daily', 'daily', 'status'],
  )
  assert.deepEqual(
    lake().attempts.map((a: { exitCode: number }) => a.exitCode),
    [1, 0],
  )
  assert.equal(lake().refreshed, true)
  assert.match(ws.readRunFile(runId, 'logs', 'lake.log'), /Stopped: Yahoo answered 429[\s\S]*retrying once[\s\S]*Data health: ok/)
})

test('a refresh that fails twice fails the Lake Step, which still records the status the Data gate reads', async () => {
  prepare()
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.nothing.json' }, daily: { stderr: 'Stopped: Yahoo answered 429\n', exitCode: 1 }, status: { example: 'status.hold.json' } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 1)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args[0]),
    ['clear-refresh', 'daily', 'daily', 'status'],
  )
  assert.equal(lake().refreshed, false)
  assert.deepEqual(
    lake().attempts.map((a: { exitCode: number }) => a.exitCode),
    [1, 1],
  )
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'lake', 'status.json')), example('status.hold.json'))
  assert.match(ws.readRunFile(runId, 'logs', 'lake.log'), /pd daily failed twice/)
})

test('a refresh left running by a dead process is cleared before the Lake is refreshed', async () => {
  prepare()
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.cleared.json' }, daily: {}, status: { example: 'status.healthy.json' } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args[0]),
    ['clear-refresh', 'daily', 'status'],
  )
  assert.deepEqual(lake().cleared, example('clear-refresh.cleared.json'))
  assert.match(ws.readRunFile(runId, 'logs', 'lake.log'), /Cleared refresh job 468: Cleared by pd clear-refresh/)
})

test('a refresh whose process is still alive is left alone, and pd daily still tries', async () => {
  prepare()
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.refused.json', exitCode: 1 }, daily: { stderr: 'Not started: pd daily is running\n', exitCode: 1 }, status: { example: 'status.hold.json' } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 1)
  assert.deepEqual(lake().cleared, example('clear-refresh.refused.json'))
  assert.match(ws.readRunFile(runId, 'logs', 'lake.log'), /Left the running refresh alone: `pd daily` is running \(process 23016\)/)
})

test('a clear-refresh that crashes is logged, and the Lake is still refreshed', async () => {
  prepare()
  ws.setPd({ 'clear-refresh': { stderr: 'Traceback: sqlite3.OperationalError: database is locked\n', exitCode: 2 }, daily: {}, status: { example: 'status.healthy.json' } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args[0]),
    ['clear-refresh', 'daily', 'status'],
  )
  assert.equal(lake().cleared, null)
  assert.match(ws.readRunFile(runId, 'logs', 'lake.log'), /Couldn't clear a refresh left running: pd clear-refresh exited with 2: Traceback/)
})

test("a status that can't be read after the refresh fails the Lake Step, keeping what the refresh did and dropping an older status", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.nothing.json' }, daily: {}, status: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(lake().refreshed, true)
  assert.equal(ws.runFiles(runId, 'lake').includes('status.json'), false)
})

test("ash_new's own schedule found on raises a To-do, and the Lake is still refreshed", async () => {
  prepare()
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.nothing.json' }, daily: {}, status: { example: 'status.schedule-on.json' } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(lake().refreshed, true)
  const raised = todos()
  assert.equal(raised.length, 2)
  assert.match(raised[0], /ash_new's own schedule is on/)
  assert.match(raised[1], /ash_new's Windows task is registered: remove it with `uv run pd schedule-task remove`/)
})

test("a dry run reads the Lake's status as it is, without clearing or refreshing anything", async () => {
  prepare({ dryRun: true })
  ws.setPd({ status: { example: 'status.healthy.json' } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['status']],
  )
  assert.deepEqual(lake(), { dryRun: true, cleared: null, attempts: [], refreshed: false })
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'lake', 'status.json')), example('status.healthy.json'))
})

test("a status that can't be read fails the Lake Step, saying why", async () => {
  prepare({ dryRun: true })
  ws.setPd({ status: { stderr: "No securities table at D:\\lake\\securities.parquet\n", exitCode: 1 } })

  const result = await ws.agents('step', 'lake', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(ws.runFiles(runId, 'lake').includes('status.json'), false)
  assert.match(ws.readRunFile(runId, 'logs', 'lake.log'), /pd status exited with 1: No securities table/)
})

test('the Lake Step runs once per Run unless forced, but again after it failed', async () => {
  prepare()
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.nothing.json' }, daily: [{ exitCode: 1 }, { exitCode: 1 }, {}], status: { example: 'status.healthy.json' } })

  assert.equal((await ws.agents('step', 'lake', '--run', runId)).status, 1)
  assert.equal((await ws.agents('step', 'lake', '--run', runId)).status, 0)
  assert.equal((await ws.agents('step', 'lake', '--run', runId)).status, 0)
  assert.equal(ws.pdCalls().filter((call) => call.args[0] === 'daily').length, 3, 'the third run found the Lake already refreshed')

  assert.equal((await ws.agents('step', 'lake', '--run', runId, '--force')).status, 0)
  assert.equal(ws.pdCalls().filter((call) => call.args[0] === 'daily').length, 4)
})
