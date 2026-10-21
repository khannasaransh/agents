import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
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
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Adds a paywall.', findings: [finding] } }] })
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
  })
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
  ws.writeCannedAnswers({ reviewer: [{ when: { repo: 'crux_flutter' }, error: 'Quota limit reached' }, { answer: { summary: 'Fine.', findings: [] } }] })
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
  repo.pushCommit('Add answer', { files: { 'answer.json': JSON.stringify({ summary: 'Read at the new head.', findings: [] }) } })
  git(repo.folder, 'checkout', '-q', '-b', 'feature/wip')
  writeFileSync(join(repo.folder, 'answer.json'), JSON.stringify({ summary: 'Read from the working copy.', findings: [] }))
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
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Changes startup.', findings: [finding] } }] })
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
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Adds a paywall.', findings: [finding(theirs, 'Theirs'), finding(his.slice(0, 7), 'His')] } }] })
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
  ws.writeCannedAnswers({ reviewer: [{ when: { repo: 'inpix-panel' }, error: 'Quota limit reached' }, { answer: { summary: 'First.', findings: [] } }] })
  prepareRun(fetched)
  await review()
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Second.', findings: [] } }] })

  const rerun = await review()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'First.')
  assert.equal(ws.reviewResult(runId, 'inpix-panel').summary, 'Second.')

  await review('--force')

  assert.equal(ws.reviewResult(runId, 'crux_flutter').summary, 'Second.')
})

test('a Run that is not a dry run never takes answers from the fake Worker', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Change')
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Fake.', findings: [] } }] })
  prepareRun([[repo, from]], { dryRun: false })

  const result = await review()

  assert.notEqual(result.status, 0)
  const crux = ws.reviewResult(runId, 'crux_flutter')
  assert.equal(crux.status, 'failed')
  assert.match(crux.error, /codex Worker/)
})

test("a review fails when the Step doesn't pass every input the Reviewer's config declares", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Change')
  const config = { ...reviewer, inputs: { ...reviewer.inputs, memory: "The Repo's Memory" } }
  ws.writeAgent('reviewer', { 'config.ts': `export default ${JSON.stringify(config)}\n`, 'instructions.md': '# Reviewer\n' })
  ws.writeCannedAnswers({ reviewer: [{ answer: { summary: 'Fine.', findings: [] } }] })
  prepareRun([[repo, from]])

  const result = await review()

  assert.notEqual(result.status, 0)
  assert.match(ws.reviewResult(runId, 'crux_flutter').error, /The reviewer Agent was called without its memory input/)
})
