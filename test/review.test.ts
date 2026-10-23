import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import reviewer from '../agents/reviewer/config.ts'
import { git, makeWorkspace, type TestRepo, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'

/** The head of the production branch the clone last fetched, standing in for the last reviewed commit. */
const lastFetched = (repo: TestRepo) => git(repo.folder, 'rev-parse', `origin/${repo.entry.branch}`)

/** Prepares a Run whose Fetch found each Repo's commits since `from`, or a first-Run baseline when `from` is null. */
function prepareRun(fetched: [TestRepo, string | null][], { dryRun = true } = {}) {
  ws.writeRepoList()
  ws.prepareRun(runId, { dryRun })
  for (const [repo, from] of fetched) ws.writeFetchResult(runId, repo, from)
}

/** Whether a process is still running, as opposed to ended or never started. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const review = (...args: string[]) => ws.agents('step', 'review', '--run', runId, ...args)

/** The clone lists no worktree but its own, and the data area holds none. */
function assertNoWorktreeLeft(folder: string) {
  const worktrees = git(folder, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))
  assert.equal(worktrees.length, 1, worktrees.join('\n'))
  let left: string[] = []
  try {
    left = readdirSync(join(ws.dataDir, 'worktrees'))
  } catch {}
  assert.deepEqual(left, [])
}

test('the Review Step reviews a Repo with new commits and records what the Reviewer found', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  const to = repo.pushCommit('Add paywall')
  const finding = { severity: 'high', file: 'lib/paywall.dart', line: 42, commit: to, author: 'Test Author', summary: 'Price shows before it loads' }
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Adds a paywall.', findings: [finding], memory: null } }] })
  prepareRun([[repo, from]])

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.reviewResult(runId, 'crux_flutter'), {
    repo: 'crux_flutter',
    team: 'flutter',
    branch: 'main',
    from,
    to,
    status: 'reviewed',
    summary: 'Adds a paywall.',
    findings: [{ ...finding, bySaransh: false }],
    memory: null,
  })
})

test("each review gives the Reviewer that Repo's Memory as Saransh last left it, or none when the Repo has no Memory yet", async () => {
  ws = makeWorkspace()
  const repos = [ws.addRepo('crux_flutter'), ws.addRepo('inpix-panel', { team: 'frontend' })]
  const fetched = repos.map((repo): [TestRepo, string] => [repo, lastFetched(repo)])
  for (const repo of repos) repo.pushCommit('Change')
  const memory = '# crux_flutter\n\n- Prices come from the payments service; never hard-code one.\n- Waved off: missing `mounted` checks in lib/legacy/.\n'
  ws.writeMemory('reviewer', 'crux_flutter', memory)
  ws.writeCannedAnswers({
    reviewer: [
      { when: { repo: 'crux_flutter', memory }, answer: { summary: 'Read its Memory.', findings: [], memory: null } },
      { when: { repo: 'inpix-panel', memory: '' }, answer: { summary: 'Had no Memory.', findings: [], memory: null } },
      { error: 'The Reviewer was given the wrong Memory' },
    ],
  })
  prepareRun(fetched)

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Read its Memory.')
  assert.equal(ws.reviewResult(runId, 'inpix-panel').summary, 'Had no Memory.')
})

test("a review records the Memory the Reviewer proposes for its Repo, or no proposal when it proposes none", async () => {
  ws = makeWorkspace()
  const repos = [ws.addRepo('crux_flutter'), ws.addRepo('inpix-panel', { team: 'frontend' })]
  const fetched = repos.map((repo): [TestRepo, string] => [repo, lastFetched(repo)])
  for (const repo of repos) repo.pushCommit('Change')
  const proposed = '# crux_flutter\n\n- Feature flags live in lib/flags.dart.\n'
  ws.writeCannedAnswers({
    reviewer: [
      { when: { repo: 'crux_flutter' }, answer: { summary: 'Adds a flag.', findings: [], memory: proposed } },
      { answer: { summary: 'Fine.', findings: [], memory: null } },
    ],
  })
  prepareRun(fetched)

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').memory, proposed)
  assert.equal(ws.reviewResult(runId, 'inpix-panel').memory, null)
})

