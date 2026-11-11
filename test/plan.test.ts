import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
const todos = () => (ws.runFiles(runId, 'todos').includes('plan.json') ? JSON.parse(ws.readRunFile(runId, 'todos', 'plan.json')) : [])
/** pd book-state's answers, in the order the Step asks: each real Book's, then the India Book's paper Books' (the last repeating). */
const bookStates = ['india', 'india', 'india', 'paper', 'rules-only'].map((name) => ({ example: `book-state.${name}.json` }))

test("the Plan Step records the Rule plans for the Run's day, then reads the state of each plan's Book, its paper Books' apart", async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.normal.json' }, 'cross-check': { example: 'cross-check.agreed.json' }, 'book-state': bookStates })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [
      ['plan', '--on', '2026-10-27', '--dossiers', 'dossiers'],
      // The plans' closes against a second source: they agree, so the plans stand.
      ['cross-check', '--plan', 'plan.json'],
      ['book-state', 'IN'],
      ['book-state', 'US'],
      ['book-state', 'HK'],
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
  assert.deepEqual([states[0], states[3], states[4]], [example('book-state.india.json'), example('book-state.paper.json'), example('book-state.rules-only.json')])
  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /India Book: Rule plan for 2026-10-26, for placing, 3 orders, made from state fa1dba342bad/)
  assert.match(log, /US Book: no Rule plan: US has no panels yet/)
  assert.match(log, /India Book's paper Book: Rule plan for 2026-10-26, 3 orders, made from state 53f848d353e2/)
  assert.match(log, /India Book's rules-only paper Book: Rule plan for 2026-10-26, 3 orders, made from state 7c1e0b5a93d2/)
  assert.match(log, /US Book's paper Book: no Rule plan: US has no panels yet/)
  assert.doesNotMatch(log, /the ledger changed/)
  assert.doesNotMatch(log, /Hold mode/)
  // The names the Desk reviews, each with the analysts it needs and why.
  assert.match(log, /Desk: Rategain Travel Technologies Ltd in the India Book's paper Book, a buy: Chart \(A buy of 865 shares\), Events \(Financial Results on 29 Oct 2026\)/)
  assert.match(log, /Desk: Risk for the India Book's paper Book \(2 buys in the India Book's paper Book\)/)
  assert.match(log, /Desk: Chart, Events, Risk needed/)
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'cross-check.json')), example('cross-check.agreed.json'))
  assert.match(log, /Cross-check: India's 9 closes of 2026-10-26 against NSE's bhavcopy: 9 agree, 1 it hasn't \(IN:BSEONLY\)/)
  assert.match(log, /Cross-check: the US's 4 closes of 2026-10-26 against Tencent's daily bars: 4 agree/)
  assert.deepEqual(todos(), [])
  // The names the plans hold or may trade are kept for the next Run's Health Step.
  const watched = JSON.parse(readFileSync(join(ws.dataDir, 'state', 'watched.json'), 'utf8'))
  assert.equal(watched.run, runId)
  assert.ok(watched.names.includes('IN:RATEGAIN'), 'a buy of the plan')
  assert.deepEqual(watched.names, [...watched.names].sort())
})

test('a close a second source gives otherwise is a To-do, and the plans are made again once ash_new has quarantined it', async () => {
  prepare()
  ws.setPd({ plan: [{ example: 'plan.normal.json' }, { example: 'plan.hold.json' }], 'cross-check': { example: 'cross-check.gap.json' }, 'book-state': bookStates })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args.slice(0, 2)).slice(0, 3),
    [['plan', '--on'], ['cross-check', '--plan'], ['plan', '--on']],
  )
  // The plans kept are those made after the Quarantines: the index's fails the Data gate, so they are in Hold mode.
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'plan.json')), example('plan.hold.json'))
  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /Cross-check: a gap on Rategain Travel Technologies Ltd \(IN:RATEGAIN\): The lake closed at 578\.20 on 2026-10-26, NSE's bhavcopy at 520\.40 \(-10\.0%\)/)
  assert.match(log, /Cross-check: Apple \(US:AAPL\) is released: its closes agree now/)
  assert.match(log, /Cross-check: it changed a Quarantine, so the Rule plans are made again/)
  assert.match(log, /Hold mode: the Data gate fails/)
  assert.deepEqual(todos(), [
    "Hong Kong's closes of 2026-10-26 weren't checked against a second source (Tencent's daily bars couldn't be fetched: timed out), so its Order lists rest on the Lake's prices alone.",
    "Two sources disagree on Rategain Travel Technologies Ltd (IN:RATEGAIN): The lake closed at 578.20 on 2026-10-26, NSE's bhavcopy at 520.40 (-10.0%). It is quarantined, so no Book buys or sells it on a signal: check the close, then approve a Correction for it or dismiss its Quarantine.",
    "Two sources disagree on S&P 500 (^GSPC) (US:^GSPC): The lake closed at 7,000.00 on 2026-10-26, Tencent's daily bars at 6,510.00 (-7.0%). It is quarantined, which fails the Data gate, so every plan is in Hold mode: check the close, then dismiss its Quarantine.",
  ])
})

