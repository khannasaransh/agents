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

/** What `codex exec --json` prints when its schema-checked answer is `answer`. */
const codexAnswering = (answer: unknown) => ({
  stdout: [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(answer) } },
    { type: 'turn.completed', usage: { input_tokens: 800, output_tokens: 40 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n'),
})

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
  taskStatus: [],
}
/** The answer as pm.json records it: with the task status report, null without a sprint post, in place of the statuses. */
const { taskStatus: _, ...recorded } = answer
const written = { status: 'answered', ...recorded, taskReport: null }

test("the PM Agent runs on Codex with the Run's reviews, commits and health so far, no Discord messages and its Memory, and its answer is written to the Run", async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeMemory('pm', 'notes', '- Still open: the inpix-panel login bug.\n')
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  const [call, ...more] = ws.workerCliCalls('codex')
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
  assert.deepEqual(answered, written)
  assert.deepEqual(runs, [runId])
  assert.match(inputs, /^[0-9a-f]{64}$/)
  assert.equal(memoryRead, '- Still open: the inpix-panel login bug.\n')
})

test('the PM Agent is not given a review of other commits, such as one from before Fetch was re-run and found more', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeRunFile(runId, 'review/crux_flutter.json', { ...review, to: sha(3) })
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(promptInput(ws.workerCliCalls('codex')[0].stdin, 'reviews'), [])
})

test('re-running PM after it answered calls no Worker, unless forced', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeRunFile(runId, 'pm.json', { status: 'answered', ...answer, todos: [] })
  ws.setWorkerCli('codex', codexAnswering(answer))

  const rerun = await pm()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'pm.json')).todos, [])

  const forced = await ws.agents('step', 'pm', '--run', runId, '--force')

  assert.equal(forced.status, 0, forced.stderr)
  assert.equal(ws.workerCliCalls('codex').length, 1)
  const { runs, inputs, memoryRead, ...answered } = JSON.parse(ws.readRunFile(runId, 'pm.json'))
  assert.deepEqual(answered, written)
})

test('a PM Agent that fails on Codex is retried on Claude Code outside any git repo, and when that fails too the Step fails and the Run records why', async () => {
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
  assert.match(recorded.error, /^codex failed: Codex is overloaded; then claude-code failed: Session limit reached$/)
})

test('re-running PM answers again once an earlier Step changed what its answer was given, such as a forced re-read of Discord', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.setWorkerCli('codex', codexAnswering(answer))
  const first = await pm()
  assert.equal(first.status, 0, first.stderr)
  ws.writeRunFile(runId, 'discord.json', { since: '2026-10-21T00:00:00.000Z', until: '2026-10-22T00:00:00.000Z', messages: [] })

  const rerun = await pm()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.workerCliCalls('codex').length, 2)
  assert.deepEqual(promptInput(ws.workerCliCalls('codex')[1].stdin, 'discord'), [])
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
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('codex')
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

const sprintPost = {
  channel: 'sprint-assignments',
  author: 'Subhash Yadav',
  postedAt: '2026-10-21T12:05:26.362+00:00',
  link: 'https://discord.com/channels/1/1306524433187602432/9',
  title: 'here is the list of tasks for this sprint-(oct 21 - oct 27)',
  messages: [{ id: '9', author: 'Subhash Yadav', timestamp: '2026-10-21T12:05:26.362+00:00', link: 'https://discord.com/channels/1/1306524433187602432/9', content: '…' }],
  tasks: [
    { id: 'paywall', title: 'Crux | Paywall', product: 'Crux', pm: 'Aditya Manchanda', assignees: [{ name: 'Asha', team: 'Flutter' }] },
    { id: 'football-center', title: 'Football Center', product: null, pm: 'Prakhar Shukla', assignees: [{ name: 'Neha', team: 'Backend' }] },
    { id: 'tender-tracker', title: 'Tender Tracker', product: null, pm: null, assignees: [{ name: 'Neha', team: 'Backend' }] },
  ],
  updates: [
    {
      id: '12',
      channel: 'payments',
      thread: null,
      dm: false,
      author: 'Asha',
      timestamp: '2026-10-22T10:00:00.000+00:00',
      content: 'Paywall build is up for QA',
      link: 'https://discord.com/channels/1/2/12',
      mentionsSaransh: false,
      fromSaransh: false,
      prdFiles: [],
      apkFiles: [],
      otherFiles: [],
      loginLinks: [],
    },
  ],
}
const { messages: _messages, tasks: _tasks, updates: _updates, ...postAbout } = sprintPost

