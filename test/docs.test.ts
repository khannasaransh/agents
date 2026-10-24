import assert from 'node:assert/strict'
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { git, makeWorkspace, type TestRepo, type TestWiki, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'
const docsBranch = 'agents/docs'
const mainLine = 'main'

const lastFetched = (repo: TestRepo) => git(repo.folder, 'rev-parse', `origin/${repo.entry.branch}`)

/** A wiki page in the shape the wiki's rules give it. */
function page(sources: string[], { body = 'The paywall shows the price.', review = 'draft' } = {}): string {
  return ['---', 'type: repo', 'layer: l1', `review: ${review}`, 'sources:', ...sources.map((s) => `  - ${s}`), '---', '', '# Paywall', '', body, ''].join('\n')
}

/** Prepares a Run whose Fetch found each Repo's commits since `from`, with the wiki in the env file. */
function prepareRun(wiki: TestWiki, fetched: [TestRepo, string | null][], { dryRun = false, id = runId } = {}) {
  ws.writeRepoList()
  ws.writeEnvFile(`WIKI_FOLDER=${wiki.folder}\n`)
  ws.prepareRun(id, { dryRun })
  for (const [repo, from] of fetched) ws.writeFetchResult(id, repo, from)
}

/** The Docs Agent's answer, as its output schema shapes it. */
interface DocsAnswer {
  pages: { page: string; summary: string }[]
  prds: { file: string; codebase: string; page: string; summary: string }[]
  skipped: { file: string; reason: string }[]
}

/** `claude --print` answering as the Docs Agent, after writing `files` in the folder it runs in. */
const claudeCodeEditing = (
  files: Record<string, string>,
  answer: DocsAnswer = { pages: Object.keys(files).map((p) => ({ page: p, summary: `Updated ${p}` })), prds: [], skipped: [] },
) => ({
  writeFiles: files,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(answer), structured_output: answer }),
})

const docs = (...args: string[]) => ws.agents('step', 'docs', '--run', runId, ...args)

const paywallPage = 'repos/crux_flutter/paywall.md'
const paywallSource = 'crux_flutter@main@1234567:lib/paywall.dart'
const nextRunId = '2026-10-23-0530'

/**
 * A wiki documenting crux_flutter's paywall, and a first Run in which the Docs Agent updated that
 * page on the docs branch after a commit changed it. Returns what the next Run needs.
 */
async function afterFirstDocsRun() {
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const wiki = ws.addWiki()
  wiki.commit('Document the paywall', { [paywallPage]: page([paywallSource]) })
  prepareRun(wiki, [[repo, from]])
  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: page([paywallSource], { body: 'First update.' }) }))
  const first = await docs()
  assert.equal(first.status, 0, first.stderr)
  const firstTip = git(wiki.folder, 'rev-parse', docsBranch)

  const nextFrom = lastFetched(repo)
  repo.pushCommit('Show the price in rupees', { files: { 'lib/paywall.dart': 'class Paywall { String currency = "INR"; }\n' } })
  return {
    repo,
    wiki,
    firstTip,
    /** Runs the Docs Step in the next Run, whose Agent writes `files`. */
    async nextRun(files: Record<string, string> = { [paywallPage]: page([paywallSource], { body: 'Second update.' }) }) {
      prepareRun(wiki, [[repo, nextFrom]], { id: nextRunId })
      ws.setWorkerCli('claude', claudeCodeEditing(files))
      return ws.agents('step', 'docs', '--run', nextRunId)
    },
  }
}

test('the Docs Agent updates a page citing a changed file on a new docs branch from main, committed as Saransh with the Agent and Run named, leaving his checkout as it was', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const wiki = ws.addWiki()
  const main = wiki.commit('Document the paywall', { [paywallPage]: page(['crux_flutter@main@1234567:lib/paywall.dart']) })
  writeFileSync(join(wiki.folder, paywallPage), 'Saransh is still writing this\n')
  prepareRun(wiki, [[repo, from]])
  const updated = page(['crux_flutter@main@1234567:lib/paywall.dart'], { body: 'The paywall shows the price from the payments service.' })
  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: updated }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(wiki.folder, 'rev-parse', `${docsBranch}^`), main)
  assert.equal(git(wiki.folder, 'show', `${docsBranch}:${paywallPage}`), updated.trimEnd())
  assert.equal(git(wiki.folder, 'log', '-1', '--format=%an <%ae>, %cn <%ce>', docsBranch), 'Saransh Khanna <saransh@example.com>, Saransh Khanna <saransh@example.com>')
  assert.equal(git(wiki.folder, 'log', '-1', '--format=%(trailers:key=Agent,valueonly,separator=)|%(trailers:key=Run,valueonly,separator=)', docsBranch), `docs|${runId}`)
  assert.equal(git(wiki.folder, 'branch', '--show-current'), 'main')
  assert.equal(git(wiki.folder, 'rev-parse', 'HEAD'), main)
  assert.equal(readFileSync(join(wiki.folder, paywallPage), 'utf8'), 'Saransh is still writing this\n')
  assert.equal(git(wiki.folder, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length, 1)
})

