import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { ashNewFolder } from '../src/env.ts'
import { schemaErrors, type JsonSchema } from '../src/schema.ts'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws?.cleanup())

/** A workspace with an ash_new folder for the Health Agent to run in. */
function workspace(): Workspace {
  const made = makeWorkspace()
  const ashNew = join(made.homeDir, 'portfolio-dashboard')
  mkdirSync(ashNew)
  made.writeEnvFile(`ASH_NEW_FOLDER=${ashNew}\n`)
  return made
}

/** Whether the Run started on a Saturday, by its id: MarketSmith and the weekly review run only then. */
function onSaturday(id: string): boolean {
  const [year, month, day] = id.split('-').map(Number)
  return new Date(year, month - 1, day).getDay() === 6
}

test('agents run stocks --dry-run reads the Lake as it is, skips the Health Agent on a healthy Lake, judges on the fake Worker, then writes the Stocks Brief', async () => {
  ws = workspace()
  ws.setPd({
    status: { example: 'status.clean.json' },
    'book-holdings': { example: 'book-holdings.empty.json' },
    review: { example: 'review.saturday.json' },
    stages: { example: 'stages-check.empty.json' },
    plan: { example: 'plan.normal.json' },
    'book-state': [{ example: 'book-state.india.json' }, { example: 'book-state.paper.json' }, { example: 'book-state.rules-only.json' }],
    feeds: { example: 'feeds.fetched.json' },
    check: { example: 'check.recorded.json' },
    'paper-books': { example: 'paper-books.json' },
    judgement: { example: 'judgement-show.books.json' },
  })

  const result = await ws.agents('run', 'stocks', '--dry-run')

  assert.equal(result.status, 0, result.stderr)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.pipeline, 'stocks')
  assert.equal(run.status, 'succeeded')
  const saturday = onSaturday(id)
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['answers', 'succeeded'],
      ['broker-inbox', 'succeeded'],
      // A dry run fetches nothing from MarketSmith, whatever the day.
      ['marketsmith', 'skipped'],
      ['lake', 'succeeded'],
      ['review', saturday ? 'succeeded' : 'skipped'],
      ['stages', 'succeeded'],
      ['health', 'skipped'],
      ['plan', 'succeeded'],
      ['feeds', 'succeeded'],
      // The fake Worker stands in for the Desk's analysts and the Portfolio Manager, so no view is kept and its Journal is never saved.
      ['desk', 'succeeded'],
      ['portfolio-manager', 'succeeded'],
      ['check', 'succeeded'],
      ['save-state', 'skipped'],
      ['brief', 'succeeded'],
    ],
  )
  assert.deepEqual(ws.workerCliCalls('claude'), [])
  const states = ['IN', 'US', 'HK'].flatMap((book) => [['book-state', book, '--paper'], ['book-state', book, '--rules-only']])
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args.map((arg) => (arg.endsWith('.json') ? arg.split(/[\\/]/).at(-1)! : arg))),
    [
      ['book-holdings'],
      ['status'],
      ...(saturday ? [['review', '--dry-run']] : []),
      ['stages', 'check', '--dry-run'],
      ['plan', '--on', id.slice(0, 10), '--dossiers', 'dossiers'],
      ['book-state', 'IN'],
      ...states,
      // A dry run fetches no Feeds: it reads the cache.
      ['feeds', '--plan', 'plan.json', '--dossiers', 'dossiers', '--cached'],
      ['check', '--plan', 'plan.json', '--judgement', 'judgement.json', '--run', id, '--dry-run'],
      ['paper-books'],
      ['judgement', 'show'],
    ],
    'nothing in ash_new is recorded, refreshed or cleared',
  )
  assert.match(result.stdout, new RegExp(`Brief: .*${id}[\\\\/]brief\\.html`))
  assert.match(ws.readRunFile(id, 'brief.html'), /Data gate: pass/)
  assert.deepEqual(readdirSync(join(ws.dataDir, 'processes')), [], 'every process the Run started is recorded as ended')
})