test('the Review Step makes no Reviewer call for unchanged Repos or first-Run baselines', async () => {
  ws = makeWorkspace()
  const unchanged = ws.addRepo('inpix-panel', { team: 'frontend' })
  const firstRun = ws.addRepo('crux_flutter')
  ws.writeCannedAnswers({ reviewer: [{ error: 'The Reviewer was called' }] })
  prepareRun([
    [unchanged, lastFetched(unchanged)],
    [firstRun, null],
  ])

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.runFiles(runId, 'review'), [])
})

test('a failed review is recorded, the other Repos are still reviewed, and the Step exits non-zero', async () => {
  ws = makeWorkspace()
  const repos = [ws.addRepo('crux_flutter'), ws.addRepo('inpix-panel', { team: 'frontend' })]
  const fetched = repos.map((repo): [TestRepo, string] => [repo, lastFetched(repo)])
  for (const repo of repos) repo.pushCommit('Change')
  ws.writeCannedAnswers({ reviewer: [{ when: { repo: 'crux_flutter' }, error: 'Quota limit reached' }, { answer: { summary: 'Fine.', findings: [], memory: null } }] })
  prepareRun(fetched)

  const result = await review()

  assert.notEqual(result.status, 0)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').status, 'failed')
  assert.match(ws.reviewResult(runId, 'crux_flutter').error, /Quota limit reached/)
  assert.equal(ws.reviewResult(runId, 'inpix-panel').status, 'reviewed')
})

test('each review runs in a clean worktree of the production branch at the new head, removed afterwards', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Add answer', { files: { 'answer.json': JSON.stringify({ summary: 'Read at the new head.', findings: [], memory: null }) } })
  git(repo.folder, 'checkout', '-q', '-b', 'feature/wip')
  writeFileSync(join(repo.folder, 'answer.json'), JSON.stringify({ summary: 'Read from the working copy.', findings: [], memory: null }))
  ws.writeCannedAnswers({ reviewer: [{ answerFrom: 'answer.json' }] })
  prepareRun([[repo, from]])

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Read at the new head.')
  assertNoWorktreeLeft(repo.folder)
  assert.equal(git(repo.folder, 'branch', '--show-current'), 'feature/wip')
  assert.equal(git(repo.folder, 'status', '--porcelain'), '?? answer.json')
})

test('the worktree is removed even when the review fails', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Change')
  ws.writeCannedAnswers({ reviewer: [{ error: 'Worker crashed' }] })
  prepareRun([[repo, from]])

  const result = await review()

  assert.notEqual(result.status, 0)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').status, 'failed')
  assertNoWorktreeLeft(repo.folder)
})

test("a Reviewer answer that doesn't match the findings schema fails that review, naming what is wrong", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  const to = repo.pushCommit('Change')
  const finding = { severity: 'urgent', file: 'lib/main.dart', line: 3, commit: to, author: 'Test Author', summary: 'Crashes on start' }
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Changes startup.', findings: [finding], memory: null } }] })
  prepareRun([[repo, from]])

  const result = await review()

  assert.notEqual(result.status, 0)
  const crux = ws.reviewResult(runId, 'crux_flutter')
  assert.equal(crux.status, 'failed')
  assert.match(crux.error, /findings\[0\]\.severity must be one of critical, high, medium, low/)
})