/** The value of one input in an Agent's prompt, as the Worker's CLI was given it. */
function promptInput(prompt: string, name: string): unknown {
  const block = new RegExp(`### ${name}: [^\\n]*\\n\\n\`\`\`(json)?\\n([\\s\\S]*?)\\n\`\`\`\\n`).exec(prompt)
  assert.ok(block, `no ${name} input in the prompt:\n${prompt}`)
  return block[1] ? JSON.parse(block[2]) : block[2]
}

test("the Docs Agent is given only the pages whose sources cite files the new commits changed on the Repo's production branch, with those files", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n', 'lib/config/prices.dart': 'const prices = {}\n' } })
  const wiki = ws.addWiki()
  wiki.commit('Document crux_flutter', {
    [paywallPage]: page(['crux_flutter@main@1234567:lib/paywall.dart', 'crux_flutter@main@1234567:lib/home.dart']),
    'repos/crux_flutter/config.md': page(['crux_flutter@main@1234567:lib/config/']),
    'repos/crux_flutter/home.md': page(['crux_flutter@main@1234567:lib/home.dart']),
    'repos/crux_flutter/legacy.md': page(['crux_flutter@legacy@1234567:lib/paywall.dart']),
    'repos/inpix-panel/paywall.md': page(['inpix-panel@main@1234567:lib/paywall.dart']),
    '_runs/crux_flutter/notes.md': page(['crux_flutter@main@1234567:lib/paywall.dart']),
  })
  prepareRun(wiki, [[repo, from]])
  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: page(['crux_flutter@main@1234567:lib/paywall.dart'], { body: 'Updated.' }) }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(promptInput(call.stdin, 'pages'), [
    { page: 'repos/crux_flutter/config.md', changed: [{ repo: 'crux_flutter', source: 'crux_flutter@main@1234567:lib/config/', files: ['lib/config/prices.dart'] }] },
    { page: paywallPage, changed: [{ repo: 'crux_flutter', source: 'crux_flutter@main@1234567:lib/paywall.dart', files: ['lib/paywall.dart'] }] },
  ])
})

test("after the Docs Agent's edits, the wiki's regions, stamp and check tools run in its worktree on the pages it touched, with each changed Repo pinned at its new head", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  const head = repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const wiki = ws.addWiki()
  wiki.commit('Document the paywall', { [paywallPage]: page([paywallSource]), 'repos/crux_flutter/home.md': page(['crux_flutter@main@1234567:lib/home.dart']) })
  prepareRun(wiki, [[repo, from]])
  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: page([paywallSource], { body: 'Updated.' }) }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  const runs = wiki.toolRuns()
  assert.deepEqual(
    runs.map((r) => r.tool),
    ['regions', 'stamp', 'check'],
  )
  const worktrees = [...new Set(runs.map((r) => r.cwd))]
  assert.equal(worktrees.length, 1)
  assert.ok(worktrees[0].startsWith(join(realpathSync(ws.dataDir), 'worktrees')), worktrees[0])
  const [, stamp, check] = runs
  const pinsFile = stamp.args[0]
  assert.deepEqual(stamp.args, [pinsFile, paywallPage])
  assert.deepEqual(check.args, [paywallPage, '--pins', pinsFile])
  assert.equal(readFileSync(pinsFile, 'utf8'), `crux_flutter main ${repo.folder} ${head}\n`)
})

test("when the wiki's check still reports errors on the pages the Docs Agent touched, nothing is committed and the Step fails, recording what the check said", async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()

  const result = await nextRun({ [paywallPage]: page([paywallSource], { body: 'The price is BROKEN (?).' }) })

  assert.equal(result.status, 1)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
  const recorded = JSON.parse(ws.readRunFile(nextRunId, 'docs.json'))
  assert.equal(recorded.status, 'check-failed')
  assert.match(recorded.check, new RegExp(`E ${paywallPage}: a claim could not be confirmed`))
})

test('a page Saransh had accepted goes back to a draft once the Docs Agent changes it', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const wiki = ws.addWiki()
  wiki.commit('Accept the paywall page', { [paywallPage]: page([paywallSource], { review: 'accepted' }) })
  prepareRun(wiki, [[repo, from]])
  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: page([paywallSource], { body: 'Updated.', review: 'accepted' }) }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(wiki.folder, 'show', `${docsBranch}:${paywallPage}`), page([paywallSource], { body: 'Updated.' }).trimEnd())
})

test('a Docs Agent that adds a page, such as documenting a Repo for the first time, gets nothing committed and the Step fails, naming the file', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()

  const result = await nextRun({
    [paywallPage]: page([paywallSource], { body: 'Second update.' }),
    'repos/inpix-panel/index.md': page(['inpix-panel@main@1234567:src/app.ts']),
  })

  assert.equal(result.status, 1)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
  const { status, files } = JSON.parse(ws.readRunFile(nextRunId, 'docs.json'))
  assert.deepEqual({ status, files }, { status: 'rejected', files: ['repos/inpix-panel/index.md'] })
})

test('while the docs branch is unmerged, the next Run continues it', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()

  const result = await nextRun()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(wiki.folder, 'rev-parse', `${docsBranch}^`), firstTip)
  assert.match(git(wiki.folder, 'show', `${docsBranch}:${paywallPage}`), /Second update\./)
  assert.match(git(wiki.folder, 'log', '-1', '--format=%(trailers:key=Run,valueonly,separator=)', docsBranch), new RegExp(nextRunId))
})

