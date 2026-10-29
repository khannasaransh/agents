import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'
const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const status = () => JSON.parse(ws.readRunFile(runId, 'run.json')).steps.find((s: { name: string }) => s.name === 'check').status

/** A stocks Run whose Plan Step ended as `plan` and left `plan.normal.json` behind if it succeeded. */
function prepare({ plan = 'succeeded', dryRun = false } = {}) {
  ws = makeWorkspace()
  const steps = [
    { name: 'plan', status: plan },
    { name: 'check', status: 'pending' },
    { name: 'brief', status: 'pending' },
  ]
  ws.prepareRun(runId, { pipeline: 'stocks', steps, dryRun })
  if (plan === 'succeeded') ws.writeRunFile(runId, 'plan.json', example('plan.normal.json'))
}

test("the Check Step records each paper Book's Order list from this Run's plans, then reads how the paper Books stand", async () => {
  prepare()
  ws.setPd({ check: { example: 'check.recorded.json' }, 'paper-books': { example: 'paper-books.json' } })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  const [check, standing] = ws.pdCalls()
  assert.deepEqual(check.args.filter((arg) => !arg.endsWith('plan.json')), ['check', '--plan', '--run', runId])
  assert.ok(check.args[2].endsWith(join(runId, 'plan.json')))
  assert.deepEqual(standing.args, ['paper-books'])
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'check.json')), { check: example('check.recorded.json'), why: null })
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'paper-books.json')), example('paper-books.json'))
  const log = ws.readRunFile(runId, 'logs', 'check.log')
  assert.match(log, /India Book's paper Book: Order list for 2026-10-26 recorded/)
  assert.match(log, /India Book's rules-only paper Book: Order list for 2026-10-26 recorded/)
  assert.match(log, /US Book's paper Book: Order list not recorded: It has no Rule plan: US has no panels yet/)
})

test('the Check Step records nothing when the Plan Step failed, and says why', async () => {
  prepare({ plan: 'failed' })
  ws.setPd({ 'paper-books': { example: 'paper-books.json' } })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'skipped')
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['paper-books']],
  )
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'check.json')), { check: null, why: 'the Plan Step failed, so there is no Rule plan to record' })
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'paper-books.json')), example('paper-books.json'))
})

test('a dry run records no Order list: it asks pd check what it would record', async () => {
  prepare({ dryRun: true })
  ws.setPd({ check: { example: 'check.dry-run.json' }, 'paper-books': { example: 'paper-books.json' } })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.pdCalls()[0].args.at(-1), '--dry-run')
  assert.match(ws.readRunFile(runId, 'logs', 'check.log'), /India Book's paper Book: Order list for 2026-10-26 would be recorded \(dry run\)/)
})

test('a pd check that fails fails the Step', async () => {
  prepare()
  ws.setPd({ check: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.match(ws.readRunFile(runId, 'logs', 'check.log'), /database is locked/)
})