test('with a sprint post, the PM Agent is given it and the last report on the same post, and its task status report covers every task', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeRunFile(runId, 'sprint.json', sprintPost)
  const lastReport = {
    post: postAbout,
    tasks: [
      { ...sprintPost.tasks[0], status: 'in-progress', note: 'Asha started it.', evidence: ['crux_flutter `1111111` Start paywall'], was: null },
      { ...sprintPost.tasks[1], status: 'blocked', note: 'Waits on the scores API.', evidence: [], was: null },
    ],
  }
  ws.prepareRun('2026-10-21-0530')
  ws.writeRunFile('2026-10-21-0530', 'pm.json', { status: 'answered', ...recorded, taskReport: lastReport })
  ws.prepareRun('2026-10-20-0530')
  ws.writeRunFile('2026-10-20-0530', 'pm.json', { status: 'answered', ...recorded, taskReport: { ...lastReport, post: { ...postAbout, link: 'https://discord.com/channels/1/1306524433187602432/1' } } })
  const taskStatus = [
    { id: 'paywall', status: 'in-testing', note: 'The paywall is merged and waits for QA.', evidence: ['crux_flutter `2222222` Add paywall'] },
    { id: 'football-center', status: 'blocked', note: 'Still waits on the scores API.', evidence: [] },
  ]
  ws.setWorkerCli('codex', codexAnswering({ ...answer, taskStatus }))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  const prompt = ws.workerCliCalls('codex')[0].stdin
  const { loginLinks, ...update } = sprintPost.updates[0]
  assert.deepEqual(promptInput(prompt, 'sprint'), { ...sprintPost, updates: [update] }, 'the PRD links of messages since the post are not To-dos again')
  assert.deepEqual(promptInput(prompt, 'previousTaskStatus'), {
    run: '2026-10-21-0530',
    tasks: lastReport.tasks.map(({ id, status, note, evidence }) => ({ id, status, note, evidence })),
  })
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'pm.json')).taskReport, {
    post: postAbout,
    tasks: [
      { ...sprintPost.tasks[0], ...taskStatus[0], id: 'paywall', was: 'in-progress' },
      { ...sprintPost.tasks[1], ...taskStatus[1], id: 'football-center', was: null },
      { ...sprintPost.tasks[2], status: 'no-signal', note: 'The PM Agent said nothing about this task.', evidence: [], was: null },
    ],
  })
})

test('without a sprint post, the PM Agent is given none and records no task status report', async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await pm()

  assert.equal(result.status, 0, result.stderr)
  const prompt = ws.workerCliCalls('codex')[0].stdin
  assert.equal(promptInput(prompt, 'sprint'), null)
  assert.equal(promptInput(prompt, 'previousTaskStatus'), null)
  assert.equal(JSON.parse(ws.readRunFile(runId, 'pm.json')).taskReport, null)
})

test("with a sprint post, the PM Agent is given the work on other branches since it, but not a read from before the post changed", async () => {
  ws = makeWorkspace()
  prepareRun()
  ws.writeRunFile(runId, 'sprint.json', sprintPost)
  const repos = [{ repo: 'inpix_flutter', team: 'flutter', production: 'development', branches: [{ branch: 'feature/jaapCounterChanges', count: 1, commits: [{ sha: sha(4), author: 'Shreyansh', date: '2026-10-22T10:00:00+05:30', subject: 'Bug fixes' }] }] }]
  ws.writeRunFile(runId, 'branches.json', { since: '2026-10-21T12:05:26.362Z', repos, failed: [] })
  ws.setWorkerCli('codex', codexAnswering(answer))

  assert.equal((await pm()).status, 0)
  assert.deepEqual(promptInput(ws.workerCliCalls('codex')[0].stdin, 'branches'), repos)

  ws.writeRunFile(runId, 'branches.json', { since: '2026-10-14T12:00:00.000Z', repos, failed: [] })
  assert.equal((await ws.agents('step', 'pm', '--run', runId, '--force')).status, 0)
  assert.equal(promptInput(ws.workerCliCalls('codex')[1].stdin, 'branches'), null)
})
