import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { git, makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

/** `claude --print` answering as a PM Agent with nothing to report. */
const claudeCodeAnsweringPm = {
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { repoLines: [], highlights: [], todos: ['Check the baselines.'], memory: null, taskStatus: [] } }),
}

test('agents run daily creates a Run named by local start date and time that runs its Steps in order', async () => {
  ws = makeWorkspace()
  ws.addRepo('crux_flutter')
  ws.writeRepoList()
  ws.setWorkerCli('claude', claudeCodeAnsweringPm)

  const result = await ws.agents('run', 'daily')

  assert.equal(result.status, 0, result.stderr)
  const [id] = ws.runIds()
  const now = new Date()
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-')
  assert.match(id, new RegExp(`^${today}-\\d{4}`))

  const run = ws.readRun(id)
  assert.equal(run.pipeline, 'daily')
  assert.equal(run.status, 'succeeded', 'Discord and Docs, not set up yet, and Branches, with no sprint post, are skipped without counting against the Run')
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['fetch', 'succeeded'],
      ['review', 'succeeded'],
      ['discord', 'skipped'],
      ['branches', 'skipped'],
      ['pm', 'succeeded'],
      ['docs', 'skipped'],
      ['save-state', 'succeeded'],
      ['brief', 'succeeded'],
    ],
  )
  for (const step of run.steps) {
    assert.ok(step.startedAt && step.endedAt, `${step.name} has start and end times`)
    assert.ok(existsSync(join(ws.dataDir, 'runs', id, step.log)), `${step.name} log exists`)
  }
  assert.ok(existsSync(join(ws.dataDir, 'runs', id, 'brief.md')))
  assert.match(ws.readRunFile(id, 'brief.md'), /## To-dos\n\n- Check the baselines\.\n[\s\S]*## Run health[\s\S]*\n- discord: skipped\. Log: logs\/discord\.log\n/)
  assert.deepEqual(readdirSync(join(ws.dataDir, 'processes')), [], 'every process the Run started is recorded as ended')
})

test("a Run whose Save state fails says so in its Brief", async () => {
  ws = makeWorkspace()
  ws.addRepo('crux_flutter')
  ws.writeRepoList()
  // Save state writes the state file through a temporary file, which can't be written over a folder.
  mkdirSync(join(ws.dataDir, 'state', 'repos.json.tmp'), { recursive: true })

  const result = await ws.agents('run', 'daily')

  assert.equal(result.status, 2)
  const [id] = ws.runIds()
  assert.equal(ws.readRun(id).steps.find((s) => s.name === 'save-state')!.status, 'failed')
  assert.match(ws.readRunFile(id, 'brief.md'), /## Run health[\s\S]*- save-state: failed\. Log: logs\/save-state\.log/)
})

test('a Run whose Fetch fails still writes its Brief and ends partial', async () => {
  ws = makeWorkspace()
  ws.addBrokenRepo('gone')
  ws.addRepo('crux_flutter')
  ws.writeRepoList()
  ws.setWorkerCli('claude', claudeCodeAnsweringPm)

  const result = await ws.agents('run', 'daily')

  assert.notEqual(result.status, 0)
  const [id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.status, 'partial')
  assert.deepEqual(
    run.steps.map((s) => [s.name, s.status]),
    [
      ['fetch', 'failed'],
      ['review', 'succeeded'],
      ['discord', 'skipped'],
      ['branches', 'skipped'],
      ['pm', 'succeeded'],
      ['docs', 'skipped'],
      ['save-state', 'succeeded'],
      ['brief', 'succeeded'],
    ],
  )
  assert.match(ws.readRunFile(id, 'brief.md'), /## Run health[\s\S]*fetch: failed/)
})

test("a Repo's second Run lists the commits pushed since its first", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  await ws.agents('run', 'daily', '--dry-run')
  repo.pushCommit('Add paywall')

  await ws.agents('run', 'daily', '--dry-run')

  const [first, second] = ws.runIds()
  assert.match(ws.readRunFile(first, 'brief.md'), /Baseline recorded/)
  assert.match(ws.readRunFile(second, 'brief.md'), /1 new commit on main:\n\n- `\w{7}` Add paywall/)
})

test('agents run daily --dry-run reviews new commits on the fake Worker, and leaves them for a real review', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  await ws.agents('run', 'daily', '--dry-run')
  const baseline = ws.readRepoState().crux_flutter.lastReviewed
  repo.pushCommit('Add paywall')

  const result = await ws.agents('run', 'daily', '--dry-run')

  assert.equal(result.status, 0, result.stderr)
  const [, id] = ws.runIds()
  const run = ws.readRun(id)
  assert.equal(run.dryRun, true)
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(ws.reviewResult(id, 'crux_flutter').findings, [])
  assert.match(ws.readRunFile(id, 'brief.md'), /## To-dos\n\nNothing is waiting on you\.\n[\s\S]*### crux_flutter[\s\S]*Review: Answered by the fake Worker\.\n\nNo findings\./)
  assert.deepEqual(ws.workerCliCalls('claude'), [])
  assert.deepEqual(ws.readRepoState(), { crux_flutter: { lastReviewed: baseline } })
})

test('agents run daily --dry-run runs the Docs Step after the PM Agent, without making or moving the docs branch', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  const wiki = ws.addWiki()
  const main = wiki.commit('Document the paywall', {
    'repos/crux_flutter/paywall.md': ['---', 'type: repo', 'review: draft', 'sources:', '  - crux_flutter@main@1234567:lib/paywall.dart', '---', '', '# Paywall', ''].join('\n'),
  })
  ws.writeEnvFile(`WIKI_FOLDER=${wiki.folder}\n`)
  await ws.agents('run', 'daily', '--dry-run')
  repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })

  const result = await ws.agents('run', 'daily', '--dry-run')

  assert.equal(result.status, 0, result.stderr)
  const [, id] = ws.runIds()
  assert.deepEqual(
    ws.readRun(id).steps.map((s) => [s.name, s.status]),
    [
      ['fetch', 'succeeded'],
      ['review', 'succeeded'],
      ['discord', 'skipped'],
      ['branches', 'skipped'],
      ['pm', 'succeeded'],
      ['docs', 'succeeded'],
      ['save-state', 'succeeded'],
      ['brief', 'succeeded'],
    ],
  )
  assert.equal(git(wiki.folder, 'branch', '--list', 'agents/docs'), '')
  assert.equal(git(wiki.folder, 'rev-parse', 'HEAD'), main)
})

