import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { git, hangingRemote, makeWorkspace, serve, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'

test('Fetch updates the production branch without touching the working tree or current branch', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  ws.prepareRun(runId)
  git(repo.folder, 'checkout', '-q', '-b', 'feature/wip')
  writeFileSync(join(repo.folder, 'notes.txt'), 'uncommitted work\n')
  const localHead = git(repo.folder, 'rev-parse', 'HEAD')
  const pushed = repo.pushCommit('Ship it')

  const result = await ws.agents('step', 'fetch', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(repo.folder, 'rev-parse', 'origin/main'), pushed)
  assert.equal(git(repo.folder, 'branch', '--show-current'), 'feature/wip')
  assert.equal(git(repo.folder, 'rev-parse', 'HEAD'), localHead)
  assert.equal(git(repo.folder, 'rev-parse', 'main'), localHead)
  assert.equal(git(repo.folder, 'status', '--porcelain'), '?? notes.txt')
  assert.equal(readFileSync(join(repo.folder, 'notes.txt'), 'utf8'), 'uncommitted work\n')
})

test("on a Repo's first Run, Fetch records its head as the baseline instead of listing history", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  repo.pushCommit('Old work')
  const head = repo.pushCommit('More old work')
  ws.writeRepoList()
  ws.prepareRun(runId)

  await ws.agents('step', 'fetch', '--run', runId)

  assert.deepEqual(ws.fetchResult(runId, 'crux_flutter'), {
    repo: 'crux_flutter',
    team: 'flutter',
    branch: 'main',
    previous: null,
    status: 'baseline',
    head,
    commits: [],
  })
  assert.deepEqual(ws.readRepoState(), { crux_flutter: { lastReviewed: head } })
})

test('Fetch lists the commits since the last recorded commit, newest first, and marks unchanged Repos', async () => {
  ws = makeWorkspace()
  const changed = ws.addRepo('crux_flutter')
  const unchanged = ws.addRepo('inpix-panel', { team: 'frontend' })
  ws.writeRepoList()
  const baseline = git(changed.folder, 'rev-parse', 'origin/main')
  ws.writeRepoState({
    crux_flutter: { lastReviewed: baseline },
    'inpix-panel': { lastReviewed: git(unchanged.folder, 'rev-parse', 'origin/main') },
  })
  const first = changed.pushCommit('Add paywall')
  const second = changed.pushCommit('Fix paywall copy')
  ws.prepareRun(runId)

  await ws.agents('step', 'fetch', '--run', runId)

  const crux = ws.fetchResult(runId, 'crux_flutter')
  assert.equal(crux.status, 'new-commits')
  assert.equal(crux.previous, baseline)
  assert.equal(crux.head, second)
  assert.deepEqual(
    crux.commits.map((c: { sha: string; subject: string; author: string; email: string }) => [c.sha, c.subject, c.author, c.email]),
    [
      [second, 'Fix paywall copy', 'Test Author', 'author@example.com'],
      [first, 'Add paywall', 'Test Author', 'author@example.com'],
    ],
  )
  assert.equal(ws.fetchResult(runId, 'inpix-panel').status, 'unchanged')
})

test('Fetch fetches from the remote in the Repo list', async () => {
  ws = makeWorkspace()
  const listed = ws.addRepo('crux_flutter')
  const other = ws.addRepo('other')
  git(listed.folder, 'remote', 'set-url', 'origin', other.entry.remote)
  ws.writeRepoList([listed.entry])
  ws.prepareRun(runId)
  const pushed = listed.pushCommit('From the listed remote')

  await ws.agents('step', 'fetch', '--run', runId)

  assert.equal(ws.fetchResult(runId, 'crux_flutter').head, pushed)
})

test('a Repo that fails to fetch is recorded, the others continue, and Fetch exits non-zero', async () => {
  ws = makeWorkspace()
  ws.addBrokenRepo('gone')
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  ws.prepareRun(runId)

  const result = await ws.agents('step', 'fetch', '--run', runId)

  assert.notEqual(result.status, 0)
  const gone = ws.fetchResult(runId, 'gone')
  assert.equal(gone.status, 'failed')
  assert.match(gone.error, /does not appear to be a git repository/)
  assert.equal(ws.fetchResult(runId, 'crux_flutter').head, git(repo.folder, 'rev-parse', 'origin/main'))
})

test('a hung fetch times out and the other Repos still fetch', async () => {
  const remote = await hangingRemote()
  try {
    ws = makeWorkspace({ AGENTS_FETCH_TIMEOUT_SECONDS: '1' })
    const hung = ws.addRepo('hung')
    const repo = ws.addRepo('crux_flutter')
    ws.writeRepoList([{ ...hung.entry, remote: remote.url }, repo.entry])
    ws.prepareRun(runId)
    const started = Date.now()

    const result = await ws.agents('step', 'fetch', '--run', runId)

    assert.ok(Date.now() - started < 8000, 'Fetch did not wait for the hung fetch')
    assert.notEqual(result.status, 0)
    assert.match(ws.fetchResult(runId, 'hung').error, /timed out/)
    assert.equal(ws.fetchResult(runId, 'crux_flutter').head, git(repo.folder, 'rev-parse', 'origin/main'))
  } finally {
    remote.close()
  }
})

test('Fetch never prompts for credentials', async () => {
  const remote = await serve((_req, res) => res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' }).end())
  const askpassCalled = join(tmpdir(), `agents-askpass-${process.pid}-${Date.now()}`)
  const askpass = `${askpassCalled}.sh`
  writeFileSync(askpass, `#!/bin/sh\ntouch '${askpassCalled}'\necho secret\n`, { mode: 0o755 })
  try {
    ws = makeWorkspace({ GIT_ASKPASS: askpass, SSH_ASKPASS: askpass })
    const repo = ws.addRepo('private')
    ws.writeRepoList([{ ...repo.entry, remote: remote.url }])
    ws.prepareRun(runId)

    await ws.agents('step', 'fetch', '--run', runId)

    assert.equal(ws.fetchResult(runId, 'private').status, 'failed')
    assert.equal(existsSync(askpassCalled), false, 'askpass was never called')
  } finally {
    remote.close()
    rmSync(askpass, { force: true })
    rmSync(askpassCalled, { force: true })
  }
})