test('once Saransh has merged the docs branch, the next Run starts it fresh from main', async () => {
  ws = makeWorkspace()
  const { wiki, nextRun } = await afterFirstDocsRun()
  git(wiki.folder, 'merge', '-q', '--no-ff', '-m', 'Merge the docs branch', docsBranch)
  const main = wiki.commit('Add a glossary page', { 'glossary.md': page([]) })

  const result = await nextRun()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(wiki.folder, 'rev-parse', `${docsBranch}^`), main)
  assert.equal(git(wiki.folder, 'rev-list', '--count', `${mainLine}..${docsBranch}`), '1')
})

test('when main has moved since, the next Run merges main into the unmerged docs branch first, as Saransh with the Agent and Run named', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()
  const main = wiki.commit('Add a glossary page', { 'glossary.md': page([]) })

  const result = await nextRun()

  assert.equal(result.status, 0, result.stderr)
  const merge = `${docsBranch}^`
  assert.equal(git(wiki.folder, 'log', '-1', '--format=%P', merge), `${firstTip} ${main}`)
  assert.equal(git(wiki.folder, 'log', '-1', '--format=%an <%ae>|%(trailers:key=Agent,valueonly,separator=)|%(trailers:key=Run,valueonly,separator=)', merge), `Saransh Khanna <saransh@example.com>|docs|${nextRunId}`)
  assert.match(git(wiki.folder, 'show', `${docsBranch}:${paywallPage}`), /Second update\./)
  assert.equal(git(wiki.folder, 'rev-parse', 'HEAD'), main)
})

test('when merging main into the docs branch conflicts, the Step stops and fails, leaving the branch as it was and recording the conflict', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()
  wiki.commit('Rewrite the paywall page', { [paywallPage]: page([paywallSource], { body: 'Saransh rewrote this.' }) })

  const result = await nextRun()

  assert.equal(result.status, 1)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
  assert.equal(ws.workerCliCalls('claude').length, 1, 'only the first Run called the Docs Agent')
  const { status, files } = JSON.parse(ws.readRunFile(nextRunId, 'docs.json'))
  assert.deepEqual({ status, files }, { status: 'conflict', files: [paywallPage] })
  assert.equal(git(wiki.folder, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length, 1)
  assert.equal(git(wiki.folder, 'status', '--porcelain'), '')
})

test('when the Docs Agent finds nothing to change, nothing is committed and the docs branch stays where it was', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()

  const result = await nextRun({})

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
  assert.equal(JSON.parse(ws.readRunFile(nextRunId, 'docs.json')).status, 'no-edits')
})

test('while Saransh has the docs branch checked out, the Step fails without calling the Docs Agent or moving the branch under him', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()
  git(wiki.folder, 'checkout', '-q', docsBranch)

  const result = await nextRun()

  assert.equal(result.status, 1)
  assert.match(result.stdout + ws.readRunFile(nextRunId, 'logs', 'docs.log'), /checked out/)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
  assert.equal(git(wiki.folder, 'status', '--porcelain'), '')
  assert.equal(ws.workerCliCalls('claude').length, 1, 'only the first Run called the Docs Agent')
})

test("the Run records what waits on the docs branch for Saransh's review, from every Run since he last merged it", async () => {
  ws = makeWorkspace()
  const { wiki, nextRun } = await afterFirstDocsRun()
  wiki.commit('Add the home page', { 'repos/crux_flutter/home.md': page(['crux_flutter@main@1234567:lib/home.dart']) })

  const result = await nextRun({ [paywallPage]: page([paywallSource], { body: 'Second update.' }) })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(ws.readRunFile(nextRunId, 'docs.json')).waiting, { commits: 3, pages: [paywallPage] })
})

test('the Run records each Repo with new commits that the wiki has never documented, for Saransh to decide on', async () => {
  ws = makeWorkspace()
  const documented = ws.addRepo('crux_flutter')
  const undocumented = ws.addRepo('inpix-panel', { team: 'frontend' })
  const unchanged = ws.addRepo('news-read-go', { team: 'backend' })
  const froms = [documented, undocumented].map((repo) => lastFetched(repo))
  documented.pushCommit('Add home', { files: { 'lib/home.dart': 'class Home {}\n' } })
  undocumented.pushCommit('Add login', { files: { 'src/login.ts': 'export {}\n' } })
  undocumented.pushCommit('Add logout', { files: { 'src/logout.ts': 'export {}\n' } })
  const wiki = ws.addWiki()
  wiki.commit('Document the paywall', { [paywallPage]: page([paywallSource]), 'codebases/inpix/index.md': page(['inpix-panel@main@1234567:src/app.ts']) })
  prepareRun(wiki, [
    [documented, froms[0]],
    [undocumented, froms[1]],
    [unchanged, lastFetched(unchanged)],
  ])

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'docs.json')).undocumented, [{ repo: 'inpix-panel', team: 'frontend', commits: 2 }])
})

