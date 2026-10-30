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
      ['plan', '--on', '2026-10-27', '--dossiers', 'dossiers'],
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
  // The names the Desk reviews, each with the analysts it needs and why.
  assert.match(log, /Desk: Rategain Travel Technologies Ltd in the India Book's paper Book, a buy: Chart \(A buy of 865 shares\), Events \(Financial Results on 29 Oct 2026\)/)
  assert.match(log, /Desk: Risk for the India Book's paper Book \(2 buys in the India Book's paper Book\)/)
  assert.match(log, /Desk: Chart, Events, Risk needed/)
})

test('on a quiet day the log says the Desk has no name to review', async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.hold.json' }, 'book-state': [{ example: 'book-state.india.json' }, { example: 'book-state.paper.json' }, { example: 'book-state.rules-only.json' }] })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.match(ws.readRunFile(runId, 'logs', 'plan.log'), /The Desk has no name to review/)
})

test('the log says what each paper plan made of the early exits Saransh approved', async () => {
  prepare()
  const plan = example('plan.normal.json')
  const paper = plan.plans.find((p: { kind: string }) => p.kind === 'paper')
  paper.early_exits = [
    { id: 4, security_id: 'IN:IDFCFIRSTB', name: 'IDFC First Bank Ltd', status: 'planned', why: null, orders: ['IN-paper-2026-10-26-004'] },
    { id: 5, security_id: 'IN:ASIANPAINT', name: 'Asian Paints Ltd', status: 'not_held', why: 'The paper Book no longer holds it: it lapses', orders: [] },
  ]
  ws.setPd({ plan: { stdout: JSON.stringify(plan) }, 'book-state': { example: 'book-state.paper.json' } })

  assert.equal((await ws.agents('step', 'plan', '--run', runId)).status, 0)

  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /India Book's paper Book: early exit 4 of IDFC First Bank Ltd: sold by IN-paper-2026-10-26-004/)
  assert.match(log, /India Book's paper Book: early exit 5 of Asian Paints Ltd: The paper Book no longer holds it: it lapses/)
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
  assert.deepEqual(ws.pdCalls()[0].args, ['plan', '--on', '2026-10-27', '--dossiers', 'dossiers'])
})

test('a pd plan that fails fails the Step, leaving no plan behind', async () => {
  prepare()
  ws.setPd({ plan: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.equal(ws.runFiles(runId, '').includes('plan.json'), false)
})
