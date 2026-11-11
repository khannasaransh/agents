import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'

/** A stocks Run whose Brief is written, its Lake Step having refreshed the Lake or not. */
function prepare({ refreshed = true, dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, {
    pipeline: 'stocks',
    steps: [
      { name: 'lake', status: refreshed ? 'succeeded' : 'failed' },
      { name: 'brief', status: 'succeeded' },
      { name: 'backtests', status: 'pending' },
    ],
    dryRun,
  })
  ws.writeRunFile(runId, 'lake.json', { dryRun, cleared: null, attempts: [], refreshed })
}

const step = () => ws.agents('step', 'backtests', '--run', runId)
const status = () => ws.readRun(runId).steps.find((s) => s.name === 'backtests')!.status
const log = () => ws.readRunFile(runId, 'logs', 'backtests.log')

test("after the Brief, the Backtests Step has ash_new run its stale backtests again, their output in the Step's log", async () => {
  prepare()
  ws.setPd({ 'backtests-update': { stdout: 'Stale backtests run again: in-cw2-selected, us-cw2-selected\nBacktests: 2 stale strategies run again\n' } })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['backtests-update']])
  assert.match(log(), /Backtests: 2 stale strategies run again/)
})

test('the stocks Pipeline runs its Backtests Step last, after the Brief', async () => {
  const { default: stocks } = await import('../pipelines/stocks.ts')

  assert.deepEqual(stocks.steps.slice(-2), ['brief', 'backtests'])
  assert.ok(stocks.steps.indexOf('lake') < stocks.steps.indexOf('brief'))
})

test('a dry run runs no backtest again', async () => {
  prepare({ dryRun: true })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'skipped')
  assert.deepEqual(ws.pdCalls(), [])
  assert.match(log(), /Skipped: Dry run: no backtest is run again/)
})

test("a Run whose Lake Step didn't refresh the Lake runs no backtest again", async () => {
  prepare({ refreshed: false })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'skipped')
  assert.deepEqual(ws.pdCalls(), [])
  assert.match(log(), /Skipped: This Run's Lake Step didn't bring the Lake up to date/)
})

test('a pd backtests-update that fails fails the Step, saying the stale strategies wait for the next refresh', async () => {
  prepare()
  ws.setPd({ 'backtests-update': { stderr: 'Not started: another refresh is running\n', exitCode: 1 } })

  const result = await step()

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.match(log(), /Not started: another refresh is running/)
  assert.match(log(), /pd backtests-update exited with 1: the strategies left stale are run again after the next refresh/)
})