test('the Docs Step is skipped, not failed, while the env file names no wiki', async () => {
  ws = makeWorkspace()
  ws.writeRepoList([])
  ws.prepareRun(runId)

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.readRun(runId).steps.find((s) => s.name === 'docs')!.status, 'skipped')
})

test('re-running the Docs Step after it updated the wiki calls no Worker and adds no commit, unless forced', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip } = await afterFirstDocsRun()

  const rerun = await docs()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.workerCliCalls('claude').length, 1)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)

  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: page([paywallSource], { body: 'Forced update.' }) }))
  const forced = await docs('--force')

  assert.equal(forced.status, 0, forced.stderr)
  assert.equal(ws.workerCliCalls('claude').length, 2)
  assert.equal(git(wiki.folder, 'rev-parse', `${docsBranch}^`), firstTip)
})

test('with no page citing a changed file, the Docs Agent is not called and the docs branch is not made', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Add home', { files: { 'lib/home.dart': 'class Home {}\n' } })
  const wiki = ws.addWiki()
  wiki.commit('Document the paywall', { [paywallPage]: page(['crux_flutter@main@1234567:lib/paywall.dart']) })
  prepareRun(wiki, [[repo, from]])

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.workerCliCalls('claude'), [])
  assert.equal(git(wiki.folder, 'branch', '--list', docsBranch), '')
  assert.equal(JSON.parse(ws.readRunFile(runId, 'docs.json')).status, 'nothing-to-update')
})

const paywallPrd = '# Paywall PRD\n\nPremium subscribers see no paywall.\n'
const paywallCopy = '_sources/inpix/PRD/Paywall_PRD.md'
const paywallPrdPage = 'products/inpix/prds/paywall.md'

/** A PRD page in the shape the wiki's PRD template gives it. */
function prdPage(sources: string[] = ['wiki@1234567:_sources/inpix/PRD/Paywall_PRD.md'], { review = 'draft' } = {}): string {
  return ['---', 'type: prd', 'products: [inpix]', 'sources:', ...sources.map((s) => `  - ${s}`), `review: ${review}`, '---', '', '# Paywall', '', '> **In one line:** Premium subscribers skip the paywall', ''].join('\n')
}

/** A wiki that knows the InPix Codebase, with its PRD sources. */
function wikiWithInpix(): { wiki: TestWiki; main: string } {
  const wiki = ws.addWiki()
  const main = wiki.commit('Add the InPix sources', { '_sources/inpix/README.md': '# InPix sources\n' })
  return { wiki, main }
}

/** `claude --print` answering as the Docs Agent that turned the paywall PRD in the inbox into its PRD page. */
const paywallPrdWritten = (files: Record<string, string> = {}) =>
  claudeCodeEditing(
    { [paywallCopy]: paywallPrd, [paywallPrdPage]: prdPage(), ...files },
    { pages: [], prds: [{ file: 'Paywall_PRD.md', codebase: 'inpix', page: paywallPrdPage, summary: 'Premium subscribers skip the paywall.' }], skipped: [] },
  )

test("a PRD waiting in the PRD inbox becomes a PRD page on the docs branch beside its copy in its Codebase's PRD sources, committed as Saransh with the Agent and Run named", async () => {
  ws = makeWorkspace()
  const { wiki, main } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', paywallPrdWritten())

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(promptInput(call.stdin, 'prds'), [{ file: 'Paywall_PRD.md', staged: '_runs/prds/inbox/Paywall_PRD.md', discordMessage: null }])
  assert.match(call.cwdChanges!, /^\?\? _runs\/prds\/inbox\/Paywall_PRD\.md$/m)
  assert.equal(git(wiki.folder, 'show', `${docsBranch}:${paywallCopy}`), paywallPrd.trimEnd())
  assert.match(git(wiki.folder, 'show', `${docsBranch}:${paywallPrdPage}`), /^# Paywall$/m)
  assert.equal(git(wiki.folder, 'ls-tree', '-r', '--name-only', docsBranch, '_runs/prds/inbox/'), '', 'the inbox files staged for the Agent are not committed')
  const commits = git(wiki.folder, 'log', '--format=%an <%ae>|%(trailers:key=Agent,valueonly,separator=)|%(trailers:key=Run,valueonly,separator=)', `${main}..${docsBranch}`).split('\n')
  assert.ok(commits.length >= 1)
  for (const commit of commits) assert.equal(commit, `Saransh Khanna <saransh@example.com>|docs|${runId}`)
  assert.equal(git(wiki.folder, 'rev-parse', 'HEAD'), main)
})

const paywallMessage = 'https://discord.com/channels/1000000000000000001/1100000000000000001/1300000000000000001'

test('a PRD that came from Discord cites the Discord message in its page\'s sources, and once committed moves to done/ in the inbox, keeping its sources.json entry there', async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  ws.writePrdInboxFile('sources.json', JSON.stringify({ 'Paywall_PRD.md': { message: paywallMessage, attachment: '1400000000000000001' } }))
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', paywallPrdWritten())

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(promptInput(call.stdin, 'prds'), [{ file: 'Paywall_PRD.md', staged: '_runs/prds/inbox/Paywall_PRD.md', discordMessage: paywallMessage }])
  assert.match(git(wiki.folder, 'show', `${docsBranch}:${paywallPrdPage}`), new RegExp(`^sources:\\n  - wiki@1234567:${paywallCopy}\\n  - ${paywallMessage}  # the Discord message this copy came from\\n`, 'm'))
  assert.deepEqual(ws.prdInboxFiles(), ['done', 'sources.json'])
  assert.equal(ws.readPrdInboxFile('done/Paywall_PRD.md'), paywallPrd)
  assert.deepEqual(JSON.parse(ws.readPrdInboxFile('sources.json')), { 'done/Paywall_PRD.md': { message: paywallMessage, attachment: '1400000000000000001' } })
  const { prds, skipped } = JSON.parse(ws.readRunFile(runId, 'docs.json'))
  assert.deepEqual({ prds, skipped }, { prds: [{ file: 'Paywall_PRD.md', codebase: 'inpix', page: paywallPrdPage, summary: 'Premium subscribers skip the paywall.' }], skipped: [] })
})

