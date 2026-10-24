import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { DocsResult } from '../steps/docs.ts'
import type { FetchResult } from '../steps/fetch.ts'
import type { PmResult } from '../steps/pm.ts'
import type { Finding, ReviewResult } from '../steps/review.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'
const sha = (n: number) => String(n).repeat(40)

function prepareRun(
  results: FetchResult[],
  {
    steps = [{ name: 'fetch', status: 'succeeded' }, { name: 'brief', status: 'pending' }],
    reviews = [] as ReviewResult[],
    pm = undefined as PmResult | undefined,
    dryRun = false,
  } = {},
) {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId, { steps, dryRun })
  for (const result of results) ws.writeRunFile(runId, `fetch/${result.repo}.json`, result)
  for (const result of reviews) ws.writeRunFile(runId, `review/${result.repo}.json`, result)
  if (pm) ws.writeRunFile(runId, 'pm.json', pm)
}

async function brief(): Promise<string> {
  const result = await ws.agents('step', 'brief', '--run', runId)
  assert.equal(result.status, 0, result.stderr)
  return ws.readRunFile(runId, 'brief.md')
}

const commit = (n: number, subject: string) => ({ sha: sha(n), author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject })

test("the Brief lists each Repo's new commits grouped by Team, in Team order", async () => {
  prepareRun([
    { repo: 'news-read-go', team: 'backend', branch: 'master', previous: sha(1), status: 'new-commits', head: sha(2), commits: [commit(2, 'Cache headlines')] },
    { repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(3), status: 'new-commits', head: sha(5), commits: [commit(5, 'Fix paywall copy'), commit(4, 'Add paywall')] },
    { repo: 'inpix-panel', team: 'frontend', branch: 'main', previous: sha(6), status: 'unchanged', head: sha(6), commits: [] },
  ])

  const text = await brief()

  const flutterAt = text.indexOf('## flutter')
  const backendAt = text.indexOf('## backend')
  const frontendAt = text.indexOf('## frontend')
  assert.ok(flutterAt >= 0 && flutterAt < backendAt && backendAt < frontendAt, text)
  assert.equal(
    text.slice(flutterAt, backendAt).trim(),
    [
      '## flutter',
      '',
      '### crux_flutter',
      '',
      '2 new commits on main:',
      '',
      '- `5555555` Fix paywall copy (Asha)',
      '- `4444444` Add paywall (Asha)',
      '',
      'No review of these commits in this Run.',
    ].join('\n'),
  )
  assert.match(text.slice(backendAt, frontendAt), /1 new commit on master:\n\n- `2222222` Cache headlines \(Asha\)/)
  assert.match(text.slice(frontendAt), /Unchanged: inpix-panel/)
})

