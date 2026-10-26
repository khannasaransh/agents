import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { readJson, writeJson } from '../src/files.ts'
import type { FetchResult } from '../steps/fetch.ts'
import type { ReviewResult } from '../steps/review.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-25-0530'
const sha = (n: number) => String(n).repeat(40)
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

test("the weekly Pipeline's first Fetch starts a week back and leaves the daily cursor", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const young = ws.addRepo('skill-up')
  const old = repo.pushCommit('Last month', { date: daysAgo(20) })
  const recent = repo.pushCommit('This week', { date: daysAgo(2) })
  const youngHead = young.pushCommit('Born this week', { date: daysAgo(2) })
  ws.writeRepoList()
  ws.writeRepoState({ crux_flutter: { lastReviewed: recent }, 'skill-up': { lastReviewed: youngHead } })
  ws.prepareRun(runId, { pipeline: 'weekly' })

  const result = await ws.agents('step', 'fetch', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  const crux = ws.fetchResult(runId, 'crux_flutter')
  assert.equal(crux.status, 'new-commits')
  assert.equal(crux.previous, old)
  assert.equal(crux.head, recent)
  assert.deepEqual(
    crux.commits.map((commit: { sha: string; subject: string }) => [commit.sha, commit.subject]),
    [[recent, 'This week']],
  )
  assert.deepEqual(ws.fetchResult(runId, 'skill-up'), {
    repo: 'skill-up',
    team: 'flutter',
    branch: 'main',
    previous: null,
    status: 'baseline',
    head: youngHead,
    commits: [],
  })
  assert.deepEqual(ws.readRepoState(), { crux_flutter: { lastReviewed: recent }, 'skill-up': { lastReviewed: youngHead } })
  assert.equal(existsSync(join(ws.dataDir, 'state', 'weekly-repos.json')), false)
})

test('a later weekly Fetch starts from the weekly cursor, not the daily one', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const old = repo.pushCommit('Last month', { date: daysAgo(20) })
  const recent = repo.pushCommit('This week', { date: daysAgo(2) })
  ws.writeRepoList()
  ws.writeRepoState({ crux_flutter: { lastReviewed: old } })
  writeJson(join(ws.dataDir, 'state', 'weekly-repos.json'), { crux_flutter: { lastReviewed: recent } })
  ws.prepareRun(runId, { pipeline: 'weekly' })

  const result = await ws.agents('step', 'fetch', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.fetchResult(runId, 'crux_flutter'), {
    repo: 'crux_flutter',
    team: 'flutter',
    branch: 'main',
    previous: recent,
    status: 'unchanged',
    head: recent,
    commits: [],
  })
  assert.deepEqual(ws.readRepoState(), { crux_flutter: { lastReviewed: old } })
})

const changed = (repo: string, previous: string, head: string): FetchResult => ({
  repo,
  team: 'flutter',
  branch: 'main',
  previous,
  status: 'new-commits',
  head,
  commits: [{ sha: head, author: 'Asha', email: 'asha@example.com', date: '2026-10-24T10:00:00+08:00', subject: 'Change' }],
})

const reviewed = (repo: string, from: string, to: string): ReviewResult => ({
  repo,
  team: 'flutter',
  branch: 'main',
  from,
  to,
  status: 'reviewed',
  summary: 'Fine.',
  findings: [],
  memory: null,
})

test("weekly Save state records the week's cursor and PM backlog, and leaves the daily Pipeline's", async () => {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId, { pipeline: 'weekly' })
  ws.writeRepoState({ crux_flutter: { lastReviewed: sha(9) } })
  ws.writePmBacklog(['2026-10-20-0530'])
  writeJson(join(ws.dataDir, 'state', 'docs.json'), { crux_flutter: { lastDocumented: sha(1) } })
  ws.writeRunFile(runId, 'fetch/crux_flutter.json', changed('crux_flutter', sha(1), sha(2)))
  ws.writeRunFile(runId, 'fetch/inpix-panel.json', changed('inpix-panel', sha(3), sha(4)))
  ws.writeRunFile(runId, 'review/crux_flutter.json', reviewed('crux_flutter', sha(1), sha(2)))
  ws.writeRunFile(runId, 'review/inpix-panel.json', { ...reviewed('inpix-panel', sha(3), sha(4)), status: 'failed', error: 'Quota limit reached' })
  ws.writeRunFile(runId, 'pm.json', { status: 'failed', error: 'claude-code failed: Session limit reached' })
  ws.writeRunFile(runId, 'docs.json', { status: 'updated', ranges: [{ repo: 'crux_flutter', branch: 'main', from: sha(1), to: sha(2) }] })

  const result = await ws.agents('step', 'save-state', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readJson(join(ws.dataDir, 'state', 'weekly-repos.json')), { crux_flutter: { lastReviewed: sha(2) } })
  assert.deepEqual(ws.readRepoState(), { crux_flutter: { lastReviewed: sha(9) } })
  assert.deepEqual(readJson(join(ws.dataDir, 'state', 'weekly-pm-backlog.json')), [runId])
  assert.deepEqual(ws.readPmBacklog(), ['2026-10-20-0530'])
  assert.deepEqual(ws.readDocsState(), { crux_flutter: { lastDocumented: sha(1) } })
})

test('the weekly PM is given the weekly backlog, not the daily one', async () => {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId, {
    pipeline: 'weekly',
    steps: [
      { name: 'fetch', status: 'succeeded' },
      { name: 'review', status: 'succeeded' },
      { name: 'discord', status: 'succeeded' },
      { name: 'pm', status: 'pending' },
    ],
  })
  ws.writeRunFile(runId, 'fetch/crux_flutter.json', changed('crux_flutter', sha(1), sha(2)))
  ws.writeRunFile(runId, 'review/crux_flutter.json', reviewed('crux_flutter', sha(1), sha(2)))
  const dailyRun = '2026-10-24-0530'
  const weeklyRun = '2026-10-18-0530'
  ws.prepareRun(dailyRun)
  ws.writeRunFile(dailyRun, 'fetch/crux_flutter.json', changed('crux_flutter', sha(7), sha(8)))
  ws.writeRunFile(dailyRun, 'review/crux_flutter.json', { ...reviewed('crux_flutter', sha(7), sha(8)), summary: 'Daily only.' })
  ws.prepareRun(weeklyRun, { pipeline: 'weekly' })
  ws.writeRunFile(weeklyRun, 'fetch/crux_flutter.json', changed('crux_flutter', sha(5), sha(6)))
  ws.writeRunFile(weeklyRun, 'review/crux_flutter.json', { ...reviewed('crux_flutter', sha(5), sha(6)), summary: 'Last week.' })
  ws.writePmBacklog([dailyRun])
  writeJson(join(ws.dataDir, 'state', 'weekly-pm-backlog.json'), [weeklyRun])
  ws.setWorkerCli('claude', {
    stdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      result: '{}',
      structured_output: { repoLines: [], highlights: [], todos: [], memory: null, taskStatus: [] },
    }),
  })

  const result = await ws.agents('step', 'pm', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  const prompt = ws.workerCliCalls('claude')[0].stdin
  assert.match(prompt, /Last week\./)
  assert.doesNotMatch(prompt, /Daily only\./)
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'pm.json')).runs, [weeklyRun, runId])
})