test("a file in the PRD inbox that isn't a PRD moves to skipped/ with the Docs Agent's reason, keeping its sources.json entry, and with nothing else to change the docs branch isn't made", async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Lunch_menu.pdf', '%PDF-1.7\nFriday lunch')
  ws.writePrdInboxFile('sources.json', JSON.stringify({ 'Lunch_menu.pdf': { message: paywallMessage, attachment: '1400000000000000002' } }))
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', claudeCodeEditing({}, { pages: [], prds: [], skipped: [{ file: 'Lunch_menu.pdf', reason: 'A lunch menu, not a PRD.' }] }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(wiki.folder, 'branch', '--list', docsBranch), '')
  assert.deepEqual(ws.prdInboxFiles(), ['skipped', 'sources.json'])
  assert.equal(ws.readPrdInboxFile('skipped/Lunch_menu.pdf'), '%PDF-1.7\nFriday lunch')
  assert.deepEqual(JSON.parse(ws.readPrdInboxFile('sources.json')), { 'skipped/Lunch_menu.pdf': { message: paywallMessage, attachment: '1400000000000000002' } })
  const { status, prds, skipped } = JSON.parse(ws.readRunFile(runId, 'docs.json'))
  assert.deepEqual({ status, prds, skipped }, { status: 'no-edits', prds: [], skipped: [{ file: 'Lunch_menu.pdf', reason: 'A lunch menu, not a PRD.' }] })
})

test("with nothing waiting in the PRD inbox, only files it already handled and Finder's .DS_Store, the Docs Agent is given no PRDs, and with no page to update it isn't called", async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const { wiki } = wikiWithInpix()
  wiki.commit('Document the paywall', { [paywallPage]: page([paywallSource]) })
  ws.writePrdInboxFile('.DS_Store', 'Finder')
  ws.writePrdInboxFile('done/Paywall_PRD.md', paywallPrd)
  ws.writePrdInboxFile('sources.json', JSON.stringify({ 'done/Paywall_PRD.md': { message: paywallMessage, attachment: '1400000000000000001' } }))
  prepareRun(wiki, [[repo, from]])
  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: page([paywallSource], { body: 'Updated.' }) }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(promptInput(call.stdin, 'prds'), [])
  assert.equal(promptInput(call.stdin, 'prdPinsFile'), null)
  assert.doesNotMatch(call.cwdChanges!, /_runs\//)
  assert.deepEqual(ws.prdInboxFiles(), ['.DS_Store', 'done', 'sources.json'])

  prepareRun(wiki, [[repo, lastFetched(repo)]], { id: nextRunId })
  const quiet = await ws.agents('step', 'docs', '--run', nextRunId)

  assert.equal(quiet.status, 0, quiet.stderr)
  assert.equal(ws.workerCliCalls('claude').length, 1, 'only the first Run called the Docs Agent')
  assert.equal(JSON.parse(ws.readRunFile(nextRunId, 'docs.json')).status, 'nothing-to-update')
})

test("a PRD's copy is committed before the wiki's tools run, and its page is stamped and checked at the PRD pins, which name every Repo fetched in the Run at its head", async () => {
  ws = makeWorkspace()
  const changed = ws.addRepo('crux_flutter')
  const from = lastFetched(changed)
  const head = changed.pushCommit('Add home', { files: { 'lib/home.dart': 'class Home {}\n' } })
  const unchanged = ws.addRepo('inpix-panel', { team: 'frontend' })
  const { wiki, main } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  prepareRun(wiki, [
    [changed, from],
    [unchanged, lastFetched(unchanged)],
  ])
  ws.setWorkerCli('claude', paywallPrdWritten())

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  const prdPins = promptInput(call.stdin, 'prdPinsFile') as string
  assert.equal(readFileSync(prdPins, 'utf8'), `crux_flutter main ${changed.folder} ${head}\ninpix-panel main ${unchanged.folder} ${lastFetched(unchanged)}\n`)
  assert.ok(!prdPins.startsWith(realpathSync(ws.dataDir) + '/worktrees') && !prdPins.startsWith(join(ws.dataDir, 'worktrees')), 'the PRD pins stay out of the wiki, where the Agent could change them')
  assert.equal(git(wiki.folder, 'ls-tree', '-r', '--name-only', docsBranch, '_runs/'), '', 'and off the docs branch')
  const runs = wiki.toolRuns()
  assert.deepEqual(
    runs.map((r) => [r.tool, r.args]),
    [
      ['regions', []],
      ['stamp', [prdPins, paywallPrdPage]],
      ['check', [paywallPrdPage, '--pins', prdPins]],
    ],
  )
  assert.equal(git(wiki.folder, 'show', '--name-only', '--format=%s', runs[1].head), `Add PRD copies from the PRD inbox\n\n${paywallCopy}`)
  assert.equal(git(wiki.folder, 'rev-parse', `${runs[1].head}^`), main)
})

