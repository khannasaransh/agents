import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { DiscordMessage, DiscordRead } from '../steps/discord.ts'
import type { DocsResult } from '../steps/docs.ts'
import type { FetchResult } from '../steps/fetch.ts'
import type { PmResult, TaskReport } from '../steps/pm.ts'
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

/** The Brief after its summary at a glance. */
const details = (text: string) => text.slice(text.indexOf('# Details\n\n') + '# Details\n\n'.length)

const commit = (n: number, subject: string) => ({ sha: sha(n), author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject })

test("the Brief lists each Repo's new commits grouped by Team, in Team order", async () => {
  prepareRun([
    { repo: 'news-read-go', team: 'backend', branch: 'master', previous: sha(1), status: 'new-commits', head: sha(2), commits: [commit(2, 'Cache headlines')] },
    { repo: 'crux_flutter', team: 'flutter', branch: 'main', previous: sha(3), status: 'new-commits', head: sha(5), commits: [commit(5, 'Fix paywall copy'), commit(4, 'Add paywall')] },
    { repo: 'inpix-panel', team: 'frontend', branch: 'main', previous: sha(6), status: 'unchanged', head: sha(6), commits: [] },
  ])

  const text = await brief()

  const flutterAt = text.indexOf('### flutter')
  const backendAt = text.indexOf('### backend')
  const frontendAt = text.indexOf('### frontend')
  assert.ok(flutterAt >= 0 && flutterAt < backendAt && backendAt < frontendAt, text)
  assert.equal(
    text.slice(flutterAt, backendAt).trim(),
    [
      '### flutter',
      '',
      '#### crux_flutter',
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

  assert.match(await brief(), /#### crux_flutter\n\nBaseline recorded at `7777777` on main/)
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
    details(text).slice(0, details(text).indexOf('2 new commits on main:')),
    [
      '## To-dos',
      '',
      '- Fix the paywall price that shows before it loads (your commit 3333333).',
      '- Download the Google Doc PRD for the payments revamp.',
      '',
      '## Discord highlights',
      '',
      '- Priya asked in #payments whether the paywall ships this week.',
      '',
      '## Code review',
      '',
      '### flutter',
      '',
      '#### crux_flutter',
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
    details(await brief()),
    /^## To-dos\n\nNothing is waiting on you\.\n\n## Discord highlights\n\nNo Discord messages were read in this Run\.\n\n## Code review\n\n### flutter\n/,
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
    details(text),
    /^The PM output is missing, so this Brief has no To-dos, Discord highlights or line per Repo\. The PM Agent failed: claude-code failed: Session limit reached\n\n## Code review\n\n### flutter\n/,
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
    ranges: [],
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
    ranges: [],
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
    ranges: [],
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
    ranges: [],
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
    ranges: [],
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
  ws.writeRunFile(runId, 'docs.json', { status: 'rejected', branch: 'agents/docs', files: ['repos/inpix-panel/index.md'], prds: [], skipped: [], waiting: null, ranges: [], undocumented: [] } satisfies DocsResult)

  assert.match(
    await brief(),
    /This Run's wiki edits weren't committed, since the Docs Agent changed repos\/inpix-panel\/index\.md, and it may only update pages and add PRD pages with copies of PRD inbox files\.\n/,
  )
})

test("when one of the wiki's other tools failed on the Docs Agent's edits, the Brief says which, with what it said", async () => {
  prepareRun([changed], { steps: [{ name: 'docs', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'docs.json', { status: 'tool-failed', branch: 'agents/docs', tool: 'stamp', output: 'cannot read pins', prds: [], skipped: [], waiting: null, ranges: [], undocumented: [] } satisfies DocsResult)

  assert.match(await brief(), /This Run's wiki edits weren't committed, since the wiki's stamp tool failed:\n\n```\ncannot read pins\n```\n/)
})

test('when the Docs Step failed, such as when both Workers did, the Brief still lists what waits on the docs branch from earlier Runs', async () => {
  prepareRun([changed], { steps: [{ name: 'docs', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'docs.json', {
    status: 'failed',
    branch: 'agents/docs',
    error: 'claude-code failed: Session limit reached; then codex failed: Codex is overloaded',
    prds: [],
    skipped: [],
    waiting: { commits: 2, pages: ['repos/crux_flutter/paywall.md'] },
    ranges: [],
    undocumented: [],
  } satisfies DocsResult)

  assert.match(
    await brief(),
    /`agents\/docs` has 2 commits not on main, changing these pages, each a draft:\n\n- repos\/crux_flutter\/paywall\.md\n\nThis Run's Docs Step failed, so it changed nothing on the wiki: claude-code failed: Session limit reached; then codex failed: Codex is overloaded\. The next Run tries the same work again\.\n/,
  )
})

test('a docs.json from before the PRD inbox, with no PRDs or skipped files, still makes a Brief', async () => {
  prepareRun([changed])
  ws.writeRunFile(runId, 'docs.json', { status: 'updated', branch: 'agents/docs', commit: sha(8), pages: [], waiting, undocumented: [] })

  assert.match(await brief(), /`agents\/docs` has 3 commits not on main/)
})

test('the Brief lists the Repos with new commits that the wiki has never documented, after the docs branch', async () => {
  prepareRun([changed])
  ws.writeRunFile(runId, 'docs.json', {
    status: 'nothing-to-update',
    branch: 'agents/docs',
    prds: [],
    skipped: [],
    waiting,
    ranges: [],
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

  assert.match(details(await brief()), /^The PM output is missing, so this Brief has no To-dos, Discord highlights or line per Repo\.\n\n## Code review\n\n### flutter\n/)
})

const discordMessage = (n: number, fields: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: String(n),
  channel: 'payments',
  thread: null,
  dm: false,
  author: 'Priya',
  timestamp: '2026-10-21T09:15:00.000+00:00',
  content: 'Build to test',
  link: `https://discord.com/channels/1/2/${n}`,
  mentionsSaransh: false,
  fromSaransh: false,
  prdFiles: [],
  apkFiles: [],
  otherFiles: [],
  loginLinks: [],
  ...fields,
})

test('the Brief opens with a summary at a glance, then gives the details', async () => {
  prepareRun([changed], {
    steps: [{ name: 'fetch', status: 'succeeded' }, { name: 'docs', status: 'failed' }, { name: 'brief', status: 'pending' }],
    reviews: [{ ...range, status: 'reviewed', summary: 'Adds a paywall.', findings: [finding('critical', 'Paywall can be skipped'), finding('high', 'Price shows before it loads', true)], memory: null }],
    pm: pmAnswered(),
  })
  ws.writeRunFile(runId, 'discord.json', {
    since: '2026-10-21T00:00:00.000Z',
    until: '2026-10-22T00:00:00.000Z',
    messages: [discordMessage(1, { mentionsSaransh: true, apkFiles: ['inshorts-4.2.0.apk'] }), discordMessage(2)],
  } satisfies DiscordRead)

  const text = await brief()

  assert.equal(
    text.slice(0, text.indexOf('## To-dos')),
    [
      '# Brief 2026-10-22-0530',
      '',
      '## At a glance',
      '',
      '- **To-dos:** 2, waiting on you',
      '- **Mentions and DMs:** 1, of 2 Discord messages read',
      '- **APKs to test:** 1, saved in the APK inbox',
      '- **Repos with new commits:** 1, 1 reviewed',
      '- **Findings:** 2, 1 critical, 1 high; 1 on your commits',
      '- **Run health:** 1, docs failed',
      '',
      '# Details',
      '',
      '',
    ].join('\n'),
  )
})

test('the Brief lists the APKs to test and the other files saved from Discord, each with the message it came from', async () => {
  prepareRun([])
  ws.writeRunFile(runId, 'discord.json', {
    since: '2026-10-21T00:00:00.000Z',
    until: '2026-10-22T00:00:00.000Z',
    messages: [discordMessage(1, { apkFiles: ['inshorts-4.2.0.apk'], otherFiles: ['screenshot.png'] }), discordMessage(2, { thread: 'Release', otherFiles: ['designs.zip'] })],
  } satisfies DiscordRead)

  const text = await brief()

  assert.match(text, /## APKs to test\n\nSaved in the APK inbox, `[^`]+apk-inbox`\.\n\n- `inshorts-4\.2\.0\.apk` from Priya in \[#payments\]\(https:\/\/discord\.com\/channels\/1\/2\/1\)\n/)
  assert.match(
    text,
    /## Other files from Discord\n\nSaved in the other folder, `[^`]+other`\.\n\n- `screenshot\.png` from Priya in \[#payments\]\([^)]+\/1\)\n- `designs\.zip` from Priya in \[#payments › Release\]\([^)]+\/2\)\n/,
  )
})

test("a Repo on GitHub links its commits, its range and its findings' files there", async () => {
  prepareRun([changed], { reviews: [{ ...range, status: 'reviewed', summary: 'Adds a paywall.', findings: [finding('high', 'Price shows before it loads')], memory: null }] })
  ws.writeRepoList([{ name: 'crux_flutter', team: 'flutter', remote: 'git@github.com:NewsInShorts/crux_flutter.git', folder: '/nowhere', branch: 'main' }])

  const text = await brief()

  const web = 'https://github.com/NewsInShorts/crux_flutter'
  assert.ok(text.includes(`2 new commits on main ([compare](${web}/compare/${sha(1)}...${sha(3)})):`), text)
  assert.ok(text.includes(`- [\`3333333\`](${web}/commit/${sha(3)}) Fix paywall copy (Asha)`), text)
  assert.ok(text.includes(`- **high** [\`lib/paywall.dart:42\`](${web}/blob/${sha(3)}/lib/paywall.dart#L42) in [\`2222222\`](${web}/commit/${sha(2)}) by Asha`), text)
})

test('the Brief is also an HTML page, where each changed Repo opens to its Overview, Commits and Review', async () => {
  prepareRun([changed], {
    reviews: [{ ...range, status: 'reviewed', summary: 'Adds a <paywall>.', findings: [finding('critical', 'Paywall can be skipped'), finding('low', 'Unused import', true)], memory: null }],
    pm: pmAnswered(),
  })
  ws.writeRepoList([{ name: 'crux_flutter', team: 'flutter', remote: 'https://github.com/NewsInShorts/crux_flutter.git', folder: '/nowhere', branch: 'main' }])
  await brief()

  const html = ws.readRunFile(runId, 'brief.html')

  assert.match(html, /^<!doctype html>/)
  assert.doesNotMatch(html, /<script|<link|src="http/, 'the page loads nothing from the internet')
  assert.match(html, /<nav class="glance"[\s\S]*<a class="card warn" href="#todos"><span class="value">2<\/span><span class="label">To-dos<\/span>/)
  assert.match(html, /<a class="card bad" href="#code-review"><span class="value">2<\/span><span class="label">Findings<\/span>/)
  const repo = html.slice(html.indexOf('<details class="repo">'), html.indexOf('</details>', html.indexOf('<details class="repo">')))
  assert.match(repo, /<summary><span class="name">crux_flutter<\/span> <span class="muted">2 commits<\/span> <span class="sev critical">1 critical<\/span><span class="sev low">1 low<\/span><span class="chip yours">1 yours<\/span><\/summary>/)
  assert.match(repo, /<label for="repo-crux_flutter-0">Overview<\/label>[\s\S]*<label for="repo-crux_flutter-1">Commits <span class="count">2<\/span><\/label>[\s\S]*<label for="repo-crux_flutter-2">Review <span class="count">2<\/span><\/label>/)
  assert.match(repo, /A paywall now guards premium stories/)
  assert.match(repo, /Adds a &lt;paywall&gt;\./, 'text from the review is escaped')
  assert.ok(repo.includes(`<a href="https://github.com/NewsInShorts/crux_flutter/commit/${sha(3)}"><code>3333333</code></a> Fix paywall copy`), repo)
  assert.ok(repo.indexOf('Unused import') < repo.indexOf('Paywall can be skipped'), "Saransh's own findings come first")
  assert.match(html, /<a href="brief\.md">brief\.md<\/a>/)
})

test("the HTML Brief keeps the links, code and bold in the PM Agent's lines, and escapes the rest", async () => {
  prepareRun([changed], {
    pm: pmAnswered({ todos: ['Download the [Finance PRD](https://docs.google.com/document/d/1Qc/edit?a=1&b=2) for `inpix` — **today** <b>now</b>', 'Not a link: [x](javascript:alert(1))'] }),
  })
  await brief()

  const html = ws.readRunFile(runId, 'brief.html')

  assert.ok(html.includes('<li>Download the <a href="https://docs.google.com/document/d/1Qc/edit?a=1&amp;b=2">Finance PRD</a> for <code>inpix</code> — <strong>today</strong> &lt;b&gt;now&lt;/b&gt;</li>'), html)
  assert.ok(html.includes('<li>Not a link: [x](javascript:alert(1))</li>'), html)
})

const taskReport: TaskReport = {
  post: { channel: 'sprint-assignments', author: 'Subhash Yadav', postedAt: '2026-10-21T12:05:26.362+00:00', link: 'https://discord.com/channels/1/2/9', title: 'tasks for this sprint-(oct 21 - oct 27)' },
  tasks: [
    { id: 'tender-tracker', title: 'Tender Tracker', product: null, pm: null, assignees: [{ name: 'Neha', team: 'Backend' }], status: 'no-signal', note: 'Nothing about it yet.', evidence: [], was: null },
    {
      id: 'paywall',
      title: 'Crux | Paywall',
      product: 'Crux',
      pm: 'Aditya Manchanda',
      assignees: [{ name: 'Asha', team: 'Flutter' }, { name: 'Ravi', team: 'iOS' }],
      status: 'in-testing',
      note: 'Merged, waiting for QA.',
      evidence: ['crux_flutter `2222222` Add paywall', '[Priya: build 4.2 is up for QA](https://discord.com/channels/1/2/10)'],
      was: 'in-progress',
    },
    { id: 'football-center', title: 'Football Center', product: null, pm: 'Prakhar Shukla', assignees: [{ name: 'Neha', team: 'Backend' }], status: 'blocked', note: 'Waits on the scores API.', evidence: [], was: null },
  ],
}

test("the Brief gives the PM Agent's sprint task status report, blocked tasks first, with each task's evidence", async () => {
  prepareRun([], { pm: pmAnswered({ taskReport }) })

  const text = await brief()

  assert.match(text, /- \*\*Sprint tasks:\*\* 3, 1 blocked, 1 in testing, 1 no signal\n/)
  assert.equal(
    text.slice(text.indexOf('## Sprint task status'), text.indexOf('## Code review')).trim(),
    [
      '## Sprint task status',
      '',
      "From Subhash Yadav's [sprint post](https://discord.com/channels/1/2/9) in #sprint-assignments, 2026-10-21: tasks for this sprint-(oct 21 - oct 27)",
      '',
      '### Blocked (1)',
      '',
      '- **Football Center**: Waits on the scores API. PM Prakhar Shukla; Neha (Backend).',
      '',
      '### In testing (1)',
      '',
      '- **Crux | Paywall** (was in progress): Merged, waiting for QA. PM Aditya Manchanda; Asha (Flutter), Ravi (iOS).',
      '  - crux_flutter `2222222` Add paywall',
      '  - [Priya: build 4.2 is up for QA](https://discord.com/channels/1/2/10)',
      '',
      '### No signal (1)',
      '',
      '- **Tender Tracker**: Nothing about it yet. PM not named; Neha (Backend).',
    ].join('\n'),
  )

  const html = ws.readRunFile(runId, 'brief.html')
  assert.match(html, /<a class="card bad" href="#sprint"><span class="value">3<\/span><span class="label">Sprint tasks<\/span>/)
  const sprint = html.slice(html.indexOf('<section id="sprint">'), html.indexOf('</section>', html.indexOf('<section id="sprint">')))
  assert.ok(sprint.indexOf('Football Center') < sprint.indexOf('Crux | Paywall') && sprint.indexOf('Crux | Paywall') < sprint.indexOf('Tender Tracker'), sprint)
  assert.match(sprint, /<summary><span class="status in-testing">In testing<\/span> <span class="name">Crux \| Paywall<\/span> <span class="chip">was in progress<\/span><span class="muted">Asha, Ravi<\/span><\/summary>/)
  assert.ok(sprint.includes('<li><a href="https://discord.com/channels/1/2/10">Priya: build 4.2 is up for QA</a></li>'), sprint)
})