test("findings on Saransh's commits are marked, using his git author emails from the env file and each commit's author from git", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  const theirs = repo.pushCommit('Add paywall')
  const his = repo.pushCommit('Fix paywall copy', { author: 'Saransh <Saransh@Inshorts.example>' })
  ws.writeEnvFile('SARANSH_GIT_EMAILS=old@example.com, saransh@inshorts.example\n')
  const finding = (commit: string, summary: string) => ({ severity: 'medium', file: 'lib/paywall.dart', line: null, commit, author: 'Someone', summary })
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Adds a paywall.', findings: [finding(theirs, 'Theirs'), finding(his.slice(0, 7), 'His')], memory: null } }] })
  prepareRun([[repo, from]])

  await review()

  const { findings } = ws.reviewResult(runId, 'crux_flutter')
  assert.deepEqual(
    findings.map((f: { summary: string; author: string; bySaransh: boolean }) => [f.summary, f.author, f.bySaransh]),
    [
      ['Theirs', 'Test Author', false],
      ['His', 'Saransh', true],
    ],
  )
})

test('re-running the Review Step keeps finished reviews, retries failed ones, and redoes all with --force', async () => {
  ws = makeWorkspace()
  const repos = [ws.addRepo('crux_flutter'), ws.addRepo('inpix-panel', { team: 'frontend' })]
  const fetched = repos.map((repo): [TestRepo, string] => [repo, lastFetched(repo)])
  for (const repo of repos) repo.pushCommit('Change')
  ws.writeCannedAnswers({ reviewer: [{ when: { repo: 'inpix-panel' }, error: 'Quota limit reached' }, { answer: { summary: 'First.', findings: [], memory: null } }] })
  prepareRun(fetched)
  await review()
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Second.', findings: [], memory: null } }] })

  const rerun = await review()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'First.')
  assert.equal(ws.reviewResult(runId, 'inpix-panel').summary, 'Second.')

  await review('--force')

  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Second.')
})

/** What `codex exec --json` prints when its final answer is `answer`, after riding out a dropped connection. */
const codexAnswering = (answer: unknown) => ({
  stdout: [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Reading the commits.' } },
    // An error Codex recovers from by itself.
    { type: 'error', message: 'Reconnecting... 1/5' },
    { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(answer) } },
    { type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 80 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n'),
})

/** What `claude --print --output-format json` prints when its schema-checked answer is `answer`. */
const claudeCodeAnswering = (answer: unknown) => ({
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, result: JSON.stringify(answer), structured_output: answer }),
})

test('a Run that is not a dry run reviews each changed Repo on Codex, in its worktree, with the commits in the prompt', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  const to = repo.pushCommit('Add paywall')
  const finding = { severity: 'high', file: 'lib/paywall.dart', line: 42, commit: to, author: 'Test Author', summary: 'Price shows before it loads' }
  ws.setWorkerCli('codex', codexAnswering({ summary: 'Adds a paywall.', findings: [finding], memory: null }))
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Fake.', findings: [], memory: null } }] })
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  const crux = ws.reviewResult(runId, 'crux_flutter')
  assert.equal(crux.summary, 'Adds a paywall.')
  assert.deepEqual(crux.findings, [{ ...finding, bySaransh: false }])
  const [call, ...more] = ws.workerCliCalls('codex')
  assert.deepEqual(more, [])
  assert.ok(call.cwd.startsWith(realpathSync(join(ws.dataDir, 'worktrees'))), call.cwd)
  assert.ok(call.stdin.includes(to), call.stdin)
  assert.deepEqual(ws.workerCliCalls('claude'), [])
})

test('a review that fails on Codex, such as on a quota limit, is retried once on Claude Code, and both attempts are logged in the Run', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Add paywall')
  const quotaLimit = { type: 'turn.failed', error: { message: "You've hit your usage limit. Try again at 4:12 PM." } }
  ws.setWorkerCli('codex', { stdout: `${JSON.stringify({ type: 'turn.started' })}\n${JSON.stringify(quotaLimit)}\n`, exitCode: 1 })
  ws.setWorkerCli('claude', claudeCodeAnswering({ summary: 'Adds a paywall.', findings: [], memory: null }))
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Adds a paywall.')
  assert.equal(ws.workerCliCalls('codex').length, 1)
  assert.equal(ws.workerCliCalls('claude').length, 1)
  assert.match(
    ws.readRunFile(runId, 'logs', 'review.log'),
    /crux_flutter: reviewer failed on codex \(gpt-6-astra, high\) after \d+s: You've hit your usage limit\. Try again at 4:12 PM\.; retrying once on claude-code \(opus, high\)\ncrux_flutter: reviewer answered on claude-code \(opus, high\) in \d+s/,
  )
})