test("when the wiki's check still reports errors on a PRD page, nothing is committed and the PRD stays waiting in the inbox, while a file that isn't a PRD is still set aside", async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  ws.writePrdInboxFile('Lunch_menu.pdf', '%PDF-1.7\nFriday lunch')
  prepareRun(wiki, [])
  ws.setWorkerCli(
    'claude',
    claudeCodeEditing(
      { [paywallCopy]: paywallPrd, [paywallPrdPage]: prdPage(undefined) + '\nThe price is BROKEN (?).\n' },
      {
        pages: [],
        prds: [{ file: 'Paywall_PRD.md', codebase: 'inpix', page: paywallPrdPage, summary: 'Premium subscribers skip the paywall.' }],
        skipped: [{ file: 'Lunch_menu.pdf', reason: 'A lunch menu, not a PRD.' }],
      },
    ),
  )

  const result = await docs()

  assert.equal(result.status, 1)
  assert.equal(git(wiki.folder, 'branch', '--list', docsBranch), '')
  assert.deepEqual(ws.prdInboxFiles(), ['Paywall_PRD.md', 'skipped'])
  const { status, prds, skipped } = JSON.parse(ws.readRunFile(runId, 'docs.json'))
  assert.deepEqual({ status, prds, skipped }, { status: 'check-failed', prds: [], skipped: [{ file: 'Lunch_menu.pdf', reason: 'A lunch menu, not a PRD.' }] })
})

test("with PRDs waiting, a Docs Agent that writes a PRD copy that isn't the inbox file, a copy in a Codebase the wiki doesn't have, or a Repo's first page gets nothing committed, and the inbox stays as it was", async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  prepareRun(wiki, [])
  ws.setWorkerCli(
    'claude',
    paywallPrdWritten({
      [paywallCopy]: '# Paywall PRD, as the Agent remembers it\n',
      '_sources/smaran/PRD/Paywall_PRD.md': paywallPrd,
      'repos/inpix-panel/index.md': page(['inpix-panel@main@1234567:src/app.ts']),
    }),
  )

  const result = await docs()

  assert.equal(result.status, 1)
  assert.equal(git(wiki.folder, 'branch', '--list', docsBranch), '')
  assert.deepEqual(ws.prdInboxFiles(), ['Paywall_PRD.md'])
  const { status, files } = JSON.parse(ws.readRunFile(runId, 'docs.json'))
  assert.deepEqual({ status, files: files.sort() }, { status: 'rejected', files: [paywallCopy, '_sources/smaran/PRD/Paywall_PRD.md', 'repos/inpix-panel/index.md'] })
})

test('a PRD the Docs Agent says it turned into a page, without writing that page, stays waiting in the inbox', async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  ws.writePrdInboxFile('Wallet_PRD.md', '# Wallet PRD\n')
  prepareRun(wiki, [])
  ws.setWorkerCli(
    'claude',
    claudeCodeEditing(
      { [paywallCopy]: paywallPrd, [paywallPrdPage]: prdPage() },
      {
        pages: [],
        prds: [
          { file: 'Paywall_PRD.md', codebase: 'inpix', page: paywallPrdPage, summary: 'Premium subscribers skip the paywall.' },
          { file: 'Wallet_PRD.md', codebase: 'inpix', page: 'products/inpix/prds/wallet.md', summary: 'A wallet.' },
        ],
        skipped: [],
      },
    ),
  )

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['Wallet_PRD.md', 'done'])
  assert.deepEqual(
    JSON.parse(ws.readRunFile(runId, 'docs.json')).prds.map((p: { file: string }) => p.file),
    ['Paywall_PRD.md'],
  )
})

test('a dry run moves nothing out of the PRD inbox, whatever the fake Worker answers', async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Lunch_menu.pdf', '%PDF-1.7\nFriday lunch')
  prepareRun(wiki, [], { dryRun: true })
  ws.writeCannedAnswers({ docs: [{ answer: { pages: [], prds: [], skipped: [{ file: 'Lunch_menu.pdf', reason: 'A lunch menu, not a PRD.' }] } }] })

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['Lunch_menu.pdf'])
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'docs.json')).skipped, [])
})

