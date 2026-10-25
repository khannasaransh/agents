import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

// A Saturday's Run, and a Tuesday's.
const saturday = '2026-10-31-0930'
const tuesday = '2026-10-27-0930'
const stocksSteps = ['marketsmith', 'lake', 'brief'].map((name) => ({ name, status: 'pending' }))

function prepare(runId: string, { dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: stocksSteps, dryRun })
}

const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const recorded = (runId: string) => JSON.parse(ws.readRunFile(runId, 'marketsmith.json'))
const todos = (runId: string) => (ws.runFiles(runId, 'todos').includes('marketsmith.json') ? JSON.parse(ws.readRunFile(runId, 'todos', 'marketsmith.json')) : [])
const log = (runId: string) => ws.readRunFile(runId, 'logs', 'marketsmith.log')

test("on a weekday the MarketSmith Step skips itself, asking nothing of pd", async () => {
  prepare(tuesday)
  ws.setPd({})

  const result = await ws.agents('step', 'marketsmith', '--run', tuesday)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(ws.readRunFile(tuesday, 'run.json')).steps[0].status, 'skipped')
  assert.deepEqual(ws.pdCalls(), [])
  assert.equal(ws.runFiles(tuesday, '').includes('marketsmith.json'), false)
  assert.match(log(tuesday), /MarketSmith is fetched on Saturdays, and this Run started on a Tuesday/)
})

test("on a Saturday it fetches India and the US with pd marketsmith and records the fetch", async () => {
  prepare(saturday)
  ws.setPd({ marketsmith: { example: 'marketsmith.fetched.json', stderr: 'IN: fetching 2599 symbols from MarketSmith\n' } })

  const result = await ws.agents('step', 'marketsmith', '--run', saturday)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(ws.readRunFile(saturday, 'run.json')).steps[0].status, 'succeeded')
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['marketsmith']],
  )
  assert.deepEqual(recorded(saturday), example('marketsmith.fetched.json'))
  assert.deepEqual(todos(saturday), [])
  assert.match(log(saturday), /IN: fetching 2599 symbols from MarketSmith/, "pd marketsmith's log is in the Step's")
  assert.match(log(saturday), /India: fetched 2571 of 2599, snapshot IN:2026-10-31/)
})

test('a rejected cookie skips the Step with a To-do naming the cookie, keeping what was fetched', async () => {
  prepare(saturday)
  ws.setPd({ marketsmith: { example: 'marketsmith.rejected.json', exitCode: 78 } })

  const result = await ws.agents('step', 'marketsmith', '--run', saturday)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(ws.readRunFile(saturday, 'run.json')).steps[0].status, 'skipped')
  assert.deepEqual(recorded(saturday), example('marketsmith.rejected.json'))
  const raised = todos(saturday)
  assert.equal(raised.length, 1)
  assert.match(raised[0], /^PDASH_MS_INDIA_AUTH didn't work, so India wasn't fetched this Saturday \(MarketSmith India answered 403/)
  assert.match(raised[0], /ash_new's \.env as PDASH_MS_INDIA_AUTH, then run `uv run pd marketsmith --region IN` in ash_new/)
})

test("a fetch that fails otherwise fails the Step, still recording what was fetched", async () => {
  prepare(saturday)
  ws.setPd({ marketsmith: { example: 'marketsmith.failed.json', exitCode: 1 } })

  const result = await ws.agents('step', 'marketsmith', '--run', saturday)

  assert.equal(result.status, 1)
  assert.equal(JSON.parse(ws.readRunFile(saturday, 'run.json')).steps[0].status, 'failed')
  assert.deepEqual(recorded(saturday), example('marketsmith.failed.json'))
  assert.match(log(saturday), /The US wasn't fetched: SiteError: MarketSmith's search of NASDAQ failed 3 times/)
})

test("pd marketsmith crashing fails the Step, saying why", async () => {
  prepare(saturday)
  ws.setPd({ marketsmith: { stderr: 'Traceback: ModuleNotFoundError: pdash.marketsmith\n', exitCode: 2 } })

  const result = await ws.agents('step', 'marketsmith', '--run', saturday)

  assert.equal(result.status, 1)
  assert.equal(JSON.parse(ws.readRunFile(saturday, 'run.json')).steps[0].status, 'failed')
  assert.equal(ws.runFiles(saturday, '').includes('marketsmith.json'), false)
  assert.match(log(saturday), /pd marketsmith exited with 2: Traceback: ModuleNotFoundError/)
})

test('a dry run fetches nothing', async () => {
  prepare(saturday, { dryRun: true })
  ws.setPd({})

  const result = await ws.agents('step', 'marketsmith', '--run', saturday)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(ws.readRunFile(saturday, 'run.json')).steps[0].status, 'skipped')
  assert.deepEqual(ws.pdCalls(), [])
})

test('run again, the Step fetches only the regions not yet fetched, and once all are, nothing unless forced', async () => {
  prepare(saturday)
  ws.setPd({ marketsmith: [{ example: 'marketsmith.rejected.json', exitCode: 78 }, { example: 'marketsmith.fetched.json' }] })

  await ws.agents('step', 'marketsmith', '--run', saturday)
  await ws.agents('step', 'marketsmith', '--run', saturday)
  await ws.agents('step', 'marketsmith', '--run', saturday)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args),
    [['marketsmith'], ['marketsmith', '--region', 'IN']],
    'the second run asked again only for India, whose cookie was rejected, and the third for nothing',
  )
  const regions = recorded(saturday).regions
  assert.deepEqual(
    regions.map((r: { region: string; status: string; ok: number }) => [r.region, r.status, r.ok]),
    [['IN', 'fetched', 2571], ['US', 'fetched', 5969]],
    "India's second fetch, and the US's first",
  )
  assert.deepEqual(todos(saturday), [], "the fetch that worked dropped the cookie's To-do")

  await ws.agents('step', 'marketsmith', '--run', saturday, '--force')
  assert.deepEqual(ws.pdCalls()[2].args, ['marketsmith'], 'forced, it fetches every region again')
})