test("a Codex call that runs past the Agent's timeout is ended, with the command it started, and retried on Claude Code", { timeout: 20_000 }, async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Add paywall')
  ws.writeAgent('reviewer', { 'config.ts': `export default ${JSON.stringify({ ...reviewer, timeoutSeconds: 1 })}\n`, 'instructions.md': '# Reviewer\n' })
  ws.setWorkerCli('codex', { hang: true })
  ws.setWorkerCli('claude', claudeCodeAnswering({ summary: 'Adds a paywall.', findings: [], memory: null }))
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Adds a paywall.')
  assert.match(ws.readRunFile(runId, 'logs', 'review.log'), /reviewer failed on codex \(gpt-6-astra, high\) after 1s: timed out after 1s; retrying once on claude-code/)
  const [{ pid, childPid }] = ws.workerCliCalls('codex')
  for (const id of [pid, childPid!]) assert.ok(!isRunning(id), `process ${id} is still running`)
})

test('a review fails, naming both failures, when Codex answers in the wrong shape and Claude Code fails too', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  const to = repo.pushCommit('Add paywall')
  const finding = { severity: 'urgent', file: 'lib/paywall.dart', line: 42, commit: to, author: 'Test Author', summary: 'Price shows before it loads' }
  ws.setWorkerCli('codex', codexAnswering({ summary: 'Adds a paywall.', findings: [finding], memory: null }))
  const sessionLimit = { type: 'result', subtype: 'success', is_error: true, result: "You've hit your session limit · resets 3:45pm" }
  ws.setWorkerCli('claude', { stdout: JSON.stringify(sessionLimit), exitCode: 1 })
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.notEqual(result.status, 0)
  const crux = ws.reviewResult(runId, 'crux_flutter')
  assert.equal(crux.status, 'failed')
  assert.match(
    crux.error,
    /^codex failed: The reviewer Agent's answer doesn't match its output schema: answer\.findings\[0\]\.severity must be one of critical, high, medium, low \(got "urgent"\); then claude-code failed: You've hit your session limit · resets 3:45pm$/,
  )
})

test("an Agent's Tools and skills reach each Worker without a file being added or changed in the Repo it reviews", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Add paywall', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const usage = 'blame <file> <line>: prints the commit that last changed that line'
  const skill = '---\nname: checklist\ndescription: What to check in a Flutter change.\n---\n\nCheck every `await` for a missing `mounted` check. The full list is in list.md.\n'
  ws.writeAgent('reviewer', {
    'config.ts': `export default ${JSON.stringify({ ...reviewer, tools: { blame: usage } })}\n`,
    'instructions.md': '# Reviewer\n',
    'tools/blame': '#!/bin/sh\ngit log -1 --format=%H -L "$2,$2:$1"\n',
    'skills/checklist/SKILL.md': skill,
    'skills/checklist/list.md': '- mounted checks\n',
  })
  // Codex answers in the wrong shape, so the review falls back to Claude Code and reaches both Workers.
  ws.setWorkerCli('codex', codexAnswering({ summary: 'Adds a paywall.' }))
  ws.setWorkerCli('claude', claudeCodeAnswering({ summary: 'Adds a paywall.', findings: [], memory: null }))
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  const [codex] = ws.workerCliCalls('codex')
  const [claude] = ws.workerCliCalls('claude')
  for (const call of [codex, claude]) {
    assert.equal(call.cwdChanges, '')
    assert.match(call.stdin, new RegExp(`- \`/[^\`]+/reviewer/tools/blame\`: ${usage}\n`))
  }
  assert.ok(codex.stdin.includes(skill.trim()), codex.stdin)
  assert.deepEqual(claude.pluginFiles, {
    '.claude-plugin/plugin.json': '{"name":"reviewer"}',
    'skills/checklist/SKILL.md': skill,
    'skills/checklist/list.md': '- mounted checks\n',
  })
  assert.ok(!existsSync(claude.pluginDir!), 'the session plugin was left behind')
})

