import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { BranchesRead } from '../steps/branches.ts'
import { git, makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-26-0300'
const postedAt = '2026-10-21T12:05:26.362000+00:00'

function prepareRun() {
  ws.prepareRun(runId)
  ws.writeRunFile(runId, 'sprint.json', { channel: 'sprint-assignments', author: 'Subhash Yadav', postedAt, link: 'https://discord.com/channels/1/2/3', title: null, messages: [], tasks: [], updates: [] })
}

const branches = () => ws.agents('step', 'branches', '--run', runId)
const read = (): BranchesRead => JSON.parse(ws.readRunFile(runId, 'branches.json'))

test("the work on each Repo's other branches since the sprint post is recorded, without what is on production, older work or bots' commits", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('inpix_flutter', { branch: 'development' })
  const quiet = ws.addRepo('crux_flutter')
  repo.pushCommit('Start the counter', { branch: 'feature/jaapCounterChanges', date: '2026-10-20T10:00:00+05:30' })
  const counter = repo.pushCommit('Count every bead', { branch: 'feature/jaapCounterChanges', author: 'Shreyansh <shreyansh@example.com>', date: '2026-10-22T10:00:00+05:30' })
  const fixes = repo.pushCommit('Bug fixes', { branch: 'feature/jaapCounterChanges', author: 'Shreyansh <shreyansh@example.com>', date: '2026-10-23T10:00:00+05:30' })
  repo.pushCommit('Old experiment', { branch: 'spike/old', date: '2026-10-01T10:00:00+05:30' })
  repo.pushCommit('Bump deps', { branch: 'dependabot/pub/deps', author: 'dependabot[bot] <bot@example.com>', date: '2026-10-22T10:00:00+05:30' })
  repo.pushCommit('Release 2.3.0', { date: '2026-10-24T10:00:00+05:30' })
  quiet.pushCommit('Old work', { branch: 'feature/old', date: '2026-10-02T10:00:00+05:30' })
  ws.writeRepoList()
  prepareRun()
  const before = git(repo.folder, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes')

  const result = await branches()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(read(), {
    since: '2026-10-21T12:05:26.362Z',
    repos: [
      {
        repo: 'inpix_flutter',
        team: 'flutter',
        production: 'development',
        branches: [
          {
            branch: 'feature/jaapCounterChanges',
            count: 2,
            commits: [
              { sha: fixes, author: 'Shreyansh', date: '2026-10-23T10:00:00+05:30', subject: 'Bug fixes' },
              { sha: counter, author: 'Shreyansh', date: '2026-10-22T10:00:00+05:30', subject: 'Count every bead' },
            ],
          },
        ],
      },
    ],
    failed: [],
  })
  assert.equal(git(repo.folder, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'), before, "Saransh's branches and remote-tracking refs are untouched")
})

test('a Repo whose branches fail to fetch is recorded, the others are still read, and the Step fails', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('inpix_flutter')
  repo.pushCommit('Count every bead', { branch: 'feature/jaap', date: '2026-10-22T10:00:00+05:30' })
  ws.addBrokenRepo('gone')
  ws.writeRepoList()
  prepareRun()

  const result = await branches()

  assert.notEqual(result.status, 0)
  const { repos, failed } = read()
  assert.deepEqual(repos.map((r) => r.repo), ['inpix_flutter'])
  assert.deepEqual(failed.map((f) => f.repo), ['gone'])
})

test('without a sprint post in the Run, the Step is skipped', async () => {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId)

  const result = await branches()

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout + result.stderr, /skipped/i)
  assert.throws(() => ws.readRunFile(runId, 'branches.json'))
})
