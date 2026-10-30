import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

// A Saturday's Run, a Tuesday's, and the first Saturday of November's.
const saturday = '2026-10-31-0930'
const tuesday = '2026-10-27-0930'
const firstSaturday = '2026-11-07-0930'
const stocksSteps = ['lake', 'review', 'stages', 'brief'].map((name) => ({ name, status: 'pending' }))

function prepare(runId: string, { dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: stocksSteps, dryRun })
}

const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const status = (runId: string) => JSON.parse(ws.readRunFile(runId, 'run.json')).steps.find((s: { name: string }) => s.name === 'review').status
const log = (runId: string) => ws.readRunFile(runId, 'logs', 'review.log')

test('on a weekday the Review Step skips itself, asking nothing of pd', async () => {
  prepare(tuesday)
  ws.setPd({})

  const result = await ws.agents('step', 'review', '--run', tuesday)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(tuesday), 'skipped')
  assert.deepEqual(ws.pdCalls(), [])
  assert.equal(ws.runFiles(tuesday, '').includes('review.json'), false)
  assert.match(log(tuesday), /The weekly review is on Saturdays, and this Run started on a Tuesday/)
})

test("on a Saturday it gets the weekly figures from pd review and keeps them for the Portfolio Manager and the Brief", async () => {
  prepare(saturday)
  ws.setPd({ review: { example: 'review.saturday.json' } })

  const result = await ws.agents('step', 'review', '--run', saturday)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(saturday), 'succeeded')
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['review']])
  assert.deepEqual(JSON.parse(ws.readRunFile(saturday, 'review.json')), example('review.saturday.json'))
  assert.match(log(saturday), /India Book: paper Book 2\.2% since 2026-07-30; 1 Sleeve reviewed/)
  assert.match(log(saturday), /US Book: paper Book not started; 0 Sleeves reviewed/)
  assert.match(log(saturday), /Due: in-super30-ok-tuned in the IN Book, from Paper to Real-small, since 2026-10-29/)
})

test("on a month's first Saturday it adds the monthly review of the month before: pd review --month", async () => {
  prepare(firstSaturday)
  ws.setPd({ review: { example: 'review.monthly.json' } })

  const result = await ws.agents('step', 'review', '--run', firstSaturday)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['review', '--month', '2026-10']])
  assert.deepEqual(JSON.parse(ws.readRunFile(firstSaturday, 'review.json')), example('review.monthly.json'))
  assert.match(log(firstSaturday), /India Book in 2026-10: 2\.1% in INR, attributed to its sources/)
  assert.match(log(firstSaturday), /US Book in 2026-10: 2\.3% in INR, attributed to its sources/)
})

test('a demotion the demotion rule made is in the log', async () => {
  prepare(saturday)
  ws.setPd({ review: { example: 'review.demotion.json' } })

  const result = await ws.agents('step', 'review', '--run', saturday)

  assert.equal(result.status, 0, result.stderr)
  assert.match(log(saturday), /Demoted in-super30-ok-tuned in the IN Book from Paper to Retired: Its live drawdown, -45\.1%, passed 1\.5 times/)
})

test('a dry run demotes nothing: it asks pd review with --dry-run', async () => {
  prepare(saturday, { dryRun: true })
  ws.setPd({ review: { example: 'review.saturday.json' } })

  const result = await ws.agents('step', 'review', '--run', saturday)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['review', '--dry-run']])
})

test('a pd review that fails fails the Step, leaving no review', async () => {
  prepare(saturday)
  ws.writeRunFile(saturday, 'review.json', { stale: true })
  ws.setPd({ review: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'review', '--run', saturday)

  assert.equal(result.status, 1)
  assert.equal(status(saturday), 'failed')
  assert.equal(ws.runFiles(saturday, '').includes('review.json'), false)
})