test('a stocks Run whose refresh fails twice calls the Health Agent and ends partial, with a Brief that says why the Data gate failed, that the Health Agent failed too, and that the Rule plans went out without the Portfolio Manager', async () => {
  ws = workspace()
  ws.setPd({
    'book-holdings': { example: 'book-holdings.empty.json' },
    'clear-refresh': { example: 'clear-refresh.nothing.json' },
    marketsmith: { example: 'marketsmith.fetched.json' },
    daily: { stderr: 'Stopped: Yahoo answered 429\n', exitCode: 1 },
    status: { example: 'status.hold.json' },
    review: { example: 'review.saturday.json' },
    stages: { example: 'stages-check.empty.json' },
    plan: { example: 'plan.normal.json' },
    'book-state': [{ example: 'book-state.india.json' }, { example: 'book-state.paper.json' }, { example: 'book-state.rules-only.json' }],
    feeds: { example: 'feeds.fetched.json' },
    check: { example: 'check.recorded.json' },
    'paper-books': { example: 'paper-books.json' },
    judgement: { example: 'judgement-show.books.json' },
  })

  const result = await ws.agents('run', 'stocks')

  assert.equal(result.status, 2)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.status, 'partial')
  // MarketSmith is fetched, and the Books reviewed, only when the Run started on a Saturday.
  const saturday = onSaturday(id)
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['answers', 'succeeded'],
      ['broker-inbox', 'succeeded'],
      ['marketsmith', saturday ? 'succeeded' : 'skipped'],
      ['lake', 'failed'],
      ['review', saturday ? 'succeeded' : 'skipped'],
      ['stages', 'succeeded'],
      ['health', 'failed'],
      ['plan', 'succeeded'],
      ['feeds', 'succeeded'],
      ['desk', 'failed'],
      ['portfolio-manager', 'failed'],
      ['check', 'succeeded'],
      ['save-state', 'skipped'],
      ['brief', 'succeeded'],
    ],
  )
  // Every Worker's CLI fails in a test unless told otherwise, so the Health Agent, the Desk's three analysts and the Portfolio Manager fail on both.
  assert.equal(ws.workerCliCalls('codex').length, 5)
  assert.equal(ws.workerCliCalls('claude').length, 5)
  const judgement = JSON.parse(ws.readRunFile(id, 'judgement.json'))
  assert.equal(judgement.status, 'failed')
  // So the buys the Desk had to review are missing their reviews, and wait a session.
  assert.deepEqual([...new Set(judgement.missing_reviews.map((m: { analyst: string }) => m.analyst))].sort(), ['chart', 'events', 'risk'])
  const brief = ws.readRunFile(id, 'brief.html')
  assert.match(brief, /Data gate: fail/)
  assert.match(brief, /The Health Agent failed, so there is no diagnosis: claude-code failed/)
  assert.match(brief, /The Portfolio Manager failed, so each paper Book's Rule plan went out instead/)
  assert.match(brief, /lake: failed\. Log: <a href="logs\/lake\.log">/)
  assert.match(brief, /<h2>Coming events for the holdings<\/h2>/)
})

const ashNewContract = join(ashNewFolder(), 'contract')
const examples = readdirSync(pdExamples).filter((file) => file.endsWith('.json'))
const schemaFor = (example: string) => JSON.parse(readFileSync(join(ashNewContract, `${example.split('.')[0]}.schema.json`), 'utf8')) as JsonSchema

test(
  "the stand-in pd's example files validate against ash_new's schemas",
  { skip: !existsSync(ashNewContract) && `ash_new's contract isn't at ${ashNewContract}` },
  () => {
    assert.ok(examples.length)
    for (const example of examples) {
      assert.deepEqual(schemaErrors(JSON.parse(readFileSync(join(pdExamples, example), 'utf8')), schemaFor(example), example), [], example)
    }
    // Every command in the contract has an example, so the stand-in can answer it.
    const commands = readdirSync(ashNewContract).flatMap((file) => (file.endsWith('.schema.json') ? [file.slice(0, -'.schema.json'.length)] : []))
    assert.deepEqual(commands.filter((command) => !examples.some((example) => example.startsWith(`${command}.`))), [])
  },
)

test("an example that breaks ash_new's schema is caught", { skip: !existsSync(ashNewContract) && `ash_new's contract isn't at ${ashNewContract}` }, () => {
  const { gate, ...withoutGate } = JSON.parse(readFileSync(join(pdExamples, 'status.healthy.json'), 'utf8'))
  const renamed = { ...withoutGate, gate: { ...gate, verdict: 'hold' } }

  assert.deepEqual(schemaErrors(withoutGate, schemaFor('status.healthy.json')), ['answer.gate is missing'])
  assert.deepEqual(schemaErrors(renamed, schemaFor('status.healthy.json')), ['answer.gate.verdict must be one of pass, fail (got "hold")'])
})