test("a cross-check that fails holds nothing up: the plans stand as made, with a To-do saying they rest on the Lake's prices alone", async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.normal.json' }, 'cross-check': { stderr: 'no such option\n', exitCode: 2 }, 'book-state': bookStates })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'plan.json')), example('plan.normal.json'))
  assert.equal(ws.runFiles(runId, '').includes('cross-check.json'), false)
  assert.equal(ws.pdCalls().filter((call) => call.args[0] === 'plan').length, 1)
  assert.match(ws.readRunFile(runId, 'logs', 'plan.log'), /Cross-check: the plans' closes couldn't be checked against a second source: pd cross-check --plan plan\.json exited with 2: no such option/)
  assert.deepEqual(todos(), ["The plans' closes weren't checked against a second source (pd cross-check failed: see the Plan Step's log), so today's Order lists rest on the Lake's prices alone."])
})

test("a second source that answers but has none of a market's closes is a To-do", async () => {
  prepare()
  const none = { ...example('cross-check.agreed.json'), markets: [{ market: 'US', as_of: '2026-10-26', source: "Tencent's daily bars", checked: 0, agreed: 0, unavailable: ['US:AAPL', 'US:^GSPC'], error: null }] }
  ws.setPd({ plan: { example: 'plan.normal.json' }, 'cross-check': { stdout: JSON.stringify(none) }, 'book-state': bookStates })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(todos(), ["The US's closes of 2026-10-26 weren't checked against a second source: Tencent's daily bars had none of the 2 asked for, so its Order lists rest on the Lake's prices alone."])
})

test('on a quiet day the log says the Desk has no name to review', async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.hold.json' }, 'book-state': bookStates })

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
  ws.setPd({ plan: { example: 'plan.hold.json' }, 'book-state': bookStates })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /Hold mode: the Data gate fails \(India: the lake is as of 2026-10-23, 1 session behind its last finished session, 2026-10-26\), so no plan makes an order/)
  assert.match(log, /India Book's paper Book: Rule plan for 2026-10-26, 0 orders/)
})

test("a plan ash_new couldn't make is recorded with why, and a state changed since its plan is said", async () => {
  prepare()
  ws.setPd({ plan: { example: 'plan.cant-plan.json' }, 'book-state': bookStates })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  const log = ws.readRunFile(runId, 'logs', 'plan.log')
  assert.match(log, /India Book: no Rule plan: The lake has no price for IN:GOLD1 on 2026-10-23/)
  assert.match(log, /India Book: its state is now fa1dba342bad, not 08c1ddde44df, which the plan was made from/)
})

test('a dry run makes the plans as any Run does, and its cross-check quarantines nothing and keeps no watched name', async () => {
  prepare({ dryRun: true })
  ws.setPd({ plan: { example: 'plan.normal.json' }, 'cross-check': { example: 'cross-check.agreed.json' }, 'book-state': bookStates })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls()[0].args, ['plan', '--on', '2026-10-27', '--dossiers', 'dossiers'])
  assert.deepEqual(ws.pdCalls()[1].args, ['cross-check', '--plan', 'plan.json', '--dry-run'])
  assert.equal(existsSync(join(ws.dataDir, 'state', 'watched.json')), false)
})

test('a pd plan that fails fails the Step, leaving no plan behind', async () => {
  prepare()
  ws.setPd({ plan: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'plan', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.equal(ws.runFiles(runId, '').includes('plan.json'), false)
})