test("Codex can't read or run a Tool the Agent doesn't declare, and gets no skill it would find by itself: its own, Saransh's, the Repo's or any above it", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  const found = '---\nname: found\ndescription: Found by Codex.\n---\n\nDo it this way.\n'
  repo.pushCommit('Add a house style', { files: { '.agents/skills/house-style/SKILL.md': found } })
  ws.writeAgent('reviewer', {
    'config.ts': `export default ${JSON.stringify({ ...reviewer, tools: { blame: 'blame <file> <line>' } })}\n`,
    'instructions.md': '# Reviewer\n',
    'tools/blame': '#!/bin/sh\n',
    'tools/secret': '#!/bin/sh\n',
  })
  ws.writeAgent('docs', { 'tools/commit': '#!/bin/sh\n' })
  const ownSkill = join(ws.codexHomeDir, 'skills', '.system', 'imagegen')
  const saranshSkill = join(ws.homeDir, '.agents', 'skills', 'review')
  const skillAbove = join(ws.dataDir, '.agents', 'skills', 'team-style')
  for (const folder of [ownSkill, saranshSkill, skillAbove]) {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), found)
  }
  ws.setWorkerCli('codex', codexAnswering({ summary: 'Adds a house style.', findings: [], memory: null }))
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  const [{ args }] = ws.workerCliCalls('codex')
  const settings = args.flatMap((arg, i) => (args[i - 1] === '--config' ? [arg] : []))
  const profile = settings.find((setting) => setting.startsWith('permissions.agent='))!
  const denied = [...profile.matchAll(/"([^"]+)"="deny"/g)].map(([, path]) => path.replace(/^.*\/agents\//, ''))
  assert.deepEqual(denied, ['docs/tools/commit', 'reviewer/tools/secret'])
  const skills = settings.find((setting) => setting.startsWith('skills.config='))!
  const turnedOff = [...skills.matchAll(/path="([^"]+)"/g)].map(([, path]) => path)
  const worktree = args[args.indexOf('--cd') + 1]
  assert.deepEqual(turnedOff, [
    join(ownSkill, 'SKILL.md'),
    join(saranshSkill, 'SKILL.md'),
    join(worktree, '.agents', 'skills', 'house-style', 'SKILL.md'),
    join(skillAbove, 'SKILL.md'),
  ])
})

/** A Reviewer that falls back to Antigravity. */
const onAntigravity = { ...reviewer, fallbackWorker: { name: 'antigravity', model: 'gemini-3.8-flash', effort: 'high' } }

/**
 * What `agy --print --output-format json` prints when its schema-checked answer is `answer`. Run as
 * a custom agent, it adds its finish tool's fields to the answer.
 */
const antigravityAnswering = (answer: object) => ({
  stdout: JSON.stringify({
    conversation_id: 'conversation-1',
    status: 'SUCCESS',
    response: `{"toolAction":"Finishing task","toolSummary":"Finish task"}\n${JSON.stringify(answer)}\n`,
    duration_seconds: 12.7,
    num_turns: 4,
    structured_output: { ...answer, toolAction: 'Finishing task', toolSummary: 'Finish task' },
    usage: { input_tokens: 24393, output_tokens: 440, thinking_tokens: 261, cache_read_tokens: 0, total_tokens: 24833 },
  }),
})

const codexQuotaLimit = { stdout: JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }), exitCode: 1 }

/** The prompt an Antigravity call was given. */
const antigravityPrompt = ({ args }: { args: string[] }) => args.find((arg) => arg.startsWith('--print='))!.slice('--print='.length)

