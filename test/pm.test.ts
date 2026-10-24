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
  const { runs, inputs, memoryRead, ...answered } = JSON.parse(ws.readRunFile(runId, 'pm.json'))
  assert.deepEqual(answered, { status: 'answered', ...answer })
  assert.deepEqual(runs, [runId])
  assert.match(inputs, /^[0-9a-f]{64}$/)
  assert.equal(memoryRead, '- Still open: the inpix-panel login bug.\n')
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
  const { runs, inputs, memoryRead, ...answered } = JSON.parse(ws.readRunFile(runId, 'pm.json'))
  assert.deepEqual(answered, { status: 'answered', ...answer })
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

test('re-running PM answers again once an earlier Step changed what its answer was given, such as a forced re-read of Discord', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))
  const first = await pm()
  assert.equal(first.status, 0, first.stderr)
  ws.writeRunFile(runId, 'discord.json', { since: '2026-10-21T00:00:00.000Z', until: '2026-10-22T00:00:00.000Z', messages: [] })

  const rerun = await pm()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.workerCliCalls('claude').length, 2)
  assert.deepEqual(promptInput(ws.workerCliCalls('claude')[1].stdin, 'discord'), [])
})

test("the PM Agent is given what earlier Runs in the PM backlog held, since their PM failed, before this Run's, and its answer names the Runs it covers", async () => {
  ws = makeWorkspace()
  prepareRun()
  const earlierRun = '2026-10-21-0530'
  const earlierFetch: FetchResult = { repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(9), status: 'new-commits', head: sha(1), commits: [{ ...commit, sha: sha(1), subject: 'Add login' }] }
  const loginFinding = { severity: 'high' as const, file: 'lib/login.dart', line: 3, commit: sha(1), author: 'Asha', summary: 'Logs the password', bySaransh: false }
  ws.prepareRun(earlierRun)
  ws.writeRunFile(earlierRun, 'fetch/crux_flutter.json', earlierFetch)
  ws.writeRunFile(earlierRun, 'review/crux_flutter.json', { ...review, from: sha(9), to: sha(1), summary: 'Adds a login.', findings: [loginFinding] } satisfies ReviewResult)
  ws.writeRunFile(earlierRun, 'discord.json', { since: '2026-10-20T00:00:00.000Z', until: '2026-10-21T00:00:00.000Z', messages: [] })
  ws.writePmBacklog([earlierRun])
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(
    (promptInput(call.stdin, 'reviews') as ReviewResult[]).map((r) => [r.from, r.to, r.status === 'reviewed' && r.findings.length]),
    [
      [sha(9), sha(1), 1],
      [sha(1), sha(2), 0],
    ],
  )
  assert.deepEqual(
    (promptInput(call.stdin, 'commits') as { commits: { subject: string }[] }[]).map((c) => c.commits[0].subject),
    ['Add login', 'Add paywall'],
  )
  assert.deepEqual(promptInput(call.stdin, 'discord'), [])
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'pm.json')).runs, [earlierRun, runId])
})
