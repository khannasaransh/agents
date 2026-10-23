import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { FetchResult } from '../steps/fetch.ts'
import type { ReviewResult } from '../steps/review.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'
const sha = (n: number) => String(n).repeat(40)

const commit = { sha: sha(2), author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject: 'Add paywall' }
const fetched: FetchResult[] = [
  { repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(1), status: 'new-commits', head: sha(2), commits: [commit] },
  { repo: 'news-read-go', team: 'backend', branch: 'master', previous: sha(5), status: 'unchanged', head: sha(5), commits: [] },
  { repo: 'gone', team: 'android', branch: 'main', previous: null, status: 'failed', error: 'fatal: repository not found' },
]
const review: ReviewResult = {
  repo: 'crux_flutter',
  team: 'flutter',
  branch: 'main',
  from: sha(1),
  to: sha(2),
  status: 'reviewed',
  summary: 'Adds a paywall.',
  findings: [],
  memory: '# crux_flutter\n',
}

function prepareRun() {
  ws.writeRepoList([])
  ws.prepareRun(runId, {
    steps: [
      { name: 'fetch', status: 'failed' },
      { name: 'review', status: 'succeeded' },
      { name: 'pm', status: 'pending' },
      { name: 'save-state', status: 'pending' },
      { name: 'brief', status: 'pending' },
    ],
  })
  for (const result of fetched) ws.writeRunFile(runId, `fetch/${result.repo}.json`, result)
  ws.writeRunFile(runId, 'review/crux_flutter.json', review)
}

const pm = () => ws.agents('step', 'pm', '--run', runId)

/** What `claude --print --output-format json` prints when its schema-checked answer is `answer`. */
const claudeCodeAnswering = (answer: unknown) => ({
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: JSON.stringify(answer), structured_output: answer }),
})

/** The value of one input in an Agent's prompt, as the Worker's CLI was given it. */
function promptInput(prompt: string, name: string): unknown {
  const block = new RegExp(`### ${name}: [^\\n]*\\n\\n\`\`\`(json)?\\n([\\s\\S]*?)\\n\`\`\`\\n`).exec(prompt)
  assert.ok(block, `no ${name} input in the prompt:\n${prompt}`)
  return block[1] ? JSON.parse(block[2]) : block[2]
}

const answer = {
  repoLines: [{ repo: 'crux_flutter', line: 'A paywall now guards premium stories.' }],
  highlights: [],
  todos: ['Fix the fetch of gone: the repository is not found.'],
  memory: null,
}

test("the PM Agent runs on Claude Code with the Run's reviews, commits and health so far, no Discord messages and its Memory, and its answer is written to the Run", async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeMemory('pm', 'notes', '- Still open: the inpix-panel login bug.\n')
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  const [call, ...more] = ws.workerCliCalls('claude')
  assert.deepEqual(more, [])
  const { memory, ...reviewed } = review
  assert.deepEqual(promptInput(call.stdin, 'reviews'), [reviewed])
  assert.deepEqual(promptInput(call.stdin, 'commits'), [
    { repo: 'crux_flutter', team: 'flutter', branch: 'main', commits: [{ sha: sha(2), author: 'Asha', subject: 'Add paywall' }] },
  ])
  assert.equal(promptInput(call.stdin, 'discord'), null)
  assert.deepEqual(promptInput(call.stdin, 'runHealth'), {
    steps: [{ name: 'fetch', status: 'failed' }],
    failedToFetch: [{ repo: 'gone', team: 'android', error: 'fatal: repository not found' }],
  })
  assert.equal(promptInput(call.stdin, 'memory'), '- Still open: the inpix-panel login bug.\n')
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'pm.json')), { status: 'answered', ...answer })
})

test('the PM Agent is not given a review of other commits, such as one from before Fetch was re-run and found more', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeRunFile(runId, 'review/crux_flutter.json', { ...review, to: sha(3) })
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(promptInput(ws.workerCliCalls('claude')[0].stdin, 'reviews'), [])
})

test('re-running PM after it answered calls no Worker, unless forced', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeRunFile(runId, 'pm.json', { status: 'answered', ...answer, todos: [] })
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const rerun = await pm()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.deepEqual(ws.workerCliCalls('claude'), [])
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'pm.json')).todos, [])

  const forced = await ws.agents('step', 'pm', '--run', runId, '--force')

  assert.equal(forced.status, 0, forced.stderr)
  assert.equal(ws.workerCliCalls('claude').length, 1)
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'pm.json')), { status: 'answered', ...answer })
})

test('a PM Agent that fails on Claude Code is retried on Codex outside any git repo, and when that fails too the Step fails and the Run records why', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.setWorkerCli('claude', { stdout: JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Session limit reached' }), exitCode: 1 })
  ws.setWorkerCli('codex', { stderr: 'Codex is overloaded', exitCode: 1 })

  const result = await pm()

  assert.equal(result.status, 1)
  const [codex] = ws.workerCliCalls('codex')
  assert.ok(codex.args.includes('--skip-git-repo-check'), codex.args.join(' '))
  const recorded = JSON.parse(ws.readRunFile(runId, 'pm.json'))
  assert.equal(recorded.status, 'failed')
  assert.match(recorded.error, /^claude-code failed: Session limit reached; then codex failed: Codex is overloaded$/)
})