test('a Run whose review fails ends partial, and its Brief says so', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  await ws.agents('run', 'daily', '--dry-run')
  repo.pushCommit('Add paywall')
  ws.writeCannedAnswers({ reviewer: [{ error: 'Quota limit reached' }] })

  const result = await ws.agents('run', 'daily', '--dry-run')

  assert.equal(result.status, 2)
  const [, id] = ws.runIds()
  assert.equal(ws.readRun(id).status, 'partial')
  assert.match(ws.readRunFile(id, 'brief.md'), /Review failed: Quota limit reached[\s\S]*## Run health[\s\S]*- review: failed/)
})

/** What `codex exec --json` prints when its schema-checked answer is `answer`. */
const codexAnswering = (answer: unknown) => ({
  stdout: [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(answer) } },
    { type: 'turn.completed' },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n'),
})

test('agents run daily --worker codex runs the PM Agent on Codex, with the model its config names for Codex', async () => {
  ws = makeWorkspace()
  ws.addRepo('crux_flutter')
  ws.writeRepoList()
  ws.setWorkerCli('codex', codexAnswering({ repoLines: [], highlights: [], todos: ['Check the baselines.'], memory: null, taskStatus: [] }))

  const result = await ws.agents('run', 'daily', '--worker', 'codex')

  assert.equal(result.status, 0, result.stderr)
  const [id] = ws.runIds()
  assert.equal(ws.readRun(id).worker, 'codex')
  const [call, ...more] = ws.workerCliCalls('codex')
  assert.deepEqual(more, [])
  assert.ok(call.args.includes('gpt-6-astra'), call.args.join(' '))
  assert.ok(call.args.includes('model_reasoning_effort="medium"'), call.args.join(' '))
  assert.deepEqual(ws.workerCliCalls('claude'), [])
})

test('agents run refuses a Worker that can only be a fallback, and a dry run that also names a Worker', async () => {
  ws = makeWorkspace()

  const antigravity = await ws.agents('run', 'daily', '--worker', 'antigravity')
  assert.equal(antigravity.status, 1)
  assert.match(antigravity.stderr, /fallback Worker/)

  const dry = await ws.agents('run', 'daily', '--dry-run', '--worker', 'codex')
  assert.equal(dry.status, 1)
  assert.match(dry.stderr, /fake Worker/)
  assert.deepEqual(ws.runIds(), [])
})
