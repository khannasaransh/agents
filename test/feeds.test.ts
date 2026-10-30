import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'
const stocksSteps = ['plan', 'feeds', 'brief'].map((name) => ({ name, status: 'pending' }))

function prepare({ dryRun = false, planned = true } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: stocksSteps, dryRun })
  if (planned) ws.writeRunFile(runId, 'plan.json', example('plan.normal.json'))
}

const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const status = () => JSON.parse(ws.readRunFile(runId, 'run.json')).steps.find((s: { name: string }) => s.name === 'feeds').status
const todos = () => (ws.runFiles(runId, 'todos').includes('feeds.json') ? JSON.parse(ws.readRunFile(runId, 'todos', 'feeds.json')) : [])

test("the Feeds Step fetches the Feeds for the plan's names, bringing the dossiers' events up to date, and keeps them", async () => {
  prepare()
  ws.setPd({ feeds: { example: 'feeds.fetched.json' } })

  const result = await ws.agents('step', 'feeds', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['feeds', '--plan', 'plan.json', '--dossiers', 'dossiers']],
  )
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'feeds.json')), example('feeds.fetched.json'))
  const log = ws.readRunFile(runId, 'logs', 'feeds.log')
  assert.match(log, /NSE's board meetings: fetched 4 of 4 names, 0 read from the cache, 0 new events/)
  assert.match(log, /4 names, 4 events as fetched by 2026-10-27T01:42:10\+00:00/)
  assert.deepEqual(todos(), [])
})

test('a source that failed, and EDGAR without its contact, each raise a To-do without failing the Step', async () => {
  prepare()
  ws.setPd({ feeds: { example: 'feeds.failed.json' } })

  const result = await ws.agents('step', 'feeds', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  const [bse, edgar] = todos()
  assert.match(bse, /^BSE's announcements failed this Run \(BSE's list of scrips answered 403 to .+ \(fetching IN:ASIANPAINT\)\), so its events are as last fetched\./)
  assert.match(bse, /needs browser-like headers and changes without notice/)
  assert.match(edgar, /^SEC EDGAR's filings weren't fetched: PDASH_SEC_CONTACT isn't set/)
  assert.match(edgar, /Set SEC_CONTACT in the agents repo's \.env/)
  assert.match(ws.readRunFile(runId, 'logs', 'feeds.log'), /SEC EDGAR's filings: skipped: PDASH_SEC_CONTACT isn't set/)
})

test('the SEC contact in the env file goes to pd feeds as PDASH_SEC_CONTACT', async () => {
  prepare()
  ws.writeEnvFile('SEC_CONTACT=Saransh saransh@example.com\n')
  ws.setPd({ feeds: { example: 'feeds.fetched.json' } })

  const result = await ws.agents('step', 'feeds', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.pdCalls()[0].env.PDASH_SEC_CONTACT, 'Saransh saransh@example.com')
})

test('a dry run fetches nothing: it reads only the cache', async () => {
  prepare({ dryRun: true })
  ws.setPd({ feeds: { example: 'feeds.fetched.json' } })

  const result = await ws.agents('step', 'feeds', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls()[0].args, ['feeds', '--plan', 'plan.json', '--dossiers', 'dossiers', '--cached'])
})

test('without a Rule plan the Step skips itself, since the plan names the names', async () => {
  prepare({ planned: false })

  const result = await ws.agents('step', 'feeds', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'skipped')
  assert.match(ws.readRunFile(runId, 'logs', 'feeds.log'), /No Rule plan was made in this Run, so no name needs its Feeds/)
  assert.deepEqual(ws.pdCalls(), [])
})

test('a pd feeds that fails fails the Step, leaving no Feeds behind', async () => {
  prepare()
  ws.setPd({ feeds: { stderr: 'database is locked\n', exitCode: 1 } })

  const result = await ws.agents('step', 'feeds', '--run', runId)

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.equal(ws.runFiles(runId, '').includes('feeds.json'), false)
})