test("the folder indexes the wiki's regions tool makes for a new PRD page, here one shared by two Products, are committed with it", async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  prepareRun(wiki, [])
  const shared = 'products/shared/prds/paywall.md'
  const index = (title: string) => ['---', 'type: index', '---', '', `# ${title}`, ''].join('\n')
  ws.setWorkerCli(
    'claude',
    claudeCodeEditing(
      { [paywallCopy]: paywallPrd, [shared]: prdPage(), 'products/shared/index.md': index('Shared across Products'), 'products/shared/prds/index.md': index('PRDs for two or more Products') },
      { pages: [], prds: [{ file: 'Paywall_PRD.md', codebase: 'inpix', page: shared, summary: 'Premium subscribers skip the paywall.' }], skipped: [] },
    ),
  )

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(git(wiki.folder, 'ls-tree', '-r', '--name-only', docsBranch, 'products/').split('\n'), ['products/shared/index.md', 'products/shared/prds/index.md', shared])
})

test("a PRD page for one Product adds that Product's folder index beside it", async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', paywallPrdWritten({ 'products/inpix/index.md': ['---', 'type: index', '---', '', '# InPix', ''].join('\n') }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(git(wiki.folder, 'ls-tree', '-r', '--name-only', docsBranch, 'products/').split('\n'), ['products/inpix/index.md', paywallPrdPage])
})

test("a Docs Agent that changes the wiki's own tools, here its check, gets nothing committed, and the Step runs none of them", async () => {
  ws = makeWorkspace()
  const { wiki, firstTip, nextRun } = await afterFirstDocsRun()
  const toolRunsBefore = wiki.toolRuns().length

  const result = await nextRun({
    [paywallPage]: page([paywallSource], { body: 'The price is BROKEN (?).' }),
    '_wiki/tools/check.mjs': "console.log('0 errors')\n",
  })

  assert.equal(result.status, 1)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
  const { status, files } = JSON.parse(ws.readRunFile(nextRunId, 'docs.json'))
  assert.deepEqual({ status, files }, { status: 'rejected', files: ['_wiki/tools/check.mjs'] })
  assert.equal(wiki.toolRuns().length, toolRunsBefore)
})

for (const tool of ['regions', 'stamp']) {
  test(`when the wiki's ${tool} tool fails on the Docs Agent's edits, nothing is committed and the check never runs`, async () => {
    ws = makeWorkspace()
    const { wiki, firstTip, nextRun } = await afterFirstDocsRun()
    const file = `_wiki/tools/${tool}.mjs`
    wiki.commit(`Break the ${tool} tool`, { [file]: `${readFileSync(join(wiki.folder, file), 'utf8')}console.error('${tool} broke')\nprocess.exitCode = 1\n` })
    const toolRunsBefore = wiki.toolRuns().length

    const result = await nextRun()

    assert.equal(result.status, 1)
    assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
    const recorded = JSON.parse(ws.readRunFile(nextRunId, 'docs.json'))
    assert.deepEqual([recorded.status, recorded.tool], ['tool-failed', tool])
    assert.match(recorded.output, new RegExp(`${tool} broke`))
    assert.deepEqual(
      wiki.toolRuns().slice(toolRunsBefore).map((r) => r.tool),
      tool === 'regions' ? ['regions'] : ['regions', 'stamp'],
    )
  })
}

test('when both Workers fail, the Run still records what waits on the docs branch, and the failed forced retry replaces the earlier success', async () => {
  ws = makeWorkspace()
  const { wiki, firstTip } = await afterFirstDocsRun()
  ws.setWorkerCli('claude', { stderr: 'Session limit reached', exitCode: 1 })
  ws.setWorkerCli('codex', { stderr: 'Codex is overloaded', exitCode: 1 })

  const forced = await docs('--force')

  assert.equal(forced.status, 1)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), firstTip)
  const recorded = JSON.parse(ws.readRunFile(runId, 'docs.json'))
  assert.equal(recorded.status, 'failed')
  assert.match(recorded.error, /Session limit reached/)
  assert.deepEqual(recorded.waiting, { commits: 1, pages: [paywallPage] })
})

test('commits whose documentation failed are documented in a later Run, though their review succeeded and Fetch finds nothing new there', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  const from = lastFetched(repo)
  repo.pushCommit('Price from payments', { files: { 'lib/paywall.dart': 'class Paywall {}\n' } })
  const wiki = ws.addWiki()
  wiki.commit('Document the paywall', { [paywallPage]: page([paywallSource]) })
  prepareRun(wiki, [[repo, from]])
  ws.setWorkerCli('claude', { stderr: 'Session limit reached', exitCode: 1 })
  assert.equal((await docs()).status, 1)
  const saved = await ws.agents('step', 'save-state', '--run', runId)
  assert.equal(saved.status, 0, saved.stderr)

  prepareRun(wiki, [[repo, lastFetched(repo)]], { id: nextRunId })
  ws.setWorkerCli('claude', claudeCodeEditing({ [paywallPage]: page([paywallSource], { body: 'Updated at last.' }) }))
  const next = await ws.agents('step', 'docs', '--run', nextRunId)

  assert.equal(next.status, 0, next.stderr)
  assert.match(git(wiki.folder, 'show', `${docsBranch}:${paywallPage}`), /Updated at last\./)
  const call = ws.workerCliCalls('claude').at(-1)!
  assert.deepEqual(
    (promptInput(call.stdin, 'repos') as { from: string; to: string }[]).map((r) => [r.from, r.to]),
    [[from, lastFetched(repo)]],
  )
})

