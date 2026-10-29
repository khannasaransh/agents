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

test('agents run stocks --dry-run reads the Lake as it is, skips the Health Agent on a healthy Lake, then writes the Stocks Brief', async () => {
  ws = workspace()
  ws.setPd({
    status: { example: 'status.clean.json' },
    'book-holdings': { example: 'book-holdings.empty.json' },
    stages: { example: 'stages-check.empty.json' },
    plan: { example: 'plan.normal.json' },
    'book-state': { example: 'book-state.india.json' },
  })

  const result = await ws.agents('run', 'stocks', '--dry-run')

  assert.equal(result.status, 0, result.stderr)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.pipeline, 'stocks')
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['answers', 'succeeded'],
      ['broker-inbox', 'succeeded'],
      // A dry run fetches nothing from MarketSmith, whatever the day.
      ['marketsmith', 'skipped'],
      ['lake', 'succeeded'],
      ['stages', 'succeeded'],
      ['health', 'skipped'],
      ['plan', 'succeeded'],
      ['brief', 'succeeded'],
    ],
  )
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['book-holdings'], ['status'], ['stages', 'check', '--dry-run'], ['plan', '--on', id.slice(0, 10)], ['book-state', 'IN'], ['book-state', 'IN', '--paper'], ['book-state', 'US', '--paper'], ['book-state', 'HK', '--paper']],
    'nothing in ash_new is recorded, refreshed or cleared',
  )
  assert.match(result.stdout, new RegExp(`Brief: .*${id}[\\\\/]brief\\.html`))
  assert.match(ws.readRunFile(id, 'brief.html'), /Data gate: pass/)
  assert.deepEqual(readdirSync(join(ws.dataDir, 'processes')), [], 'every process the Run started is recorded as ended')
})

test('a stocks Run whose refresh fails twice calls the Health Agent and ends partial, with a Brief that says why the Data gate failed and that the Health Agent failed too', async () => {
  ws = workspace()
  ws.setPd({
    'book-holdings': { example: 'book-holdings.empty.json' },
    'clear-refresh': { example: 'clear-refresh.nothing.json' },
    marketsmith: { example: 'marketsmith.fetched.json' },
    daily: { stderr: 'Stopped: Yahoo answered 429\n', exitCode: 1 },
    status: { example: 'status.hold.json' },
    stages: { example: 'stages-check.empty.json' },
    plan: { example: 'plan.normal.json' },
    'book-state': { example: 'book-state.india.json' },
  })

  const result = await ws.agents('run', 'stocks')

  assert.equal(result.status, 2)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.status, 'partial')
  // MarketSmith is fetched only when the Run started on a Saturday.
  const [year, month, day] = id.split('-').map(Number)
  const saturday = new Date(year, month - 1, day).getDay() === 6
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['answers', 'succeeded'],
      ['broker-inbox', 'succeeded'],
      ['marketsmith', saturday ? 'succeeded' : 'skipped'],
      ['lake', 'failed'],
      ['stages', 'succeeded'],
      ['health', 'failed'],
      ['plan', 'succeeded'],
      ['brief', 'succeeded'],
    ],
  )
  // Every Worker's CLI fails in a test unless told otherwise, so the Health Agent fails on both.
  assert.equal(ws.workerCliCalls('codex').length, 1)
  assert.equal(ws.workerCliCalls('claude').length, 1)
  const brief = ws.readRunFile(id, 'brief.html')
  assert.match(brief, /Data gate: fail/)
  assert.match(brief, /The Health Agent failed, so there is no diagnosis: claude-code failed/)
  assert.match(brief, /lake: failed\. Log: <a href="logs\/lake\.log">/)
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
