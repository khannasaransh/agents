import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-28-0930'
const stocksSteps = ['answers', 'lake', 'stages', 'brief'].map((name) => ({ name, status: 'pending' }))

function prepare({ dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: stocksSteps, dryRun })
}

const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const status = () => JSON.parse(ws.readRunFile(runId, 'run.json')).steps.find((s: { name: string }) => s.name === 'stages').status

test("the Stages Step records each Book's Sleeves and their Stages, as pd stages check prints them", async () => {
  prepare()
  ws.setPd({ stages: { example: 'stages-check.books.json' } })

  const result = await ws.agents('step', 'stages', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['stages', 'check']], 'a new version of a strategy is recorded as a Candidate')
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'stages.json')), example('stages-check.books.json'))
  const log = ws.readRunFile(runId, 'logs', 'stages.log')
  assert.match(log, /India Book: India Super 30 OK, tuned in Paper since 2026-07-29; India CW2, selected a Candidate since 2026-10-28; 1 Retired/)
  assert.match(log, /US Book: no Sleeve yet/)
})

test('a dry run records nothing: it asks pd stages check what it would record', async () => {
  prepare({ dryRun: true })
  ws.setPd({ stages: { example: 'stages-check.empty.json' } })

  const result = await ws.agents('step', 'stages', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['stages', 'check', '--dry-run']])
})

test("a pd stages check that fails fails the Step, recording no Stages", async () => {
  prepare()
  ws.setPd({ stages: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'stages', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.equal(ws.runFiles(runId, '').includes('stages.json'), false)
})
