import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'
const stocksSteps = ['lake', 'health', 'plan', 'brief'].map((name) => ({ name, status: 'pending' }))

function prepare({ dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: stocksSteps, dryRun })
}

const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const status = () => JSON.parse(ws.readRunFile(runId, 'run.json')).steps.find((s: { name: string }) => s.name === 'plan').status

test("the Plan Step records the Rule plans for the Run's day, then reads the state of each plan's Book, its paper Books' apart", async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.normal.json' }, 'book-state': [{ example: 'book-state.india.json' }, { example: 'book-state.paper.json' }, { example: 'book-state.rules-only.json' }] })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [
      ['plan', '--on', '2026-10-27'],
      ['book-state', 'IN'],
      ['book-state', 'IN', '--paper'],
      ['book-state', 'IN', '--rules-only'],
      ['book-state', 'US', '--paper'],
      ['book-state', 'US', '--rules-only'],
      ['book-state', 'HK', '--paper'],
      ['book-state', 'HK', '--rules-only'],
    ],
  )
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'plan.json')), example('plan.normal.json'))
  const states = JSON.parse(ws.readRunFile(runId, 'book-states.json')).states
  assert.deepEqual(states.slice(0, 3), [example('book-state.india.json'), example('book-state.paper.json'), example('book-state.rules-only.json')])
  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /India Book: shadow Rule plan for 2026-10-26, 2 orders, made from state fa1dba342bad/)
  assert.match(log, /India Book's paper Book: Rule plan for 2026-10-26, 3 orders, made from state 53f848d353e2/)
  assert.match(log, /India Book's rules-only paper Book: Rule plan for 2026-10-26, 3 orders, made from state 7c1e0b5a93d2/)
  assert.match(log, /US Book's paper Book: no Rule plan: US has no panels yet/)
  assert.doesNotMatch(log, /the ledger changed/)
  assert.doesNotMatch(log, /Hold mode/)
})

test('on a day the Data gate fails, the log says every plan is in Hold mode', async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.hold.json' }, 'book-state': [{ example: 'book-state.india.json' }, { example: 'book-state.paper.json' }, { example: 'book-state.rules-only.json' }] })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /Hold mode: the Data gate fails \(India: the lake is as of 2026-10-23, 1 session behind its last finished session, 2026-10-26\), so no plan makes an order/)
  assert.match(log, /India Book's paper Book: Rule plan for 2026-10-26, 0 orders/)
})

test("a plan ash_new couldn't make is recorded with why, and a state changed since its plan is said", async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.cant-plan.json' }, 'book-state': [{ example: 'book-state.india.json' }, { example: 'book-state.paper.json' }, { example: 'book-state.rules-only.json' }] })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /India Book: no shadow Rule plan: The lake has no price for IN:GOLD1 on 2026-10-23/)
  assert.match(log, /India Book: its state is now fa1dba342bad, not 08c1ddde44df, which the plan was made from/)
})

test('a dry run makes the plans as any Run does: neither command records anything', async () => {
  prepare({ dryRun: true })
  ws.setPd({ plan: { example: 'plan.normal.json' }, 'book-state': [{ example: 'book-state.india.json' }, { example: 'book-state.paper.json' }, { example: 'book-state.rules-only.json' }] })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls()[0].args, ['plan', '--on', '2026-10-27'])
})

test('a pd plan that fails fails the Step, leaving no plan behind', async () => {
  prepare()
  ws.setPd({ plan: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.equal(ws.runFiles(runId, '').includes('plan.json'), false)
})
