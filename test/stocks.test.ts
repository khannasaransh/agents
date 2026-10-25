import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { ashNewFolder } from '../src/env.ts'
import { schemaErrors, type JsonSchema } from '../src/schema.ts'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws?.cleanup())

test('agents run stocks --dry-run reads the Lake as it is, then writes the Stocks Brief', async () => {
  ws = makeWorkspace()
  ws.setPd({ status: { example: 'status.healthy.json' } })

  const result = await ws.agents('run', 'stocks', '--dry-run')

  assert.equal(result.status, 0, result.stderr)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.pipeline, 'stocks')
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['lake', 'succeeded'],
      ['brief', 'succeeded'],
    ],
  )
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['status']],
    'nothing in ash_new is refreshed or cleared',
  )
  assert.match(result.stdout, new RegExp(`Brief: .*${id}[\\\\/]brief\\.html`))
  assert.match(ws.readRunFile(id, 'brief.html'), /Data gate: pass/)
  assert.deepEqual(readdirSync(join(ws.dataDir, 'processes')), [], 'every process the Run started is recorded as ended')
})

test('a stocks Run whose refresh fails twice ends partial, with a Brief that says why the Data gate failed', async () => {
  ws = makeWorkspace()
  ws.setPd({ 'clear-refresh': { example: 'clear-refresh.nothing.json' }, daily: { stderr: 'Stopped: Yahoo answered 429\n', exitCode: 1 }, status: { example: 'status.hold.json' } })

  const result = await ws.agents('run', 'stocks')

  assert.equal(result.status, 2)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.status, 'partial')
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['lake', 'failed'],
      ['brief', 'succeeded'],
    ],
  )
  const brief = ws.readRunFile(id, 'brief.html')
  assert.match(brief, /Data gate: fail/)
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