test("the Brief notes a Repo's baseline on its first Run", async () => {
  prepareRun([{ repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: null, status: 'baseline', head: sha(7), commits: [] }])

  assert.match(await brief(), /### crux_flutter\n\nBaseline recorded at `7777777` on main/)
})

test('the Run health names failed Steps and the Repos that failed to fetch', async () => {
  prepareRun(
    [{ repo: 'gone', team: 'android', branch: 'main', previous: null, status: 'failed', error: 'fatal: repository not found\nmore detail' }],
    { steps: [{ name: 'fetch', status: 'failed' }, { name: 'brief', status: 'pending' }] },
  )

  const health = (await brief()).split('## Run health')[1]

  assert.match(health, /- fetch: failed\. Log: logs\/fetch\.log/)
  assert.match(health, /- gone \(android\): fatal: repository not found\n/)
})

test('the Run health names skipped Steps', async () => {
  prepareRun([], { steps: [{ name: 'fetch', status: 'skipped' }, { name: 'brief', status: 'pending' }] })

  assert.match((await brief()).split('## Run health')[1], /- fetch: skipped/)
})

test('a healthy Run says so in its Run health', async () => {
  prepareRun([{ repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(1), status: 'unchanged', head: sha(1), commits: [] }])

  assert.match((await brief()).split('## Run health')[1], /No Step failed or was skipped/)
})

const changed: FetchResult = {
  repo: 'crux_flutter',
  team: 'flutter',
  branch: 'main',
  previous: sha(1),
  status: 'new-commits',
  head: sha(3),
  commits: [commit(3, 'Fix paywall copy'), commit(2, 'Add paywall')],
}
const range = { repo: 'crux_flutter', team: 'flutter', branch: 'main', from: sha(1), to: sha(3) } as const

const finding = (severity: Finding['severity'], summary: string, bySaransh = false): Finding => ({
  severity,
  file: 'lib/paywall.dart',
  line: 42,
  commit: sha(bySaransh ? 3 : 2),
  author: bySaransh ? 'Saransh' : 'Asha',
  summary,
  bySaransh,
})

test("the Brief shows each changed Repo's review, with findings by severity and Saransh's own first", async () => {
  const findings = [finding('low', 'Unused import'), finding('medium', 'Copy is cut off', true), finding('critical', 'Paywall can be skipped'), finding('high', 'Price shows before it loads', true)]
  prepareRun([changed], { reviews: [{ ...range, status: 'reviewed', summary: 'Adds a paywall and fixes its copy.', findings, memory: null }] })

  const text = await brief()

  const review = text.slice(text.indexOf('Review:'), text.indexOf('## Run health')).trim()
  assert.equal(
    review,
    [
      'Review: Adds a paywall and fixes its copy.',
      '',
      '- **high** `lib/paywall.dart:42` in `3333333` by Saransh (yours): Price shows before it loads',
      '- **medium** `lib/paywall.dart:42` in `3333333` by Saransh (yours): Copy is cut off',
      '- **critical** `lib/paywall.dart:42` in `2222222` by Asha: Paywall can be skipped',
      '- **low** `lib/paywall.dart:42` in `2222222` by Asha: Unused import',
    ].join('\n'),
  )
})

test('the Brief says when a review found nothing', async () => {
  prepareRun([changed], { reviews: [{ ...range, status: 'reviewed', summary: 'Adds a paywall.', findings: [], memory: null }] })

  assert.match(await brief(), /Review: Adds a paywall\.\n\nNo findings\./)
})

test("the Brief says when a Repo's review failed, and its Run health names the Repo", async () => {
  prepareRun([changed], {
    steps: [{ name: 'fetch', status: 'succeeded' }, { name: 'review', status: 'failed' }, { name: 'brief', status: 'pending' }],
    reviews: [{ ...range, status: 'failed', error: 'Quota limit reached\nmore detail' }],
  })

  const [repos, health] = (await brief()).split('## Run health')

  assert.match(repos, /### crux_flutter[\s\S]*Review failed: Quota limit reached\n/)
  assert.match(health, /- review: failed/)
  assert.match(health, /Repos whose review failed:\n\n- crux_flutter \(flutter\): Quota limit reached\n/)
})

test('the Brief shows no review for commits it does not cover, such as after Fetch was re-run and found more', async () => {
  const older = { ...range, to: sha(2) }
  prepareRun([changed], {
    steps: [{ name: 'fetch', status: 'succeeded' }, { name: 'review', status: 'succeeded' }, { name: 'brief', status: 'pending' }],
    reviews: [{ ...older, status: 'reviewed', summary: 'Adds a paywall.', findings: [], memory: null }],
  })

  const text = await brief()

  assert.match(text, /- `2222222` Add paywall \(Asha\)\n\nNo review of these commits in this Run\.\n/)
  assert.doesNotMatch(text, /Review: Adds a paywall|No findings/)
})

test("a review that failed on other commits is not reported as this Run's failure", async () => {
  prepareRun([changed], { reviews: [{ ...range, from: sha(9), status: 'failed', error: 'Quota limit reached' }] })

  const text = await brief()

  assert.match(text, /No review of these commits in this Run\./)
  assert.doesNotMatch(text, /Quota limit reached/)
})

test('the Brief says when a changed Repo has no review at all', async () => {
  prepareRun([changed])

  assert.match(await brief(), /- `2222222` Add paywall \(Asha\)\n\nNo review of these commits in this Run\.\n/)
})

test("a dry run's Brief says its reviews came from the fake Worker", async () => {
  prepareRun([changed], { reviews: [{ ...range, status: 'reviewed', summary: 'Answered by the fake Worker.', findings: [], memory: null }], dryRun: true })

  assert.match(await brief(), /^# Brief 2026-10-22-0530\n\nDry run: every Agent ran on the fake Worker, so no review in this Brief is real, and none counts as done\./)
})

const pmAnswered = (answer: Partial<Extract<PmResult, { status: 'answered' }>> = {}): PmResult => ({
  status: 'answered',
  repoLines: [{ repo: 'crux_flutter', line: 'A paywall now guards premium stories, and its price can show before it loads.' }],
  highlights: ['Priya asked in #payments whether the paywall ships this week.'],
  todos: ['Fix the paywall price that shows before it loads (your commit 3333333).', 'Download the Google Doc PRD for the payments revamp.'],
  memory: null,
  ...answer,
})

test("a full Brief opens with the PM Agent's To-dos and highlights, gives each changed Repo its line, and counts the Repos reviewed", async () => {
  const unchanged: FetchResult = { repo: 'news-read-go', team: 'backend', branch: 'master', previous: sha(5), status: 'unchanged', head: sha(5), commits: [] }
  const failing: FetchResult = { ...changed, repo: 'inpix-panel', team: 'frontend' }
  prepareRun([changed, unchanged, failing], {
    reviews: [
      { ...range, status: 'reviewed', summary: 'Adds a paywall.', findings: [finding('high', 'Price shows before it loads', true)], memory: null },
      { ...range, repo: 'inpix-panel', team: 'frontend', status: 'failed', error: 'Quota limit reached' },
    ],
    pm: pmAnswered(),
  })

  const text = await brief()

  assert.equal(
    text.slice(0, text.indexOf('2 new commits on main:')),
    [
      '# Brief 2026-10-22-0530',
      '',
      '## To-dos',
      '',
      '- Fix the paywall price that shows before it loads (your commit 3333333).',
      '- Download the Google Doc PRD for the payments revamp.',
      '',
      '## Discord highlights',
      '',
      '- Priya asked in #payments whether the paywall ships this week.',
      '',
      '## flutter',
      '',
      '### crux_flutter',
      '',
      'A paywall now guards premium stories, and its price can show before it loads.',
      '',
      '',
    ].join('\n'),
  )
  assert.match(text, /- \*\*high\*\* `lib\/paywall\.dart:42` in `3333333` by Saransh \(yours\): Price shows before it loads/)
  assert.match(text.split('## Run health')[1], /\nRepos reviewed: 1\.\n/)
})

test('a Brief with no Discord input says no Discord messages were read, and one with no To-dos says nothing is waiting', async () => {
  prepareRun([changed], { pm: pmAnswered({ highlights: [], todos: [] }) })

  assert.match(
    await brief(),
    /^# Brief 2026-10-22-0530\n\n## To-dos\n\nNothing is waiting on you\.\n\n## Discord highlights\n\nNo Discord messages were read in this Run\.\n\n## flutter\n/,
  )
})

test('when the PM Agent failed, the Brief says its output is missing and why, and still shows the reviews and Run health', async () => {
  prepareRun([changed], {
    steps: [{ name: 'fetch', status: 'succeeded' }, { name: 'review', status: 'succeeded' }, { name: 'pm', status: 'failed' }, { name: 'brief', status: 'pending' }],
    reviews: [{ ...range, status: 'reviewed', summary: 'Adds a paywall.', findings: [finding('high', 'Price shows before it loads', true)], memory: null }],
    pm: { status: 'failed', error: 'claude-code failed: Session limit reached\nmore detail' },
  })

  const text = await brief()

  assert.match(
    text,
    /^# Brief 2026-10-22-0530\n\nThe PM output is missing, so this Brief has no To-dos, Discord highlights or line per Repo\. The PM Agent failed: claude-code failed: Session limit reached\n\n## flutter\n/,
  )
  assert.match(text, /Review: Adds a paywall\.\n\n- \*\*high\*\* `lib\/paywall\.dart:42`/)
  assert.match(text.split('## Run health')[1], /- pm: failed\. Log: logs\/pm\.log/)
})

const waiting = { commits: 3, pages: ['repos/crux_flutter/paywall.md', 'codebases/inpix/index.md'] }

test("after the Repos, the Brief lists the docs branch's pages waiting for Saransh's review, with what this Run changed on it", async () => {
  prepareRun([changed])
  ws.writeRunFile(runId, 'docs.json', {
    status: 'updated',
    branch: 'agents/docs',
    commit: sha(8),
    pages: [{ page: 'repos/crux_flutter/paywall.md', summary: 'The price now comes from the payments service.' }],
    prds: [],
    skipped: [],
    waiting,
    undocumented: [],
  } satisfies DocsResult)

  const text = await brief()

  const docs = text.slice(text.indexOf('## Docs branch waiting for review'), text.indexOf('## Run health'))
  assert.ok(text.indexOf('## flutter') < text.indexOf('## Docs branch waiting for review'), text)
  assert.equal(
    docs.trim(),
    [
      '## Docs branch waiting for review',
      '',
      '`agents/docs` has 3 commits not on main, changing these pages, each a draft:',
      '',
      '- repos/crux_flutter/paywall.md',
      '- codebases/inpix/index.md',
      '',
      'This Run updated:',
      '',
      '- repos/crux_flutter/paywall.md: The price now comes from the payments service.',
      '',
      'Review it with `git diff main...agents/docs` in the wiki, and merge it into main when you accept it.',
    ].join('\n'),
  )
})

test('the Brief lists the PRD pages this Run wrote from the PRD inbox on the docs branch, and the inbox files it set aside, with why', async () => {
  prepareRun([changed])
  ws.writeRunFile(runId, 'docs.json', {
    status: 'updated',
    branch: 'agents/docs',
    commit: sha(8),
    pages: [],
    prds: [{ file: 'Paywall_PRD.pdf', codebase: 'inpix', page: 'products/inpix/prds/paywall.md', summary: 'Premium subscribers skip the paywall.' }],
    skipped: [{ file: 'Lunch_menu.pdf', reason: 'A lunch menu, not a PRD.' }],
    waiting: { commits: 2, pages: ['products/inpix/prds/paywall.md'] },
    undocumented: [],
  } satisfies DocsResult)

  const text = await brief()

  assert.equal(
    text.slice(text.indexOf('## Docs branch waiting for review'), text.indexOf('## Run health')).trim(),
    [
      '## Docs branch waiting for review',
      '',
      '`agents/docs` has 2 commits not on main, changing these pages, each a draft:',
      '',
      '- products/inpix/prds/paywall.md',
      '',
      'This Run wrote PRD pages from the PRD inbox, and moved their files to done/ there:',
      '',
      '- products/inpix/prds/paywall.md, from Paywall_PRD.pdf: Premium subscribers skip the paywall.',
      '',
      'Review it with `git diff main...agents/docs` in the wiki, and merge it into main when you accept it.',
      '',
      '## PRD inbox files set aside',
      '',
      "The Docs Agent didn't turn these into PRD pages, so they were moved to skipped/ in the PRD inbox. Move one back into the inbox for the next Run to try it again.",
      '',
      '- Lunch_menu.pdf: A lunch menu, not a PRD.',
    ].join('\n'),
  )
})

test('the Brief lists the PRD inbox files set aside even when the docs branch has nothing waiting', async () => {
  prepareRun([changed])
  ws.writeRunFile(runId, 'docs.json', {
    status: 'no-edits',
    branch: 'agents/docs',
    prds: [],
    skipped: [{ file: 'Lunch_menu.pdf', reason: 'A lunch menu, not a PRD.' }],
    waiting: null,
    undocumented: [],
  } satisfies DocsResult)

  const text = await brief()

  assert.doesNotMatch(text, /## Docs branch waiting for review/)
  assert.match(text, /## PRD inbox files set aside\n\n[^\n]+\n\n- Lunch_menu\.pdf: A lunch menu, not a PRD\.\n/)
})

test('when merging main into the docs branch conflicted, the Brief says the wiki was left as it was, and how to go on', async () => {
  prepareRun([changed], { steps: [{ name: 'docs', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'docs.json', {
    status: 'conflict',
    branch: 'agents/docs',
    files: ['repos/crux_flutter/paywall.md'],
    prds: [],
    skipped: [],
    waiting: { commits: 1, pages: ['repos/crux_flutter/paywall.md'] },
    undocumented: [],
  } satisfies DocsResult)

  const text = await brief()

  assert.match(
    text,
    /`agents\/docs` has 1 commit not on main[\s\S]*This Run left it as it was: merging main into it conflicts in repos\/crux_flutter\/paywall\.md\. Merge main into agents\/docs yourself, then re-run the docs Step\.\n/,
  )
})

test("when the wiki's check failed on the Docs Agent's edits, the Brief says they weren't committed, even with nothing waiting on the docs branch", async () => {
  prepareRun([changed], { steps: [{ name: 'docs', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'docs.json', {
    status: 'check-failed',
    branch: 'agents/docs',
    check: 'E repos/crux_flutter/paywall.md: cites lib/gone.dart, not at the pin\n1 errors',
    prds: [],
    skipped: [],
    waiting: null,
    undocumented: [],
  } satisfies DocsResult)

  const text = await brief()

  assert.match(
    text,
    /## Docs branch waiting for review\n\nNothing on `agents\/docs` is waiting for you\.\n\nThis Run's wiki edits weren't committed, since the wiki's check still reports errors:\n\n```\nE repos\/crux_flutter\/paywall\.md: cites lib\/gone\.dart, not at the pin\n1 errors\n```\n/,
  )
})

test('when the Docs Agent added a page, the Brief says its edits were rejected and names the file', async () => {
  prepareRun([changed], { steps: [{ name: 'docs', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'docs.json', { status: 'rejected', branch: 'agents/docs', files: ['repos/inpix-panel/index.md'], prds: [], skipped: [], waiting: null, undocumented: [] } satisfies DocsResult)

  assert.match(
    await brief(),
    /This Run's wiki edits weren't committed, since the Docs Agent added, deleted or replaced repos\/inpix-panel\/index\.md, and it may only update pages that exist and add PRD pages with copies of PRD inbox files\.\n/,
  )
})

test('the Brief lists the Repos with new commits that the wiki has never documented, after the docs branch', async () => {
  prepareRun([changed])
  ws.writeRunFile(runId, 'docs.json', {
    status: 'nothing-to-update',
    branch: 'agents/docs',
    prds: [],
    skipped: [],
    waiting,
    undocumented: [
      { repo: 'inpix-panel', team: 'frontend', commits: 2 },
      { repo: 'news-read-go', team: 'backend', commits: 1 },
    ],
  } satisfies DocsResult)

  const text = await brief()

  assert.ok(text.indexOf('## Docs branch waiting for review') < text.indexOf('## Undocumented Repos with new commits'), text)
  assert.equal(
    text.slice(text.indexOf('## Undocumented Repos with new commits'), text.indexOf('## Run health')).trim(),
    [
      '## Undocumented Repos with new commits',
      '',
      "The wiki has no pages of these Repos, and the Docs Agent never writes a Repo's first pages. Document one with the wiki's code-to-wiki skill when you choose.",
      '',
      '- inpix-panel (frontend): 2 new commits',
      '- news-read-go (backend): 1 new commit',
    ].join('\n'),
  )
})

test('a Brief written before the PM Agent answered says its output is missing', async () => {
  prepareRun([changed])

  assert.match(await brief(), /^# Brief 2026-10-22-0530\n\nThe PM output is missing, so this Brief has no To-dos, Discord highlights or line per Repo\.\n\n## flutter\n/)
})