test('a re-run finishes moving the inbox files of PRD pages an interrupted Run committed, without calling the Docs Agent again, and redoes the work when the branch never moved', async () => {
  ws = makeWorkspace()
  const { wiki, main } = wikiWithInpix()
  const entry = { 'Paywall_PRD.md': { message: paywallMessage, attachment: '1400000000000000001' } }
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  ws.writePrdInboxFile('sources.json', JSON.stringify(entry))
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', paywallPrdWritten())
  assert.equal((await docs()).status, 0)
  const tip = git(wiki.folder, 'rev-parse', docsBranch)
  /** As if the Run had stopped before it moved the file out of the inbox. */
  const unmove = () => {
    renameSync(join(ws.dataDir, 'prd-inbox', 'done', 'Paywall_PRD.md'), join(ws.dataDir, 'prd-inbox', 'Paywall_PRD.md'))
    ws.writePrdInboxFile('sources.json', JSON.stringify(entry))
  }
  unmove()

  const rerun = await docs()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(ws.workerCliCalls('claude').length, 1)
  assert.equal(git(wiki.folder, 'rev-parse', docsBranch), tip)
  assert.deepEqual(ws.prdInboxFiles(), ['done', 'sources.json'])
  assert.deepEqual(JSON.parse(ws.readPrdInboxFile('sources.json')), { 'done/Paywall_PRD.md': entry['Paywall_PRD.md'] })

  // As if the Run had stopped before the branch moved, too.
  unmove()
  git(wiki.folder, 'update-ref', `refs/heads/${docsBranch}`, main)
  const redone = await docs()

  assert.equal(redone.status, 0, redone.stderr)
  assert.equal(ws.workerCliCalls('claude').length, 2)
  assert.match(git(wiki.folder, 'show', `${docsBranch}:${paywallPrdPage}`), /^# Paywall$/m)
  assert.deepEqual(ws.prdInboxFiles(), ['done', 'sources.json'])
})

test('a file the Docs Agent set aside, which Saransh moves back into the inbox, keeps its Discord message, and its PRD page cites it', async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  const source = { message: paywallMessage, attachment: '1400000000000000001' }
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  ws.writePrdInboxFile('sources.json', JSON.stringify({ 'Paywall_PRD.md': source }))
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', claudeCodeEditing({}, { pages: [], prds: [], skipped: [{ file: 'Paywall_PRD.md', reason: 'Looks like meeting notes.' }] }))
  assert.equal((await docs()).status, 0)
  renameSync(join(ws.dataDir, 'prd-inbox', 'skipped', 'Paywall_PRD.md'), join(ws.dataDir, 'prd-inbox', 'Paywall_PRD.md'))

  prepareRun(wiki, [], { id: nextRunId })
  ws.setWorkerCli('claude', paywallPrdWritten())
  const retried = await ws.agents('step', 'docs', '--run', nextRunId)

  assert.equal(retried.status, 0, retried.stderr)
  const call = ws.workerCliCalls('claude').at(-1)!
  assert.deepEqual(promptInput(call.stdin, 'prds'), [{ file: 'Paywall_PRD.md', staged: '_runs/prds/inbox/Paywall_PRD.md', discordMessage: paywallMessage }])
  assert.match(git(wiki.folder, 'show', `${docsBranch}:${paywallPrdPage}`), new RegExp(`  - ${paywallMessage}  # the Discord message this copy came from`))
  assert.deepEqual(JSON.parse(ws.readPrdInboxFile('sources.json')), { 'done/Paywall_PRD.md': source })
})

test('a PRD from Discord whose page has no frontmatter to cite the message in stays waiting in the inbox', async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  ws.writePrdInboxFile('sources.json', JSON.stringify({ 'Paywall_PRD.md': { message: paywallMessage, attachment: '1400000000000000001' } }))
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', paywallPrdWritten({ [paywallPrdPage]: '# Paywall\n\nPremium subscribers skip the paywall.\n' }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['Paywall_PRD.md', 'sources.json'])
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'docs.json')).prds, [])
})

test('a page the Docs Agent links to a new PRD page from is stamped at the PRD pins, which it traced the PRD at', async () => {
  ws = makeWorkspace()
  const { wiki } = wikiWithInpix()
  wiki.commit('Document the paywall', { [paywallPage]: page([paywallSource]) })
  ws.writePrdInboxFile('Paywall_PRD.md', paywallPrd)
  prepareRun(wiki, [])
  ws.setWorkerCli('claude', paywallPrdWritten({ [paywallPage]: page([paywallSource], { body: 'See [the PRD](../../products/inpix/prds/paywall.md).' }) }))

  const result = await docs()

  assert.equal(result.status, 0, result.stderr)
  const prdPins = promptInput(ws.workerCliCalls('claude')[0].stdin, 'prdPinsFile')
  assert.deepEqual(
    wiki.toolRuns().filter((r) => r.tool !== 'regions').map((r) => [r.tool, r.args]),
    [
      ['stamp', [prdPins, paywallPrdPage, paywallPage]],
      ['check', [paywallPrdPage, paywallPage, '--pins', prdPins]],
    ],
  )
})
