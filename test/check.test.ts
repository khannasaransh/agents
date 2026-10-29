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
const standing = { 'paper-books': { example: 'paper-books.json' }, judgement: { example: 'judgement-show.books.json' } }

/** The Portfolio Manager's answer, as its Step keeps it. */
const answered = {
  status: 'answered',
  answer: { books: example('judgement.answered.json').books, journal: { entries: [], open: [] } },
  journalRead: '',
  inputs: ['plan.json', 'book-states.json', 'stages.json'],
}

/** A stocks Run whose Plan Step ended as `plan` and left `plan.normal.json` behind if it succeeded, and whose Portfolio Manager ended as `pm`. */
function prepare({ plan = 'succeeded', pm = 'succeeded', dryRun = false } = {}) {
  ws = makeWorkspace()
  const steps = [
    { name: 'plan', status: plan },
    { name: 'portfolio-manager', status: pm },
    { name: 'check', status: 'pending' },
    { name: 'brief', status: 'pending' },
  ]
  ws.prepareRun(runId, { pipeline: 'stocks', steps, dryRun })
  if (plan === 'succeeded') ws.writeRunFile(runId, 'plan.json', example('plan.normal.json'))
  if (pm === 'succeeded') ws.writeRunFile(runId, 'portfolio-manager.json', answered)
}

test("the Check Step hands the Portfolio Manager's judgement to pd check with this Run's plans, then reads how the paper Books stand and their Judgement modes", async () => {
  prepare()
  ws.setPd({ check: { example: 'check.recorded.json' }, ...standing })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  const [check, paperBooks, modes] = ws.pdCalls()
  assert.deepEqual(
    check.args.filter((arg) => !arg.endsWith('.json')),
    ['check', '--plan', '--judgement', '--run', runId],
  )
  assert.ok(check.args[2].endsWith(join(runId, 'plan.json')))
  assert.ok(check.args[4].endsWith(join(runId, 'judgement.json')))
  // What pd check reads: the answer's judgement of each Book, and the Run's files its Decision records may cite.
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'judgement.json')), example('judgement.answered.json'))
  assert.deepEqual(paperBooks.args, ['paper-books'])
  assert.deepEqual(modes.args, ['judgement', 'show'])
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'check.json')), { check: example('check.recorded.json'), why: null })
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'paper-books.json')), example('paper-books.json'))
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'judgement-show.json')), example('judgement-show.books.json'))
  const log = ws.readRunFile(runId, 'logs', 'check.log')
  assert.match(log, /India Book's paper Book: Order list for 2026-10-26 with the Portfolio Manager's changes recorded/)
  assert.match(log, /India Book's paper Book: dropped the Portfolio Manager's swap: IN:ZOMATO isn't in the Book's Pool/)
  assert.match(log, /India Book's rules-only paper Book: Order list for 2026-10-26 recorded/)
  assert.match(log, /US Book's paper Book: Order list not recorded: It has no Rule plan: US has no panels yet/)
})

test("when the Portfolio Manager didn't run, pd check is told so and sends the Rule plans", async () => {
  prepare({ pm: 'skipped' })
  ws.setPd({ check: { example: 'check.recorded.json' }, ...standing })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'judgement.json')), {
    status: 'failed',
    why: 'The Portfolio Manager Step skipped, so it judged nothing',
    inputs: [],
    books: [],
  })
})

test('a list that sends only its exits and stops raises its To-do', async () => {
  prepare()
  const recorded = example('check.recorded.json')
  const todo = "The India Book's paper Book's Rule plan for 2026-10-26 breaks the Mandate (IN:STOVEKRAFT would be 16% of the Book, over the position cap of 15%), so only its exits and Disaster stops went out"
  recorded.lists[0].judgement = { ...recorded.lists[0].judgement, applied: 'exits_only', why: 'The Rule plan breaks the Mandate too', todo }
  ws.setPd({ check: { stdout: JSON.stringify(recorded) }, ...standing })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'todos', 'check.json')), [todo])
})

test('the Check Step records nothing when the Plan Step failed, and says why', async () => {
  prepare({ plan: 'failed', pm: 'skipped' })
  ws.setPd(standing)

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'skipped')
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['paper-books'], ['judgement', 'show']],
  )
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'check.json')), { check: null, why: 'the Plan Step failed, so there is no Rule plan to record' })
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'paper-books.json')), example('paper-books.json'))
})

test('a dry run records no Order list: it asks pd check what it would record', async () => {
  prepare({ dryRun: true })
  ws.setPd({ check: { example: 'check.dry-run.json' }, ...standing })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.pdCalls()[0].args.at(-1), '--dry-run')
  assert.match(ws.readRunFile(runId, 'logs', 'check.log'), /India Book's paper Book: Order list for 2026-10-26 with the Portfolio Manager's changes would be recorded \(dry run\)/)
})

test('a pd check that fails fails the Step', async () => {
  prepare()
  ws.setPd({ check: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'check', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.match(ws.readRunFile(runId, 'logs', 'check.log'), /database is locked/)
})