test("a review can fall back to Antigravity, which runs on the Pipeline's own Antigravity home with only the Agent's permissions, and changes nothing in the Repo", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Add paywall', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const usage = 'blame <file> <line>: prints the commit that last changed that line'
  const skill = '---\nname: checklist\ndescription: What to check in a Flutter change.\n---\n\nCheck every `await` for a missing `mounted` check.\n'
  ws.writeAgent('reviewer', {
    'config.ts': `export default ${JSON.stringify({ ...onAntigravity, tools: { blame: usage } })}\n`,
    'instructions.md': '# Reviewer\n',
    'tools/blame': '#!/bin/sh\n',
    'tools/secret': '#!/bin/sh\n',
    'skills/checklist/SKILL.md': skill,
  })
  // Settings Antigravity saved in its home, such as at login, are kept; permissions left there are not.
  const home = join(ws.dataDir, 'antigravity-home')
  const settingsFile = join(home, '.gemini', 'antigravity-cli', 'settings.json')
  mkdirSync(join(settingsFile, '..'), { recursive: true })
  writeFileSync(settingsFile, JSON.stringify({ themeMode: 'dark', permissions: { allow: ['command(*)'] } }))
  ws.setWorkerCli('codex', codexQuotaLimit)
  ws.setWorkerCli('agy', antigravityAnswering({ summary: 'Adds a paywall.', findings: [], memory: null }))
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Adds a paywall.')
  assert.match(ws.readRunFile(runId, 'logs', 'review.log'), /retrying once on antigravity \(gemini-3\.8-flash, high\)\ncrux_flutter: reviewer answered on antigravity/)
  const [call, ...more] = ws.workerCliCalls('agy')
  assert.deepEqual(more, [])
  assert.equal(call.home, home)
  assert.equal(call.cwdChanges, '')
  const { themeMode, toolPermission, permissions } = call.antigravitySettings
  assert.equal(themeMode, 'dark')
  // Commands run only inside the sandbox, so no rule allows one.
  assert.equal(toolPermission, 'proceed-in-sandbox')
  assert.ok(![...permissions.allow, ...permissions.deny].some((rule: string) => rule.startsWith('command(')), permissions.allow.join('\n'))
  const readable = permissions.allow.map((rule: string) => rule.replace(/^read_file\((.*)\)$/, '$1').replace(/^.*\/(clones|agents)\//, ''))
  assert.deepEqual(readable, ['crux_flutter/.git', 'reviewer/tools/blame', 'reviewer/skills/checklist'])
  assert.ok(permissions.deny.some((rule: string) => /^read_file\(\/.*\/reviewer\/tools\/secret\)$/.test(rule)), permissions.deny.join('\n'))
  assert.ok(permissions.deny.includes('write_file(*)'), permissions.deny.join('\n'))
  // It runs as an agent with only the tools to read, run commands and finish, which takes on no skills, rules or plugins.
  const agentName = call.args[call.args.indexOf('--agent') + 1]
  assert.equal(agentName, 'pipeline-reviewer')
  assert.match(call.antigravityCustomAgent!, /^---\nname: pipeline-reviewer\n.*\ntools: \[read_file, run_command, finish\]\ninheritCustomizations: false\n---\n/s)
  const prompt = antigravityPrompt(call)
  assert.match(prompt, new RegExp(`- \`/[^\`]+/reviewer/tools/blame\`: ${usage}\n`))
  assert.ok(prompt.includes(skill.trim()), prompt)
})

test("Antigravity calls running at once keep each other's rules, so each can still read its own Repo's git data", async () => {
  ws = makeWorkspace()
  const repos = [ws.addRepo('crux_flutter'), ws.addRepo('inpix-panel', { team: 'frontend' })]
  const fetched = repos.map((repo): [TestRepo, string] => [repo, lastFetched(repo)])
  for (const repo of repos) repo.pushCommit('Change')
  ws.writeAgent('reviewer', { 'config.ts': `export default ${JSON.stringify(onAntigravity)}\n`, 'instructions.md': '# Reviewer\n' })
  ws.setWorkerCli('codex', codexQuotaLimit)
  // Each call is still running when the other starts.
  ws.setWorkerCli('agy', { ...antigravityAnswering({ summary: 'Fine.', findings: [], memory: null }), answerAfterMs: 1500 })
  prepareRun(fetched, { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  const calls = ws.workerCliCalls('agy')
  assert.equal(calls.length, 2)
  for (const { antigravitySettings } of calls) {
    const readable = antigravitySettings.permissions.allow.map((rule: string) => rule.replace(/^.*\/clones\//, ''))
    assert.deepEqual(readable.sort(), ['crux_flutter/.git)', 'inpix-panel/.git)'])
  }
})

test('an Antigravity call that answers while a command it started is still running ends that command, without waiting for it', { timeout: 20_000 }, async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Add paywall')
  ws.writeAgent('reviewer', { 'config.ts': `export default ${JSON.stringify({ ...onAntigravity, timeoutSeconds: 5 })}\n`, 'instructions.md': '# Reviewer\n' })
  ws.setWorkerCli('codex', codexQuotaLimit)
  ws.setWorkerCli('agy', { ...antigravityAnswering({ summary: 'Adds a paywall.', findings: [], memory: null }), leaveRunning: true })
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Adds a paywall.')
  const [{ childPid }] = ws.workerCliCalls('agy')
  assert.ok(!isRunning(childPid!), `process ${childPid} is still running`)
})

test("an Antigravity call fails, saying why, when it was refused something it tried, isn't logged in or runs past the Agent's timeout", { timeout: 30_000 }, async () => {
  const cases: [object, RegExp, object?][] = [
    [
      // Antigravity ends a call at the first thing it refuses, and still reports success.
      { stdout: JSON.stringify({ conversation_id: 'c', status: 'SUCCESS', response: '', num_turns: 1, denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }) },
      /then antigravity failed: it stopped when it was refused command$/,
    ],
    [
      { stdout: JSON.stringify({ conversation_id: '', status: 'ERROR', response: '', error: 'authentication failed or timed out', num_turns: 0 }), exitCode: 1 },
      /then antigravity failed: authentication failed or timed out; log in once with HOME=\/.*\/antigravity-home agy$/,
    ],
    [{ hang: true }, /then antigravity failed: timed out after 1s$/, { timeoutSeconds: 1 }],
  ]
  for (const [behavior, message, config] of cases) {
    ws?.cleanup()
    ws = makeWorkspace()
    const repo = ws.addRepo('crux_flutter')
    const from = lastFetched(repo)
    repo.pushCommit('Add paywall')
    ws.writeAgent('reviewer', { 'config.ts': `export default ${JSON.stringify({ ...onAntigravity, ...config })}\n`, 'instructions.md': '# Reviewer\n' })
    ws.setWorkerCli('codex', codexQuotaLimit)
    ws.setWorkerCli('agy', behavior)
    prepareRun([[repo, from]], { dryRun: false })

    const result = await review()

    assert.notEqual(result.status, 0)
    assert.match(ws.reviewResult(runId, 'crux_flutter').error, message)
  }
})

test("a review fails when the Step doesn't pass every input the Reviewer's config declares", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Change')
  const config = { ...reviewer, inputs: { ...reviewer.inputs, styleGuide: "The Repo's style guide" } }
  ws.writeAgent('reviewer', { 'config.ts': `export default ${JSON.stringify(config)}\n`, 'instructions.md': '# Reviewer\n' })
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Fine.', findings: [], memory: null } }] })
  prepareRun([[repo, from]])

  const result = await review()

  assert.notEqual(result.status, 0)
  assert.match(ws.reviewResult(runId, 'crux_flutter').error, /The reviewer Agent was called without its styleGuide input/)
})
